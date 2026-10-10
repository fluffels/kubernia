#!/usr/bin/env node
// Kein weiterer Shebang-Zwang: wird vom Workflow gestartet UND von test/board-takt.test.ts importiert.
/**
 * Generischer Board-Takt (#1390, ursprünglich #1351/#1349): der Workflow `.github/workflows/board-takt.yml` ruft dieses Skript. Es pflegt
 *  1. das Status-Ticket „Langfuse-Status überprüfen“ (Entscheidung und Anlegen: scripts/langfuse-takt.mjs, ADR 0016) und
 *  2. das ungeclaimte Harness-Sammelticket „Harness-Härtung (gesammelt)“: nach `HARNESS_TAKT_MERGES` Spiel-Merges (Spielquote, #1425) hinter den Kopf
 *     holen und, unabhängig von der Aktivität, auf die Position laut AGENTS.md zurückschieben, wenn es dahinter steht (Selbstkorrektur,
 *     nur nach vorn, nie in den Kopf).
 * Die Entscheidungen sind pur und getestet (test/board-takt.test.ts, test/langfuse-takt.test.ts), nur die gh-Aufrufe in `main` sind es nicht.
 *
 * Idempotent und ohne gespeicherten Zähler: jedes Mal wird aus den offenen Issues, der Commit-Liste von main und der Board-Liste
 * abgeleitet, was zu tun ist. Zwei Läufe hintereinander (der Workflow serialisiert sie über seine Concurrency-Group) legen darum nie
 * zwei Tickets an und lassen die Position nicht springen. Die Board-Liste wird je Lauf EINMAL geladen und nach der Status-Aktion im
 * Speicher nachgezogen.
 *
 * Nur Node-Builtins, analog zu board-lib.mjs. `--dry-run` zeigt die Entscheidungen, ändert nichts.
 */
import { pathToFileURL } from "node:url";
import { mitKontingent } from "./kontingent-lib.mjs";
import {
  REPO,
  SAMMELTICKET_TITEL,
  STATUS_TITEL,
  TAG_MS,
  alsDatum,
  ghJson,
  kopfEnde,
  loadItems,
  loadOpenIssuePages,
  normalizeOffene,
  positionLautAgentsMd,
  sammelticketItem,
  sammelticketKorrektur,
  setPosition,
  todoItem,
  verschiebe,
} from "./board-lib.mjs";
import { entscheideTakt, fuehreStatusAus } from "./langfuse-takt.mjs";

/** Spielquote (#1425): höchstens 1 Harness-Ticket auf so viele Spiel-Tickets. */
export const SPIEL_QUOTE = 3;

/** Harness-Sammelticket: so viele SPIEL-Merges seit dem Abschluss des letzten Sammeltickets holen das ungeclaimte nach oben (hinter den Kopf).
 *  Gleich der Spielquote: Harness-Merges verdienen keinen weiteren Harness-Platz (#1425). */
export const HARNESS_TAKT_MERGES = SPIEL_QUOTE;

/**
 * Beginn des Aktivitätsfensters: 60 s nach dem Abschluss des Vorgängers (dessen eigener Squash-Commit soll nicht
 * zählen), ohne Vorgänger 7 Tage vor `jetzt`.
 */
export function mergeFensterAb(letzterAbschluss, jetzt) {
  const j = alsDatum(jetzt, "jetzt");
  if (letzterAbschluss === null || letzterAbschluss === undefined) return new Date(j.getTime() - 7 * TAG_MS);
  return new Date(alsDatum(letzterAbschluss, "letzterAbschluss").getTime() + 60_000);
}

/**
 * Zahl der Ticket-Merges in einer Commit-Liste von main (`repos/<repo>/commits`): Commits, deren Autor kein Bot ist
 * (Dependabot, github-actions: Login endet auf `[bot]`). Mit `seit` zählen nur Commits ab diesem Zeitpunkt. Pur.
 */
