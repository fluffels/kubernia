// Gate-Befehle (factory#182): Block `befehle` der Projekt-Config und der Läufer `node scripts/gate-befehl.mjs <name>`.
// Die Sammelbefehle (Installation, verify, verify:kompakt, verify:changed, Abdeckung) stehen je Projekt in der Config;
// pre-push, CI und alle Laufzeiten rufen denselben Läufer, damit Kern-Texte kein Build-Werkzeug nennen. Ohne Block gelten die npm-Standards.
// Lib ohne Direktaufruf-Guard; importiert nur flag-lib (kein Zyklus mit der Config-Lib, der Lader wird injiziert).
// Grenze: endet der Befehl selbst mit 2, ist das vom Aufruf-Fehler nur an der Fix-Zeile auf stderr zu unterscheiden.
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";

export const STANDARD_BEFEHLE = Object.freeze({
  install: "npm ci",
  verify: "npm run verify",
  verifyKompakt: "npm run verify:kompakt",
  verifyChanged: "npm run verify:changed",
  coverage: "npm run test:coverage",
  testGezielt: "npx vitest run",
});

export const GATE_BEFEHL_NAMEN = Object.freeze(Object.keys(STANDARD_BEFEHLE));

/** Art des Prüflaufs je Gate-Befehl (Werkzeugmessung zählt `voll`/`gezielt`; null = kein Prüflauf); Schlüssel = `GATE_BEFEHL_NAMEN`. */
export const PRUEFLAUF_ART = Object.freeze({ install: null, verify: "voll", verifyKompakt: "voll", verifyChanged: "gezielt", coverage: null, testGezielt: null });

/** Der einzige Name, der Pfade annimmt; sie werden in doppelten Anführungszeichen an die Befehlszeile angehängt. */
export const PFAD_NAME = "testGezielt";
/** Erlaubte Zeichen eines angehängten Pfads (keine Shell-Metazeichen, kein Leerzeichen). */
const PFAD_MUSTER = /^[\w./\\:@+=,-]+$/;

/** Flag, das nur die Befehlszeile ausgibt, statt sie zu starten. */
export const ZEIGEN_FLAG = "--zeigen";

const istName = (name) => typeof name === "string" && Object.hasOwn(STANDARD_BEFEHLE, name);
const istBefehl = (w) => typeof w === "string" && w.trim() !== "";

/** Pur: Formfehler des optionalen Blocks `befehle` (leer = gültig, auch ohne Block). */
export function pruefeBefehle(block) {
  if (block === undefined) return [];
  if (block === null || typeof block !== "object" || Array.isArray(block)) return ["befehle muss ein Objekt (Name → Befehlszeile) sein"];
  return Object.keys(block).flatMap((k) => {
    if (!istName(k)) return [`befehle.${k} ist kein bekannter Name (erlaubt: ${GATE_BEFEHL_NAMEN.join(", ")})`];
    if (!istBefehl(block[k])) return [`befehle.${k} muss eine nicht-leere Befehlszeile (String) sein`];
    if (/[\r\n]/.test(block[k])) return [`befehle.${k} muss eine einzelne Zeile sein (kein Zeilenumbruch)`];
    return [];
  });
}

/** Pur: wirksamer Befehl zu `name`; unbekannter Name oder kaputter Block wirft mit Fix-Zeile. */
export function befehlAus(config, name) {
  if (!istName(name)) throw new Error(`unbekannter Gate-Befehl „${name}“.\nFix: einen Namen aus ${GATE_BEFEHL_NAMEN.join(", ")} angeben.`);
  const block = config?.befehle;
  const fehler = pruefeBefehle(block);
  if (fehler.length > 0) throw new Error(`befehle in der Projekt-Config ungültig: ${fehler.join("; ")}\nFix: den Block befehle der Projekt-Config korrigieren.`);
  return block?.[name] ?? STANDARD_BEFEHLE[name];
}

/** Startet die Befehlszeile als String in der Shell (Windows: sonst scheitert npm.cmd); liefert den Exit-Code (fail-closed: Signal und Startfehler = 1). */
export function fuehreAus(befehl, { spawn, cwd, err }) {
  const r = spawn(befehl, { shell: true, stdio: "inherit", cwd });
  if (r.error) {
    err(`✖ Gate-Befehl konnte nicht starten: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

/** Aufruf-Fehler: Meldung samt Fix-Zeile auf stderr, Exit 2. */
function aufrufFehler(err, text) {
  err(text);
  return AUFRUF_EXIT;
}

/** Einstieg: `<name> [--zeigen]` (`testGezielt` zusätzlich mit Pfaden); gibt den Exit-Code zurück (der Einstieg setzt `process.exitCode`). */
export function cli(argv, { lade, spawn, cwd, out = console.log, err = console.error }) {
  const { werte, positionale, fehler } = flagsLesen(argv, { [ZEIGEN_FLAG.slice(2)]: { type: "boolean" } }, { positionale: true });
  const hinweis = `Fix: node scripts/gate-befehl.mjs <name> [${ZEIGEN_FLAG}] mit name aus ${GATE_BEFEHL_NAMEN.join(", ")}`;
  if (fehler) return aufrufFehler(err, `${fehler.text}\n${hinweis}`);
  const name = positionale[0];
  const mitPfaden = name === PFAD_NAME;
  if (!mitPfaden && positionale.length !== 1) return aufrufFehler(err, `genau ein Gate-Befehl-Name erwartet (Pfade nimmt nur ${PFAD_NAME} an).\n${hinweis}`);
  const pfade = mitPfaden ? positionale.slice(1) : [];
  if (mitPfaden && pfade.length === 0) return aufrufFehler(err, `${PFAD_NAME} braucht mindestens einen Pfad.\nFix: node scripts/gate-befehl.mjs ${PFAD_NAME} <datei> [<datei> …]`);
  const schlecht = pfade.find((x) => !PFAD_MUSTER.test(x));
  if (schlecht !== undefined) return aufrufFehler(err, `Pfad „${schlecht}“ enthält unerlaubte Zeichen (erlaubt: Buchstaben, Ziffern, _ . / \\ : @ + = , -).\nFix: einen einfachen Pfad ohne Leerzeichen und Shell-Zeichen angeben.`);
  let befehl;
  try {
    if (!istName(name)) befehlAus({}, name);
    befehl = befehlAus(lade(), name);
  } catch (e) {
    return aufrufFehler(err, e.message);
  }
  if (pfade.length > 0) befehl = `${befehl} ${pfade.map((x) => `"${x}"`).join(" ")}`;
  if (werte[ZEIGEN_FLAG.slice(2)]) {
    out(befehl);
    return 0;
  }
  err(`▶ Gate-Befehl ${name}: ${befehl}`);
  return fuehreAus(befehl, { spawn, cwd, err });
}
