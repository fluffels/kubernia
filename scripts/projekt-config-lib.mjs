// Lib ohne Direktaufruf-Guard; die Kommandozeile startet scripts/projekt-config.mjs.
/**
 * Projekt-Config (#1611, ADR 0022 F2): Repo, Besitzer und Board-IDs kommen zur Laufzeit aus `.factory/projekt.json`,
 * nicht aus Literalen im Kern. Fehlt die Datei oder ein Pflichtschlüssel, bricht der Lader mit klarer Meldung ab:
 * es gibt bewusst keinen stillen Standardwert. Dieses Modul trägt selbst kein Projektliteral.
 *
 * Kommandozeile (über den Einstieg projekt-config.mjs): `node scripts/projekt-config.mjs [--config <pfad>] <schluessel.pfad>` gibt einen Skalarwert aus
 * (Exit 0), 1 bei fehlender/ungültiger Config oder unbekanntem Schlüssel, 2 bei einem Aufruf-Fehler (ohne Schlüssel, unbekanntes Flag, fehlender Wert).
 *
 * Nur Node-Builtins, `flag-lib.mjs` und `spezifikation-lib.mjs` (importfrei; läuft auch in Workflows ohne `npm ci`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { QUELL_VERZEICHNIS, ZEIGER_WURZEL } from "./skill-pfade.mjs";
import { spracheMaengel } from "./spezifikation-lib.mjs";

export const PROJEKT_CONFIG = ".factory/projekt.json";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const istText = (v) => typeof v === "string" && v.trim() !== "";
const istPositiv = (v) => Number.isInteger(v) && v > 0;
const istObjekt = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

export const BOARD_ROLLEN = ["produkt", "factory"];

/** Kern-Bereiche der Ticket-Auswahl (`--bereich`) mit Anzeigenamen; das Label für „agentic“ ist `labels.harness`. Projektspezifische Namen sind Aliase (`bereiche.aliase`). */
export const BEREICHE = Object.freeze({ agentic: "Agentic Engineering", produkt: "Produktentwicklung" });

/** Pur: die Bereichs-Aliase der Config (Alias → Kern-Bereich); ohne Schlüssel leer. Die Form prüft `pruefeBereiche`. */
export function bereichAliaseAus(config) {
  const aliase = config?.bereiche?.aliase;
  return istObjekt(aliase) ? aliase : {};
}

/** Pur: prüft `bereiche` (optional; `aliase` bildet je Name einen Kern-Bereich ab, ohne einen Kern-Namen zu überdecken). */
function pruefeBereiche(b) {
  if (!istObjekt(b)) return ["bereiche muss ein Objekt mit aliase sein"];
  if (b.aliase === undefined) return [];
  if (!istObjekt(b.aliase)) return ["bereiche.aliase muss ein Objekt (Alias → Kern-Bereich) sein"];
  const fehler = [];
  for (const [alias, ziel] of Object.entries(b.aliase)) {
    if (!/^[a-z][a-z0-9-]*$/.test(alias)) fehler.push(`bereiche.aliase.${alias}: der Alias-Name muss dem Muster ^[a-z][a-z0-9-]*$ entsprechen`);
    else if (Object.hasOwn(BEREICHE, alias)) fehler.push(`bereiche.aliase.${alias} überdeckt einen Kern-Bereich (${Object.keys(BEREICHE).join(", ")})`);
    if (typeof ziel !== "string" || !Object.hasOwn(BEREICHE, ziel)) fehler.push(`bereiche.aliase.${alias} muss auf einen Kern-Bereich zeigen (${Object.keys(BEREICHE).join(", ")})`);
  }
  return fehler;
}

/** Pur: prüft ein Board-Objekt; `praefix` ist der Schlüsselpfad für die Fehlermeldungen (z. B. `boards.1.`). */
function pruefeBoard(b, praefix) {
  const fehler = [];
  if (!BOARD_ROLLEN.includes(b.rolle)) fehler.push(`${praefix}rolle muss eine von ${BOARD_ROLLEN.join(", ")} sein`);
  if (!istText(b.besitzer)) fehler.push(`${praefix}besitzer muss ein nicht-leerer String sein`);
  if (b.besitzerTyp !== "user" && b.besitzerTyp !== "org") fehler.push(`${praefix}besitzerTyp muss "user" oder "org" sein`);
  if (!istPositiv(b.nummer)) fehler.push(`${praefix}nummer muss eine positive Ganzzahl sein`);
  if (!istPositiv(b.statusFeldId)) fehler.push(`${praefix}statusFeldId muss eine positive Ganzzahl sein`);
  for (const k of ["projectId", "statusFeldNodeId", "todoOptionId"]) {
    if (!istText(b[k])) fehler.push(`${praefix}${k} muss ein nicht-leerer String sein`);
  }
  return fehler;
}

