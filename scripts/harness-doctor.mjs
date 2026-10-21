#!/usr/bin/env node
/* Harness-Doctor (ADR 0022, #1799): meldet, welche GitHub- und Langfuse-Voraussetzungen der Factory im Projekt fehlen.
 *
 *   node scripts/harness-doctor.mjs --pruefen [--config <pfad>]
 *   node scripts/harness-doctor.mjs --einrichten [--dry-run] [--config <pfad>]
 *
 * `--einrichten` (#1800) legt nur Umkehrbares an: fehlende Labels, die Wochenlauf-Datei (.github/workflows/harness-doctor.yml) und das Harness-Sammelticket
 * (über sammelticket-anlegen.mjs); Ruleset, Secrets, Variablen, Project-Felder, Actions, Admin-Recht, Token und Langfuse nie automatisch, nur als
 * `ANLEITUNG <Punkt>: <Befund> Fix: <Schritt> Link: <Seite>`. `--dry-run` gibt nur den Plan aus (`PLAN …`). Ein zweiter Lauf ändert nichts.
 * Der Wochenlauf selbst (Lücke als Zeile ins Sammelticket) steht in harness-doctor-melden.mjs.
 *
 * Je Lücke eine Zeile `LÜCKE <Punkt>: <Befund> Fix: <Anweisung>`; Exit 0 ohne Lücke, 1 mit mindestens einer, 2 bei Aufruf-Fehler oder
 * unlesbarer Config bzw. unlesbarem Ruleset-Spiegel (dann ohne einen einzigen gh-Aufruf). Reines Node-Skript ohne Modell-Tokens; `gh` und
 * der Langfuse-Aufruf sind injizierbar (Tests laufen ohne Netz). Alles Projektspezifische kommt zur Laufzeit aus `.factory/projekt.json`
 * und den Workflows (`voraussetzungenAus`); der Wächter test/harness/harness-doctor-voraussetzungen.test.ts hält die Ableitung vollständig.
 *
 * Bekannte Grenzen: private Repos auf GitHub Free kennen keine Rulesets (ADR 0022), dort ist das fehlende Ruleset eine Lücke mit dieser
 * Erklärung; `allowed_actions: selected` gilt als erlaubt (welche Actions, prüft der Doctor nicht); geprüft werden nur Repo- und Org-Secrets
 * bzw. -Variablen der Actions (keine Environment-Secrets); Required Checks zählen nur aus Rulesets (klassischer Branch-Schutz wird nicht gelesen); ein fein granulares Token hat keinen Scope-Header, dann nur ein HINWEIS.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { fehlerText, ghText } from "./gh-cli.mjs";
import { istDirektaufruf } from "./hook-io.mjs";
import { boardPfad, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { ladeRulesetSpiegel } from "./docs-gen/ruleset-spiegel.mjs";

const SKRIPTE = dirname(fileURLToPath(import.meta.url));
const USAGE = "Aufruf: node scripts/harness-doctor.mjs --pruefen [--config <pfad>] | --einrichten [--dry-run] [--config <pfad>]";

/** Links der Anleitungen (nur `--einrichten`): Seiten der GitHub-Doku bzw. des Werkzeugs, je Voraussetzung, die der Doctor nie selbst setzt. */
const LINK = {
  ruleset: "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository",
  secrets: "https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets",
  variablen: "https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables",
  projektFelder: "https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-single-select-fields",
  actions: "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository",
  token: "https://cli.github.com/manual/gh_auth_refresh",
  admin: "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository",
  langfuse: "https://langfuse.com/self-hosting",
};

