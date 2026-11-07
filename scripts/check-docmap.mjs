// Kein Shebang — analog zu scripts/check-size.mjs: dieses Skript wird über
// `node scripts/check-docmap.mjs` (npm run check:docmap) gestartet UND von
// test/projekt-config.test.ts und test/quellwurzeln-docmap.test.ts importiert. Ein `#!` bricht genau diesen Vitest/esbuild-Import.
/**
 * Doku↔Code-Drift-Wächter (quellprojekt#482, Skalierung quellprojekt#907, Quellwurzeln factory#183) — hält die Tiefendoc-Abdeckung ehrlich.
 *
 * Hintergrund: Eine per-Datei-Zeile in der Repo-Landkarte wächst linear mit den Modulen. quellprojekt#907 ersetzt den per-File-Check der Landkarte
 * durch einen Tiefendoc-Abdeckungs-Check: jedes Modul unter `struktur.quelle` muss als Backtick-Pfad in `<moduldoku>/*.md` vorkommen.
 *
 * Quellen (aus `struktur` der Projekt-Config): `quelle` (ein Pfad oder eine Liste von Pfaden bzw. Globs), `endungen` (Standard nur `.ts`, ohne
 * `.d.ts`; `.d.ts` zählt nur, wenn die Liste es nennt), `ohne` (Glob-Liste: solche Dateien sind kein Modul) und `docmapEinheit`:
 * `"datei"` (Standard, eine Quelldatei je Modul) oder `"ordner"` (ein Ordner mit mindestens einer direkten Quelldatei ist ein Modul und
 * braucht seinen Backtick-Pfad, mit oder ohne End-Slash; eine Datei-Erwähnung deckt dann nicht ab).
 *
 *   1. Keine Geister-Einträge: jeder in den Tiefendocs genannte Pfad unter einer Quellwurzel existiert (Datei-Form: eine Quelldatei der Endungsliste,
 *      bei `ohne` auch eine ausgeschlossene; Ordner-Form im Ordner-Modus: der Pfad existiert).
 *   2. Keine verwaisten Module (Datei bzw. Ordner ohne Tiefendoc-Erwähnung).
 *   3. Schicht-Konsistenz: weggefallen — `check:arch` erzwingt die Schichtgrenzen.
 *
 * Kandidaten im Tiefendoc (geschlossene Liste): Backtick-Läufe ohne Leerraum; ein Lauf zählt, wenn er unter einer Quellwurzel liegt (wörtliche
 * Wurzel: Präfix; Glob-Wurzel: ein Segment-Präfix des Laufs erfüllt den Glob). Datei-Form: Lauf endet auf eine Endung der Liste. Ordner-Form
 * (nur im Ordner-Modus): ohne solche Endung, gleich einer Wurzel oder darunter. Grenze: ein Lauf mit Leerraum (`a.ts oder b.ts`) ist kein Kandidat.
 *
 * Bewusst ein reines Node-Skript (nur Builtins). Ausführen mit: npm run check:docmap
 */

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { strukturOrdnerBefunde } from "./check-basis.mjs";
import { globRegex } from "./pfad-glob.mjs";
import { ladeProjektConfig, strukturAus } from "./projekt-config-lib.mjs";
import { quellDateien, quellenAus } from "./quellwurzeln-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Module, die bewusst KEINE Tiefendoc-Zeile brauchen (repo-relativ, POSIX).
 *  Leer gehalten: die Konvention verlangt für JEDES Quellmodul eine Tiefendoc-Erwähnung. */
export const ORPHAN_ALLOWLIST = [];

/** Endungen, wenn `struktur.endungen` fehlt (wie bisher nur `.ts`, nicht die JS/TS-Familie von check:size). */
export const DOCMAP_STANDARD_ENDUNGEN = Object.freeze([".ts"]);

/** Der Block `struktur` samt `quelle` (auch als Liste), `endungen`, `ohne`, `docmapEinheit` und `moduldoku`; wirft ohne `struktur` (kein stiller Standardwert). */
const configStruktur = () => {
  const c = ladeProjektConfig();
  const { moduldoku } = strukturAus(c);
  return { ...c.struktur, moduldoku };
};

/** Pur: `{ wurzeln, endungen, ohne, einheit }` aus einem Struktur-Block; `quelle` darf ein String (eine Wurzel) oder eine Liste sein; wirft mit Fix-Zeile bei kaputter Form. */
export function docmapQuellen(struktur) {
  const q = quellenAus({ struktur });
  return { wurzeln: q.wurzeln, endungen: struktur.endungen === undefined ? [...DOCMAP_STANDARD_ENDUNGEN] : q.endungen, ohne: q.ohne, einheit: struktur.docmapEinheit ?? "datei" };
}

