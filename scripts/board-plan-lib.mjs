// Kein Shebang: reine Bibliothek. Importiert nie board-lib.mjs (board-lib importiert sie; sonst gäbe es einen Zyklus).
/**
 * Pure Plan-Funktionen zum Aufnehmen von Issues ins Board (aus board-lib.mjs herausgelöst, #78): sie brauchen nur die Projekt-Config
 * und sind ohne Netz und ohne Dateizugriff testbar.
 */
import { boardRolleFuer, fremdesBoardText } from "./projekt-config-lib.mjs";

/** Guard der Plan-Funktionen und der Lader: das Repo (`owner/name`), für das gilt, ist Pflicht (kein stiller Standardwert, #76). */
export function brauchtRepo(repo, wo) {
  if (typeof repo !== "string" || repo === "") throw new Error(`${wo}: repo fehlt\nFix: das Repo (owner/name), für das das Board gilt, als repo übergeben`);
}

/**
 * Aufnahme-Plan für Nummern, die weder die REST-Liste noch der GraphQL-Fallback im Board fand (#1428 Z37): ein frisch angelegtes Issue
 * stand nie im Board, `board-place` meldete nur „nicht gefunden“. `issues`: Nummer → REST-Antwort von `repos/<repo>/issues/<nr>` (oder
 * null/fehlend, wenn nicht ladbar). Aufgenommen werden nur offene Issues (keine PRs) mit `node_id`; der `--after`-Anker (`ankerNr`) nie
 * automatisch, ein Issue, dessen Board ein anderes Repo als `repo` führt, nie. Liefert `{ aufnehmen: [{ number, nodeId, title, rolle }], abgelehnt: [{ number, grund }] }`.
 * `repo` ist Pflicht (wirft ohne). Pur.
 */
export function aufnahmePlan(fehlend, issues, { config, ankerNr = null, repo } = {}) {
  brauchtRepo(repo, "aufnahmePlan");
  const aufnehmen = [];
  const abgelehnt = [];
  for (const nr of fehlend) {
    const i = issues?.[nr] ?? null;
    const grund = aufnahmeGrund(nr, i, ankerNr) ?? fremdGrund(i, repo, config);
    if (grund) abgelehnt.push({ number: nr, grund });
    else aufnehmen.push({ number: nr, nodeId: i.node_id, title: typeof i.title === "string" ? i.title : "", rolle: boardRolleFuer(i.labels ?? [], config) });
  }
  return { aufnehmen, abgelehnt };
}

/** Pur: warum `aufnahmePlan` das Issue `i` (REST-Antwort oder null) der Nummer `nr` nicht aufnimmt, sonst `null`. */
function aufnahmeGrund(nr, i, ankerNr) {
  if (nr === ankerNr) return "Anker wird nie automatisch aufgenommen";
  if (!i || i.number !== nr) return "Issue nicht ladbar oder unbekannt";
  if (i.pull_request) return "ist ein Pull Request";
  if (i.state !== "open") return "Issue ist geschlossen";
  return typeof i.node_id !== "string" || i.node_id === "" ? "Antwort ohne node_id" : null;
}

/** Pur: erste Zeile des Fremd-Board-Texts, wenn das Board der Rolle des Issues `i` ein anderes Repo als `repo` führt, sonst `null`. */
function fremdGrund(i, repo, config) {
  return fremdesBoardText(boardRolleFuer(i.labels ?? [], config), repo, config)?.split("\n")[0] ?? null;
}
