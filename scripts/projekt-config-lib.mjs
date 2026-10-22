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
import { isAbsolute, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { QUELL_VERZEICHNIS } from "./skill-pfade.mjs";
import { spracheMaengel } from "./spezifikation-lib.mjs";

export const PROJEKT_CONFIG = ".factory/projekt.json";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const istText = (v) => typeof v === "string" && v.trim() !== "";
const istPositiv = (v) => Number.isInteger(v) && v > 0;
const istObjekt = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

export const BOARD_ROLLEN = ["produkt", "factory"];

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
  return ["quelle", "moduldoku"].flatMap((k) => {
    if (!istText(s[k])) return [`struktur.${k} muss ein nicht-leerer String (repo-relativer Pfad) sein`];
    return istRepoRelativPosix(s[k]) ? [] : [`struktur.${k} muss ein repo-relativer POSIX-Pfad sein (ohne führenden / oder Laufwerk, ohne . und .., ohne Backslash, ohne End- oder Doppel-Slash): ${JSON.stringify(s[k])}`];
  });
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

/** Pur: prüft `agenten`: je Pflichtschlüssel ein Name nach AGENT_MUSTER. */
function pruefeAgenten(a) {
  if (!istObjekt(a)) return [`agenten muss ein Objekt mit ${PFLICHT_AGENTEN.join(", ")} sein`];
  const fehler = [];
  for (const k of PFLICHT_AGENTEN) {
    if (typeof a[k] !== "string" || !AGENT_MUSTER.test(a[k])) fehler.push(`agenten.${k} muss ein Name ohne Leerraum und ohne ":" sein, nicht mit "-" am Anfang`);
  }
  return fehler;
}

/** Pur: prüft die geparste Config, gibt die Liste der Fehler zurück (leer = gültig). */
export function pruefeProjektConfig(wert) {
  if (!istObjekt(wert)) return ["Config muss ein JSON-Objekt sein"];
  const fehler = [];
  if (wert.version !== 2) fehler.push("version muss 2 sein (Schema mit boards-Liste)");
  if (!istText(wert.repo) || !REPO_FORM.test(wert.repo)) fehler.push("repo muss die Form owner/name haben");
  fehler.push(...pruefeBoards(wert.boards));
  fehler.push(...pruefePraefixe(wert.praefixe), ...pruefeLabels(wert.labels), ...pruefeAgenten(wert.agenten));
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
  if (wert.ausnahmen !== undefined) fehler.push(...pruefeAusnahmen(wert.ausnahmen));
  return fehler;
}

/** REST-Pfad des Boards: `users|orgs/<besitzer>/projectsV2/<nummer>`. Pur. */
export function boardPfad(board) {
  return `${board.besitzerTyp === "org" ? "orgs" : "users"}/${board.besitzer}/projectsV2/${board.nummer}`;
}

/**
 * Liest und prüft die Config; wirft mit Pfad, allen Fehlern und einer „Fix:“-Zeile. `pruefen: false` liest nur und parst (ohne Schema-Prüfung):
 * für Werkzeuge, die genau einen Schlüssel brauchen und ihn selbst prüfen (`worktreeNamenOderGrund`).
 */
export function ladeProjektConfig({ rootDir = ROOT, pfad = PROJEKT_CONFIG, pruefen = true } = {}) {
  const abs = isAbsolute(pfad) ? pfad : resolve(rootDir, pfad);
  let roh;
  try {
    roh = readFileSync(abs, "utf8");
  } catch {
    throw new Error(`Projekt-Config fehlt oder ist nicht lesbar: ${abs}\nFix: ${PROJEKT_CONFIG} anlegen (Pflichtschlüssel: version, repo, boards[], praefixe, labels, agenten)`);
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

/** Die sortierten `FACTORY_…`-Namen, die die `*.mjs` unter `ordner` (rekursiv) über `umgebungsWert` lesen. */
export function kernEnvNamen(ordner) {
  const namen = new Set();
  const gehe = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) gehe(p);
      else if (e.endsWith(".mjs")) for (const n of sammleKernEnv(p.split("\\").join("/"), readFileSync(p, "utf8")).literale) namen.add(n);
    }
  };
  gehe(ordner);
  return [...namen].sort();
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
 * mit Exit 2, bevor er etwas liest oder schreibt. Ohne `--config` gilt die Config des Repos. `lade` ist die Test-Naht.
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