/** Die Wochenlauf-Datei, die `--einrichten` installiert (Vorlage = Datei im Repo, ein Wächter hält beide gleich). */
export const WOCHENLAUF_PFAD = ".github/workflows/harness-doctor.yml";
export const WOCHENLAUF_WORKFLOW = [
  "name: Harness-Doctor (Wochenlauf)",
  "",
  "# Meldet Lücken der Factory-Voraussetzungen (scripts/harness-doctor.mjs) einmal pro Woche als Zeile im Harness-Sammelticket, mit Abgleich",
  "# gegen die offenen Zeilen (scripts/harness-doctor-melden.mjs). Geprüft wird mit PROJECT_TOKEN, gepostet mit github.token; fehlt das Secret,",
  "# meldet der Lauf genau das als Lücke. Diese Datei ist die Vorlage von `harness-doctor.mjs --einrichten` (ein Wächter hält beide gleich).",
  "",
  "on:",
  "  schedule:",
  "    - cron: \"47 5 * * 1\"",
  "  workflow_dispatch:",
  "    inputs:",
  "      trocken:",
  "        description: \"Nur ausgeben, nichts ins Sammelticket schreiben\"",
  "        type: boolean",
  "        default: false",
  "",
  "concurrency:",
  "  group: harness-doctor",
  "  cancel-in-progress: false",
  "",
  "permissions:",
  "  contents: read",
  "  issues: write",
  "",
  "jobs:",
  "  doctor:",
  "    name: \"Harness-Doctor: Lücken ins Sammelticket\"",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v7",
  "      - uses: actions/setup-node@v7",
  "        with:",
  "          node-version-file: .nvmrc",
  "      - name: Voraussetzungen prüfen und Lücken melden",
  "        env:",
  "          GH_TOKEN: ${{ github.token }}",
  "          GITHUB_REPOSITORY: ${{ github.repository }}",
  "          PROJECT_TOKEN: ${{ secrets.PROJECT_TOKEN }}",
  "          TROCKEN: ${{ inputs.trocken == true }}",
  "        run: |",
  "          if [ \"$TROCKEN\" = \"true\" ]; then node scripts/harness-doctor-melden.mjs --dry-run; else node scripts/harness-doctor-melden.mjs; fi",
  "",
].join("\n");

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
const luecke = (punkt, befund, fix, link, aktion) => ({ punkt, ok: false, befund, fix, ...(link ? { link } : {}), ...(aktion ? { aktion } : {}) });
const gut = (punkt) => ({ punkt, ok: true });
const fehlen = (soll, ist, gleich = (a, b) => a === b) => soll.filter((s) => !ist.some((i) => gleich(s, i)));
const ohneCase = (a, b) => a.toLowerCase() === b.toLowerCase();

function pruefeToken(gh) {
  let kopf;
  try {
    kopf = gh(["api", "-i", "user"]);
  } catch (e) {
    return { fatal: true, ergebnis: [luecke("Token", `gh nicht angemeldet oder ohne Zugriff (${erste(e)})`, "gh auth login --scopes project", LINK.token)] };
  }
  const scopes = /^x-oauth-scopes:\s*(.*)$/im.exec(kopf);
  if (!scopes) return { ergebnis: [{ ...gut("Token-Scope"), hinweis: "kein Scope-Header (fein granulares Token): Project-Zugriff nicht prüfbar" }] };
  if (!scopes[1].split(",").map((s) => s.trim()).includes("project")) {
    return { ergebnis: [luecke("Token-Scope", "dem Token fehlt der Scope project (Boards lesen und schreiben)", "gh auth refresh -s project", LINK.token)] };
  }
  return { ergebnis: [gut("Token-Scope")] };
}

function pruefeRepo(gh, repo) {
  try {
    const r = json(gh, ["api", `repos/${repo}`]);
    const admin = r.permissions?.admin === true ? gut("Admin-Recht") : luecke("Admin-Recht", `das Konto hat kein Admin-Recht an ${repo}`, `dem Konto Admin-Recht an ${repo} geben (Einstellungen, Collaborators)`, LINK.admin);
    return { repo: r, ergebnis: [admin] };
  } catch (e) {
    return { repo: {}, ergebnis: [luecke("Admin-Recht", `Repo ${repo} nicht lesbar (${erste(e)})`, "gh auth status prüfen und das Konto mit Zugriff auf das Repo anmelden", LINK.admin)] };
  }
}

