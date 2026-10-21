#!/usr/bin/env node
/* Harness-Doctor (ADR 0022, #1799): meldet, welche GitHub- und Langfuse-Voraussetzungen der Factory im Projekt fehlen.
 *
 *   node scripts/harness-doctor.mjs --pruefen [--config <pfad>]
 *
 * Je Lücke eine Zeile `LÜCKE <Punkt>: <Befund> Fix: <Anweisung>`; Exit 0 ohne Lücke, 1 mit mindestens einer, 2 bei Aufruf-Fehler oder
 * unlesbarer Config bzw. unlesbarem Ruleset-Spiegel (dann ohne einen einzigen gh-Aufruf). Reines Node-Skript ohne Modell-Tokens; `gh` und
 * der Langfuse-Aufruf sind injizierbar (Tests laufen ohne Netz). Alles Projektspezifische kommt zur Laufzeit aus `.factory/projekt.json`
 * und den Workflows (`voraussetzungenAus`); der Wächter test/harness/harness-doctor-voraussetzungen.test.ts hält die Ableitung vollständig.
 *
 * Bekannte Grenzen: private Repos auf GitHub Free kennen keine Rulesets (ADR 0022), dort ist das fehlende Ruleset eine Lücke mit dieser
 * Erklärung; `allowed_actions: selected` gilt als erlaubt (welche Actions, prüft der Doctor nicht); geprüft werden nur Repo- und Org-Secrets
 * bzw. -Variablen der Actions (keine Environment-Secrets); ein fein granulares Token hat keinen Scope-Header, dann nur ein HINWEIS.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { fehlerText, ghText } from "./gh-cli.mjs";
import { istDirektaufruf } from "./hook-io.mjs";
import { boardPfad, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { ladeRulesetSpiegel } from "./docs-gen/ruleset-spiegel.mjs";

const SKRIPTE = dirname(fileURLToPath(import.meta.url));
const USAGE = "Aufruf: node scripts/harness-doctor.mjs --pruefen [--config <pfad>]";

export const STATUS_FELD_NAME = "Status";
export const TODO_OPTION_NAME = "Todo";

const optionName = (o) => (typeof o?.name === "string" ? o.name : o?.name?.raw);
/** Je Board-Schlüssel der Config eine Prüfung gegen die GitHub-Antworten `b` (Board) und `f` (Status-Feld); `null` = in Ordnung.
 *  `besitzer` und `besitzerTyp` stecken im REST-Pfad: stimmen sie nicht, scheitert schon der Abruf. */
const BOARD_PRUEFUNG = {
  besitzer: () => null,
  besitzerTyp: () => null,
  nummer: (board, b) => (b.number !== board.nummer ? `nummer ${board.nummer} passt nicht zum Board (${b.number})` : null),
  projectId: (board, b) => (b.node_id !== board.projectId ? `projectId ${board.projectId} passt nicht zum Board (${b.node_id})` : null),
  statusFeldId: (board, b, f) => (f.name !== STATUS_FELD_NAME ? `statusFeldId zeigt auf das Feld "${f.name}", erwartet "${STATUS_FELD_NAME}"` : null),
  statusFeldNodeId: (board, b, f) => (f.node_id !== board.statusFeldNodeId ? `statusFeldNodeId ${board.statusFeldNodeId} passt nicht zum Feld (${f.node_id})` : null),
  todoOptionId: (board, b, f) => {
    const opt = (f.options ?? []).find((o) => o.id === board.todoOptionId);
    return !opt || optionName(opt) !== TODO_OPTION_NAME ? `todoOptionId ${board.todoOptionId} ist nicht die Option "${TODO_OPTION_NAME}"` : null;
  },
};
/** Board-Schlüssel der Config, die der Doctor gegen GitHub prüft (der Wächter hält sie mit den Skripten zusammen). */
export const BOARD_PRUEFPUNKTE = Object.keys(BOARD_PRUEFUNG);