/** Pur: prüft die Board-Liste (Einzelprüfung, genau eins je Rolle, eindeutige projectId und REST-Pfad). */
function pruefeBoards(boards) {
  if (!Array.isArray(boards) || boards.length === 0) return ["boards muss eine nicht-leere Liste von Board-Objekten sein"];
  const fehler = [];
  const projekte = new Set();
  const pfade = new Set();
  const rollen = new Map();
  boards.forEach((b, i) => {
    if (!istObjekt(b)) {
      fehler.push(`boards.${i} muss ein Objekt sein`);
      return;
    }
    fehler.push(...pruefeBoard(b, `boards.${i}.`));
    if (BOARD_ROLLEN.includes(b.rolle)) rollen.set(b.rolle, (rollen.get(b.rolle) ?? 0) + 1);
    if (istText(b.projectId)) {
      if (projekte.has(b.projectId)) fehler.push(`boards.${i}.projectId kommt mehrfach vor`);
      projekte.add(b.projectId);
    }
    if (istText(b.besitzer) && istPositiv(b.nummer)) {
      const pfad = boardPfad(b);
      if (pfade.has(pfad)) fehler.push(`boards.${i}: Board ${pfad} kommt mehrfach vor`);
      pfade.add(pfad);
    }
  });
  for (const rolle of BOARD_ROLLEN) {
    const n = rollen.get(rolle) ?? 0;
    if (n === 0) fehler.push(`Rolle ${rolle} fehlt in boards (genau ein Board je Rolle)`);
    if (n > 1) fehler.push(`Rolle ${rolle} kommt mehrfach in boards vor (genau ein Board je Rolle)`);
  }
  return fehler;
}

/** Muster der Präfixe (#1741, F3): Commit-Zeilen-Präfix wie `<PRAEFIX>-` (Großbuchstabe, dann Großbuchstaben/Ziffern, Bindestrich am Ende);
 *  Branch ohne Regex-Sonderzeichen und Leerraum, Worktree zusätzlich ohne Schrägstrich (ein Ordnername). */
export const COMMIT_PRAEFIX_MUSTER = /^[A-Z][A-Z0-9]*-$/;
const BRANCH_MUSTER = /^[A-Za-z0-9_/-]+$/;
const WORKTREE_MUSTER = /^[A-Za-z0-9_-]+$/;
/** Agentenname: kein Leerraum, kein `:` (Agent-Typ-Trenner), nicht mit `-` am Anfang. */
export const AGENT_MUSTER = /^[^\s:-][^\s:]*$/;

/** Pflicht-Label-Schlüssel (weitere erlaubt, gleiche Prüfung) und Pflicht-Agenten. */
export const PFLICHT_LABELS = ["harness", "festgefahren", "forum", "dependabotInbox"];
/** Name des Kern-Ticket-Skills (Quelle `.agents/skills/<name>/`, Zeiger `.claude/skills/<name>/`): gilt immer, unabhängig von `agenten.ticketSkill` der Projekt-Config. */
export const KERN_TICKET_SKILL = "factory";

export const PFLICHT_AGENTEN = ["planer", "umsetzer", "lens", "gruppe", "ticketSkill"];

/**
 * Feste Kern-Pfade der Rollen (#1748, F3h): ohne Projektwert im Pfad, die Identität setzt `name:` aus `agenten.<rolle>` (Platzhalterzeile vor `name:`).
 * Einzige Quelle der Pfade; Schlüssel wie `PFLICHT_AGENTEN`.
 */
export const ROLLEN_PFADE = Object.freeze({
  planer: ".claude/agents/factory-planer.md",
  umsetzer: ".claude/agents/factory-umsetzer.md",
  lens: ".claude/agents/factory-lens.md",
  gruppe: ".claude/agents/factory-gruppe.md",
  ticketSkill: `${QUELL_VERZEICHNIS}/factory-ticket/SKILL.md`,
});

/**
 * Rollen, deren Datei dem Projekt gehört (ADR 0022, Fortschreibung #1850): nie im Manifest, das Ziel legt sie unter dem Rollen-Pfad selbst an.
 * Alle anderen Rollen aus `ROLLEN_PFADE` müssen im Quell-Manifest eine ganze, verteilte Einheit sein (Prüfung im Sync, #1871).
 */
export const PROJEKT_ROLLEN = Object.freeze(["ticketSkill"]);

/** Verzeichnis des Ticket-Skills (`ROLLEN_PFADE.ticketSkill` ohne Dateiname), die einzige Ableitung für alle Nutzer. */
export const TICKET_SKILL_ORDNER = posix.dirname(ROLLEN_PFADE.ticketSkill);

/** Verzeichnisname des Ticket-Skills (letztes Segment von `TICKET_SKILL_ORDNER`) und sein generierter Zeiger unter der Zeiger-Wurzel. */
export const TICKET_SKILL_NAME = posix.basename(TICKET_SKILL_ORDNER);
export const TICKET_SKILL_ZEIGER = `${ZEIGER_WURZEL}/${TICKET_SKILL_NAME}/SKILL.md`;

/** Pur: prüft `praefixe` (commitZeile, branch, worktree). */
function pruefePraefixe(p) {
  if (!istObjekt(p)) return ["praefixe muss ein Objekt mit commitZeile, branch und worktree sein"];
  const fehler = [];
  const regeln = [
    ["commitZeile", COMMIT_PRAEFIX_MUSTER, "ein Präfix der Form <GROSSBUCHSTABEN>- (Muster ^[A-Z][A-Z0-9]*-$)"],
    ["branch", BRANCH_MUSTER, "ein nicht-leerer Text aus Buchstaben, Ziffern, _, - und / (keine Regex-Sonderzeichen, kein Leerraum)"],
    ["worktree", WORKTREE_MUSTER, "ein nicht-leerer Text aus Buchstaben, Ziffern, _ und - (kein /, keine Regex-Sonderzeichen, kein Leerraum)"],
  ];
  for (const [k, muster, soll] of regeln) {
    if (typeof p[k] !== "string" || !muster.test(p[k])) fehler.push(`praefixe.${k} muss ${soll} sein`);
  }
  return fehler;
}