function pruefeActions(gh, repo) {
  try {
    const a = json(gh, ["api", `repos/${repo}/actions/permissions`]);
    if (a.enabled !== true || a.allowed_actions === "local_only") {
      return luecke("Actions", "Actions sind im Repo nicht erlaubt", `gh api -X PUT repos/${repo}/actions/permissions -F enabled=true -f allowed_actions=all`, LINK.actions);
    }
    return gut("Actions");
  } catch (e) {
    return luecke("Actions", `Actions-Einstellung nicht lesbar (${erste(e)})`, "Admin-Recht und Token prüfen", LINK.actions);
  }
}

function pruefeGeheimnisse(gh, repo, art, namen) {
  const [pfad, org, schluessel, setzen] = art === "secrets"
    ? ["actions/secrets", "actions/organization-secrets", "secrets", "gh secret set"]
    : ["actions/variables", "actions/organization-variables", "variables", "gh variable set"];
  const punkt = art === "secrets" ? "Secret" : "Variable";
  const link = art === "secrets" ? LINK.secrets : LINK.variablen;
  let ist;
  try {
    ist = seiten(gh, `repos/${repo}/${pfad}`, schluessel).map((s) => s.name);
  } catch (e) {
    return [luecke(punkt, `${art} nicht lesbar (${erste(e)})`, "Admin-Recht und Token prüfen", link)];
  }
  try {
    ist.push(...seiten(gh, `repos/${repo}/${org}`, schluessel).map((s) => s.name));
  } catch {
    /* Org-Abruf ist optional: ein Nutzer-Repo hat keine Org-Geheimnisse */
  }
  const l = fehlen(namen, ist).map((n) => luecke(`${punkt} ${n}`, `${n} fehlt (ein Workflow liest es)`, `${setzen} ${n} --repo ${repo}`, link));
  return l.length ? l : [gut(`${punkt}s`)];
}

function pruefeLabels(gh, repo, soll) {
  let ist;
  try {
    ist = seiten(gh, `repos/${repo}/labels?per_page=100`).map((l) => l.name);
  } catch (e) {
    return [luecke("Labels", `Labels nicht lesbar (${erste(e)})`, "Token prüfen")];
  }
  const l = fehlen(soll, ist, ohneCase).map((n) => luecke(`Label ${n}`, `Label "${n}" fehlt`, `gh label create "${n}" --repo ${repo}`, undefined, { art: "label", name: n }));
  return l.length ? l : [gut("Labels")];
}

function pruefeBoard(gh, board, i) {
  const name = `Board ${board.rolle ?? i}`;
  const pfad = boardPfad(board);
  const hilfe = `boards[${i}] in .factory/projekt.json prüfen (gh api ${pfad}/fields listet die Felder)`;
  const l = (befund) => luecke(name, befund, hilfe, LINK.projektFelder);
  let b;
  try {
    b = json(gh, ["api", pfad]) ?? {};
  } catch (e) {
    return [l(`Board nicht lesbar (${erste(e)})`)];
  }
  let f;
  try {
    f = json(gh, ["api", `${pfad}/fields/${board.statusFeldId}`]) ?? {};
  } catch (e) {
    return [l(`Status-Feld ${board.statusFeldId} ("${STATUS_FELD_NAME}") nicht lesbar (${erste(e)})`)];
  }
  const probleme = Object.values(BOARD_PRUEFUNG).map((p) => p(board, b, f)).filter(Boolean);
  return probleme.length ? probleme.map(l) : [gut(name)];
}

