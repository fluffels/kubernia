#!/usr/bin/env node
/* Harness-Doctor (ADR 0022, #1799): meldet, welche GitHub- und Langfuse-Voraussetzungen der Factory im Projekt fehlen.
 *
 *   node scripts/harness-doctor.mjs --pruefen [--config <pfad>]
 *   node scripts/harness-doctor.mjs --einrichten [--dry-run] [--config <pfad>]
 *
 * `--einrichten` (#1800) legt nur Umkehrbares an: fehlende Labels, die Wochenlauf-Datei (.github/workflows/harness-doctor.yml) und das Harness-Sammelticket
 * (über sammelticket-anlegen.mjs); Ruleset, Secrets, Variablen, Project-Felder, Actions, Admin-Recht und Token nie automatisch, nur als
 * `ANLEITUNG <Punkt>: <Befund> Fix: <Schritt> Link: <Seite>`. Langfuse prüft nur `--pruefen`; `--config` gilt nicht für das Sammelticket (sammelticket-anlegen.mjs liest die Standard-Config). `--dry-run` gibt nur den Plan aus (`PLAN …`). Ein zweiter Lauf ändert nichts.
 * Der Wochenlauf selbst (Lücke als Zeile ins Sammelticket) steht in harness-doctor-melden.mjs.
 *
 * `--pruefen` meldet den Block `sprache.spezifikation` der Config als Lücke `Sprache`, wenn er fehlt oder unvollständig ist (das Spezifikations-Gate hat keinen Standardwert). Es meldet zusätzlich jede Kern-Umgebungsvariable, die in der Umgebung dieses Prozesses noch unter ihrem Altnamen (Projektpräfix statt `FACTORY_`) gesetzt ist: der Altname wird nicht mehr gelesen (Wert nie ausgegeben; Namen aus den `umgebungsWert`-Literalen in scripts/). Grenze: nur die Umgebung des Doctor-Prozesses, nicht die anderer Shells oder Settings-Dateien.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { fehlerText, ghText } from "./gh-cli.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { kernEnvNamen, PROJEKT_CONFIG } from "./projekt-config-lib.mjs";
import { WOCHENLAUF_PFAD, WOCHENLAUF_WORKFLOW, konfigFehlerText, ohneActionPins, pruefLauf } from "./harness-doctor-lib.mjs";

// Die Prüf-API (Ableitung, Prüfpunkte, Vorlage) steht in der Lib; sie bleibt unter diesem Namen erreichbar.
export { BOARD_PRUEFPUNKTE, STATUS_FELD_NAME, TODO_OPTION_NAME, WOCHENLAUF_PFAD, WOCHENLAUF_WORKFLOW, ohneActionPins, pruefLauf, pruefe, voraussetzungenAus, workflowsLesen } from "./harness-doctor-lib.mjs";

const SKRIPTE = dirname(fileURLToPath(import.meta.url));
const USAGE = "Aufruf: node scripts/harness-doctor.mjs --pruefen [--config <pfad>] | --einrichten [--dry-run] [--config <pfad>]";

const erste = (e) => fehlerText(e).split("\n")[0];
const langfuseStandard = () =>
  spawnSync(process.execPath, [join(SKRIPTE, "langfuse-vorbedingung.mjs")], { encoding: "utf8", windowsHide: true, timeout: 10000 });

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
  if (ohneActionPins(ohneCr(readFileSync(ziel, "utf8"))) === ohneActionPins(ohneCr(WOCHENLAUF_WORKFLOW))) out(`OK Workflow ${WOCHENLAUF_PFAD}`);
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
  return { geplant: trocken && (/^Würde /m.test(text) || /^Trockenlauf: .*würde es neu setzen/m.test(text)) ? 1 : 0, angelegt: !trocken && /^Angelegt:/m.test(text) ? 1 : 0, fehler: 0 };
}

/**
 * `--einrichten [--dry-run]`: legt nur Umkehrbares an (fehlende Labels, die Wochenlauf-Datei, das Sammelticket); alles andere (Ruleset,
 * Secrets, Variablen, Project-Felder, Actions, Admin-Recht, Token) nur als `ANLEITUNG` mit Link. Ein zweiter Lauf ändert nichts.
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
  const fatal = ergebnis.some((p) => !p.ok && p.fatal === true);
  // sammelticket-anlegen.mjs liest immer die Standard-Config: bei einer anderen --config würde es ein Ticket für ein anderes Repo anlegen.
  const abweichend = werte.config !== undefined && resolve(rootDir, werte.config) !== resolve(rootDir, PROJEKT_CONFIG);
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
  else if (abweichend) {
    out("ANLEITUNG Sammelticket: sammelticket-anlegen.mjs liest nur die Standard-Config (" + PROJEKT_CONFIG + "), nicht --config Fix: node scripts/sammelticket-anlegen.mjs harness mit der Standard-Config fahren");
    anleitungen++;
  } else {
    const s = sammelticket({ trocken, spawn, out });
    geplant += s.geplant;
    angelegt += s.angelegt;
    fehler += s.fehler;
  }
  out(`Harness-Doctor --einrichten${trocken ? " --dry-run" : ""}: ${angelegt} angelegt, ${geplant} geplant, ${anleitungen + (fatal ? 1 : 0)} Anleitung(en), ${fehler} Fehler`);
  return anleitungen + (fatal ? 1 : 0) + fehler + geplant > 0 ? 1 : 0;
}

function pruefen({ werte, rootDir, gh, langfuse, env, out, err, kernEnv }) {
  let namen;
  try {
    namen = kernEnv(SKRIPTE); // Dateien lesen nur hier am Rand, die Prüflogik bekommt die Namen
  } catch (e) {
    err(`Kern-Umgebungsvariablen nicht lesbar: ${e instanceof Error ? e.message : String(e)}\nFix: scripts/ im Checkout wiederherstellen (git status), dann erneut prüfen`);
    return AUFRUF_EXIT;
  }
  let ergebnis;
  try {
    ({ ergebnis } = pruefLauf({ rootDir, configPfad: werte.config, gh, langfuse, umgebung: { env, namen } }));
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
  { rootDir = join(SKRIPTE, ".."), gh = (a) => ghText(a, { timeout: 30000 }), langfuse = langfuseStandard, spawn = sammelticketStandard, env = process.env, out = console.log, err = console.error, kernEnv = kernEnvNamen } = {},
) {
  const { werte, fehler } = flagsLesen(argv, { pruefen: { type: "boolean" }, einrichten: { type: "boolean" }, "dry-run": { type: "boolean" }, config: { type: "string" } });
  const aufrufFehler = fehler?.text ?? (Number(werte.pruefen === true) + Number(werte.einrichten === true) !== 1 ? "Genau einen Modus angeben: --pruefen oder --einrichten" : null)
    ?? (werte["dry-run"] && !werte.einrichten ? "--dry-run gilt nur mit --einrichten" : null);
  if (aufrufFehler) {
    err(`${aufrufFehler}\n${USAGE}`);
    return AUFRUF_EXIT;
  }
  return werte.einrichten ? einrichten({ werte, rootDir, gh, spawn, out, err }) : pruefen({ werte, rootDir, gh, langfuse, env, out, err, kernEnv });
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
