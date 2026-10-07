#!/usr/bin/env node
// Kein weiterer Shebang-Zwang: wird vom Workflow gestartet UND von test/langfuse-takt.test.ts importiert.
/**
 * Takt für „Langfuse-Status überprüfen“ (#1351, ADR 0016: wöchentlich plus nach Aktivität) und für das Harness-Sammelticket (#1349). Der Workflow
 * `.github/workflows/langfuse-takt.yml` ruft dieses Skript; die Entscheidung ist pur und getestet
 * (test/langfuse-takt.test.ts), nur die gh-Aufrufe ganz unten sind es nicht.
 *
 * Idempotent und ohne gespeicherten Zähler: jedes Mal wird aus den offenen Issues und der Commit-Liste von
 * main abgeleitet, was zu tun ist. Zwei Läufe hintereinander (der Workflow serialisiert sie über seine
 * Concurrency-Group) legen darum nie zwei Tickets an und lassen die Position nicht springen.
 *
 * Nur Node-Builtins, analog zu board-lib.mjs.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  LANGFUSE_SAMMELTICKET_TITEL,
  SAMMELTICKET_TITEL,
  STATUS_TITEL,
  addToBoardTodo,
  imKopf,
  kopfEnde,
  loadItems,
  loadOpenIssuePages,
  sammelticketItem,
  setPosition,
} from "./board-lib.mjs";

export { STATUS_TITEL };
export const SAMMEL_TITEL = LANGFUSE_SAMMELTICKET_TITEL;
/** Aktivitäts-Untergrenze: so viele Commits auf main seit dem Abschluss des Vorgängers, sonst kein neues Ticket. */
export const MIN_MERGES = 5;
/** Push-Auslöser (Aktivität): so viele Ticket-Merges (ohne Bots) seit dem Abschluss des Vorgängers legen das Status-Ticket an bzw. holen es nach oben. */
export const MIN_TICKET_MERGES_PUSH = 8;
/** Harness-Sammelticket: so viele Ticket-Merges seit dem Abschluss des letzten Sammeltickets holen das ungeclaimte nach oben (hinter den Kopf). */
export const HARNESS_TAKT_MERGES = 5;

const TAG_MS = 24 * 60 * 60 * 1000;

const alsDatum = (wert, name) => {
  const d = wert instanceof Date ? wert : new Date(wert);
  if (Number.isNaN(d.getTime())) throw new Error(`Ungültiges Datum für ${name}: ${String(wert)}`);
  return d;
};

/**
 * Antwort von `gh api --paginate --slurp repos/<repo>/issues?state=open` (Liste von Seiten) → offene Issues
 * `{ number, titel, assignees, createdAt }`. Pull Requests fliegen raus. Wirft bei unerwarteter Form, statt still
 * ein Ticket zu übersehen (das führte zu einem Doppel-Ticket).
 */
export function normalizeOffene(pages) {
  if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p))) {
    throw new Error("Unerwartete Antwortform der offenen Issues (keine Liste von Seiten).");
  }
  return pages
    .flat()
    .filter((i) => !i?.pull_request)
    .map((i) => {
      if (!Number.isInteger(i?.number) || typeof i.title !== "string" || typeof i.created_at !== "string") {
        throw new Error(`Unerwartete Form eines Issues: ${JSON.stringify(i)?.slice(0, 120)}`);
      }
      return {
        number: i.number,
        titel: i.title,
        assignees: Array.isArray(i.assignees) ? i.assignees.map((a) => a?.login).filter((l) => typeof l === "string") : [],
        createdAt: i.created_at,
      };
    });
}

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
 * Was tut der Lauf mit dem Status-Ticket? `offene` aus normalizeOffene, `mergesSeit` = Zahl der Commits auf main im Fenster,
 * `ticketMerges` = davon Ticket-Merges ohne Bots, `ausloeser` = Workflow-Event (`push` zählt nur Aktivität: mindestens
 * `MIN_TICKET_MERGES_PUSH` Ticket-Merges, sonst nichts; alles andere ist der Wochen-Cron mit `MIN_MERGES`).
 * Liefert `{ aktion: "anlegen" | "nach-oben" | "nichts", nr?, grund, warnungen }`. Pur.
 */