/** Pur: das Label zum Schlüssel `labels.<schluessel>` der Config; wirft ohne nicht-leeren String (kein stiller Standardwert, #1744). */
export function labelAus(config, schluessel) {
  const wert = config?.labels?.[schluessel];
  if (typeof wert !== "string" || wert.trim() === "") {
    throw new Error(`labels.${schluessel} fehlt oder ist kein nicht-leerer String in ${PROJEKT_CONFIG}\nFix: den Schlüssel labels.${schluessel} in ${PROJEKT_CONFIG} eintragen`);
  }
  return wert;
}

/**
 * Pur: der Block `sprache` der Config (`umschrift` plus `spezifikation` mit den Abschnittsnamen und Schlüsselwörtern des Spezifikations-Gates);
 * wirft ohne `sprache` (kein stiller Deutsch-Standardwert, #1711). Die Form prüft `pruefeProjektConfig`, das Gate wirft bei einem fehlenden Schlüssel selbst.
 */
export function spracheAus(config) {
  const wert = config?.sprache;
  if (!istObjekt(wert) || !istObjekt(wert.spezifikation)) {
    throw new Error(`sprache fehlt oder hat keinen Block spezifikation in ${PROJEKT_CONFIG}\nFix: den Schlüssel sprache (umschrift, spezifikation) in ${PROJEKT_CONFIG} eintragen`);
  }
  return wert;
}

/**
 * Pur: der Block `struktur` der Config (`quelle`: Wurzel des Quellcodes, `moduldoku`: Ordner der Modul-Tiefendocs; beide repo-relativ, POSIX) für die Kern-Checks
 * `check:size` und `check:docmap`; wirft ohne beide nicht-leeren Strings (kein stiller Standardwert, #1843). Nicht zu verwechseln mit der Quellwurzel der Schichtdaten.
 */
export function strukturAus(config) {
  const wert = config?.struktur;
  if (!istObjekt(wert) || !istText(wert.quelle) || !istText(wert.moduldoku)) {
    throw new Error(`struktur fehlt oder hat keine nicht-leeren Strings quelle und moduldoku in ${PROJEKT_CONFIG}\nFix: den Schlüssel struktur (quelle, moduldoku) in ${PROJEKT_CONFIG} eintragen`);
  }
  const form = pruefeStruktur(wert);
  if (form.length > 0) throw new Error(`${form.join("; ")} in ${PROJEKT_CONFIG}\nFix: struktur.quelle und struktur.moduldoku als repo-relative POSIX-Pfade (z. B. docs/module) eintragen`);
  return { quelle: wert.quelle, moduldoku: wert.moduldoku };
}

/** Pur: prüft `struktur` (nur die Form; ein fehlender Block ist beim Laden erlaubt, `strukturAus` verlangt ihn beim Gebrauch). */
function pruefeStruktur(s) {
  if (!istObjekt(s)) return ["struktur muss ein Objekt mit quelle und moduldoku sein"];
  const pfade = ["quelle", "moduldoku"].flatMap((k) => {
    if (!istText(s[k])) return [`struktur.${k} muss ein nicht-leerer String (repo-relativer Pfad) sein`];
    return istRepoRelativPosix(s[k]) ? [] : [`struktur.${k} muss ein repo-relativer POSIX-Pfad sein (ohne führenden / oder Laufwerk, ohne . und .., ohne Backslash, ohne End- oder Doppel-Slash): ${JSON.stringify(s[k])}`];
  });
  return [...pfade, ...pruefeEscapeKopien(s.escapeKopien)];
}

/** Pur: prüft den optionalen Schlüssel `struktur.escapeKopien` (Liste repo-relativer POSIX-Pfade ohne Doppelte); fehlt er, ist nichts zu prüfen. */
function pruefeEscapeKopien(liste) {
  if (liste === undefined) return [];
  if (!Array.isArray(liste)) return ["struktur.escapeKopien muss eine Liste repo-relativer Pfade sein"];
  const fehler = liste.flatMap((p, i) => {
    if (!istText(p)) return [`struktur.escapeKopien[${i}] muss ein nicht-leerer String (repo-relativer Pfad) sein`];
    return istRepoRelativPosix(p) ? [] : [`struktur.escapeKopien[${i}] muss ein repo-relativer POSIX-Pfad sein: ${JSON.stringify(p)}`];
  });
  const doppelt = liste.filter((p, i) => istText(p) && liste.indexOf(p) !== i);
  return [...fehler, ...[...new Set(doppelt)].map((p) => `struktur.escapeKopien enthält ${p} doppelt`)];
}

/**
 * Pur: die Dateien, die den Escape-Zeichensatz des Ticket-Namen-Kerns bewusst als Kopie tragen (`struktur.escapeKopien`, repo-relative POSIX-Pfade); ohne Schlüssel leer.
 * Eine kaputte Liste wirft (kein stiller Standardwert); die Kern-Prüfung `test/harness/ticket-namen.test.ts` addiert sie zu ihrer festen Kern-Liste.
 */
export function escapeKopienAus(config) {
  const wert = config?.struktur?.escapeKopien;
  const form = pruefeEscapeKopien(wert);
  if (form.length > 0) throw new Error(`${form.join("; ")} in ${PROJEKT_CONFIG}
Fix: struktur.escapeKopien als Liste repo-relativer POSIX-Pfade eintragen`);
  return wert === undefined ? [] : [...wert];
}