export function zaehleTicketMerges(commits, seit = null) {
  if (!Array.isArray(commits)) throw new Error("commits muss eine Liste sein.");
  const ab = seit === null ? null : alsDatum(seit, "seit").getTime();
  return commits.filter((c) => {
    if (/\[bot\]$/i.test(String(c?.author?.login ?? ""))) return false;
    if (ab === null) return true;
    const t = new Date(c?.commit?.committer?.date ?? c?.commit?.author?.date ?? "").getTime();
    return Number.isFinite(t) && t >= ab;
  }).length;
}

/**
 * Ist dieser Commit von main ein Harness-Merge? Der Squash-Commit trägt den PR-Titel `feat(<scope>): …`; Scope `harness` markiert
 * Harness-Arbeit (Konvention aus AGENTS.md, in den letzten 14 Tagen 86 von 125 Commits). Bot-Commits sind keine Ticket-Merges. Pur.
 * Seit #1428 zählt das Label: `harnessIssues` ist die Menge der Nummern geschlossener `area:harness`-Issues (90 Tage, lädt `main` ohnehin).
 * Nennt die Titelzeile `#N`-Referenzen, entscheiden sie allein: eine davon in der Menge = Harness, sonst Spiel (so zählen `docs(adr)`
 * und `fix(ci)` zu einem Harness-Issue als Harness, ein `feat(harness)` zu einem Spiel-Issue als Spiel). Ohne Referenz oder ohne Menge
 * (null) bleibt der Rückfall auf den COMMIT-SCOPE `(harness)`. Bewusste Grenze: ein Commit ohne `#N` im Titel (Handarbeit) zählt nur
 * über den Scope; ein Titel mit nur einer PR-Nummer zählt als Spiel (keine PR→Issue-Auflösung, #1460 Z6: von 139 Commits tragen 128 Issue und
 * PR, die 11 mit einer Nummer sind Dependabot, keiner ist ohne; der Scope-Rückfall greift praktisch nie).
 */