export function entscheideTakt({ offene, mergesSeit, ticketMerges = 0, ausloeser = "schedule" }) {
  if (!Array.isArray(offene)) throw new Error("offene muss eine Liste sein.");
  if (!Number.isInteger(mergesSeit) || mergesSeit < 0) throw new Error(`mergesSeit muss eine ganze Zahl ≥ 0 sein, war ${String(mergesSeit)}`);
  const treffer = offene
    .filter((i) => i.titel === STATUS_TITEL)
    .sort((a, b) => alsDatum(a.createdAt, "createdAt") - alsDatum(b.createdAt, "createdAt") || a.number - b.number);
  const warnungen = [];
  if (treffer.length > 1) {
    warnungen.push(`Mehrere offene „${STATUS_TITEL}“ (${treffer.map((t) => `#${t.number}`).join(", ")}): der Lauf arbeitet mit dem ältesten und schließt nichts selbst.`);
  }
  const push = ausloeser === "push";
  if (push && ticketMerges < MIN_TICKET_MERGES_PUSH) {
    return { aktion: "nichts", grund: `Push: nur ${ticketMerges} Ticket-Merges seit dem letzten Abschluss (Untergrenze ${MIN_TICKET_MERGES_PUSH})`, warnungen };
  }
  if (treffer.length > 0) {
    const geclaimt = treffer.find((t) => t.assignees.length > 0);
    if (geclaimt) return { aktion: "nichts", grund: `#${geclaimt.number} ist geclaimt und läuft schon`, warnungen };
    return { aktion: "nach-oben", nr: treffer[0].number, grund: `#${treffer[0].number} ist offen und ungeclaimt, kommt an die Spitze`, warnungen };
  }
  if (mergesSeit < MIN_MERGES) {
    return { aktion: "nichts", grund: `nur ${mergesSeit} Merges seit dem letzten Abschluss (Untergrenze ${MIN_MERGES})`, warnungen };
  }
  return { aktion: "anlegen", grund: `${mergesSeit} Merges seit dem letzten Abschluss, kein offenes Status-Ticket`, warnungen };
}

/**
 * Harness-Sammelticket nach Aktivität: `items` = Board in Reihenfolge (board-lib), `ticketMergesSeitAbschluss` = Ticket-Merges
 * seit dem Abschluss des letzten Harness-Sammeltickets. Ab `HARNESS_TAKT_MERGES` kommt das erste ungeclaimte Harness-Sammelticket
 * direkt hinter den Kopf (Status-, Notfall-, Dependabot-, Forum-Ticket), nie vor einen roten main. Steht es dort schon, ist
 * der Lauf idempotent. Liefert `{ aktion: "nach-oben" | "nichts", nr?, afterId?, grund }`. Pur.
 */
export function entscheideHarnessTakt({ items, ticketMergesSeitAbschluss }) {
  if (!Array.isArray(items)) throw new Error("items muss eine Liste sein.");
  if (!Number.isInteger(ticketMergesSeitAbschluss) || ticketMergesSeitAbschluss < 0) {
    throw new Error(`ticketMergesSeitAbschluss muss eine ganze Zahl ≥ 0 sein, war ${String(ticketMergesSeitAbschluss)}`);
  }
  const ticket = sammelticketItem(items);
  if (!ticket) return { aktion: "nichts", grund: `kein ungeclaimtes „${SAMMELTICKET_TITEL}“` };
  if (ticketMergesSeitAbschluss < HARNESS_TAKT_MERGES) {
    return { aktion: "nichts", grund: `nur ${ticketMergesSeitAbschluss} Ticket-Merges seit dem letzten Sammelticket (Untergrenze ${HARNESS_TAKT_MERGES})` };
  }
  const ende = kopfEnde(items);
  const idx = items.findIndex((i) => i.id === ticket.id);
  if (items.slice(ende, idx).every((i) => i.state !== "open")) {
    return { aktion: "nichts", grund: `#${ticket.number} steht schon direkt hinter dem Kopf` };
  }
  return {
    aktion: "nach-oben",
    nr: ticket.number,
    afterId: ende > 0 ? items[ende - 1].id : null,
    grund: `${ticketMergesSeitAbschluss} Ticket-Merges seit dem letzten Sammelticket, #${ticket.number} kommt hinter den Kopf`,
  };
}

/** Montag 00:00 UTC der Kalenderwoche, in der `d` liegt. */
const wochenStart = (d) => {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const tag = (new Date(t).getUTCDay() + 6) % 7; // Mo=0
  return t - tag * TAG_MS;
};

/** Letzte volle Kalenderwoche (Mo–So UTC) vor `jetzt` und die davor, als `YYYY-MM-DD`. Pur. */
export function wochenFenster(jetzt) {
  const mo = wochenStart(alsDatum(jetzt, "jetzt"));
  const tag = (ms) => new Date(ms).toISOString().slice(0, 10);
  const woche = (start) => ({ von: tag(start), bis: tag(start + 6 * TAG_MS) });
  return { letzte: woche(mo - 7 * TAG_MS), davor: woche(mo - 14 * TAG_MS) };
}

/** Body des neu angelegten Status-Tickets. `vorgaenger` = `{ number, closedAt }` oder null. Pur. */
export function statusBody({ vorgaenger, jetzt }) {
  const w = wochenFenster(jetzt);
  const zeitraum = vorgaenger
    ? `seit dem Abschluss von #${vorgaenger.number} (${vorgaenger.closedAt}) bis zum Claim`
    : "seit dem Merge von #1293 bis zum Claim";
  const repo = "https://github.com/fluffels/kubernia/blob/main/docs";
  return [
    "Wiederkehrende Auswertung der Langfuse-Daten, vom Wochen-Workflow angelegt (kein Agent legt dieses Ticket an).",
    "",
    `- **Zeitraum:** ${zeitraum}.`,
    `- **Wochenbudget:** letzte volle Woche ${w.letzte.von} bis ${w.letzte.bis} (Mo–So UTC) gegen die Woche davor ${w.davor.von} bis ${w.davor.bis}.`,
    `- **Checkliste:** [docs/model-routing.md › Langfuse-Status überprüfen](${repo}/model-routing.md#langfuse-status-überprüfen-1293).`,
    `- **Mechanik:** [docs/ticket-reihenfolge.md](${repo}/ticket-reihenfolge.md#wiederkehrendes-ticket-langfuse-status-überprüfen-1293).`,
    `- **Abschluss:** Bericht-Kommentar geschrieben, große Befunde als Issues, kleine als Zeilen ins Sammelticket „${SAMMEL_TITEL}“ (danach per \`board-place.mjs --top\` nach oben), PR mit Verdichtungszeile und \`Closes\`.`,
  ].join("\n");
}

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const ghJson = (args) => JSON.parse(gh(args));

/** Item hinzufügen (idempotent), Status Todo setzen, an die Spitze schieben (alles aus board-lib). Wirft bei jedem Fehler einer Mutation. */
function setzeBoardSpitze(nodeId, token) {
  setPosition(addToBoardTodo(nodeId, { token }), null, { token });
}

function main() {
  const dry = process.argv.includes("--dry-run");
  const repo = process.env.GITHUB_REPOSITORY || "fluffels/kubernia";
  const ausloeser = process.env.GITHUB_EVENT_NAME || "schedule";
  const token = process.env.PROJECT_TOKEN;
  const jetzt = new Date();
  const offene = normalizeOffene(loadOpenIssuePages(repo));
  const seit = new Date(jetzt.getTime() - 90 * TAG_MS).toISOString();
  const geschlossen = ghJson(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=closed&labels=area:harness&since=${seit}&per_page=100`])
    .flat()
    .filter((i) => !i.pull_request && typeof i.closed_at === "string")
    .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));
  const letzter = (titel) => {
    const g = geschlossen.find((i) => i.title === titel);
    return g ? { number: g.number, closedAt: g.closed_at } : null;
  };
  const vorgaenger = letzter(STATUS_TITEL);
  const abStatus = mergeFensterAb(vorgaenger?.closedAt ?? null, jetzt).toISOString();
  const abHarness = mergeFensterAb(letzter(SAMMELTICKET_TITEL)?.closedAt ?? null, jetzt).toISOString();
  const fruehestens = abStatus < abHarness ? abStatus : abHarness;
  const commits = ghJson(["api", "--paginate", "--slurp", `repos/${repo}/commits?sha=main&since=${fruehestens}&per_page=100`]).flat();
  const imFenster = commits.filter((c) => new Date(c?.commit?.committer?.date ?? 0).getTime() >= new Date(abStatus).getTime());
  const e = entscheideTakt({ offene, mergesSeit: imFenster.length, ticketMerges: zaehleTicketMerges(commits, abStatus), ausloeser });
  for (const w of e.warnungen) console.log(`::warning::${w}`);
  console.log(`Status-Ticket (${ausloeser}): ${e.aktion}${e.nr ? ` #${e.nr}` : ""} (${e.grund}); Fenster ab ${abStatus}`);
  let fehler = false;
  if (!dry && e.aktion !== "nichts") fehler = !fuehreStatusAus(e, { repo, vorgaenger, jetzt, token });

  // Harness-Sammelticket nach Aktivität (gleicher Mechanismus, eigenes Fenster).
  if (!token) {
    console.log("::warning::PROJECT_TOKEN fehlt: Harness-Sammelticket-Takt übersprungen (die Board-Liste braucht den Projekt-Scope).");
  } else {
    const items = loadItems({ token });
    const h = entscheideHarnessTakt({ items, ticketMergesSeitAbschluss: zaehleTicketMerges(commits, abHarness) });
    console.log(`Harness-Sammelticket: ${h.aktion}${h.nr ? ` #${h.nr}` : ""} (${h.grund}); Fenster ab ${abHarness}`);
    if (!dry && h.aktion === "nach-oben") {
      try {
        setPosition(items.find((i) => i.number === h.nr).id, h.afterId, { token });
        console.log("Sammelticket-Position gesetzt.");
      } catch (err) {
        console.log(`::error::Sammelticket-Position nicht gesetzt: ${String(err.message).split("\n")[0]}. Die Wiederholung ist idempotent.`);
        fehler = true;
      }
    }
  }
  if (fehler) process.exitCode = 1;
}

/** Status-Ticket anlegen bzw. nach oben schieben; true bei Erfolg (oder fehlendem Token, das nur warnt). */
function fuehreStatusAus(e, { repo, vorgaenger, jetzt, token }) {
  let nodeId;
  if (e.aktion === "anlegen") {
    const neu = ghJson([
      "api", "-X", "POST", `repos/${repo}/issues`,
      "-f", `title=${STATUS_TITEL}`, "-f", `body=${statusBody({ vorgaenger, jetzt })}`, "-f", "labels[]=area:harness",
    ]);
    console.log(`Angelegt: #${neu.number}`);
    nodeId = neu.node_id;
  } else {
    nodeId = ghJson(["api", `repos/${repo}/issues/${e.nr}`]).node_id;
  }
  if (!token) {
    console.log("::warning::PROJECT_TOKEN fehlt, Board-Position nicht gesetzt (das Ticket steht dann nicht im Board, der nächste Lauf trägt es nach, sofern es ungeclaimt und der Token gesetzt ist; nach dem Setzen des Tokens auch sofort per workflow_dispatch).");
    return true;
  }
  try {
    if (e.aktion === "nach-oben" && imKopf(loadItems({ token }), e.nr)) {
      console.log("Status-Ticket steht schon im Kopf, Position bleibt.");
      return true;
    }
    setzeBoardSpitze(nodeId, token);
    console.log("Board-Position oben gesetzt.");
    return true;
  } catch (err) {
    console.log(`::error::Board-Position nicht gesetzt: ${String(err.message).split("\n")[0]}. Die Wiederholung ist idempotent und legt kein zweites Ticket an.`);
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