/** Pur: ein repo-relativer POSIX-Pfad (`src`, `docs/module`): kein absoluter Pfad, kein Laufwerk, keine `.`/`..`-Segmente, kein Backslash, kein End- oder Doppel-Slash. */
function istRepoRelativPosix(pfad) {
  if (pfad.includes("\\") || pfad.includes(":")) return false;
  return pfad.split("/").every((teil) => teil !== "" && teil !== "." && teil !== "..");
}

/** Pur: die Umschrift-Wortliste (`sprache.umschrift`) für den Umlaut-Wächter; wirft ohne nicht-leere Liste (kein stiller Deutsch-Standardwert, #1711). */
export function umschriftAus(config) {
  const liste = config?.sprache?.umschrift;
  if (!Array.isArray(liste) || liste.length === 0) {
    throw new Error(`sprache.umschrift fehlt oder ist keine nicht-leere Liste in ${PROJEKT_CONFIG}\nFix: den Schlüssel sprache.umschrift (Liste der ASCII-Umschriften) in ${PROJEKT_CONFIG} eintragen`);
  }
  return liste;
}

/**
 * Pur: prüft `sprache` (nur die Form; ein fehlender Block ist beim Laden erlaubt, `spracheAus` verlangt ihn beim Gebrauch).
 * Die Schlüssel von `sprache.spezifikation` prüft die Spezifikations-Lib (`spracheMaengel`, SSOT; ihr `wortschatz` wirft bei denselben Mängeln).
 */
function pruefeSprache(s) {
  if (!istObjekt(s)) return ["sprache muss ein Objekt mit umschrift und spezifikation sein"];
  const fehler = [];
  if (!Array.isArray(s.umschrift) || s.umschrift.length === 0 || !s.umschrift.every((w) => typeof w === "string" && /^[a-z]+$/.test(w))) {
    fehler.push("sprache.umschrift muss eine nicht-leere Liste kleingeschriebener ASCII-Wörter (Muster ^[a-z]+$) sein");
  }
  return [...fehler, ...spracheMaengel(s.spezifikation)];
}

const AUSNAHME_LISTEN_NAMEN = ["groesse", "kontext"];

/** Pur: prüft den Block `ausnahmen` (Form): je Liste `{ datei, grund }`, die Datei repo-relativ POSIX und je Liste nur einmal, der Grund nennt ein Ticket `#<nr>`. */
function pruefeAusnahmen(a) {
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
    liste.forEach((e, i) => {
      const wo = `ausnahmen.${name}[${i}]`;
      if (!istObjekt(e)) return fehler.push(`${wo} muss ein Objekt { datei, grund } sein`);
      if (!istText(e.datei)) fehler.push(`${wo}.datei muss ein nicht-leerer String (repo-relativer Pfad) sein`);
      else if (!istRepoRelativPosix(e.datei)) fehler.push(`${wo}.datei muss ein repo-relativer POSIX-Pfad sein: ${JSON.stringify(e.datei)}`);
      else if (gesehen.has(e.datei)) fehler.push(`${wo}.datei „${e.datei}“ steht doppelt`);
      else gesehen.add(e.datei);
      if (!istText(e.grund)) fehler.push(`${wo}.grund muss ein nicht-leerer String sein`);
      else if (!/#\d+/.test(e.grund)) fehler.push(`${wo}.grund muss ein Ticket #<nr> nennen (eine Ausnahme ohne offenes Ticket gibt es nicht)`);
    });
  }
  return fehler;
}

/**
 * Pur: die Ausnahmelisten der Größen-Gates (`ausnahmen.groesse` für check:size, `ausnahmen.kontext` für check:contextsize), je Eintrag `{ datei, grund }`;
 * ohne Block beide leer. Wirft mit Fix-Zeile bei kaputter Form (die Gates dürfen keine Ausnahme still verlieren).
 */
export function ausnahmenAus(config) {
  const wert = config?.ausnahmen;
  if (wert === undefined) return { groesse: [], kontext: [] };
  const fehler = pruefeAusnahmen(wert);
  if (fehler.length > 0) throw new Error(`${fehler.join("; ")} in ${PROJEKT_CONFIG}\nFix: den Block ausnahmen (groesse, kontext: Liste von { datei, grund mit #<nr> }) in ${PROJEKT_CONFIG} korrigieren`);
  return { groesse: wert.groesse ?? [], kontext: wert.kontext ?? [] };
}

const GATE_FORM = /^[\w:.-]+$/;

/** Pur: prüft den Block `gates` (Form): nur `nichtInVerify`, eine Liste `{ gate, grund }`; das Gate ein Skriptname, je Liste nur einmal, der Grund nicht leer. */
function pruefeGates(g) {
  if (!istObjekt(g)) return ["gates muss ein Objekt mit der Liste nichtInVerify sein"];
  const fehler = Object.keys(g).filter((k) => k !== "nichtInVerify").map((k) => `gates.${k} ist kein bekannter Schlüssel (erlaubt: nichtInVerify)`);
  if (g.nichtInVerify === undefined) return fehler;
  if (!Array.isArray(g.nichtInVerify)) return [...fehler, "gates.nichtInVerify muss eine Liste von { gate, grund } sein"];
  const gesehen = new Set();
  g.nichtInVerify.forEach((e, i) => {
    const wo = `gates.nichtInVerify[${i}]`;
    if (!istObjekt(e)) return fehler.push(`${wo} muss ein Objekt { gate, grund } sein`);
    if (!istText(e.gate) || !GATE_FORM.test(e.gate)) fehler.push(`${wo}.gate muss ein Skriptname (Buchstaben, Ziffern, : . _ -) sein`);
    else if (gesehen.has(e.gate)) fehler.push(`${wo}.gate „${e.gate}“ steht doppelt`);
    else gesehen.add(e.gate);
    if (!istText(e.grund)) fehler.push(`${wo}.grund muss ein nicht-leerer String sein`);
  });
  return fehler;
}

