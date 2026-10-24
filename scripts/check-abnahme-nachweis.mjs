// Kein Shebang — wie check-review-nachweis.mjs: wird per `node scripts/check-abnahme-nachweis.mjs`
// gestartet (CI + lokal) UND von test/abnahme-nachweis.test.ts importiert.
/**
 * Abnahme-Nachweis-Wächter (ADR 0022 F13, #1755) — erzwingt in der PR-CI das Urteil der Holdout-Abnahme und seine Spur.
 *
 * Verlangt im Slice (Commits `<basis>..HEAD`) die Abnahme-Zeile (Schlüssel `abnahme` der Commit-Zeilen) und prüft sie gegen das verknüpfte Ticket:
 *  - ein Urteil je Akzeptanzkriterium (`kriterien()` des Issue-Bodys): fehlend, unbekannt (über der Anzahl) → rot; doppelte Nummern und
 *    unbekannte Werte fängt der Parser (`ungueltig`); jeder Wert ≠ erfuellt → rot (nicht-erfuellt, nicht-pruefbar);
 *    `nach-merge` ist nur an einem Kriterium mit dem Präfix `Nach dem Merge:` erlaubt (dort auch `erfuellt`), an einem normalen rot;
 *  - `1 ≤ durchgaenge ≤ runden` der Review-Zeile (auch die Delta-Lens nach einem Abnahme-Fix zählt als Pass, über dem Cap mit `abnahmefix=1` der Review-Zeile, auch eine Delta-Lens nach CI-Fix oder Konflikt-Merge
 *    hinter einer bestandenen Abnahme ist ein Pass);
 *  - head-Regel: `head` liegt im Slice, ist gleich oder Nachfahre des Review-head, danach nur leere Commits und konfliktfreie Merges;
 *  - die Spur: der jüngste vertraute Kommentar mit Abnahme-Marker auf dem PR trägt gleichen head, Durchgang == `durchgaenge`, gleiches Urteil;
 *  - `entfaellt` ist nur grün, wenn das Ticket keine Kriterien hat oder kein Ticket verknüpft ist.
 *
 * Das Ticket ist die einzige Schließ-Referenz im PR-Body (Umgebungsvariable `FACTORY_PR_BODY`, alle GitHub-Schlüsselwörter zählen); mehrere sind rot.
 * Ein Entwurfs-PR (`FACTORY_PR_DRAFT=true`) wird nur berichtet: maßgeblich ist der Lauf nach `ready_for_review`. Jeder git- oder gh-Fehler ist rot
 * (fail-closed). Druckventil: die Override-Zeile (Schlüssel `abnahmeOverride`, `#<nr> <warum>`), ausgewertet vor jedem gh-Aufruf.
 * Bewusst kein npm-`check:*`-Skript und nicht in `verify` (der Nachweis entsteht erst nach dem Review). Lokal:
 *   node scripts/check-abnahme-nachweis.mjs
 *
 * Mit `--config <pfad>` liest der Wächter eine andere Projekt-Config. Reines Node-Skript, nur Kern-Module als Importe.
 */
import { istDirektaufruf } from "./hook-io.mjs";
import { execFileSync } from "node:child_process";
import { resolveBase } from "./check-basis.mjs";
import { fehlerText, ghJson } from "./gh-cli.mjs";
import { issueKommentare } from "./fremdtext-lib.mjs";
import { MAX_REVIEW_PAESSE, parseNachweis, vertrauteAbnahmeMarker } from "./nachweis-lib.mjs";
import { ladeProjektConfig, spracheAus, trenneConfigArg, umgebungsWert, zerlegeRepo } from "./projekt-config-lib.mjs";
import { commitImSlice, commitZeilenAus, loeseCommit, meldeUngueltigeOverrides, sliceOverride } from "./slice-override.mjs";
import { kriterien } from "./spezifikation-lib.mjs";