function pruefeRuleset(gh, repo, repoInfo, spiegel) {
  const branch = repoInfo.default_branch ?? "main";
  const privat = repoInfo.private === true;
  const grenze = privat ? " (private Repos auf GitHub Free kennen keine Rulesets, ADR 0022)" : "";
  const fixAnlegen = privat ? "Repo öffentlich machen oder einen Plan mit Rulesets wählen, dann das Ruleset anlegen" : `Ruleset auf ${branch} mit Required status checks anlegen`;
  let regeln;
  try {
    regeln = seiten(gh, `repos/${repo}/rules/branches/${branch}?per_page=100`);
  } catch (e) {
    return [luecke("Ruleset", `Regeln auf ${branch} nicht lesbar (${erste(e)})${grenze}`, fixAnlegen, LINK.ruleset)];
  }
  const kontexte = regeln.filter((r) => r.type === "required_status_checks").flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context));
  if (kontexte.length === 0) return [luecke("Ruleset", `kein Required status check auf ${branch}${grenze}`, fixAnlegen, LINK.ruleset)];
  const noetig = spiegel?.requiredChecks ?? [];
  const rs = spiegel?.name ? `Ruleset "${spiegel.name}"` : "das Ruleset";
  const fehlend = fehlen(noetig, kontexte).map((c) => luecke(`Required-Check ${c}`, `Required-Check "${c}" fehlt auf ${branch}`, `"${c}" in ${rs} unter Required status checks ergänzen`, LINK.ruleset));
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
  if (langfuse) {
    const lf = langfuse();
    const text = String(lf.stderr || lf.stdout || "").trim().split("\n")[0];
    ergebnis.push(lf.status === 0 ? gut("Langfuse") : luecke("Langfuse", text || "Langfuse nicht erreichbar", "Langfuse starten (node scripts/langfuse-vorbedingung.mjs zeigt den Befund)", LINK.langfuse));
  }
  return ergebnis;
}

const langfuseStandard = () =>
  spawnSync(process.execPath, [join(SKRIPTE, "langfuse-vorbedingung.mjs")], { encoding: "utf8", windowsHide: true, timeout: 10000 });

/** Die Workflow-Dateien des Projekts: `[{ pfad, text }]` (Dateiname, Inhalt). */
export function workflowsLesen(rootDir) {
  const ordner = join(rootDir, ".github", "workflows");
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({ pfad: f, text: readFileSync(join(ordner, f), "utf8") }));
}

/** Text eines Config- oder Spiegel-Fehlers samt `Fix:`-Zeile (Exit 2 im Aufrufer). */
export function konfigFehlerText(e) {
  const text = e instanceof Error ? e.message : String(e);
  return text.includes("Fix:") ? text : `${text}\nFix: Ruleset-Spiegel laut rulesetSpiegel in der Projekt-Config reparieren, dann erneut prüfen`;
}

/**
 * Lädt Config und Ruleset-Spiegel und führt alle Prüfpunkte aus: `{ config, ergebnis }`. Wirft bei unlesbarer Config oder unlesbarem Spiegel,
 * bevor ein einziger `gh`-Aufruf läuft. `langfuse: null` lässt den Langfuse-Punkt aus; `mitWochenlauf` rechnet die Vorlage des Wochenlaufs
 * als Workflow mit, falls die Datei fehlt (dann erscheinen ihre Secrets schon im Plan von `--einrichten`).
 */
export function pruefLauf({ rootDir, configPfad, gh, langfuse = null, mitWochenlauf = false }) {
  const config = ladeProjektConfig({ rootDir, pfad: configPfad });
  const spiegel = config.rulesetSpiegel ? ladeRulesetSpiegel(rootDir, config.rulesetSpiegel) : undefined;
  const workflows = workflowsLesen(rootDir);
  if (mitWochenlauf && !workflows.some((w) => w.pfad === basename(WOCHENLAUF_PFAD))) workflows.push({ pfad: basename(WOCHENLAUF_PFAD), text: WOCHENLAUF_WORKFLOW });
  const ergebnis = pruefe({ config, voraussetzungen: voraussetzungenAus({ config, workflows }), spiegel, gh, langfuse });
  return { config, ergebnis };
}

