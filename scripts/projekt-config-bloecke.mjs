// Form-Prüfer der Blöcke der Projekt-Config (factory#162 L22): reine Funktionen `pruefeX(wert) → Fehlerliste` für struktur, sprache, ausnahmen, datengroesse, gates, factoryLinks, labels, skills,
// berechtigungen, sandbox und die Literal-Objekte. `projekt-config-lib.mjs` importiert sie (`pruefeProjektConfig`, Accessoren); dieses Modul importiert nichts aus ihr (Blatt, kein Zyklus).
// Nur Blatt-Importe: `relativ-pfad.mjs` (importfrei), `pfad-glob.mjs` (nur relativ-pfad), `quellwurzeln-lib.mjs` (nur Builtins, pfad-glob und relativ-pfad) und `spezifikation-lib.mjs` (zieht `markdown.mjs` und `repo-form.mjs`, nur Builtins).
import { istRelativPosix } from "./relativ-pfad.mjs";
import { GATE_FORM } from "./regex-lib.mjs";
import { globMaengel } from "./pfad-glob.mjs";
import { spracheMaengel } from "./spezifikation-lib.mjs";
import { endungenMaengel, quellenMaengel } from "./quellwurzeln-lib.mjs";

export const istText = (v) => typeof v === "string" && v.trim() !== "";
export const istObjekt = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pflicht-Label-Schlüssel (weitere erlaubt, gleiche Prüfung). */
const PFLICHT_LABELS = ["harness", "festgefahren", "forum", "dependabotInbox"];

/** Pur: prüft `struktur` (nur die Form; ein fehlender Block ist beim Laden erlaubt, `strukturAus` verlangt ihn beim Gebrauch). */
export function pruefeStruktur(s) {
  if (!istObjekt(s)) return ["struktur muss ein Objekt mit quelle und moduldoku sein"];
  const doku = s.moduldoku;
  const pfade = doku === null ? [] : !istText(doku) ? ["struktur.moduldoku muss ein nicht-leerer String (repo-relativer Pfad) sein"]
    : istRelativPosix(doku) && !/[*?]/.test(doku) ? [] : [`struktur.moduldoku muss ein repo-relativer POSIX-Pfad sein (ohne führenden / oder Laufwerk, ohne . und .., ohne Backslash, ohne End- oder Doppel-Slash): ${JSON.stringify(doku)}`];
  return [...quellenMaengel(s), ...pfade, ...pruefeEscapeKopien(s.escapeKopien)];
}

/** Pur: prüft den optionalen Schlüssel `struktur.escapeKopien` (Liste repo-relativer POSIX-Pfade ohne Doppelte); fehlt er, ist nichts zu prüfen. */
export function pruefeEscapeKopien(liste) {
  if (liste === undefined) return [];
  if (!Array.isArray(liste)) return ["struktur.escapeKopien muss eine Liste repo-relativer Pfade sein"];
  const fehler = liste.flatMap((p, i) => {
    if (!istText(p)) return [`struktur.escapeKopien[${i}] muss ein nicht-leerer String (repo-relativer Pfad) sein`];
    return istRelativPosix(p) ? [] : [`struktur.escapeKopien[${i}] muss ein repo-relativer POSIX-Pfad sein: ${JSON.stringify(p)}`];
  });
  const doppelt = liste.filter((p, i) => istText(p) && liste.indexOf(p) !== i);
  return [...fehler, ...[...new Set(doppelt)].map((p) => `struktur.escapeKopien enthält ${p} doppelt`)];
}

/**
 * Pur: prüft `sprache` (nur die Form; ein fehlender Block ist beim Laden erlaubt, `spracheAus` verlangt ihn beim Gebrauch).
 * Die Schlüssel von `sprache.spezifikation` prüft die Spezifikations-Lib (`spracheMaengel`, SSOT; ihr `wortschatz` wirft bei denselben Mängeln).
 */
export function pruefeSprache(s) {
  if (!istObjekt(s)) return ["sprache muss ein Objekt mit umschrift und spezifikation sein"];
  const fehler = [];
  if (!Array.isArray(s.umschrift) || s.umschrift.length === 0 || !s.umschrift.every((w) => typeof w === "string" && /^[a-z]+$/.test(w))) {
    fehler.push("sprache.umschrift muss eine nicht-leere Liste kleingeschriebener ASCII-Wörter (Muster ^[a-z]+$) sein");
  }
  return [...fehler, ...spracheMaengel(s.spezifikation)];
}

const AUSNAHME_LISTEN_NAMEN = ["groesse", "kontext"];