const hatEndung = (pfad, endungen) => endungen.some((e) => pfad.endsWith(e));

/** Wie ein Lauf zu einer Wurzel liegt: `gleich` (der Lauf ist die Wurzel) oder `unter` (mindestens ein Zeichen unterhalb). */
function lageZurWurzel(lauf, wurzel) {
  if (!/[*?]/.test(wurzel)) {
    return { gleich: lauf === wurzel, unter: lauf.startsWith(wurzel + "/") && lauf.length > wurzel.length + 1 };
  }
  const re = globRegex(wurzel);
  const segmente = lauf.split("/");
  const treffer = (k) => re.test(segmente.slice(0, k).join("/"));
  return { gleich: treffer(segmente.length), unter: segmente.some((_, k) => k + 1 < segmente.length && treffer(k + 1)) };
}

/** Ob ein Backtick-Lauf ein Kandidat ist: `datei` (Datei-Form) bzw. `ordner` (Ordner-Form, nur im Ordner-Modus) oder `null`. */
function kandidatArt(lauf, { wurzeln, endungen, einheit }) {
  const lagen = wurzeln.map((w) => lageZurWurzel(lauf, w));
  if (hatEndung(lauf, endungen)) return lagen.some((l) => l.unter) ? "datei" : null;
  return einheit === "ordner" && lagen.some((l) => l.gleich || l.unter) ? "ordner" : null;
}

/** Scannt alle `<moduldoku>/*.md` nach Backtick-Pfaden unter den Quellwurzeln (Kandidaten, Regeln im Kopfkommentar).
 *  Gibt ein Set der gefundenen Pfade zurück (repo-relativ, POSIX, ohne End-Slash).
 *  `rootDir` überschreibbar, damit der Test deterministisch dasselbe Repo misst;
 *  `struktur` ohne Angabe aus der Projekt-Config. */
