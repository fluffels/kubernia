// Blatt-Modul (factory#181): Quellwurzeln und Endungsliste der Projekt-Config (`struktur.quelle`, `struktur.endungen`, `struktur.ohne`, `struktur.docmapEinheit`).
// Importiert nur Node-Builtins, `pfad-glob.mjs` und `relativ-pfad.mjs`; nie `projekt-config-lib` oder `check-basis` (Zyklus), darum sagen die
// Meldungen „in der Projekt-Config“ ohne Dateipfad. Kein Projektliteral.
//
// Formen von `struktur.quelle`: ein String (ein wörtlicher Ordner, wie bisher) oder eine Liste von Ordnern bzw. Globs (Syntax von `pfad-glob.mjs`,
// etwa `*/src/main/java`). Globs lösen nur Ordner auf. Grenze beim Auflösen eines Globs (geschlossene Liste): `node_modules` und Ordner mit
// führendem `.` werden nie betreten; ohne `**` reicht der Abstieg nur so tief wie das Muster Segmente hat; ein wörtlicher Präfix vor dem ersten Glob-Segment wird direkt genommen (auch `.claude/...`). Innerhalb einer
// aufgelösten Wurzel zählt jede Datei mit passender Endung, wie bisher.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { globMaengel, globRegex } from "./pfad-glob.mjs";
import { istRelativPosix } from "./relativ-pfad.mjs";

