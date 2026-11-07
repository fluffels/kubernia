/* Prüf-Kern des Harness-Doctors (#1800, ADR 0022): was das Projekt braucht (`voraussetzungenAus`), die Prüfpunkte gegen GitHub (`pruefe`), der
 * Lauf aus Config, Spiegel und Workflows (`pruefLauf`) und die Vorlage der Wochenlauf-Datei. Lib ohne Direktaufruf: `harness-doctor.mjs`
 * (--pruefen, --einrichten) und `harness-doctor-melden.mjs` (Wochenlauf) importieren sie, nie ein Einstiegsskript das andere (#1398).
 * Alles Projektspezifische kommt zur Laufzeit aus `.factory/projekt.json` und den Workflows; `gh` ist injizierbar. Grenzen: siehe Kopf von harness-doctor.mjs.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fehlerText } from "./gh-cli.mjs";
import { factorySeiteIn } from "./factory-seite.mjs";
import { altEnvName, boardPfad, ladeProjektConfig, PROJEKT_CONFIG } from "./projekt-config-lib.mjs";
import { spracheMaengel } from "./spezifikation-lib.mjs";
import { ladeRulesetSpiegel } from "./docs-gen/ruleset-spiegel.mjs";
import { MANIFEST_PFAD, manifestAusText, pflichtChecksFehler, wirdVerteilt } from "./besitz-lib.mjs";
import { GRENZE_PRIVAT, LINK_ACTIONS, LINK_RULESET, pruefeSicherheit } from "./harness-doctor-sicherheit.mjs";
import { ausFehler as ausFehlerRoh, gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { manifestKenntModule, MODUL_STANDARD, modulFormFehler, modulWahl } from "./modul-wahl-lib.mjs";

/** Links der Anleitungen (nur `--einrichten`): Seiten der GitHub-Doku bzw. des Werkzeugs, je Voraussetzung, die der Doctor nie selbst setzt. */
const LINK = {
  ruleset: LINK_RULESET,
  secrets: "https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets",
  variablen: "https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables",
  projektFelder: "https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-single-select-fields",
  actions: LINK_ACTIONS,
  token: "https://cli.github.com/manual/gh_auth_refresh",
  admin: "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository",
};

/**
 * Pur: neutralisiert die Action-Pins eines Workflow-Texts: `uses: x@<40 Hex>` samt Versionskommentar wird zu `uses: x@<pin>`.
 * Dependabot hebt Pins an; der Vergleich mit der Vorlage soll daran nicht rot werden. Ein Pin, der fehlt (Tag statt SHA), bleibt stehen und ist ein Unterschied.
 */