export function parseDeepDocMaps(rootDir = ROOT, struktur = configStruktur()) {
  if (struktur.moduldoku === null) return new Set(); // Opt-out (`struktur.moduldoku: null`): keine Tiefendocs
  const q = docmapQuellen(struktur);
  const docsDir = join(rootDir, ...struktur.moduldoku.split("/"));
  const covered = new Set();
  for (const filename of readdirSync(docsDir)) {
    if (!filename.endsWith(".md")) continue;
    const text = readFileSync(join(docsDir, filename), "utf8");
    for (const m of text.matchAll(/`([^`]+)(?=`)/g)) {
      const lauf = m[1].replace(/\/$/, "");
      if (!/\s/.test(lauf) && kandidatArt(lauf, q) !== null) covered.add(lauf);
    }
  }
  return covered;
}

/** Die Quelldateien (repo-relativ, POSIX, sortiert) unter den Wurzeln mit einer Endung der Liste, ohne reine Typdeklarationen (`.d.ts`, außer die Liste nennt sie);
 *  `alle` ohne, `modulDateien` mit dem `ohne`-Filter. */
function quellListen(rootDir, q) {
  const typen = (liste) => (q.endungen.includes(".d.ts") ? liste : liste.filter((f) => !f.endsWith(".d.ts")));
  const alle = typen(quellDateien(rootDir, { wurzeln: q.wurzeln, endungen: q.endungen }));
  return { alle, modulDateien: typen(quellDateien(rootDir, q)) };
}

const modulEinheiten = (modulDateien, einheit) =>
  einheit === "ordner" ? [...new Set(modulDateien.map((f) => posix.dirname(f)))].sort() : modulDateien;

/** Sammelt die Module unter den Quellwurzeln (repo-relativer POSIX-Pfad): je Quelldatei (`datei`) bzw. je Ordner mit direkter Quelldatei (`ordner`).
 *  `struktur.quelle` darf auch ein String sein (eine Wurzel); `struktur` darf ein String sein (nur die Wurzel); ohne Angabe aus der Projekt-Config. */
export function collectSrcModules(rootDir = ROOT, struktur = configStruktur()) {
  const q = docmapQuellen(typeof struktur === "string" ? { quelle: struktur } : struktur);
  return modulEinheiten(quellListen(rootDir, q).modulDateien, q.einheit);
}

/** Vergleicht Tiefendocs gegen Code. Gibt strukturierte Befunde zurück (leere Arrays = ok). */
export function auditDocMap(rootDir = ROOT, struktur = configStruktur()) {
  if (struktur.moduldoku === null) return { entfaellt: true, modules: [], ghosts: [], orphans: [], staleAllowlist: [] }; // Opt-out: das Gate entfällt
  const q = docmapQuellen(struktur);
  const { alle, modulDateien } = quellListen(rootDir, q);
  const modules = modulEinheiten(modulDateien, q.einheit);
  const moduleSet = new Set(modules);
  const alleSet = new Set(alle);
  const allowed = new Set(ORPHAN_ALLOWLIST);
  const covered = parseDeepDocMaps(rootDir, struktur);

  // 1. Geister-Einträge: Datei-Form nicht unter den Quelldateien, Ordner-Form (Ordner-Modus) nicht vorhanden.
  const ghosts = [...covered].filter((c) => (hatEndung(c, q.endungen) ? !alleSet.has(c) : !existsSync(join(rootDir, ...c.split("/")))));

  // 2. Verwaiste Module: Quelldatei bzw. Ordner ohne Tiefendoc-Erwähnung (außer Allowlist).
  const orphans = modules.filter((f) => !covered.has(f) && !allowed.has(f));

  // 3. Stale Allowlist-Einträge (Modul weg oder inzwischen doch in einem Tiefendoc).
  const staleAllowlist = ORPHAN_ALLOWLIST.filter((f) => !moduleSet.has(f) || covered.has(f));

  return { modules, ghosts, orphans, staleAllowlist };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
/** Die Meldungstexte zu den Quellwurzeln: `wo` (für Geister), `muster` (Hinweis bei leerer Wurzel), `einheit` (Erfolgszeile). */
export function wurzelTexte(q) {
  const wo = q.wurzeln.length === 1 ? `nicht in ${q.wurzeln[0]}/` : `in keiner Quellwurzel (${q.wurzeln.join(", ")})`;
  const muster = q.einheit === "ordner"
    ? `keinen Ordner mit Quelldatei (${q.endungen.join(", ")}) unter ${q.wurzeln.join(", ")}`
    : `keine ${q.wurzeln.flatMap((w) => q.endungen.map((e) => `\`${w}/**/*${e}\``)).join(" oder ")}`;
  return { wo, muster, einheit: q.einheit === "ordner" ? " (Ordner-Einheit)" : "" };
}

function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);

  let struktur;
  let q;
  try {
    struktur = configStruktur();
    q = docmapQuellen(struktur);
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  if (struktur.moduldoku === null) {
    console.log("check:docmap entfällt (struktur.moduldoku: null)");
    return;
  }
  // Fehlt ein Ordner, ist das rot mit Fix-Zeile (factory#168); eine vorhandene, noch leere Quellwurzel ist nur ein Hinweis (unten).
  const befunde = strukturOrdnerBefunde(ROOT, struktur, ["quelle", "moduldoku"]);
  befunde.forEach((b) => console.error(red(`✖ ${b}`)));
  if (befunde.length > 0) process.exit(1);
  const { modules, ghosts, orphans, staleAllowlist } = auditDocMap(ROOT, struktur);
  const text = wurzelTexte(q);

  let bad = false;
  for (const f of ghosts) {
    bad = true;
    console.error(red(`✖ Geister-Eintrag: „${f}" steht in einem Tiefendoc, existiert aber ${text.wo}.`));
  }
  for (const o of orphans) {
    bad = true;
    console.error(
      red(`✖ Verwaistes Modul: „${o}" ist in keinem ${struktur.moduldoku}/*.md als Backtick-Pfad erwähnt (Zeile ergänzen).`),
    );
  }
  for (const f of staleAllowlist) {
    bad = true;
    console.error(red(`✖ Stale ORPHAN_ALLOWLIST-Eintrag „${f}" — aus scripts/check-docmap.mjs entfernen.`));
  }

  if (bad) {
    console.error(`\nDoku↔Code-Drift. Tiefendoc-Abdeckung in ${struktur.moduldoku}/*.md ergänzen.`);
    process.exit(1);
  }
  if (modules.length === 0) {
    console.log(`Hinweis: check:docmap prüft noch nichts: ${text.muster} in der vorhandenen Quellwurzel (Exit 0)`);
    return;
  }
  console.log(
    green(`✔ Tiefendoc-Abdeckung vollständig (${modules.length} Quell-Module (${q.wurzeln.join(", ")})${text.einheit} alle in ${struktur.moduldoku}/*.md erwähnt).`),
  );
}

if (istDirektaufruf(import.meta.url)) main();