/** Pur: prüft den Block `ausnahmen` (Form): je Liste `{ datei, grund }`, die Datei repo-relativ POSIX und je Liste nur einmal, der Grund nennt ein Ticket `#<nr>`. */
export function pruefeAusnahmen(a) {
  if (!istObjekt(a)) return ["ausnahmen muss ein Objekt mit den Listen groesse und kontext sein"];
  const fehler = Object.keys(a).filter((k) => !AUSNAHME_LISTEN_NAMEN.includes(k)).map((k) => `ausnahmen.${k} ist kein bekannter Schlüssel (erlaubt: ${AUSNAHME_LISTEN_NAMEN.join(", ")})`);
  for (const name of AUSNAHME_LISTEN_NAMEN) {
    const liste = a[name];
    if (liste === undefined) continue;
    if (!Array.isArray(liste)) {
      fehler.push(`ausnahmen.${name} muss eine Liste von { datei, grund } sein`);
      continue;
    }
    const gesehen = new Set();
    liste.forEach((e, i) => fehler.push(...eintragMaengel(e, `ausnahmen.${name}[${i}]`, gesehen)));
  }
  return fehler;
}

/** Pur: Form eines Listeneintrags `{ datei, grund }` (Datei repo-relativ POSIX und je Liste nur einmal über `gesehen`, der Grund nennt ein Ticket `#<nr>`); `wo` ist der Pfad in den Meldungen. */
function eintragMaengel(e, wo, gesehen) {
  if (!istObjekt(e)) return [`${wo} muss ein Objekt { datei, grund } sein`];
  const fehler = [];
  if (!istText(e.datei)) fehler.push(`${wo}.datei muss ein nicht-leerer String (repo-relativer Pfad) sein`);
  else if (!istRelativPosix(e.datei)) fehler.push(`${wo}.datei muss ein repo-relativer POSIX-Pfad sein: ${JSON.stringify(e.datei)}`);
  else if (gesehen.has(e.datei)) fehler.push(`${wo}.datei „${e.datei}“ steht doppelt`);
  else gesehen.add(e.datei);
  if (!istText(e.grund)) fehler.push(`${wo}.grund muss ein nicht-leerer String sein`);
  else if (!/#\d+/.test(e.grund)) fehler.push(`${wo}.grund muss ein Ticket #<nr> nennen (eine Ausnahme ohne offenes Ticket gibt es nicht)`);
  return fehler;
}

/** Standard-Endungen des Datenbudgets (`datengroesse.endungen`): ein Format, kein Projektwort. */
export const DATEN_STANDARD_ENDUNGEN = [".json"];
const DATEN_SCHLUESSEL = ["pfade", "budget", "endungen", "hinweis", "deckel"];
const istPositivGanz = (v) => Number.isInteger(v) && v > 0;

/**
 * Pur: prüft den Block `datengroesse` (Form, factory#7): `pfade` (nicht-leere Liste wörtlicher Ordner oder Globs) und `budget` (positive Ganzzahl, Zeilen) sind Pflicht;
 * `endungen` (Standard `.json`), `hinweis` (Projekttext der Teilung) und `deckel` (Liste `{ datei, max, grund mit #<nr> }`, Ratchet für bestehende Monolithe) sind optional.
 * Ein fehlender Block (`undefined`) ist erlaubt (das Datenbudget ist dann aus) und ergibt keinen Fehler.
 */
export function pruefeDatengroesse(d) {
  if (d === undefined) return [];
  if (!istObjekt(d)) return ["datengroesse muss ein Objekt mit pfade und budget sein"];
  const fehler = Object.keys(d).filter((k) => !DATEN_SCHLUESSEL.includes(k)).map((k) => `datengroesse.${k} ist kein bekannter Schlüssel (erlaubt: ${DATEN_SCHLUESSEL.join(", ")})`);
  fehler.push(...(!Array.isArray(d.pfade) || d.pfade.length === 0 ? ["datengroesse.pfade muss eine nicht-leere Liste von Ordnern oder Pfad-Globs sein"] : globMaengel(d.pfade, "datengroesse.pfade")));
  if (!istPositivGanz(d.budget)) fehler.push("datengroesse.budget muss eine positive Ganzzahl (Zeilen) sein");
  fehler.push(...endungenMaengel(d.endungen, "datengroesse.endungen"));
  if (d.hinweis !== undefined && !istText(d.hinweis)) fehler.push("datengroesse.hinweis muss ein nicht-leerer String sein");
  if (d.deckel === undefined) return fehler;
  if (!Array.isArray(d.deckel)) return [...fehler, "datengroesse.deckel muss eine Liste von { datei, max, grund } sein"];
  const gesehen = new Set();
  d.deckel.forEach((e, i) => {
    const wo = `datengroesse.deckel[${i}]`;
    fehler.push(...eintragMaengel(e, wo, gesehen));
    if (istObjekt(e) && !istPositivGanz(e.max)) fehler.push(`${wo}.max muss eine positive Ganzzahl (Zeilen) sein`);
  });
  return fehler;
}


/** Pur: prüft den Block `gates` (Form): nur `nichtInVerify`, eine Liste `{ gate, grund }`; das Gate ein Skriptname, je Liste nur einmal, der Grund nicht leer. */
export function pruefeGates(g) {
  if (!istObjekt(g)) return ["gates muss ein Objekt mit der Liste nichtInVerify sein"];
  const fehler = Object.keys(g).filter((k) => k !== "nichtInVerify").map((k) => `gates.${k} ist kein bekannter Schlüssel (erlaubt: nichtInVerify)`);
  if (g.nichtInVerify === undefined) return fehler;
  if (!Array.isArray(g.nichtInVerify)) return [...fehler, "gates.nichtInVerify muss eine Liste von { gate, grund } sein"];
  const gesehen = new Set();
  g.nichtInVerify.forEach((e, i) => {
    const wo = `gates.nichtInVerify[${i}]`;
    if (!istObjekt(e)) return fehler.push(`${wo} muss ein Objekt { gate, grund } sein`);
    if (!istText(e.gate) || !GATE_FORM.test(e.gate)) fehler.push(`${wo}.gate muss ein Skriptname (Buchstaben, Ziffern, : . _ -, kein Punkt am Ende) sein`);
    else if (gesehen.has(e.gate)) fehler.push(`${wo}.gate „${e.gate}“ steht doppelt`);
    else gesehen.add(e.gate);
    if (!istText(e.grund)) fehler.push(`${wo}.grund muss ein nicht-leerer String sein`);
  });
  return fehler;
}

/** Pur: prüft den Block `factoryLinks` (Form): nur `ausnahmen`, eine Liste von Pfad-Globs (`scripts/pfad-glob.mjs`). */
export function pruefeFactoryLinks(f) {
  if (!istObjekt(f)) return ["factoryLinks muss ein Objekt mit der Liste ausnahmen sein"];
  const fehler = Object.keys(f).filter((k) => k !== "ausnahmen").map((k) => `factoryLinks.${k} ist kein bekannter Schlüssel (erlaubt: ausnahmen)`);
  return f.ausnahmen === undefined ? fehler : [...fehler, ...globMaengel(f.ausnahmen, "factoryLinks.ausnahmen")];
}

/** Pur: prüft `labels`: die Pflichtschlüssel und alle weiteren Werte sind nicht-leere Strings. */
export function pruefeLabels(l) {
  if (!istObjekt(l)) return [`labels muss ein Objekt (Name → String) mit den Pflichtschlüsseln ${PFLICHT_LABELS.join(", ")} sein`];
  const fehler = [];
  for (const k of PFLICHT_LABELS) {
    if (!Object.hasOwn(l, k)) fehler.push(`labels.${k} fehlt (Pflichtschlüssel)`);
  }
  for (const [k, v] of Object.entries(l)) {
    if (!istText(v)) fehler.push(`labels.${k} muss ein nicht-leerer String sein`);
  }
  return fehler;
}

/** Der Skill-Schlüssel, dessen Wert `null` sein darf (kein Abschluss-Skill, factory#139). */
export const NULLBARER_SKILL = "abschluss";

/**
 * Pur: prüft `skills` (Name → nicht-leerer String); `abschluss` ist Pflichtschlüssel (der Skill, den ein Ticketlauf am Ende fährt),
 * sein Wert darf `null` sein (kein Abschluss-Skill, factory#139); der Schlüssel selbst fehlt nie.
 */
export function pruefeSkills(s) {
  if (!istObjekt(s)) return ["skills muss ein Objekt (Name → String) mit dem Pflichtschlüssel abschluss sein"];
  const fehler = [];
  if (!Object.hasOwn(s, NULLBARER_SKILL)) fehler.push("skills.abschluss fehlt (Pflichtschlüssel)");
  for (const [k, v] of Object.entries(s)) {
    if (k === NULLBARER_SKILL && v === null) continue;
    if (!istText(v)) fehler.push(`skills.${k} muss ein nicht-leerer String${k === NULLBARER_SKILL ? " oder null (kein Abschluss-Skill)" : ""} sein`);
  }
  return fehler;
}

const BERECHTIGUNG_LISTEN = ["allow", "ask", "deny"];
const BERECHTIGUNG_PRAEFIX = "mcp__";

/**
 * Pur: prüft den Block `berechtigungen` (Form, #1874): nur die Listen allow, ask und deny, je Eintrag ein nicht-leerer String ohne Leerraum
 * mit dem Präfix `mcp__` (nur Modul- und Server-Regeln), je Liste ohne Duplikat. Ob ein allow ein deny oder ask aufhebt, prüft die Besitz-Lib
 * (`ergaenzungsBefunde`), sie kennt den Kern-Anteil.
 */
export function pruefeBerechtigungen(b) {
  if (!istObjekt(b)) return ["berechtigungen muss ein Objekt mit den Listen allow, ask und deny sein"];
  const fehler = Object.keys(b).filter((k) => !BERECHTIGUNG_LISTEN.includes(k)).map((k) => `berechtigungen.${k} ist kein bekannter Schlüssel (erlaubt: ${BERECHTIGUNG_LISTEN.join(", ")})`);
  for (const name of BERECHTIGUNG_LISTEN) {
    const liste = b[name];
    if (liste === undefined) continue;
    if (!Array.isArray(liste)) {
      fehler.push(`berechtigungen.${name} muss eine Liste von Strings sein`);
      continue;
    }
    const gesehen = new Set();
    liste.forEach((e, i) => {
      const wo = `berechtigungen.${name}[${i}]`;
      if (!istText(e) || /\s/.test(e)) return fehler.push(`${wo} muss ein nicht-leerer String ohne Leerraum sein`);
      if (!e.startsWith(BERECHTIGUNG_PRAEFIX)) fehler.push(`${wo} muss mit „${BERECHTIGUNG_PRAEFIX}“ beginnen (nur Modul- und Server-Regeln gehören in die Ergänzung): ${JSON.stringify(e)}`);
      if (gesehen.has(e)) fehler.push(`${wo} „${e}“ steht doppelt`);
      gesehen.add(e);
    });
  }
  return fehler;
}

const SANDBOX_KEYS = ["allowedDomains", "envVars"];

/**
 * Pur: prüft den Block `sandbox` (Form, #1888): nur die Listen allowedDomains (Strings ohne Leerraum) und envVars (Objekte `{ name, mode }` mit `mode: "deny"`), je Liste ohne Duplikat (Name).
 * Ob die Ergänzung zum Wert in `.claude/settings.json` passt und nichts öffnet, prüft die Besitz-Lib (`sandboxErgaenzungsBefunde`).
 */
export function pruefeSandbox(b) {
  if (!istObjekt(b)) return ["sandbox muss ein Objekt mit den Listen allowedDomains und envVars sein"];
  const fehler = Object.keys(b).filter((k) => !SANDBOX_KEYS.includes(k)).map((k) => `sandbox.${k} ist kein bekannter Schlüssel (erlaubt: ${SANDBOX_KEYS.join(", ")})`);
  for (const k of SANDBOX_KEYS) {
    const liste = b[k];
    if (liste === undefined) continue;
    if (!Array.isArray(liste)) {
      fehler.push(`sandbox.${k} muss eine Liste sein`);
      continue;
    }
    const gesehen = new Set();
    liste.forEach((e, i) => {
      const wo = `sandbox.${k}[${i}]`;
      const name = k === "envVars" ? e?.name : e;
      if (!istText(name) || /\s/.test(name)) return fehler.push(`${wo} braucht einen nicht-leeren Namen ohne Leerraum`);
      if (k === "envVars" && (!istObjekt(e) || e.mode !== "deny" || Object.keys(e).some((x) => x !== "name" && x !== "mode"))) fehler.push(`${wo} muss die Form { "name": …, "mode": "deny" } haben (eine Ergänzung sperrt nur)`);
      if (gesehen.has(name)) fehler.push(`${wo} „${name}“ steht doppelt`);
      gesehen.add(name);
    });
  }
  return fehler;
}

/** Pur: prüft ein optionales Literal-Objekt (`projektliterale`, `seitenliterale`: Name → nicht-leerer String); fehlt es, gibt es keinen Fehler. */
export function pruefeLiterale(wert, schluessel) {
  if (wert[schluessel] === undefined) return [];
  if (!istObjekt(wert[schluessel])) return [`${schluessel} muss ein Objekt (Name → String) sein`];
  return Object.entries(wert[schluessel]).filter(([, lit]) => !istText(lit)).map(([name]) => `${schluessel}.${name} muss ein nicht-leerer String sein`);
}