const ohneCr = (t) => t.replace(/\r\n/g, "\n");
const einzeilig = (t) => t.replace(/\s*\n\s*/g, " ");

const sammelticketStandard = (args) =>
  spawnSync(process.execPath, [join(SKRIPTE, "sammelticket-anlegen.mjs"), ...args], { encoding: "utf8", windowsHide: true, timeout: 120000 });

/** Wochenlauf-Datei: fehlt sie, anlegen; ist sie gleich, nichts; weicht sie ab, bleibt sie (die Verteilung gehört factory-sync). `{ geplant, angelegt }`. */
function wochenlaufDatei({ rootDir, trocken, out }) {
  const ziel = join(rootDir, WOCHENLAUF_PFAD);
  if (!existsSync(ziel)) {
    if (trocken) {
      out(`PLAN Workflow ${WOCHENLAUF_PFAD} anlegen`);
      return { geplant: 1, angelegt: 0 };
    }
    mkdirSync(dirname(ziel), { recursive: true });
    writeFileSync(ziel, WOCHENLAUF_WORKFLOW);
    out(`ANGELEGT Workflow ${WOCHENLAUF_PFAD}`);
    return { geplant: 0, angelegt: 1 };
  }
  if (ohneCr(readFileSync(ziel, "utf8")) === ohneCr(WOCHENLAUF_WORKFLOW)) out(`OK Workflow ${WOCHENLAUF_PFAD}`);
  else out(`HINWEIS Workflow ${WOCHENLAUF_PFAD} weicht von der Vorlage ab und bleibt unverändert (Verteilung: factory-sync)`);
  return { geplant: 0, angelegt: 0 };
}

/** Sammelticket über `sammelticket-anlegen.mjs harness` (idempotent). `{ geplant, angelegt, fehler }`. */
function sammelticket({ trocken, spawn, out }) {
  const r = spawn(["harness", ...(trocken ? ["--dry-run"] : [])]);
  const text = String(r.stdout ?? "").trim();
  for (const z of text.split("\n").filter(Boolean)) out(`Sammelticket: ${z.trim()}`);
  if (r.status !== 0) {
    out(`FEHLER Sammelticket: sammelticket-anlegen.mjs endete mit Exit ${r.status ?? "?"} ${einzeilig(String(r.stderr ?? "").trim()).slice(0, 200)}`.trimEnd());
    return { geplant: 0, angelegt: 0, fehler: 1 };
  }
  return { geplant: trocken && /^Würde /m.test(text) ? 1 : 0, angelegt: !trocken && /^Angelegt:/m.test(text) ? 1 : 0, fehler: 0 };
}

/**
 * `--einrichten [--dry-run]`: legt nur Umkehrbares an (fehlende Labels, die Wochenlauf-Datei, das Sammelticket); alles andere (Ruleset,
 * Secrets, Variablen, Project-Felder, Actions, Admin-Recht, Token, Langfuse) nur als `ANLEITUNG` mit Link. Ein zweiter Lauf ändert nichts.
 * Exit: 0 nichts offen; 1 Anleitung offen, Plan nicht leer (Dry-Run) oder Fehler; 2 Aufruf-Fehler oder Config.
 */