export function istHarnessCommit(commit, harnessIssues = null) {
  const kopf = String(commit?.commit?.message ?? "").split(/\r?\n/, 1)[0];
  const refs = [...kopf.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  if (harnessIssues && refs.length > 0) return refs.some((n) => harnessIssues.has(n));
  return /^[a-z]+\(harness\)!?:/i.test(kopf);
}

/** Spiel-Merges in einer Commit-Liste: Ticket-Merges (`zaehleTicketMerges`) ohne Harness-Commits (`istHarnessCommit`); mit `seit` nur ab diesem Zeitpunkt. Pur. */
export function zaehleSpielMerges(commits, seit = null, harnessIssues = null) {
  if (!Array.isArray(commits)) throw new Error("commits muss eine Liste sein.");
  return zaehleTicketMerges(commits.filter((c) => !istHarnessCommit(c, harnessIssues)), seit);
}

/**
 * Die Spielquote des Fensters als Zahlen und Zeile für das Protokoll: `harness` und `spiel` = Ticket-Merges (ohne Bots) mit bzw. ohne
 * Harness-Zuordnung (`istHarnessCommit`), `eingehalten` = höchstens 1 Harness auf `SPIEL_QUOTE` Spiel (Notfälle und Security gelten als Harness, sofern ihr Issue `area:harness` trägt, und
 * zählen hier mit; das Protokoll ist Information, kein Gate). Pur.
 */
export function quotenBericht(commits, seit = null, harnessIssues = null) {
  const harness = zaehleTicketMerges(commits.filter((c) => istHarnessCommit(c, harnessIssues)), seit);
  const spiel = zaehleSpielMerges(commits, seit, harnessIssues);
  const eingehalten = harness * SPIEL_QUOTE <= spiel;
  return { harness, spiel, eingehalten, zeile: `Spielquote: ${harness} Harness- auf ${spiel} Spiel-Merges im Fenster (Soll höchstens 1:${SPIEL_QUOTE}), ${eingehalten ? "eingehalten" : "überschritten"}` };
}

/**
 * Harness-Sammelticket: `items` = Board in Reihenfolge (board-lib), `spielMergesSeitAbschluss` = Spiel-Merges (`zaehleSpielMerges`) seit dem Abschluss des
 * letzten Harness-Sammeltickets, `position` = Position laut AGENTS.md (`sammelticketPosition`). Reihenfolge der Regeln:
 *  1. Ab `HARNESS_TAKT_MERGES` kommt das erste ungeclaimte Harness-Sammelticket direkt hinter den zusammenhängenden Kopf ganz oben
 *     (Status-, Notfall-, Dependabot-, Forum-Ticket) → `nach-oben`. Steht es dort schon, ist der Lauf idempotent.
 *  2. Sonst, und auch bei wenig Aktivität: steht es hinter der Position laut AGENTS.md, geht es dorthin zurück (`sammelticketKorrektur`:
 *     nur nach vorn, nie in den Kopf) → `auf-position`.
 *  3. Sonst nichts.
 * Grenze: ein Kopf-Item, das nicht zusammenhängend oben steht, zählt nicht zum Kopf. Liefert `{ aktion: "nach-oben" | "auf-position" | "nichts", nr?, afterId?, grund }`.
 * Ungültige Eingaben (auch ein `position` unter 1) werfen. Pur.
 */
export function entscheideHarnessTakt({ items, spielMergesSeitAbschluss, position }) {
  if (!Array.isArray(items)) throw new Error("items muss eine Liste sein.");
  if (!Number.isInteger(spielMergesSeitAbschluss) || spielMergesSeitAbschluss < 0) {
    throw new Error(`spielMergesSeitAbschluss muss eine ganze Zahl ≥ 0 sein, war ${String(spielMergesSeitAbschluss)}`);
  }
  if (!Number.isInteger(position) || position < 1) throw new RangeError(`position muss eine ganze Zahl ≥ 1 sein, war ${String(position)}`);
  const ticket = sammelticketItem(items);
  if (!ticket) return { aktion: "nichts", grund: `kein ungeclaimtes „${SAMMELTICKET_TITEL}“` };
  const ende = kopfEnde(items);
  const idx = items.findIndex((i) => i.id === ticket.id);
  const direktHinterKopf = items.slice(ende, idx).every((i) => i.state !== "open");
  if (spielMergesSeitAbschluss >= HARNESS_TAKT_MERGES && !direktHinterKopf) {
    return {
      aktion: "nach-oben",
      nr: ticket.number,
      afterId: ende > 0 ? items[ende - 1].id : null,
      grund: `${spielMergesSeitAbschluss} Spiel-Merges seit dem letzten Sammelticket, #${ticket.number} kommt hinter den Kopf`,
    };
  }
  const k = sammelticketKorrektur(items, position);
  if (k) {
    return {
      aktion: "auf-position",
      nr: k.nr,
      afterId: k.afterId,
      grund: `#${k.nr} stand auf Rang ${k.vonRang}, zurück auf Rang ${k.nachRang} (Position ${position} laut AGENTS.md)`,
    };
  }
  if (spielMergesSeitAbschluss < HARNESS_TAKT_MERGES) {
    return { aktion: "nichts", grund: `nur ${spielMergesSeitAbschluss} Spiel-Merges seit dem letzten Sammelticket (Untergrenze ${HARNESS_TAKT_MERGES}), Position stimmt` };
  }
  return { aktion: "nichts", grund: `#${ticket.number} steht schon direkt hinter dem Kopf` };
}

/**
 * Die Harness-Entscheidung aus der Commit-Liste von main: zählt NUR Spiel-Merges seit `seit` (dem Fenster ab dem Abschluss des letzten
 * Sammeltickets) und fragt damit `entscheideHarnessTakt`. Eigene pure Funktion, damit die Verdrahtung (Spiel- statt aller Merges)
 * getestet ist und `main` nichts anderes tut als sie aufzurufen. Pur.
 */
export function harnessTaktAusCommits({ items, commits, seit, position, harnessIssues = null }) {
  return entscheideHarnessTakt({ items, spielMergesSeitAbschluss: zaehleSpielMerges(commits, seit, harnessIssues), position });
}

/**
 * Zieht die im Speicher gehaltene Board-Liste nach einer Status-Aktion nach (statt sie neu zu laden): `ergebnis` = `{ nr, itemId }` aus
 * `fuehreStatusAus` bzw. null/ohne `itemId` (nichts bewegt). Das Status-Item steht danach an der Spitze, ein noch nicht gelistetes
 * (frisch angelegt, die REST-Liste liefert es verzögert) wird vorn ergänzt. Pur.
 */
export function ziehListeNach(items, ergebnis) {
  if (!ergebnis?.itemId) return items;
  const vorhanden = items.find((i) => i.id === ergebnis.itemId || i.number === ergebnis.nr);
  if (vorhanden) return verschiebe(items, vorhanden.id, null);
  return [todoItem({ id: ergebnis.itemId, number: ergebnis.nr, title: STATUS_TITEL }), ...items];
}

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────

/**
 * Darf der Harness-Teil des Takts laufen? Er braucht die Board-Liste (Projekt-Scope des Tokens) und die Position laut AGENTS.md.
 * Fehlt etwas, entfällt NUR dieser Teil (das Status-Ticket braucht beides nicht) und das wird sichtbar gemeldet: ein fehlender Token
 * ist eine Warnung (Exit 0, der Lauf ohne Token ist bekannt), eine fehlende oder mehrdeutige Position ein Fehler (Exit 1), denn die
 * Selbstkorrektur ist dann blind. Liefert `{ ok: true }` oder `{ ok: false, meldung, fehler }`. Pur.
 */
export function harnessVoraussetzung({ items, position, positionFehler }) {
  if (!items) return { ok: false, fehler: false, meldung: "::warning::PROJECT_TOKEN fehlt: Harness-Sammelticket-Takt übersprungen (die Board-Liste braucht den Projekt-Scope)." };
  if (!Number.isInteger(position) || position < 1) {
    return {
      ok: false,
      fehler: true,
      meldung: `::error::Harness-Sammelticket-Takt übersprungen, die Position laut AGENTS.md fehlt: ${String(positionFehler ?? "keine Position").split("\n")[0]}`,
    };
  }
  return { ok: true };
}

/** Harness-Entscheidung ausführen; true bei Erfolg. */
function fuehreHarnessAus(h, items, token) {
  try {
    setPosition(items.find((i) => i.number === h.nr).id, h.afterId, { token });
    console.log("Sammelticket-Position gesetzt.");
    return true;
  } catch (err) {
    console.log(`::error::Sammelticket-Position nicht gesetzt: ${String(err.message).split("\n")[0]}. Die Wiederholung ist idempotent.`);
    return false;
  }
}

/** Die echte I/O des Takts (gh, Board, Dateien); `fuehreTaktAus` nimmt sie injiziert, damit die Verdrahtung ohne Netz testbar ist. */
const ECHTE_IO = {
  ghJson,
  loadItems,
  loadOpenIssuePages,
  positionLautAgentsMd,
  fuehreStatusAus,
  fuehreHarnessAus,
  log: (z) => console.log(z),
};

/**
 * Der ganze Lauf (#1428 Z23, vorher `main`): Fenster berechnen, Status-Ticket und Harness-Sammelticket entscheiden und ausführen.
 * `io` bündelt jeden Zugriff nach außen (siehe `ECHTE_IO`). Liefert `{ fehler }`; der Aufrufer setzt daraus den Exit-Code.
 */
export function fuehreTaktAus({ jetzt, dry = false, repo = REPO, ausloeser = "schedule", token, io = ECHTE_IO }) {
  let position = null;
  let positionFehler = null;
  try {
    position = io.positionLautAgentsMd();
  } catch (err) {
    positionFehler = err.message;
  }
  const offene = normalizeOffene(io.loadOpenIssuePages(repo));
  const seit = new Date(jetzt.getTime() - 90 * TAG_MS).toISOString();
  const geschlossen = io.ghJson(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=closed&labels=area:harness&since=${seit}&per_page=100`])
    .flat()
    .filter((i) => !i.pull_request && typeof i.closed_at === "string")
    .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));
  // Die Nummern aller geschlossenen Harness-Issues: die Spielquote ordnet einen Commit über seine `#N`-Referenz zu (istHarnessCommit).
  const harnessIssues = new Set(geschlossen.map((i) => i.number));
  const letzter = (titel) => {
    const g = geschlossen.find((i) => i.title === titel);
    return g ? { number: g.number, closedAt: g.closed_at, createdAt: g.created_at } : null;
  };
  const vorgaenger = letzter(STATUS_TITEL);
  const abStatus = mergeFensterAb(vorgaenger?.closedAt ?? null, jetzt).toISOString();
  const abHarness = mergeFensterAb(letzter(SAMMELTICKET_TITEL)?.closedAt ?? null, jetzt).toISOString();
  const fruehestens = abStatus < abHarness ? abStatus : abHarness;
  const commits = io.ghJson(["api", "--paginate", "--slurp", `repos/${repo}/commits?sha=main&since=${fruehestens}&per_page=100`]).flat();
  const imFenster = commits.filter((c) => new Date(c?.commit?.committer?.date ?? 0).getTime() >= new Date(abStatus).getTime());
  // Die Board-Liste einmal je Lauf (braucht den Projekt-Scope des Tokens).
  let items = token ? io.loadItems({ token }) : null;

  const stundenSeitAbschluss = vorgaenger ? (jetzt.getTime() - new Date(vorgaenger.closedAt).getTime()) / (TAG_MS / 24) : null;
  const e = entscheideTakt({ offene, mergesSeit: imFenster.length, ticketMerges: zaehleTicketMerges(commits, abStatus), ausloeser, stundenSeitAbschluss });
  for (const w of e.warnungen) io.log(`::warning::${w}`);
  io.log(`Status-Ticket (${ausloeser}): ${e.aktion}${e.nr ? ` #${e.nr}` : ""} (${e.grund}); Fenster ab ${abStatus}`);
  let fehler = false;
  if (!dry && e.aktion !== "nichts") {
    const r = io.fuehreStatusAus(e, { repo, vorgaenger, jetzt, token, items: items ?? [] });
    fehler = !r.ok;
    if (items) items = ziehListeNach(items, r);
  }

  // Harness-Sammelticket: Aktivität (eigenes Fenster) und Positionskorrektur, auf der nachgezogenen Liste.
  const voraussetzung = harnessVoraussetzung({ items, position, positionFehler });
  if (!voraussetzung.ok) {
    io.log(voraussetzung.meldung);
    if (voraussetzung.fehler) fehler = true;
  } else {
    const h = harnessTaktAusCommits({ items, commits, seit: abHarness, position, harnessIssues });
    io.log(`Harness-Sammelticket: ${h.aktion}${h.nr ? ` #${h.nr}` : ""} (${h.grund}); Fenster ab ${abHarness}`);
    io.log(quotenBericht(commits, abHarness, harnessIssues).zeile);
    if (!dry && h.aktion !== "nichts" && !io.fuehreHarnessAus(h, items, token)) fehler = true;
  }
  return { fehler };
}

function main() {
  if (process.env.PROJECT_TOKEN) mitKontingent("board-takt", { token: process.env.PROJECT_TOKEN });
  const { fehler } = fuehreTaktAus({
    jetzt: new Date(),
    dry: process.argv.includes("--dry-run"),
    repo: REPO,
    ausloeser: process.env.GITHUB_EVENT_NAME || "schedule",
    token: process.env.PROJECT_TOKEN,
  });
  if (fehler) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.log(`::error::${String(err.message).split("\n")[0]}`);
    process.exitCode = 1;
  }
}