const LABEL_FLAG = /--(?:add-)?label[ =]+(?:"([^"$]+)"|'([^'$]+)'|([^\s"'$\\]+))/g;
const LABEL_ENV = /^\s*\w*LABEL\w*:\s*(.+?)\s*$/gm;
const SECRET_VAR = /\b(secrets|vars)\.([A-Za-z_]\w*)/g;

const ohneAnfuehrung = (s) => s.replace(/^(["'])(.*)\1$/, "$2");

/** Pur: leitet aus Config und Workflows ab, was das Projekt braucht: `{ secrets, variablen, labels, boards }`. */
export function voraussetzungenAus({ config, workflows }) {
  const secrets = new Set();
  const variablen = new Set();
  const labels = new Map();
  const merke = (name) => {
    if (name && !labels.has(name.toLowerCase())) labels.set(name.toLowerCase(), name);
  };
  for (const wert of Object.values(config.labels ?? {})) merke(wert);
  for (const { text } of workflows) {
    for (const [, art, name] of text.matchAll(SECRET_VAR)) if (name !== "GITHUB_TOKEN") (art === "secrets" ? secrets : variablen).add(name);
    for (const m of text.matchAll(LABEL_FLAG)) for (const l of (m[1] ?? m[2] ?? m[3]).split(",")) merke(l.trim());
    for (const [, wert] of text.matchAll(LABEL_ENV)) if (!wert.includes("${{") && !wert.includes("$")) merke(ohneAnfuehrung(wert));
  }
  return { secrets: [...secrets].sort(), variablen: [...variablen].sort(), labels: [...labels.values()], boards: config.boards ?? [] };
}

const erste = (e) => fehlerText(e).split("\n")[0];
const json = (gh, args) => JSON.parse(gh(args));
/** Seiten von `gh api --paginate --slurp` zu einer Liste (`schluessel` = Feld je Seite, sonst die Seite selbst). */
const seiten = (gh, pfad, schluessel) => json(gh, ["api", "--paginate", "--slurp", pfad]).flatMap((s) => (schluessel ? (s[schluessel] ?? []) : s));
const luecke = (punkt, befund, fix) => ({ punkt, ok: false, befund, fix });
const gut = (punkt) => ({ punkt, ok: true });
const fehlen = (soll, ist, gleich = (a, b) => a === b) => soll.filter((s) => !ist.some((i) => gleich(s, i)));
const ohneCase = (a, b) => a.toLowerCase() === b.toLowerCase();

function pruefeToken(gh) {
  let kopf;
  try {
    kopf = gh(["api", "-i", "user"]);
  } catch (e) {
    return { fatal: true, ergebnis: [luecke("Token", `gh nicht angemeldet oder ohne Zugriff (${erste(e)})`, "gh auth login --scopes project")] };
  }
  const scopes = /^x-oauth-scopes:\s*(.*)$/im.exec(kopf);
  if (!scopes) return { ergebnis: [{ ...gut("Token-Scope"), hinweis: "kein Scope-Header (fein granulares Token): Project-Zugriff nicht prüfbar" }] };
  if (!scopes[1].split(",").map((s) => s.trim()).includes("project")) {
    return { ergebnis: [luecke("Token-Scope", "dem Token fehlt der Scope project (Boards lesen und schreiben)", "gh auth refresh -s project")] };
  }
  return { ergebnis: [gut("Token-Scope")] };
}

function pruefeRepo(gh, repo) {
  try {
    const r = json(gh, ["api", `repos/${repo}`]);
    const admin = r.permissions?.admin === true ? gut("Admin-Recht") : luecke("Admin-Recht", `das Konto hat kein Admin-Recht an ${repo}`, `dem Konto Admin-Recht an ${repo} geben (Einstellungen, Collaborators)`);
    return { repo: r, ergebnis: [admin] };
  } catch (e) {
    return { repo: {}, ergebnis: [luecke("Admin-Recht", `Repo ${repo} nicht lesbar (${erste(e)})`, "gh auth status prüfen und das Konto mit Zugriff auf das Repo anmelden")] };
  }
}

function pruefeActions(gh, repo) {
  try {
    const a = json(gh, ["api", `repos/${repo}/actions/permissions`]);
    if (a.enabled !== true || a.allowed_actions === "local_only") {
      return luecke("Actions", "Actions sind im Repo nicht erlaubt", `gh api -X PUT repos/${repo}/actions/permissions -F enabled=true -f allowed_actions=all`);
    }
    return gut("Actions");
  } catch (e) {
    return luecke("Actions", `Actions-Einstellung nicht lesbar (${erste(e)})`, "Admin-Recht und Token prüfen");
  }
}

function pruefeGeheimnisse(gh, repo, art, namen) {
  const [pfad, org, schluessel, setzen] = art === "secrets"
    ? ["actions/secrets", "actions/organization-secrets", "secrets", "gh secret set"]
    : ["actions/variables", "actions/organization-variables", "variables", "gh variable set"];
  const punkt = art === "secrets" ? "Secret" : "Variable";
  let ist;
  try {
    ist = seiten(gh, `repos/${repo}/${pfad}`, schluessel).map((s) => s.name);
  } catch (e) {
    return [luecke(punkt, `${art} nicht lesbar (${erste(e)})`, "Admin-Recht und Token prüfen")];
  }
  try {
    ist.push(...seiten(gh, `repos/${repo}/${org}`, schluessel).map((s) => s.name));
  } catch {
    /* Org-Abruf ist optional: ein Nutzer-Repo hat keine Org-Geheimnisse */
  }
  const l = fehlen(namen, ist).map((n) => luecke(`${punkt} ${n}`, `${n} fehlt (ein Workflow liest es)`, `${setzen} ${n} --repo ${repo}`));
  return l.length ? l : [gut(`${punkt}s`)];
}

function pruefeLabels(gh, repo, soll) {
  let ist;
  try {
    ist = seiten(gh, `repos/${repo}/labels?per_page=100`).map((l) => l.name);
  } catch (e) {
    return [luecke("Labels", `Labels nicht lesbar (${erste(e)})`, "Token prüfen")];
  }
  const l = fehlen(soll, ist, ohneCase).map((n) => luecke(`Label ${n}`, `Label "${n}" fehlt`, `gh label create "${n}" --repo ${repo}`));
  return l.length ? l : [gut("Labels")];
}

function pruefeBoard(gh, board, i) {
  const name = `Board ${board.rolle ?? i}`;
  const pfad = boardPfad(board);
  const hilfe = `boards[${i}] in .factory/projekt.json prüfen (gh api ${pfad}/fields listet die Felder)`;
  try {
    const b = json(gh, ["api", pfad]);
    const f = json(gh, ["api", `${pfad}/fields/${board.statusFeldId}`]);
    const probleme = Object.values(BOARD_PRUEFUNG).map((p) => p(board, b, f)).filter(Boolean);
    return probleme.length ? probleme.map((p) => luecke(name, p, hilfe)) : [gut(name)];
  } catch (e) {
    return [luecke(name, `Board nicht lesbar (${erste(e)})`, hilfe)];
  }
}

function pruefeRuleset(gh, repo, repoInfo, spiegel) {
  const branch = repoInfo.default_branch ?? "main";
  const privat = repoInfo.private === true;
  const grenze = privat ? " (private Repos auf GitHub Free kennen keine Rulesets, ADR 0022)" : "";
  const fixAnlegen = privat ? "Repo öffentlich machen oder einen Plan mit Rulesets wählen, dann das Ruleset anlegen" : `Ruleset auf ${branch} mit Required status checks anlegen`;
  let regeln;
  try {
    regeln = json(gh, ["api", `repos/${repo}/rules/branches/${branch}`]);
  } catch (e) {
    return [luecke("Ruleset", `Regeln auf ${branch} nicht lesbar (${erste(e)})${grenze}`, fixAnlegen)];
  }
  const kontexte = regeln.filter((r) => r.type === "required_status_checks").flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context));
  if (kontexte.length === 0) return [luecke("Ruleset", `kein Required status check auf ${branch}${grenze}`, fixAnlegen)];
  const noetig = spiegel?.requiredChecks ?? [];
  const rs = spiegel?.name ? `Ruleset "${spiegel.name}"` : "das Ruleset";
  const fehlend = fehlen(noetig, kontexte).map((c) => luecke(`Required-Check ${c}`, `Required-Check "${c}" fehlt auf ${branch}`, `"${c}" in ${rs} unter Required status checks ergänzen`));
  return fehlend.length ? fehlend : [gut("Ruleset")];
}

/** Führt alle Prüfpunkte aus: `[{ punkt, ok, befund?, fix?, hinweis? }]`. Wirft nie. */
export function pruefe({ config, voraussetzungen, spiegel, gh, langfuse }) {
  const repo = config.repo;
  const ergebnis = [];
  const token = pruefeToken(gh);
  ergebnis.push(...token.ergebnis);
  if (!token.fatal) {
    const r = pruefeRepo(gh, repo);
    ergebnis.push(...r.ergebnis, pruefeActions(gh, repo));
    if (voraussetzungen.secrets.length) ergebnis.push(...pruefeGeheimnisse(gh, repo, "secrets", voraussetzungen.secrets));
    if (voraussetzungen.variablen.length) ergebnis.push(...pruefeGeheimnisse(gh, repo, "variables", voraussetzungen.variablen));
    ergebnis.push(...pruefeLabels(gh, repo, voraussetzungen.labels));
    voraussetzungen.boards.forEach((b, i) => ergebnis.push(...pruefeBoard(gh, b, i)));
    ergebnis.push(...pruefeRuleset(gh, repo, r.repo, spiegel));
  }
  const lf = langfuse();
  const text = String(lf.stderr || lf.stdout || "").trim().split("\n")[0];
  ergebnis.push(lf.status === 0 ? gut("Langfuse") : luecke("Langfuse", text || "Langfuse nicht erreichbar", "Langfuse starten (node scripts/langfuse-vorbedingung.mjs zeigt den Befund)"));
  return ergebnis;
}

const langfuseStandard = () =>
  spawnSync(process.execPath, [join(SKRIPTE, "langfuse-vorbedingung.mjs")], { encoding: "utf8", windowsHide: true, timeout: 10000 });

function workflowsLesen(rootDir) {
  const ordner = join(rootDir, ".github", "workflows");
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({ pfad: f, text: readFileSync(join(ordner, f), "utf8") }));
}