/** Schließ-Referenzen eines PR-Bodys: verschiedene Ticketnummern zu close/fix/resolve (alle Beugungen, Groß-/Kleinschreibung egal, optional `:`). Pur. */
export function verknuepfteTickets(body) {
  const nummern = [...String(body ?? "").matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?[ \t]+#(\d+)\b/gi)].map((m) => Number(m[1]));
  return [...new Set(nummern)];
}

/** Der jüngste Kommentar (Reihenfolge der API: chronologisch) eines vertrauten Autors mit gültigem Abnahme-Marker, sonst `null`. Pur. */
export function vertrauterMarker(kommentare, owner, zeilen) {
  return vertrauteAbnahmeMarker(kommentare, owner, zeilen).at(-1) ?? null;
}

const menge = (urteil) => urteil.map((u) => `${u.k}:${u.wert}`).sort().join(",");

/** Die Vorlage für die Fehlerausgabe (Format: docs/agent-harness.md §3a). */
const vorlage = (zeilen) =>
  `${zeilen.abnahme}: head=<sha> durchgaenge=<n> urteil=K1:erfuellt,…   |   ${zeilen.abnahme}: entfaellt — <Grund>`;

/** Urteil je Kriterium gegen die Kriterien des Tickets (`[{k, nachMerge}]`) und gegen `erfuellt`; `nach-merge` gilt nur an einem Nach-Merge-Kriterium. */
function bewerteUrteil(urteil, liste, nachMerge) {
  const n = liste.length;
  const fehler = [];
  for (const u of urteil) {
    const nr = Number(u.k.slice(1));
    if (nr > n) fehler.push(`${u.k}: unbekannt, das Ticket hat nur ${n} Kriterium/Kriterien.`);
    else if (u.wert === "nach-merge") {
      if (!liste[nr - 1].nachMerge) fehler.push(`${u.k}: nach-merge ist nur bei einem Kriterium mit dem Präfix \`${nachMerge}\` erlaubt.`);
    } else if (u.wert !== "erfuellt") fehler.push(`${u.k}: ${u.wert} (Merge gestoppt, Abnahme nicht bestanden).`);
  }
  for (let i = 1; i <= n; i++) if (!urteil.some((u) => u.k === `K${i}`)) fehler.push(`K${i}: Urteil fehlt.`);
  return fehler;
}

/** Cap-Regel und head-Regel (`abnahmeHead`: {bekannt, imSlice, nachReviewHead, konfliktMerges, aenderungsCommits}). */
function bewerteHead(a, review, abnahmeHead) {
  const fehler = [];
  if (!review || !Number.isInteger(review.runden)) {
    fehler.push("Review-Zeile fehlt oder runden ist keine Zahl: die Abnahme zählt gegen das Cap der Review-Pässe.");
  } else if (a.durchgaenge > review.runden) {
    fehler.push(
      `durchgaenge=${a.durchgaenge} ist größer als runden=${review.runden}: jeder Abnahme-Durchgang nach der Konvergenz zählt als Pass, ` +
        `die Review-Zeile muss runden >= durchgaenge tragen (Cap ${MAX_REVIEW_PAESSE} Pässe, darüber nur mit Zusatzpass).`,
    );
  }
  if (!abnahmeHead.bekannt) return [...fehler, `Abnahme: head=${a.head} ist kein bekannter Commit.`];
  if (!abnahmeHead.imSlice) return [...fehler, `Abnahme: head=${a.head} liegt nicht im Slice dieses PR.`];
  if (review?.head && !abnahmeHead.nachReviewHead) fehler.push(`Abnahme: head=${a.head} ist kein Nachfahre des Review-head ${review.head}.`);
  for (const sha of abnahmeHead.konfliktMerges ?? []) fehler.push(`Konflikt-Merge ${sha} nach dem Abnahme-head: Auflösung ungeprüft.`);
  for (const c of abnahmeHead.aenderungsCommits ?? []) fehler.push(`Commit ${c.sha} nach dem Abnahme-head ändert Dateien (${c.dateien.join(", ")}): erneut abnehmen.`);
  return fehler;
}

/** Die Spur: der vertraute Marker auf dem PR gegen die Zeile. */
function bewerteSpur(a, marker) {
  if (!marker) return ["Spur fehlt: kein Kommentar eines vertrauten Autors mit Abnahme-Marker auf dem PR."];
  const fehler = [];
  const kurz = [a.head, marker.head.toLowerCase()];
  if (!(kurz[0].startsWith(kurz[1]) || kurz[1].startsWith(kurz[0]))) fehler.push(`Spur: Marker-head ${marker.head} weicht vom Abnahme-head ${a.head} ab.`);
  if (marker.durchgang !== a.durchgaenge) fehler.push(`Spur: Marker-Durchgang ${marker.durchgang} weicht von durchgaenge=${a.durchgaenge} ab.`);
  if (menge(marker.urteil) !== menge(a.urteil)) fehler.push("Spur: das Urteil im Marker weicht vom Urteil der Zeile ab.");
  return fehler;
}

/**
 * Bewertet den Abnahme-Nachweis; liefert `fehler[]` (leer = grün). Pur.
 * `ticket` = `{nr, kriterien: <Liste aus kriterien()>, nachMerge: <Präfix aus sprache.spezifikation>}` oder `null` (kein Ticket verknüpft), `marker` = Ergebnis von `vertrauterMarker`.
 */
export function bewerteAbnahme({ nachweis, ticket, marker, abnahmeHead, zeilen }) {
  const a = nachweis.abnahme;
  if (!a) return [`${zeilen.abnahme}: Zeile fehlt. Ablauf: node scripts/abnahme.mjs kriterien <nr>; Vorlage: ${vorlage(zeilen)}`];
  if (a.art === "ungueltig") return [`${zeilen.abnahme}: ungültig (${a.grund ? `${a.grund}: ` : ""}${a.zeile}). Vorlage: ${vorlage(zeilen)}`];
  if (a.art === "entfaellt") {
    return ticket && ticket.kriterien.length > 0 ? [`${zeilen.abnahme}: entfaellt ist bei Ticket #${ticket.nr} mit ${ticket.kriterien.length} Akzeptanzkriterien nicht erlaubt.`] : [];
  }
  if (!ticket) return [`${zeilen.abnahme}: ein Urteil braucht ein verknüpftes Ticket (Schließ-Referenz im PR-Body).`];
  return [...bewerteUrteil(a.urteil, ticket.kriterien, ticket.nachMerge), ...bewerteHead(a, nachweis.review, abnahmeHead), ...bewerteSpur(a, marker)];
}

const gitDefault = (args) => execFileSync("git", args, { encoding: "utf8" });

/** Liest die Daten zum Abnahme-head aus git: bekannt, im Slice, Nachfahre des Review-head, Konflikt-Merges und Änderungs-Commits danach. */
function leseAbnahmeHead(git, base, abnahmeSha, reviewSha) {
  const a = commitImSlice(git, base, abnahmeSha);
  const leer = { bekannt: a.bekannt, imSlice: false, nachReviewHead: false, konfliktMerges: [], aenderungsCommits: [] };
  if (!a.imSlice) return leer;
  const rSha = reviewSha ? loeseCommit(git, reviewSha) : null;
  return {
    ...leer,
    imSlice: true,
    nachReviewHead: rSha !== null && git(["merge-base", rSha, a.sha]).trim() === rSha,
    konfliktMerges: a.konfliktMerges,
    aenderungsCommits: a.aenderungsCommits,
  };
}

/**
 * Führt die Prüfung aus. `runGit`, `gh` (liefert geparstes JSON), `env`, `ladeConfig` injizierbar. Fail-closed: Config-, git- und gh-Fehler sind rot.
 * Liefert `{ok, fehler, override?, entwurf?, skipped?, invalid}`; ein Entwurf bleibt `ok` und trägt die Fehler nur als Bericht.
 */
export function checkAbnahmeNachweis({ runGit, gh = (a) => ghJson(a), env = process.env, ladeConfig = () => ladeProjektConfig() } = {}) {
  let config;
  let zeilen;
  try {
    config = ladeConfig();
    zeilen = commitZeilenAus(config);
  } catch (e) {
    return { ok: false, fehler: [e instanceof Error ? e.message : String(e)], invalid: [] };
  }
  const git = runGit ?? gitDefault;
  const base = resolveBase(git, env);
  if (!base) return { ok: false, fehler: ["Keine Vergleichs-Basis auflösbar (flacher Checkout?): Abnahme-Nachweis nicht prüfbar."], invalid: [] };
  let fehler;
  try {
    if (git(["rev-parse", "HEAD"]).trim() === base) return { ok: true, skipped: true, fehler: [], invalid: [] };
    const ov = sliceOverride(git, base, zeilen.abnahmeOverride);
    if (ov.reason !== null) return { ok: true, override: ov.reason, overrideKey: zeilen.abnahmeOverride, fehler: [], invalid: ov.invalid };
    fehler = pruefe({ git, gh, env, config, zeilen, base });
  } catch (e) {
    fehler = [`Fehler beim Prüfen des Abnahme-Nachweises (git/gh): ${fehlerText(e)}`];
  }
  const entwurf = umgebungsWert(env, "FACTORY_PR_DRAFT") === "true";
  return { ok: fehler.length === 0 || entwurf, entwurf: entwurf && fehler.length > 0, fehler, invalid: [] };
}

/** Der eigentliche Ablauf nach Override-Prüfung; wirft bei git- oder gh-Fehlern (der Aufrufer wertet das als rot). */
function pruefe({ git, gh, env, config, zeilen, base }) {
  const repo = env.GITHUB_REPOSITORY || config.repo;
  const { owner } = zerlegeRepo(repo);
  const nachweis = parseNachweis(git(["log", "--reverse", "--format=%B", `${base}..HEAD`]), zeilen);
  const nummern = verknuepfteTickets(umgebungsWert(env, "FACTORY_PR_BODY"));
  if (nummern.length > 1) return [`Mehr als ein verknüpftes Ticket im PR-Body (${nummern.map((n) => `#${n}`).join(", ")}): ein PR gehört zu einem Ticket.`];
  let ticket = null;
  if (nummern.length === 1) {
    const issue = gh(["api", `repos/${repo}/issues/${nummern[0]}`]);
    if (issue?.pull_request) return [`#${nummern[0]} im PR-Body ist ein PR, kein Ticket.`];
    const sprache = spracheAus(config).spezifikation;
    ticket = { nr: nummern[0], kriterien: kriterien(issue?.body ?? "", sprache), nachMerge: sprache.nachMerge };
  }
  const abnahmeHead = nachweis.abnahme?.art === "urteil" ? leseAbnahmeHead(git, base, nachweis.abnahme.head, nachweis.review?.head) : null;
  let marker = null;
  if (nachweis.abnahme?.art === "urteil") {
    // Ohne PR-Nummer bleibt es rot (fail-closed), zeigt aber vorher die Head-Fehler (Konflikt-Merge hinter der Abnahme), damit der lokale Lauf sie sieht.
    if (!/^\d+$/.test(umgebungsWert(env, "FACTORY_PR_NUMBER") ?? "")) return [...bewerteHead(nachweis.abnahme, nachweis.review, abnahmeHead), "PR-Nummer fehlt (FACTORY_PR_NUMBER): die Spur ist nicht prüfbar."];
    marker = vertrauterMarker(issueKommentare(umgebungsWert(env, "FACTORY_PR_NUMBER"), gh, repo), owner, zeilen);
  }
  return bewerteAbnahme({ nachweis, ticket, marker, abnahmeHead, zeilen });
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(argv = process.argv.slice(2)) {
  const getrennt = trenneConfigArg(argv);
  if (getrennt.fehler) {
    console.error(getrennt.fehler);
    process.exit(1);
  }
  const r = checkAbnahmeNachweis({ ladeConfig: () => ladeProjektConfig({ pfad: getrennt.pfad }) });
  if (r.skipped) {
    console.log("• check-abnahme-nachweis: Basis == HEAD, nichts zu prüfen.");
    return;
  }
  if (r.override) {
    console.log(`• geduldet: ${r.overrideKey} — ${r.override}`);
    console.log("✔ Abnahme-Nachweis ok (Override mit Begründung).");
    return;
  }
  meldeUngueltigeOverrides(r.invalid);
  if (r.entwurf) {
    console.log("• Entwurf, nur Bericht (maßgeblich ist der Lauf nach ready_for_review):");
    for (const f of r.fehler) console.log(`  - ${f}`);
    return;
  }
  if (r.ok) {
    console.log("✔ Abnahme-Nachweis ok.");
    return;
  }
  console.error("✖ Abnahme-Nachweis fehlt oder ist ungültig (ADR 0022 F13):");
  for (const f of r.fehler) console.error(`  - ${f}`);
  console.error("\nNach bestandener Holdout-Abnahme setzt der Umsetzer einen leeren Commit mit der Zeile (Format: docs/agent-harness.md §3a); Override: Schlüssel `abnahmeOverride` der Commit-Zeilen, `#<nr> <warum>`.");
  process.exit(1);
}

if (istDirektaufruf(import.meta.url)) main();