/**
 * Pur: die Gates des Projekts, die bewusst nicht in der `verify`-Kette laufen (`gates.nichtInVerify`, je Eintrag `{ gate, grund }`; #1925); ohne Block leer
 * (die strenge Richtung: dann muss `verify` jedes `check:*` fahren). Wirft mit Fix-Zeile bei kaputter Form.
 */
export function gatesAus(config) {
  const wert = config?.gates;
  if (wert === undefined) return { nichtInVerify: [] };
  const fehler = pruefeGates(wert);
  if (fehler.length > 0) throw new Error(`${fehler.join("; ")} in ${PROJEKT_CONFIG}\nFix: den Block gates (nichtInVerify: Liste von { gate, grund }) in ${PROJEKT_CONFIG} korrigieren`);
  return { nichtInVerify: wert.nichtInVerify ?? [] };
}

const REPO_FORM = /^([^/\s]+)\/([^/\s]+)$/;

/** Pur: zerlegt `owner/name` in `{ owner, name }`; wirft mit Fix-Zeile, wenn `repo` nicht genau diese Form hat (kein stiller Standardwert, #1745). */
export function zerlegeRepo(repo) {
  const m = typeof repo === "string" ? REPO_FORM.exec(repo) : null;
  if (!m) throw new Error(`repo fehlt oder hat nicht die Form owner/name in ${PROJEKT_CONFIG}\nFix: den Schlüssel repo in ${PROJEKT_CONFIG} als owner/name eintragen`);
  return { owner: m[1], name: m[2] };
}

/** Pur: der Namensteil von `repo` der Config (`owner/name` → `name`); wirft wie `zerlegeRepo`. */
export const repoName = (config) => zerlegeRepo(config?.repo).name;

/** Pur: der Besitzerteil von `repo` der Config (`owner/name` → `owner`); wirft wie `zerlegeRepo`. */
export const repoOwner = (config) => zerlegeRepo(config?.repo).owner;