export function ohneActionPins(text) {
  return text.replace(/(uses:[ \t]*[^\s@]+@)[0-9a-f]{40}\b(?:[ \t]+#[^\r\n]*)?/g, "$1<pin>");
}

/** Die Wochenlauf-Datei, die `--einrichten` installiert (Vorlage = Datei im Repo, ein Wächter hält beide gleich, Action-Pins ausgenommen). */
export const WOCHENLAUF_PFAD = ".github/workflows/harness-doctor.yml";
export const WOCHENLAUF_WORKFLOW = [
  "name: Harness-Doctor (Wochenlauf)",
  "",
  "# Meldet Lücken der Factory-Voraussetzungen (scripts/harness-doctor.mjs) einmal pro Woche als Zeile im Harness-Sammelticket, mit Abgleich",
  "# gegen die offenen Zeilen (scripts/harness-doctor-melden.mjs). Geprüft wird mit PROJECT_TOKEN; gepostet wird im eigenen Repo mit github.token, an einer fremden Meldestelle (Schlüssel meldestelle, factory#153) mit MELDESTELLE_TOKEN (Rückfall PROJECT_TOKEN);",
  "# fehlt PROJECT_TOKEN, meldet der Lauf genau das als Lücke. Diese Datei ist die Vorlage von `harness-doctor.mjs --einrichten` (ein Wächter hält beide gleich).",
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
  "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
  "        with:",
  "          persist-credentials: false",
  "      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0",
  "        with:",
  "          node-version-file: .nvmrc",
  "      - name: Voraussetzungen prüfen und Lücken melden",
  "        env:",
  "          GH_TOKEN: ${{ github.token }}",
  "          GITHUB_REPOSITORY: ${{ github.repository }}",
  "          PROJECT_TOKEN: ${{ secrets.PROJECT_TOKEN }}",
  "          MELDESTELLE_TOKEN: ${{ secrets.MELDESTELLE_TOKEN }}",
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
  repo: () => null, // optional: welches Repo das Board führt; die Form prüft die Config, die Auswahl filtert danach (ADR 0022 F10)
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
/** Secrets, die ein Workflow liest, die aber ein Rückfall haben und nur in einem Sonderfall nötig sind: der Doctor fordert sie nicht (`MELDESTELLE_TOKEN`: nur für eine fremde Meldestelle, sonst `PROJECT_TOKEN`, factory#153). */
const OPTIONALE_SECRETS = new Set(["MELDESTELLE_TOKEN"]);
/** Pur: die Menge (`secrets`, `optionale` oder `variablen`), in die `art.name` gehört. */
const mengeFuer = (art, name, mengen) => (art !== "secrets" ? mengen.variablen : OPTIONALE_SECRETS.has(name) ? mengen.optionale : mengen.secrets);
const SECRET_VAR = /\b(secrets|vars)\.([A-Za-z_]\w*)/g;

const ohneAnfuehrung = (s) => s.replace(/^(["'])(.*)\1$/, "$2");

/**
 * Pur: die Pflicht-Checks der verteilten Kern-Workflows aus dem Besitz-Manifest (factory#117): `{ checks, fehler }`. `besitz` ist `{ wert }` oder `{ fehler }`, `undefined` gilt als nicht gelesen (fail-closed).
 * Ein Eintrag zählt nur, wenn er verteilt wird und seine Datei (Basisname) in `workflows` liegt; ein ungültiges `pflichtChecks` macht das ganze Manifest unlesbar (eine halb gelesene Soll-Liste prüfte still zu wenig).
 */
function kernPflichtChecks({ besitz, workflows }) {
  if (besitz === undefined || besitz.fehler !== undefined) return { checks: [], fehler: besitz?.fehler ?? "nicht gelesen", manifest: null };
  const eintraege = besitz.wert?.eintraege;
  if (!Array.isArray(eintraege)) return { checks: [], fehler: "kein Array eintraege", manifest: null };
  if (eintraege.some((e) => e === null || typeof e !== "object" || pflichtChecksFehler(e).length > 0)) return { checks: [], fehler: "pflichtChecks ungültig", manifest: null };
  const dateien = new Set(workflows.map((w) => basename(w.pfad)));
  const checks = eintraege.filter((e) => wirdVerteilt(e) && e.pflichtChecks !== undefined && dateien.has(basename(e.pfad))).flatMap((e) => e.pflichtChecks);
  return { checks, fehler: null, manifest: besitz.wert };
}

/** Pur: die Soll-Liste der Required Checks: Spiegel zuerst, dann der Kern, ohne Doppelte (exakter Vergleich). */
const vereinigt = (spiegel, kern) => [...new Set([...(spiegel?.requiredChecks ?? []), ...kern])];

/**
 * Pur: leitet aus Config und Workflows ab, was das Projekt braucht: `{ secrets, optionaleSecrets (gelesen, aber nicht gefordert), variablen, labels, boards, pflichtChecks, besitzFehler, manifest }` (`manifest`: das gelesene Besitz-Manifest oder `null`). `pflichtChecks` ist die Vereinigung aus den
 * Required Checks des Ruleset-Spiegels (zuerst) und den `pflichtChecks` der verteilten Kern-Workflows im Manifest, ohne Doppelte; `besitzFehler` nennt den Grund, wenn das Manifest nicht lesbar ist.
 */
export function voraussetzungenAus({ config, workflows, spiegel, besitz }) {
  const secrets = new Set();
  const optionale = new Set();
  const variablen = new Set();
  const labels = new Map();
  const merke = (name) => {
    if (name && !labels.has(name.toLowerCase())) labels.set(name.toLowerCase(), name);
  };
  for (const wert of Object.values(config.labels ?? {})) merke(wert);
  for (const { text } of workflows) {
    for (const [, art, name] of text.matchAll(SECRET_VAR)) if (name !== "GITHUB_TOKEN") mengeFuer(art, name, { secrets, optionale, variablen }).add(name);
    for (const m of text.matchAll(LABEL_FLAG)) for (const l of (m[1] ?? m[2] ?? m[3]).split(",")) merke(l.trim());
    for (const [, wert] of text.matchAll(LABEL_ENV)) if (!wert.includes("${{") && !wert.includes("$")) merke(ohneAnfuehrung(wert));
  }
  const kern = kernPflichtChecks({ besitz, workflows });
  return { secrets: [...secrets].sort(), optionaleSecrets: [...optionale].sort(), variablen: [...variablen].sort(), labels: [...labels.values()], boards: config.boards ?? [], pflichtChecks: vereinigt(spiegel, kern.checks), besitzFehler: kern.fehler, manifest: kern.manifest };
}

const erste = (e) => fehlerText(e).split("\n")[0];
const json = (gh, args) => JSON.parse(gh(args));
/** Seiten von `gh api --paginate --slurp` zu einer Liste (`schluessel` = Feld je Seite, sonst die Seite selbst). */
const seiten = (gh, pfad, schluessel) => json(gh, ["api", "--paginate", "--slurp", pfad]).flatMap((s) => (schluessel ? (s[schluessel] ?? []) : s));
/** Quelle fehlgeschlagen; jede Quelle dieses Moduls bringt ihren `fix` selbst mit. */
const ausFehler = (punkt, was, quelle, link) => ausFehlerRoh(punkt, was, quelle, undefined, link);
const fehlen = (soll, ist, gleich = (a, b) => a === b) => soll.filter((s) => !ist.some((i) => gleich(s, i)));
const ohneCase = (a, b) => a.toLowerCase() === b.toLowerCase();

function pruefeToken(gh) {
  let kopf;
  try {
    kopf = gh(["api", "-i", "user"]);
  } catch (e) {
    return { fatal: true, ergebnis: [{ ...luecke("Token", `gh nicht angemeldet oder ohne Zugriff (${erste(e)})`, "gh auth login --scopes project", LINK.token), fatal: true }] };
  }
  const scopes = /^x-oauth-scopes:\s*(.*)$/im.exec(kopf);
  if (!scopes) return { ergebnis: [{ ...gut("Token-Scope"), hinweis: "kein Scope-Header (fein granulares Token): Project-Zugriff nicht prüfbar" }] };
  if (!scopes[1].split(",").map((s) => s.trim()).includes("project")) {
    return { ergebnis: [luecke("Token-Scope", "dem Token fehlt der Scope project (Boards lesen und schreiben)", "gh auth refresh -s project", LINK.token)] };
  }
  return { ergebnis: [gut("Token-Scope")] };
}

/** Liest eine Quelle für die Prüfpunkte: `{ wert }` oder `{ fehler }` (erste Fehlerzeile); wirft nie. */
const hole = (lesen) => {
  try {
    return { wert: lesen() };
  } catch (e) {
    return { fehler: erste(e) };
  }
};

function pruefeRepo(repo, quelle) {
  if (quelle.fehler !== undefined) return { repo: {}, ergebnis: [ausFehler("Admin-Recht", `Repo ${repo}`, { fehler: quelle.fehler, fix: "gh auth status prüfen und das Konto mit Zugriff auf das Repo anmelden" }, LINK.admin)] };
  const admin = quelle.wert?.permissions?.admin === true ? gut("Admin-Recht") : luecke("Admin-Recht", `das Konto hat kein Admin-Recht an ${repo}`, `dem Konto Admin-Recht an ${repo} geben (Einstellungen, Collaborators)`, LINK.admin);
  return { repo: quelle.wert ?? {}, ergebnis: [admin] };
}

function pruefeActions(repo, quelle) {
  if (quelle.fehler !== undefined) return ausFehler("Actions", "Actions-Einstellung", { fehler: quelle.fehler, fix: "Admin-Recht und Token prüfen" }, LINK.actions);
  const a = quelle.wert ?? {};
  if (a.enabled !== true || a.allowed_actions === "local_only") {
    return luecke("Actions", "Actions sind im Repo nicht erlaubt", `gh api -X PUT repos/${repo}/actions/permissions -F enabled=true -f allowed_actions=all`, LINK.actions);
  }
  return gut("Actions");
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
    return [ausFehler(punkt, art, { fehler: erste(e), fix: "Admin-Recht und Token prüfen" }, link)];
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
    return [ausFehler("Labels", "Labels", { fehler: erste(e), fix: "Token prüfen" }, undefined)];
  }
  const l = fehlen(soll, ist, ohneCase).map((n) => luecke(`Label ${n}`, `Label "${n}" fehlt`, `gh label create "${n}" --repo ${repo}`, undefined, { art: "label", name: n }));
  return l.length ? l : [gut("Labels")];
}

function pruefeBoard(gh, board, i) {
  const name = `Board ${board.rolle ?? i}`;
  const pfad = boardPfad(board);
  const hilfe = `boards[${i}] in ${PROJEKT_CONFIG} prüfen (gh api ${pfad}/fields listet die Felder)`;
  const l = (befund) => luecke(name, befund, hilfe, LINK.projektFelder);
  const lesefehler = (was, quelle) => ausFehler(name, was, { ...quelle, fix: hilfe }, LINK.projektFelder);
  let b;
  try {
    b = json(gh, ["api", pfad]) ?? {};
  } catch (e) {
    return [lesefehler("Board", { fehler: erste(e) })];
  }
  let f;
  try {
    f = json(gh, ["api", `${pfad}/fields/${board.statusFeldId}`]) ?? {};
  } catch (e) {
    return [lesefehler(`Status-Feld ${board.statusFeldId} ("${STATUS_FELD_NAME}")`, { fehler: erste(e) })];
  }
  const probleme = Object.values(BOARD_PRUEFUNG).map((p) => p(board, b, f)).filter(Boolean);
  return probleme.length ? probleme.map(l) : [gut(name)];
}

function pruefeRuleset(regelnQuelle, repoInfo, spiegel, noetig) {
  const branch = repoInfo.default_branch ?? "main";
  const privat = repoInfo.private === true;
  const grenze = privat ? GRENZE_PRIVAT : "";
  const fixAnlegen = privat ? "Repo öffentlich machen oder einen Plan mit Rulesets wählen, dann das Ruleset anlegen" : `Ruleset auf ${branch} mit Required status checks anlegen`;
  if (regelnQuelle.fehler !== undefined) return [nichtPruefbar("Ruleset", `Regeln auf ${branch} nicht lesbar (${regelnQuelle.fehler})${grenze}`, fixAnlegen, LINK.ruleset)];
  const regeln = regelnQuelle.wert;
  const kontexte = regeln.filter((r) => r.type === "required_status_checks").flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context));
  const rs = spiegel?.name ? `Ruleset "${spiegel.name}"` : "das Ruleset";
  const fehlend = fehlen(noetig, kontexte).map((c) => luecke(`Required-Check ${c}`, `Required-Check "${c}" fehlt auf ${branch}`, `"${c}" in ${rs} unter Required status checks ergänzen`, LINK.ruleset));
  if (kontexte.length === 0) return [luecke("Ruleset", `kein Required status check auf ${branch}${grenze}`, fixAnlegen, LINK.ruleset), ...fehlend];
  return fehlend.length ? fehlend : [gut("Ruleset")];
}

/**
 * Pur: prüft das Wörterbuch des Spezifikations-Gates (`sprache.spezifikation`, Mängel aus `spracheMaengel`, auch `blocker` und `abhaengigkeit`). Das Laden der Config lässt einen fehlenden Block zu
 * (additive Schlüssel brechen den Stand nicht), das Gate hat aber keinen Standardwert: der Doctor meldet die Lücke mit der Fix-Zeile, statt dass erst das Gate wirft.
 */
export function pruefeSprache(config) {
  const sp = config?.sprache?.spezifikation;
  const maengel = sp === undefined || sp === null ? ["sprache.spezifikation fehlt"] : spracheMaengel(sp);
  if (maengel.length === 0) return [gut("Sprache")];
  return [luecke("Sprache", `${maengel.join("; ")} in ${PROJEKT_CONFIG}`, `den Block sprache.spezifikation (ziel, nachMerge, akzeptanzkriterien, blocker, abhaengigkeit, negativfall, begrenzung, allquantor) in ${PROJEKT_CONFIG} vervollständigen`)];
}

/**
 * Pur: meldet jede Kern-Umgebungsvariable, die noch unter ihrem Altnamen (Projektpräfix statt `FACTORY_`) gesetzt ist; der Altname wird nicht mehr gelesen.
 * `namen` sind die `FACTORY_…`-Namen (`kernEnvNamen`), `env` die Umgebung des Doctor-Prozesses. „Gesetzt“ heißt `!== undefined`, auch ein leerer Wert. Der Wert erscheint nie in der Meldung.
 */
export function pruefeAltnamen({ env, config, namen }) {
  const luecken = [];
  for (const neu of namen) {
    const alt = altEnvName(neu, config);
    if (alt !== null && env[alt] !== undefined) luecken.push(luecke(`Umgebungsvariable ${alt}`, `${alt} ist gesetzt, wird aber nicht mehr gelesen`, `${alt} entfernen und den Wert als ${neu} setzen`));
  }
  return luecken.length ? luecken : [gut("Umgebungsvariablen")];
}

/** Prüfpunkt, wenn das Besitz-Manifest nicht lesbar ist: die Kern-Pflicht-Checks sind unbekannt, nie grün (factory#117). */
const besitzNichtPruefbar = (grund) => ({
  punkt: "Kern-Pflicht-Checks",
  ok: false,
  nichtPruefbar: true,
  befund: `${MANIFEST_PFAD} nicht lesbar (${grund}): welche Required Checks die Kern-Workflows brauchen, ist unbekannt`,
  fix: `${MANIFEST_PFAD} aus Git oder per Sync von einem Factory-Tag wiederherstellen, dann erneut prüfen`,
  hinweis: "nur die Checks des Ruleset-Spiegels geprüft, Kern-Pflicht-Checks nicht prüfbar",
});

/**
 * Doctor-Punkt `Sicherheits-Module` (factory#119): fehlender Schlüssel `module` ist eine Lücke, eine Teilauswahl OK mit Hinweis auf die nicht gewählten Module.
 * Ohne lesbares Manifest (`manifestFehler` gesetzt) ist der Punkt nicht prüfbar (factory#139); `null`, wenn das Manifest einfach nicht übergeben wurde (direkter Aufruf)
 * oder keine Module kennt und die Config nichts wählt (es gibt nichts zu wählen).
 */
export function modulPunkt(config, manifest, { configPfad = "die Projekt-Config", manifestFehler = null } = {}) {
  const punkt = "Sicherheits-Module";
  if (!manifest && manifestFehler) return nichtPruefbar(punkt, `${MANIFEST_PFAD} nicht lesbar (${manifestFehler}): welche Module wählbar sind, ist unbekannt`, `${MANIFEST_PFAD} aus Git oder per Sync von einem Factory-Tag wiederherstellen, dann erneut prüfen`);
  const w = modulWahl(config, manifest, { configPfad });
  if (!manifest || (!manifestKenntModule(manifest) && w.fehlt)) return null;
  if (w.fehlt) {
    return luecke(punkt, `der Schlüssel module fehlt in ${configPfad} (es gilt nur ${MODUL_STANDARD.join(", ")})`, `module in ${configPfad} als Liste der gewünschten Sicherheits-Module eintragen (wählbar: ${w.erlaubt.join(", ")}); [] wählt bewusst keines`);
  }
  const fehler = [...modulFormFehler(config), ...w.fehler];
  if (fehler.length > 0) return luecke(punkt, fehler[0].split("\n")[0], fehler[0].split("\nFix: ")[1]);
  return gut(punkt, w.nichtGewaehlt.length > 0 ? `nicht gewählt: ${w.nichtGewaehlt.join(", ")}` : undefined);
}

const besitzPunkt = (v) => (v.besitzFehler ? [besitzNichtPruefbar(v.besitzFehler)] : []);
/** Soll-Liste der Required Checks: die Ableitung, sonst (direkter Aufruf ohne sie) der Spiegel, damit er nie verloren geht. */
const sollChecks = (v, spiegel) => v.pflichtChecks ?? spiegel?.requiredChecks ?? [];

/** Führt alle Prüfpunkte aus: `[{ punkt, ok, befund?, fix?, hinweis?, nichtPruefbar? }]` (`nichtPruefbar`: ok false, aber keine belegte Lücke). Wirft nie. */
export function pruefe({ config, voraussetzungen, spiegel, gh, langfuse, umgebung = null }) {
  const repo = config.repo;
  const ergebnis = [];
  const token = pruefeToken(gh);
  ergebnis.push(...token.ergebnis);
  if (!token.fatal) {
    const quellen = {
      repo: hole(() => json(gh, ["api", `repos/${repo}`])),
      actions: hole(() => json(gh, ["api", `repos/${repo}/actions/permissions`])),
    };
    const r = pruefeRepo(repo, quellen.repo);
    ergebnis.push(...r.ergebnis, pruefeActions(repo, quellen.actions));
    if (voraussetzungen.secrets.length) ergebnis.push(...pruefeGeheimnisse(gh, repo, "secrets", voraussetzungen.secrets));
    if (voraussetzungen.variablen.length) ergebnis.push(...pruefeGeheimnisse(gh, repo, "variables", voraussetzungen.variablen));
    ergebnis.push(...pruefeLabels(gh, repo, voraussetzungen.labels));
    voraussetzungen.boards.forEach((b, i) => ergebnis.push(...pruefeBoard(gh, b, i)));
    const branch = r.repo.default_branch ?? "main";
    const regeln = hole(() => seiten(gh, `repos/${repo}/rules/branches/${branch}?per_page=100`));
    ergebnis.push(...pruefeRuleset(regeln, r.repo, spiegel, sollChecks(voraussetzungen, spiegel)));
    ergebnis.push(...pruefeSicherheit({ ...quellen, regeln, pvr: hole(() => json(gh, ["api", `repos/${repo}/private-vulnerability-reporting`])), spiegel, branch, privat: r.repo.private === true }));
  } else {
    const aus = { fehler: "gh nicht angemeldet oder ohne Zugriff", fix: "erst den Token-Punkt beheben" };
    ergebnis.push(...pruefeSicherheit({ repo: aus, actions: aus, regeln: aus, pvr: aus, spiegel }));
  }
  ergebnis.push(...pruefeSprache(config)); // liest nur die Config, braucht kein Token
  const module = modulPunkt(config, voraussetzungen.manifest, { configPfad: PROJEKT_CONFIG, manifestFehler: voraussetzungen.besitzFehler }); // Sicherheits-Module (factory#119), ebenfalls ohne Token
  if (module !== null) ergebnis.push(module);
  if (langfuse) {
    const lf = langfuse();
    const text = String(lf.stderr || lf.stdout || "").trim().split("\n")[0];
    ergebnis.push(lf.status === 0 ? gut("Langfuse") : luecke("Langfuse", text || "Langfuse nicht erreichbar", "Langfuse starten (node scripts/langfuse-vorbedingung.mjs zeigt den Befund)"));
  }
  if (umgebung) ergebnis.push(...pruefeAltnamen({ env: umgebung.env, config, namen: umgebung.namen }));
  ergebnis.push(...besitzPunkt(voraussetzungen)); // liest nur das Manifest, braucht kein Token
  return ergebnis;
}

/** Die Workflow-Dateien des Projekts: `[{ pfad, text }]` (Dateiname, Inhalt). */
export function workflowsLesen(rootDir) {
  const ordner = join(rootDir, ".github", "workflows");
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({ pfad: f, text: readFileSync(join(ordner, f), "utf8") }));
}

/** Vorlage des Ruleset-Spiegels in der Quelle (Factory); `konfigFehlerText` nennt sie im Fix. */
export const RULESET_VORLAGE = ".github/ruleset-main-schutz.json";

/** Text eines Config- oder Spiegel-Fehlers samt `Fix:`-Zeile (Exit 2 im Aufrufer); `rootDir` löst den Link auf die Vorlage der Quelle auf (ohne: lokaler Pfad). */
export function konfigFehlerText(e, rootDir = "") {
  const text = e instanceof Error ? e.message : String(e);
  return text.includes("Fix:") ? text : `${text}\nFix: Ruleset-Spiegel laut rulesetSpiegel in der Projekt-Config reparieren (Vorlage der Quelle: ${factorySeiteIn(rootDir, RULESET_VORLAGE)}), dann erneut prüfen`;
}

/**
 * Lädt Config und Ruleset-Spiegel und führt alle Prüfpunkte aus: `{ config, ergebnis }`. Wirft bei unlesbarer Config oder unlesbarem Spiegel,
 * bevor ein einziger `gh`-Aufruf läuft. `langfuse: null` lässt den Langfuse-Punkt aus, `dateien: null` die Dateipunkte (`dateien({ rootDir, config, spiegel, workflows, pflichtChecks })` mit der geladenen Config, dem Spiegel, den einmal gelesenen Workflows und der Soll-Liste `voraussetzungen.pflichtChecks` liefert Ergebnisse wie `pruefeDateien`, factory#94, factory#148; der Aufrufer reicht die Funktion am Rand herein), `umgebung: null` den Altnamen-Punkt (`{ env, namen }` prüft ihn: `namen` sind die `FACTORY_…`-Namen aus `kernEnvNamen`, die der Aufrufer am Rand bestimmt; die Lib liest dafür keine Dateien); `mitWochenlauf` rechnet die Vorlage des Wochenlaufs
 * als Workflow mit, falls die Datei fehlt (dann erscheinen ihre Secrets schon im Plan von `--einrichten`).
 */
export function pruefLauf({ rootDir, configPfad, gh, langfuse = null, mitWochenlauf = false, umgebung = null, dateien = null }) {
  if (umgebung && !Array.isArray(umgebung.namen)) throw new Error("umgebung braucht { env, namen }: die Kern-Namen bestimmt der Aufrufer am Rand (kernEnvNamen)");
  const config = ladeProjektConfig({ rootDir, pfad: configPfad });
  const spiegel = config.rulesetSpiegel ? ladeRulesetSpiegel(rootDir, config.rulesetSpiegel) : undefined;
  const workflows = workflowsLesen(rootDir);
  const manifestVoll = join(rootDir, MANIFEST_PFAD);
  const geladen = manifestAusText(existsSync(manifestVoll) ? readFileSync(manifestVoll, "utf8") : null);
  const besitz = geladen.fehler === undefined ? { wert: geladen.manifest } : { fehler: geladen.text };
  if (mitWochenlauf && !workflows.some((w) => w.pfad === basename(WOCHENLAUF_PFAD))) workflows.push({ pfad: basename(WOCHENLAUF_PFAD), text: WOCHENLAUF_WORKFLOW });
  const voraussetzungen = voraussetzungenAus({ config, workflows, spiegel, besitz });
  const ergebnis = pruefe({ config, voraussetzungen, spiegel, gh, langfuse, umgebung });
  if (dateien) ergebnis.push(...dateien({ rootDir, config, spiegel, workflows, pflichtChecks: voraussetzungen.pflichtChecks }));
  return { config, ergebnis };
}