export function main(argv = process.argv.slice(2), { rootDir = join(SKRIPTE, ".."), gh = (a) => ghText(a, { timeout: 30000 }), langfuse = langfuseStandard, out = console.log, err = console.error } = {}) {
  const { werte, fehler } = flagsLesen(argv, { pruefen: { type: "boolean" }, config: { type: "string" } }, { pflicht: ["pruefen"] });
  if (fehler) {
    err(`${fehler.text}\n${USAGE}`);
    return AUFRUF_EXIT;
  }
  let config;
  let spiegel;
  try {
    config = ladeProjektConfig({ rootDir, pfad: werte.config });
    if (config.rulesetSpiegel) spiegel = ladeRulesetSpiegel(rootDir, config.rulesetSpiegel);
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    err(text.includes("Fix:") ? text : `${text}\nFix: Ruleset-Spiegel laut rulesetSpiegel in der Projekt-Config reparieren, dann erneut prüfen`);
    return AUFRUF_EXIT;
  }
  const ergebnis = pruefe({ config, voraussetzungen: voraussetzungenAus({ config, workflows: workflowsLesen(rootDir) }), spiegel, gh, langfuse });
  let luecken = 0;
  for (const p of ergebnis) {
    if (!p.ok) {
      luecken++;
      out(`LÜCKE ${p.punkt}: ${p.befund.replace(/\s*\n\s*/g, " ")} Fix: ${p.fix}`);
    } else {
      out(`OK ${p.punkt}`);
      if (p.hinweis) out(`HINWEIS ${p.punkt}: ${p.hinweis}`);
    }
  }
  out(luecken ? `Harness-Doctor: ${luecken} Lücke(n)` : "Harness-Doctor: keine Lücke");
  return luecken ? 1 : 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