/** Endungen der JS/TS-Familie (`.d.ts` zählt über `.ts` mit); gilt, wenn `struktur.endungen` fehlt. */
export const STANDARD_ENDUNGEN = Object.freeze([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

/** Doku-Einheiten von `check:docmap` (`struktur.docmapEinheit`): eine Datei oder ein Ordner je Modul; Standard `datei`. */
export const DOCMAP_EINHEITEN = Object.freeze(["datei", "ordner"]);

const ENDUNG = /^(\.[A-Za-z0-9_-]+)+$/;
const istText = (v) => typeof v === "string" && v.trim() !== "";
const istObjekt = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pur: ob ein Eintrag Glob-Zeichen (`*` oder `?`) trägt. */
export function istGlob(muster) {
  return /[*?]/.test(muster);
}

function stringMaengel(quelle) {
  if (!istText(quelle)) return ["struktur.quelle muss ein nicht-leerer String (repo-relativer Pfad) oder eine Liste von Pfaden bzw. Globs sein"];
  if (!istRelativPosix(quelle)) return [`struktur.quelle muss ein repo-relativer POSIX-Pfad sein (ohne führenden / oder Laufwerk, ohne . und .., ohne Backslash, ohne End- oder Doppel-Slash): ${JSON.stringify(quelle)}`];
  if (istGlob(quelle)) return [`struktur.quelle ist ein wörtlicher Pfad und darf kein * oder ? tragen (Globs als Liste schreiben): ${JSON.stringify(quelle)}`];
  return [];
}

/** Pur: Fehlertexte einer optionalen Endungsliste; `wo` ist der Schlüsselname in den Meldungen. */
export function endungenMaengel(liste, wo = "struktur.endungen") {
  if (liste === undefined) return [];
  if (!Array.isArray(liste) || liste.length === 0) return [`${wo} muss eine nicht-leere Liste von Endungen mit Punkt sein (etwa .java, .ts)`];
  const gesehen = new Set();
  return liste.flatMap((e, i) => {
    if (typeof e !== "string" || !ENDUNG.test(e)) return [`${wo}[${i}] muss eine Endung mit Punkt sein (etwa .java, .d.ts): ${JSON.stringify(e)}`];
    if (gesehen.has(e)) return [`${wo}[${i}] „${e}“ steht doppelt`];
    gesehen.add(e);
    return [];
  });
}

function einheitMaengel(wert) {
  if (wert === undefined || DOCMAP_EINHEITEN.includes(wert)) return [];
  return [`struktur.docmapEinheit muss "datei" oder "ordner" sein: ${JSON.stringify(wert)}`];
}

/** Pur: Fehlertexte für `quelle`, `endungen`, `ohne` und `docmapEinheit` des Blocks `struktur`; leer = gültig. Ein fehlender Block ist hier kein Fehler (`quellenAus` verlangt ihn). */
export function quellenMaengel(struktur) {
  if (!istObjekt(struktur)) return [];
  const q = struktur.quelle;
  let quelle;
  if (Array.isArray(q)) quelle = q.length === 0 ? ["struktur.quelle darf als Liste nicht leer sein"] : globMaengel(q, "struktur.quelle");
  else quelle = stringMaengel(q);
  const ohne = struktur.ohne === undefined ? [] : globMaengel(struktur.ohne, "struktur.ohne");
  return [...quelle, ...endungenMaengel(struktur.endungen), ...ohne, ...einheitMaengel(struktur.docmapEinheit)];
}

/** Die Quellwurzeln, Endungen und Ausschlüsse aus der Config: `{ quelle (roh), wurzeln, endungen, ohne }`; wirft mit Fix-Zeile bei fehlendem `quelle` oder kaputter Form (fail-closed). */
export function quellenAus(config) {
  const block = config?.struktur;
  const fix = "Fix: struktur.quelle (ein Pfad oder eine Liste von Pfaden bzw. Globs), optional struktur.endungen (etwa [\".java\"]) und struktur.ohne (Glob-Liste) in der Projekt-Config eintragen";
  if (!istObjekt(block) || block.quelle === undefined) throw new Error(`struktur.quelle fehlt in der Projekt-Config\n${fix}`);
  const fehler = quellenMaengel(block);
  if (fehler.length > 0) throw new Error(`${fehler.join("; ")} in der Projekt-Config\n${fix}`);
  return {
    quelle: block.quelle,
    wurzeln: typeof block.quelle === "string" ? [block.quelle] : [...block.quelle],
    endungen: [...(block.endungen ?? STANDARD_ENDUNGEN)],
    ohne: [...(block.ohne ?? [])],
  };
}

/** Die Quellen als Objekt `{ wurzeln, endungen, ohne }`: ein Objekt bleibt, ein String wird eine wörtliche Wurzel mit der Standard-Endungsliste (die alte Einzel-Wurzel-Form der Aufrufer). */
export function quellenObjekt(quellen) {
  if (typeof quellen !== "string") return { ohne: [], ...quellen };
  return { quelle: quellen, wurzeln: [quellen], endungen: [...STANDARD_ENDUNGEN], ohne: [] };
}

const istOrdner = (pfad) => {
  try {
    return statSync(pfad).isDirectory();
  } catch {
    return false;
  }
};

const uebersprungen = (name) => name === "node_modules" || name.startsWith(".");

// `maxTiefe`: Segmentzahl, ab der kein Ordner mehr gelesen wird (ohne `**` trifft ein Muster nur Ordner mit genau so vielen Segmenten wie es selbst; `Infinity` mit `**`).
function ordnerWalk(rootDir, rel, regex, treffer, maxTiefe, readdir) {
  for (const ent of readdir(join(rootDir, ...rel.split("/")), { withFileTypes: true })) {
    if (!ent.isDirectory() || uebersprungen(ent.name)) continue;
    const kind = rel === "" ? ent.name : `${rel}/${ent.name}`;
    if (regex.test(kind)) treffer.push(kind);
    if (kind.split("/").length < maxTiefe) ordnerWalk(rootDir, kind, regex, treffer, maxTiefe, readdir);
  }
}

/** Die Ordner (repo-relativ, POSIX, sortiert), die ein Eintrag von `struktur.quelle` trifft; ein wörtlicher Pfad ergibt sich selbst, wenn er ein Ordner ist, sonst `[]`.
 *  Ohne `**` ist die Auflösung auf die Segmentzahl des Musters begrenzt (kein Abstieg in `target` oder Modul-Unterbäume, factory#208); `readdir` ist die Dateisystem-Naht. */
export function ordnerZuMuster(rootDir, muster, readdir = readdirSync) {
  if (!istGlob(muster)) return istOrdner(join(rootDir, ...muster.split("/"))) ? [muster] : [];
  const segmente = muster.split("/");
  const erstes = segmente.findIndex((s) => istGlob(s));
  const praefix = segmente.slice(0, erstes).join("/");
  if (praefix !== "" && !istOrdner(join(rootDir, ...praefix.split("/")))) return [];
  const treffer = [];
  ordnerWalk(rootDir, praefix, globRegex(muster), treffer, segmente.includes("**") ? Infinity : segmente.length, readdir);
  return treffer.sort();
}

/** Pur: die Wurzel-Präfixe (repo-relative Ordner, POSIX), unter denen `pfad` liegt: je wörtlicher Wurzel diese selbst, je Glob jedes Segment-Präfix des Pfads,
 *  das der Glob trifft (dieselbe Grenze wie `ordnerZuMuster`: ab dem ersten Glob-Segment ist kein Segment `node_modules` und keines beginnt mit `.`). Leer = außerhalb aller Wurzeln. */
export function wurzelPraefixe(pfad, wurzeln) {
  const segmente = pfad.split("/");
  const treffer = new Set();
  for (const w of wurzeln) {
    if (!istGlob(w)) {
      if (pfad.startsWith(`${w}/`)) treffer.add(w);
      continue;
    }
    const regex = globRegex(w);
    const erstes = w.split("/").findIndex((s) => istGlob(s));
    for (let i = 1; i < segmente.length; i++) {
      const praefix = segmente.slice(0, i);
      if (praefix.slice(erstes).some(uebersprungen)) break;
      if (regex.test(praefix.join("/"))) treffer.add(praefix.join("/"));
    }
  }
  return [...treffer];
}

function dateiWalk(rootDir, rel, dateien) {
  for (const ent of readdirSync(join(rootDir, ...rel.split("/")), { withFileTypes: true })) {
    const kind = `${rel}/${ent.name}`;
    if (ent.isDirectory()) dateiWalk(rootDir, kind, dateien);
    else if (ent.isFile()) dateien.push(kind);
  }
}

/** Alle Quelldateien (repo-relativ, POSIX, sortiert, ohne Dubletten) unter den Wurzeln mit einer der Endungen, abzüglich der `ohne`-Globs. */
export function quellDateien(rootDir, { wurzeln, endungen, ohne = [] }) {
  const ausgeschlossen = ohne.map(globRegex);
  const alle = new Set();
  for (const wurzel of wurzeln) {
    for (const ordner of ordnerZuMuster(rootDir, wurzel)) {
      const dateien = [];
      dateiWalk(rootDir, ordner, dateien);
      for (const d of dateien) {
        if (endungen.some((e) => d.endsWith(e)) && !ausgeschlossen.some((re) => re.test(d))) alle.add(d);
      }
    }
  }
  return [...alle].sort();
}