function einrichten({ werte, rootDir, gh, spawn, out, err }) {
  const trocken = werte["dry-run"] === true;
  let lauf;
  try {
    lauf = pruefLauf({ rootDir, configPfad: werte.config, gh, langfuse: null, mitWochenlauf: true });
  } catch (e) {
    err(konfigFehlerText(e));
    return AUFRUF_EXIT;
  }
  const { config, ergebnis } = lauf;
  const fatal = ergebnis.some((p) => !p.ok && p.punkt === "Token");
  let { geplant, angelegt, fehler, anleitungen } = { geplant: 0, angelegt: 0, fehler: 0, anleitungen: 0 };
  for (const p of ergebnis.filter((x) => !x.ok)) {
    if (p.aktion?.art === "label") {
      if (trocken) {
        out(`PLAN Label "${p.aktion.name}" anlegen`);
        geplant++;
        continue;
      }
      try {
        gh(["api", "-X", "POST", `repos/${config.repo}/labels`, "-f", `name=${p.aktion.name}`]);
        out(`ANGELEGT Label "${p.aktion.name}"`);
        angelegt++;
      } catch (e) {
        out(`FEHLER Label "${p.aktion.name}": ${erste(e)}`);
        fehler++;
      }
      continue;
    }
    anleitungen++;
    out(`ANLEITUNG ${p.punkt}: ${einzeilig(p.befund)} Fix: ${p.fix}${p.link ? ` Link: ${p.link}` : ""}`);
  }
  const datei = wochenlaufDatei({ rootDir, trocken, out });
  geplant += datei.geplant;
  angelegt += datei.angelegt;
  if (fatal) out("ANLEITUNG Sammelticket: ohne gültigen Token kein Zugriff auf GitHub Fix: erst den Token-Punkt beheben, dann --einrichten erneut fahren");
  else {
    const s = sammelticket({ trocken, spawn, out });
    geplant += s.geplant;
    angelegt += s.angelegt;
    fehler += s.fehler;
  }
  out(`Harness-Doctor --einrichten${trocken ? " --dry-run" : ""}: ${angelegt} angelegt, ${geplant} geplant, ${anleitungen + (fatal ? 1 : 0)} Anleitung(en), ${fehler} Fehler`);
  return anleitungen + (fatal ? 1 : 0) + fehler + geplant > 0 ? 1 : 0;
}

function pruefen({ werte, rootDir, gh, langfuse, out, err }) {
  let ergebnis;
  try {
    ({ ergebnis } = pruefLauf({ rootDir, configPfad: werte.config, gh, langfuse }));
  } catch (e) {
    err(konfigFehlerText(e));
    return AUFRUF_EXIT;
  }
  let luecken = 0;
  for (const p of ergebnis) {
    if (!p.ok) {
      luecken++;
      out(`LÜCKE ${p.punkt}: ${einzeilig(p.befund)} Fix: ${p.fix}`);
    } else {
      out(`OK ${p.punkt}`);
      if (p.hinweis) out(`HINWEIS ${p.punkt}: ${p.hinweis}`);
    }
  }
  out(luecken ? `Harness-Doctor: ${luecken} Lücke(n)` : "Harness-Doctor: keine Lücke");
  return luecken ? 1 : 0;
}

export function main(
  argv = process.argv.slice(2),
  { rootDir = join(SKRIPTE, ".."), gh = (a) => ghText(a, { timeout: 30000 }), langfuse = langfuseStandard, spawn = sammelticketStandard, out = console.log, err = console.error } = {},
) {
  const { werte, fehler } = flagsLesen(argv, { pruefen: { type: "boolean" }, einrichten: { type: "boolean" }, "dry-run": { type: "boolean" }, config: { type: "string" } });
  const aufrufFehler = fehler?.text ?? (Number(werte.pruefen === true) + Number(werte.einrichten === true) !== 1 ? "Genau einen Modus angeben: --pruefen oder --einrichten" : null)
    ?? (werte["dry-run"] && !werte.einrichten ? "--dry-run gilt nur mit --einrichten" : null);
  if (aufrufFehler) {
    err(`${aufrufFehler}\n${USAGE}`);
    return AUFRUF_EXIT;
  }
  return werte.einrichten ? einrichten({ werte, rootDir, gh, spawn, out, err }) : pruefen({ werte, rootDir, gh, langfuse, out, err });
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