/** Pur: prüft `labels`: die Pflichtschlüssel und alle weiteren Werte sind nicht-leere Strings. */
function pruefeLabels(l) {
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

/** Pur: prüft `skills` (Name → nicht-leerer String); `abschluss` ist Pflicht (der Skill, den ein Ticketlauf am Ende fährt). */
function pruefeSkills(s) {
  if (!istObjekt(s)) return ["skills muss ein Objekt (Name → String) mit dem Pflichtschlüssel abschluss sein"];
  const fehler = [];
  if (!Object.hasOwn(s, "abschluss")) fehler.push("skills.abschluss fehlt (Pflichtschlüssel)");
  for (const [k, v] of Object.entries(s)) {
    if (!istText(v)) fehler.push(`skills.${k} muss ein nicht-leerer String sein`);
  }
  return fehler;
}

/** Pur: prüft `agenten`: je Pflichtschlüssel ein Name nach AGENT_MUSTER. */
function pruefeAgenten(a) {
  if (!istObjekt(a)) return [`agenten muss ein Objekt mit ${PFLICHT_AGENTEN.join(", ")} sein`];
  const fehler = [];
  for (const k of PFLICHT_AGENTEN) {
    if (typeof a[k] !== "string" || !AGENT_MUSTER.test(a[k])) fehler.push(`agenten.${k} muss ein Name ohne Leerraum und ohne ":" sein, nicht mit "-" am Anfang`);
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
function pruefeBerechtigungen(b) {
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

/**
 * Pur: die Berechtigungs-Ergänzung des Projekts (`berechtigungen`, #1874) als `{ allow, ask, deny }`; ohne Block alle drei leer.
 * Wirft mit Fix-Zeile bei kaputter Form (die Ergänzung darf nicht still verloren gehen).
 */
export function berechtigungenAus(config) {
  const wert = config?.berechtigungen;
  if (wert === undefined) return { allow: [], ask: [], deny: [] };
  const fehler = pruefeBerechtigungen(wert);
  if (fehler.length > 0) throw new Error(`${fehler.join("; ")} in ${PROJEKT_CONFIG}\nFix: den Block berechtigungen (allow, ask, deny: Listen von mcp__-Einträgen) in ${PROJEKT_CONFIG} korrigieren`);
  return { allow: wert.allow ?? [], ask: wert.ask ?? [], deny: wert.deny ?? [] };
}

const SANDBOX_KEYS = ["allowedDomains", "envVars"];

/**
 * Pur: prüft den Block `sandbox` (Form, #1888): nur die Listen allowedDomains (Strings ohne Leerraum) und envVars (Objekte `{ name, mode }` mit `mode: "deny"`), je Liste ohne Duplikat (Name).
 * Ob die Ergänzung zum Wert in `.claude/settings.json` passt und nichts öffnet, prüft die Besitz-Lib (`sandboxErgaenzungsBefunde`).
 */
function pruefeSandbox(b) {
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

/** Pur: die Sandbox-Ergänzung des Projekts (`sandbox`, #1888) als `{ allowedDomains, envVars }`; ohne Block beide leer. Wirft mit Fix-Zeile bei kaputter Form. */
export function sandboxAus(config) {
  const wert = config?.sandbox;
  if (wert === undefined) return { allowedDomains: [], envVars: [] };
  const fehler = pruefeSandbox(wert);
  if (fehler.length > 0) throw new Error(`${fehler.join("; ")} in ${PROJEKT_CONFIG}\nFix: den Block sandbox (allowedDomains: Strings, envVars: { name, mode: "deny" }) in ${PROJEKT_CONFIG} korrigieren`);
  return { allowedDomains: wert.allowedDomains ?? [], envVars: wert.envVars ?? [] };
}

/** Pur: die gesamte Ergänzung des Projekts aus der geparsten Config: die Listen von `berechtigungen` plus der Zweig `sandbox`; wirft bei kaputter Form. */
export function ergaenzungAus(config) {
  return { ...berechtigungenAus(config), sandbox: sandboxAus(config) };
}

/** Pur: wie `ergaenzungAus` auf dem Dateitext der Projekt-Config; `null` (keine Datei) heißt leer, kein gültiges JSON wirft. */
export function ergaenzungAusText(text) {
  if (text === null) return ergaenzungAus({});
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    throw new Error(`${PROJEKT_CONFIG} ist kein gültiges JSON`);
  }
  return ergaenzungAus(config);
}

/** Pur: prüft die geparste Config, gibt die Liste der Fehler zurück (leer = gültig). */
export function pruefeProjektConfig(wert) {
  if (!istObjekt(wert)) return ["Config muss ein JSON-Objekt sein"];
  const fehler = [];
  if (wert.version !== 2) fehler.push("version muss 2 sein (Schema mit boards-Liste)");
  if (!istText(wert.repo) || !REPO_FORM.test(wert.repo)) fehler.push("repo muss die Form owner/name haben");
  fehler.push(...pruefeBoards(wert.boards));
  fehler.push(...pruefePraefixe(wert.praefixe), ...pruefeLabels(wert.labels), ...pruefeAgenten(wert.agenten), ...pruefeSkills(wert.skills));
  if (wert.projektliterale !== undefined) {
    if (!istObjekt(wert.projektliterale)) {
      fehler.push("projektliterale muss ein Objekt (Name → String) sein");
    } else {
      for (const [name, lit] of Object.entries(wert.projektliterale)) {
        if (!istText(lit)) fehler.push(`projektliterale.${name} muss ein nicht-leerer String sein`);
      }
    }
  }
  if (wert.rulesetSpiegel !== undefined && !istText(wert.rulesetSpiegel)) fehler.push("rulesetSpiegel muss ein nicht-leerer String (Pfad zum Ruleset-Spiegel) sein");
  if (wert.spezifikation !== undefined) {
    if (!istObjekt(wert.spezifikation) || !istPositiv(wert.spezifikation.hartAb)) fehler.push("spezifikation.hartAb muss eine positive Ganzzahl sein (Stichtag: Issue-Nummer, ab der das Spezifikations-Gate hart ist)");
  }
  if (wert.sprache !== undefined) fehler.push(...pruefeSprache(wert.sprache));
  if (wert.struktur !== undefined) fehler.push(...pruefeStruktur(wert.struktur));
  if (wert.bereiche !== undefined) fehler.push(...pruefeBereiche(wert.bereiche));
  if (wert.ausnahmen !== undefined) fehler.push(...pruefeAusnahmen(wert.ausnahmen));
  if (wert.gates !== undefined) fehler.push(...pruefeGates(wert.gates));
  if (wert.berechtigungen !== undefined) fehler.push(...pruefeBerechtigungen(wert.berechtigungen));
  if (wert.sandbox !== undefined) fehler.push(...pruefeSandbox(wert.sandbox));
  return fehler;
}

/** REST-Pfad des Boards: `users|orgs/<besitzer>/projectsV2/<nummer>`. Pur. */
export function boardPfad(board) {
  return `${board.besitzerTyp === "org" ? "orgs" : "users"}/${board.besitzer}/projectsV2/${board.nummer}`;
}

const wurzelSchluessel = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));

/** Pur (bis auf `ROOT`): der Pfad aus `FACTORY_PROJEKT_CONFIG`, wenn der Riegel passt (`VITEST` gesetzt, `FACTORY_PROJEKT_WURZEL` = Wurzel dieses Laders, normalisiert, unter Windows ohne Groß-/Kleinschreibung), sonst `undefined`. */
function probeConfigAusUmgebung(env) {
  const wert = umgebungsWert(env, "FACTORY_PROJEKT_CONFIG");
  if (!wert || !env.VITEST) return undefined;
  const wurzel = umgebungsWert(env, "FACTORY_PROJEKT_WURZEL");
  return wurzel && wurzelSchluessel(wurzel) === wurzelSchluessel(ROOT) ? wert : undefined;
}

/**
 * Liest und prüft die Config; wirft mit Pfad, allen Fehlern und einer „Fix:“-Zeile. `pruefen: false` liest nur und parst (ohne Schema-Prüfung):
 * für Werkzeuge, die genau einen Schlüssel brauchen und ihn selbst prüfen (`worktreeNamenOderGrund`).
 * Pfad-Vorrang: explizites `pfad` (`--config`), dann `FACTORY_PROJEKT_CONFIG` (Fremd-Config-Probe, `scripts/fremd-config-probe.mjs`), sonst `PROJEKT_CONFIG`; leer zählt als nicht gesetzt. Ein explizites `rootDir` (anderes Repo, etwa `--wurzel`) ignoriert die Variable.
 * Riegel (`probeConfigAusUmgebung`): die Variable gilt nur unter Vitest (`VITEST` gesetzt) und nur, wenn `FACTORY_PROJEKT_WURZEL` die Wurzel dieses Laders nennt; so erbt sie kein Prozess außerhalb der Probe und kein Temp-Repo.
 */
export function ladeProjektConfig({ rootDir, pfad, pruefen = true, env = process.env } = {}) {
  const gewaehlt = pfad || (rootDir === undefined ? probeConfigAusUmgebung(env) : undefined) || PROJEKT_CONFIG;
  rootDir ??= ROOT;
  const abs = isAbsolute(gewaehlt) ? gewaehlt : resolve(rootDir, gewaehlt);
  let roh;
  try {
    roh = readFileSync(abs, "utf8");
  } catch {
    throw new Error(`Projekt-Config fehlt oder ist nicht lesbar: ${abs}\nFix: ${PROJEKT_CONFIG} anlegen (Pflichtschlüssel: version, repo, boards[], praefixe, labels, agenten, skills.abschluss)`);
  }
  let wert;
  try {
    wert = JSON.parse(roh);
  } catch (e) {
    throw new Error(`Projekt-Config ist kein gültiges JSON: ${abs} (${e instanceof Error ? e.message : e})\nFix: JSON-Syntax korrigieren`, { cause: e });
  }
  const fehler = pruefen ? pruefeProjektConfig(wert) : [];
  if (fehler.length) {
    throw new Error(`Projekt-Config ungültig: ${abs}\n- ${fehler.join("\n- ")}\nFix: Pflichtschlüssel in ${PROJEKT_CONFIG} ergänzen bzw. korrigieren`);
  }
  return wert;
}

/** Präfix der Umgebungsvariablen, die ein Kern-Werkzeug liest (#1824): `FACTORY_<NAME>`. */
export const KERN_ENV_PRAEFIX = "FACTORY_";

/** Pur: der Altpräfix einer Umgebungsvariable aus `praefixe.commitZeile` (`<PRAEFIX>-` → `<PRAEFIX>_`); `null` bei fehlendem oder ungültigem Präfix. */
export function altEnvPraefix(config) {
  const p = config?.praefixe?.commitZeile;
  return typeof p === "string" && COMMIT_PRAEFIX_MUSTER.test(p) ? `${p.slice(0, -1)}_` : null;
}

/** Pur: der Altname zu einem neuen Namen (`FACTORY_<NAME>` → `<Altpräfix><NAME>`); `null`, wenn der Altpräfix fehlt oder `name` nicht mit `FACTORY_` plus Rest beginnt. */
export function altEnvName(name, config) {
  const alt = altEnvPraefix(config);
  if (alt === null || typeof name !== "string") return null;
  if (!name.startsWith(KERN_ENV_PRAEFIX) || name.length === KERN_ENV_PRAEFIX.length) return null;
  return alt + name.slice(KERN_ENV_PRAEFIX.length);
}

/**
 * Liest eine Kern-Umgebungsvariable. `name` ist der volle Name (`FACTORY_<NAME>`); gelesen wird nur dieser Name, ein Altname
 * (Projektpräfix) wirkt nicht mehr (`harness-doctor --pruefen` meldet ihn). „Gesetzt“ heißt `!== undefined`.
 * Wirft nur bei einem Namen ohne `FACTORY_`-Präfix.
 */
export function umgebungsWert(env, name) {
  if (typeof name !== "string" || !name.startsWith(KERN_ENV_PRAEFIX) || name.length === KERN_ENV_PRAEFIX.length) {
    throw new Error(`Umgebungsvariable ${String(name)} muss mit ${KERN_ENV_PRAEFIX} beginnen`);
  }
  return env[name];
}

const ENV_LITERAL = /umgebungsWert\([^,()]*,\s*"(FACTORY_[A-Z0-9_]+)"/g;
const KOMMENTARZEILE = /^\s*(\*|\/\/)/;
const AUFRUF = /umgebungsWert\(/;

/** Pur: sammelt die `FACTORY_…`-Literale der `umgebungsWert`-Aufrufe eines Quelltexts und die Aufrufe ohne Literal (`datei:zeile`). Kommentarzeilen und die Definition zählen nicht. */
export function sammleKernEnv(datei, text) {
  const literale = new Set();
  const ohneLiteral = [];
  text.split("\n").forEach((zeile, i) => {
    if (KOMMENTARZEILE.test(zeile) || !AUFRUF.test(zeile)) return;
    if (datei.endsWith("projekt-config-lib.mjs") && /function umgebungsWert\(/.test(zeile)) return;
    const treffer = [...zeile.matchAll(ENV_LITERAL)];
    for (const x of treffer) literale.add(x[1]);
    if (treffer.length === 0) ohneLiteral.push(`${datei}:${i + 1}`);
  });
  return { literale, ohneLiteral };
}

/**
 * Sammelt über alle `*.mjs` unter `ordner` (rekursiv) die `FACTORY_…`-Literale der `umgebungsWert`-Aufrufe und die Aufrufe ohne Literal: `{ literale, ohneLiteral }` wie `sammleKernEnv`.
 * `bezug` bestimmt die Dateinamen in `ohneLiteral` (`datei:zeile`, relativ zu `bezug`, Schrägstrich); ohne `bezug` steht der Pfad, wie er unter `ordner` gebildet wurde.
 */
export function sammleKernEnvIn(ordner, bezug = null) {
  const literale = new Set();
  const ohneLiteral = [];
  const gehe = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) gehe(p);
      else if (e.endsWith(".mjs")) {
        const fest = p.split("\\").join("/");
        const rel = bezug === null ? null : relative(bezug.split("\\").join("/").replace(/\/$/, ""), fest).split("\\").join("/");
        const name = rel === null || rel.startsWith("../") || isAbsolute(rel) ? fest : rel; // liegt die Datei nicht unter dem Bezug, bleibt der volle Pfad
        const f = sammleKernEnv(name, readFileSync(p, "utf8"));
        f.literale.forEach((n) => literale.add(n));
        ohneLiteral.push(...f.ohneLiteral);
      }
    }
  };
  gehe(ordner);
  return { literale, ohneLiteral };
}

/** Die sortierten `FACTORY_…`-Namen, die die `*.mjs` unter `ordner` (rekursiv) über `umgebungsWert` lesen. */
export function kernEnvNamen(ordner) {
  return [...sammleKernEnvIn(ordner).literale].sort();
}

/** Trennt `--config <pfad>` (auch `--config=<pfad>`) aus der Argumentliste. Pur. Liefert `{ args, pfad }` (`pfad` undefined ohne Option)
 *  oder `{ fehler }`, wenn der Pfad fehlt. Andere Argumente bleiben unberührt in `args`; das erste `--config` zählt. */
export function trenneConfigArg(argv) {
  const { tokens } = flagsLesen(argv, { config: { type: "string" } }, { positionale: true });
  const t = tokens.find((x) => x.kind === "option" && x.name === "config");
  if (!t) return { args: [...argv], pfad: undefined };
  if (!t.value) return { fehler: "✖ --config braucht einen Pfad\n\nFix: --config <pfad> angeben oder weglassen" };
  const belegt = new Set([t.index, ...(t.inlineValue ? [] : [t.index + 1])]);
  return { args: argv.filter((_, k) => !belegt.has(k)), pfad: t.value };
}

/**
 * Rahmen für `--config <pfad>` im Direktaufruf eines Werkzeugs: trennt das Flag ab, lädt die Config und liefert `{ args, config }` oder
 * `{ args, fehler }` (Text ohne `✖`-Präfix: fehlender Pfad bzw. Ladefehler mit Pfad, Schlüssel und `Fix:`-Zeile). Der Aufrufer meldet den Fehler
 * mit Exit 2, bevor er etwas liest oder schreibt. Ohne `--config` gilt die Config des Repos. `--config` übersteuert Sprache, Labels, Namen und `hartAb`; Repo und Board-IDs kommen aus der Repo-Config (`board-lib`/`inbox-lib`). `lade` ist die Test-Naht.
 */
export function configAusAufruf(argv, { lade = ladeProjektConfig } = {}) {
  const getrennt = trenneConfigArg(argv);
  if (getrennt.fehler) return { args: [...argv], fehler: getrennt.fehler.replace(/^✖ /, "") };
  try {
    return { args: getrennt.args, config: lade({ pfad: getrennt.pfad }) };
  } catch (e) {
    return { args: getrennt.args, fehler: e instanceof Error ? e.message : String(e) };
  }
}

const CLI_AUFRUF = "Fix: node scripts/projekt-config.mjs [--config <pfad>] <schluessel.pfad>";

/** Kommandozeile; gibt den Exit-Code zurück. */
export function cli(argv, { rootDir = ROOT, out = console.log, err = console.error } = {}) {
  const { werte, positionale, fehler } = flagsLesen(argv, { config: { type: "string" } }, { positionale: true });
  if (fehler) {
    err(`✖ ${fehler.text}\n\n${CLI_AUFRUF}`);
    return AUFRUF_EXIT;
  }
  const [schluessel, ueberzaehlig] = positionale;
  if (!schluessel) {
    err(`✖ Schlüssel fehlt\n\n${CLI_AUFRUF}`);
    return AUFRUF_EXIT;
  }
  if (ueberzaehlig !== undefined) {
    err(`✖ Unbekanntes Argument: ${ueberzaehlig}\n\n${CLI_AUFRUF}`);
    return AUFRUF_EXIT;
  }
  const pfad = werte.config;
  let cfg;
  try {
    cfg = ladeProjektConfig({ rootDir, pfad });
  } catch (e) {
    err(`✖ ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  let wert = cfg;
  for (const teil of schluessel.split(".")) {
    if (Array.isArray(wert)) wert = /^(0|[1-9]\d*)$/.test(teil) && Number(teil) < wert.length ? wert[Number(teil)] : undefined;
    else wert = istObjekt(wert) && Object.hasOwn(wert, teil) ? wert[teil] : undefined;
  }
  if (wert === undefined || istObjekt(wert) || Array.isArray(wert)) {
    err(`✖ Schlüssel nicht gefunden oder kein Skalar: ${schluessel}\n\nFix: Schlüssel in ${PROJEKT_CONFIG} prüfen`);
    return 1;
  }
  out(String(wert));
  return 0;
}
