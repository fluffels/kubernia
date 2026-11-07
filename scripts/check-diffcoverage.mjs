// Kein Shebang: das Skript wird gestartet UND von test/diffcoverage.test.ts importiert; eine `#!`-Zeile bricht den Test-Import (analog check-diffsize.mjs).
/**
 * Diff-Coverage-Wächter (#1021) — die geänderten Zeilen eines Slices müssen getestet sein.
 *
 * WARUM zusätzlich zum Coverage-Gate (#495): jenes misst ein Schicht-AGGREGAT. Neuer,
 * komplett ungetesteter Code verschwindet im Nenner der ganzen Schicht und reißt keinen
 * Floor (bei ~4000 Domänen-Zeilen fallen 40 neue unter die Rundungsschwelle). Dieser
 * Wächter dreht den Nenner um: gemessen wird nur, was der aktuelle Slice ANFASST.
 *
 * Mechanik: die Hunk-Header aus `git diff -U0 <basis>...HEAD -- <Quellwurzeln>` liefern die
 * geänderten Zeilen der NEUEN Seite (alle Quellwurzeln der Projekt-Config, Endungsliste, ohne `struktur.ohne`); geschnitten mit den
 * Coverage-Berichten (`coverage.berichte` der Projekt-Config, Standard `coverage/lcov.info`; lcov und JaCoCo, Leser in
 * scripts/coverage-berichte.mjs) ergibt das je Zeile „getestet / nicht getestet". Jeder konfigurierte Bericht ist Pflicht. Bewertet
 * wird PRO SCHICHT über `layerOf()` aus der Schicht-SSOT scripts/layers.cjs — dieselben
 * Grenzen, an denen auch die Aggregat-Floors in vite.config.ts hängen. Die Basis-Semantik
 * teilt es sich mit check:diffsize (#533): `resolveBase` steht in check-basis.mjs.
 *
 * Die volle Begründung (Floors je Schicht, asymmetrische Degradation, Ratchet) steht als
 * Regel in docs/agent-harness.md (Testabdeckung wird gemessen). Die Parse-/Bewertungslogik ist als pure Funktionen exportiert (Test: test/diffcoverage.test.ts).
 *
 * Ausführen mit:  npm run check:diffcoverage   (nach: npm run test:coverage)
 */

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { isMeasured, parseDiffLines, resolveBase } from "./check-basis.mjs";
import { ladeAbdeckung, STANDARD_BERICHTE, berichteAus } from "./coverage-berichte.mjs";
// Die Diff-Zeilen-Helfer wohnen in der Gate-Lib (#112, Konvention #1398), die lcov-Leser in coverage-berichte.mjs (factory#185, Blatt: nicht re-exportiert).
export { isMeasured, parseDiffLines };
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { istGlob, quellenAus, quellenObjekt } from "./quellwurzeln-lib.mjs";
import { ladeCommitZeilen, ladeCommitZeilenOderBeende, meldeUngueltigeOverrides, sliceOverride, staleOverrideHinweis, versetzteOverrideHinweis } from "./slice-override.mjs";

// Die Schichtdaten sind CommonJS (der dependency-cruiser-Config `require`t sie) und liegen im Projekt: der Pfad steht in
// scripts/docs-gen/config.json › schichten.layers, ein Kern-Modul importiert sie nie statisch (Kern-Reinheit, ADR 0022 F7).
const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const schichtenPfad = JSON.parse(readFileSync(`${WURZEL}scripts/docs-gen/config.json`, "utf8")).schichten?.layers;
if (typeof schichtenPfad !== "string") throw new Error("scripts/docs-gen/config.json: schichten.layers fehlt");
const { LAYERS, layerOf } = createRequire(import.meta.url)(`${WURZEL}${schichtenPfad}`);

/** Wo der v8-Reporter das lcov ablegt (reportsDirectory in vite.config.ts) — relativ zur
 *  Skript-Datei aufgelöst, damit der Wächter unabhängig vom cwd misst. Der Standard-Bericht ohne Block `coverage` der Projekt-Config. */
export const LCOV_PATH = join(WURZEL, ...STANDARD_BERICHTE[0].pfad.split("/"));

/** Mindest-Abdeckung der GEÄNDERTEN Zeilen je Schicht in Prozent; `null` = messen und
 *  berichten, aber nicht gaten (Präsentation/Einstieg hängen an Framework und Oberfläche, per Architektur
 *  unit-untestbar). Kalibriert an den letzten zehn `src`-Commits: Domäne/Anwendung lagen
 *  bei 100 %, Präsentation/Einstieg bei 0-47 %. Die 90/80 liegen bewusst unter dem Ist —
 *  Luft für defensive Guard-Zweige, sonst erzwingt jede Kleinigkeit ein Override (#395).
 *  RATCHET: nur per reviewtem Commit ANHEBEN, nie senken, um Rot grün zu bekommen. */
export const LAYER_DIFF_FLOORS = {
  [LAYERS.DOMAIN]: 90,
  [LAYERS.APPLICATION]: 80,
  [LAYERS.PRESENTATION]: null,
  [LAYERS.ENTRY]: null,
};

/** Geänderte Zeilen, die ausgeführt wurden (DA > 0), aber mindestens einen ungenommenen Zweig tragen
 *  (z. B. ein `catch` mit Weiterwurf auf derselben Zeile): die Zeilen-Coverage zählt sie als getestet,
 *  der Zweig bleibt unsichtbar. Nur berichtend, kein Gate (v8 meldet implizite Zweige, keine Kalibrierung).
 *  Gemessen werden nur Dateien, für die `isMeasured` gilt. Pure. */
export function teilweiseGetestet(changed, lcov, branches, quelle = quellenAus(ladeProjektConfig())) {
  const partial = [];
  for (const [path, lines] of changed) {
    if (!isMeasured(path, quelle)) continue;
    const da = lcov.get(path);
    const br = branches.get(path);
    if (da === undefined || br === undefined) continue;
    for (const line of [...lines].sort((a, b) => a - b)) {
      const b = br.get(line);
      if ((da.get(line) ?? 0) > 0 && b !== undefined && b.taken < b.total) {
        partial.push({ path, line, taken: b.taken, total: b.total });
      }
    }
  }
  return partial;
}

/** Die Berichtsdateien einer Datei aus `berichteJe` (kann fehlen). Pur. */
const berichteVon = (berichteJe, path) => berichteJe?.get(path) ?? [];

/** Schneidet die geänderten Zeilen gegen das lcov und aggregiert PRO SCHICHT.
 *
 *  Der Floor-Vergleich läuft ganzzahlig (`covered * 100 < floor * total`) statt über
 *  einen Prozent-Float: `9/10*100` ist in IEEE754 `90.00000000000001`, ein Float-Vergleich
 *  entschiede je nach Zahlenpaar mal zu streng, mal zu lasch. `pct` ist nur Anzeige. Pure. */
export function evaluateByLayer(changed, lcov, floors = LAYER_DIFF_FLOORS, quelle = quellenAus(ladeProjektConfig()), berichteJe) {
  const buckets = {};
  for (const layer of Object.values(LAYERS)) {
    buckets[layer] = { covered: 0, total: 0, pct: 100, floor: floors[layer] ?? null, below: false, files: [] };
  }
  const missing = [];

  for (const [path, lines] of changed) {
    if (!isMeasured(path, quelle)) continue;
    const record = lcov.get(path);
    if (record === undefined) {
      missing.push(path);
      continue;
    }
    const bucket = buckets[layerOf(path)];
    const uncovered = [];
    let total = 0;
    let covered = 0;
    for (const line of [...lines].sort((a, b) => a - b)) {
      const hits = record.get(line);
      if (hits === undefined) continue; // nicht ausführbar (Kommentar/Typ/Leerzeile)
      total++;
      if (hits > 0) covered++;
      else uncovered.push(line);
    }
    if (total === 0) continue;
    bucket.total += total;
    bucket.covered += covered;
    bucket.files.push({ path, total, covered, uncovered, berichte: berichteVon(berichteJe, path) });
  }

  const below = [];
  for (const [layer, b] of Object.entries(buckets)) {
    b.pct = b.total === 0 ? 100 : (b.covered / b.total) * 100;
    b.below = b.floor !== null && b.total > 0 && b.covered * 100 < b.floor * b.total;
    if (b.below) below.push(layer);
  }
  return { buckets, missing, below };
}

/** Override-Trailer (#1269, Schlüssel aus `zeilen.diffcovOverride`): eine Zeile `<praefixe.commitZeile>Diffcov-Override: #<nr> <warum>` (Präfix aus der Projekt-Config)
 *  in einer Commit-Message des Slices. Parser und Slice-Bereich teilt es sich mit
 *  check:diffsize (scripts/slice-override.mjs), damit es lokal, im PR und auf main gleich wirkt. */

/** Git-Optionen des Diff-Laufs; maxBuffer groß, damit ein breiter Diff nicht an ENOBUFS scheitert. */
export const GIT_OPTIONEN = { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 };

/** Die Pfadangaben des Diffs je Quellwurzel: eine wörtliche Wurzel unverändert, ein Glob als `:(glob)<wurzel>/**`. Maßgeblich bleibt danach der Filter `isMeasured` (Endungen, `ohne`). */
export function pfadAngaben(quellen) {
  return quellenObjekt(quellen).wurzeln.map((w) => (istGlob(w) ? `:(glob)${w}/**` : w));
}

/** Schneidet die Messung (Zeilen, Zweige) gegen die geänderten Zeilen: Bewertung je Schicht, teilweise Getestetes und die Messfehler (fehlt im Bericht, mehrdeutiger JaCoCo-Pfad). */
function messe(changed, geladen, quelle) {
  const verdict = evaluateByLayer(changed, geladen.abdeckung, LAYER_DIFF_FLOORS, quelle, geladen.berichteJe);
  const mehrdeutigePfade = new Set(geladen.mehrdeutig.map((e) => e.pfad));
  const missing = verdict.missing.filter((p) => !mehrdeutigePfade.has(p));
  return { ...verdict, missing, mehrdeutig: geladen.mehrdeutig, partial: teilweiseGetestet(changed, geladen.abdeckung, geladen.zweige, quelle) };
}

/** Führt die komplette Prüfung aus (Basis → Diff → Berichte → Bewertung → Override).
 *  `runGit`/`readFile`/`env` sind injizierbar, damit der Test ohne git, ohne
 *  Coverage-Lauf und ohne Repo-Zustand deterministisch läuft. `quelle` ist ein String (eine Wurzel) oder `{ wurzeln, endungen, ohne }`,
 *  `berichte` die Liste aus `berichteAus`, `rootDir` die Wurzel, gegen die Berichtspfade gelten (factory#185). */
export function checkDiffCoverage({
  runGit,
  readFile,
  env = process.env,
  zeilen = ladeCommitZeilen(),
  quelle = quellenAus(ladeProjektConfig()),
  berichte = berichteAus(ladeProjektConfig()),
  rootDir = WURZEL,
} = {}) {
  const git = runGit ?? ((args) => execFileSync("git", args, GIT_OPTIONEN));
  const read = readFile ?? ((p) => readFileSync(p, "utf8"));
  const base = resolveBase(git, env);

  // Keine Basis (flacher Checkout / nichts gegenüber main) → bewusst No-op-grün.
  if (!base) return { skipped: true, failed: false, base: null };

  let diff;
  try {
    // Drei-Punkt, NICHT `base HEAD`: FACTORY_DIFF_BASE ist in der PR-CI der Kopf von main (erster
    // Elternteil des Merge-Checkouts, ci.yml „Diff-Basis bestimmen“) statt des Branchpunkts.
    // Zwei-Punkt wiese jede Änderung, die main NACH dem Abzweigen bekam, spiegelverkehrt als
    // Addition dieses Slices aus — fremde Zeilen im Nenner, potenziell falsches Rot. `A...B`
    // misst gegen die Merge-Base.
    diff = git(["diff", "-U0", `${base}...HEAD`, "--", ...pfadAngaben(quelle)]);
  } catch (err) {
    // Ein zu großer Diff (ENOBUFS) ist ein Messfehler, kein flacher Checkout: rot statt still grün.
    // Jeder andere Fehler (Basis nicht auflösbar, flacher Checkout) bleibt bewusst No-op-grün.
    if (err && err.code === "ENOBUFS") return { skipped: false, failed: true, base, diffUnlesbar: true };
    return { skipped: true, failed: false, base };
  }

  const changed = parseDiffLines(diff);
  const measuredFiles = [...changed.keys()].filter((p) => isMeasured(p, quelle));
  // Kein Quellcode angefasst (reiner Doku-/Tooling-Slice) → nichts zu messen, grün.
  // Ein Override-Trailer ist dann überflüssig (stale, #1309): es gibt nichts durchzulassen.
  if (measuredFiles.length === 0) {
    const { reason, invalid } = sliceOverride(git, base, zeilen.diffcovOverride);
    return { skipped: false, failed: reason !== null, base, nothingToMeasure: true, stale: reason !== null, reason, invalidOverrides: invalid };
  }

  const quellenObj = quellenObjekt(quelle);
  const geladen = ladeAbdeckung({ berichte, rootDir, lies: read, messDateien: measuredFiles, quellen: quellenObj });
  // Quellcode geändert, aber (mindestens) ein Bericht fehlt → NICHT still grün melden.
  if (geladen.fehlend.length > 0) return { skipped: false, failed: true, base, noReport: true, fehlendeBerichte: geladen.fehlend };

  const verdict = messe(changed, geladen, quelle);
  // `below` ist eine COVERAGE-Lücke (bewertbar, darum override-bar), `missing` und `mehrdeutig` ein
  // MESSfehler — für diese Datei wurde gar nichts gemessen. Ihn durchzuwinken wäre
  // dasselbe „grün ohne Messung", das der noReport-Zweig verbietet: nicht override-bar.
  const messfehler = verdict.missing.length + verdict.mehrdeutig.length;
  const violated = verdict.below.length > 0;
  const { reason, invalid, versetzt } = sliceOverride(git, base, zeilen.diffcovOverride);
  const allowed = violated && reason !== null;
  const stale = !violated && messfehler === 0 && reason !== null;

  return {
    skipped: false,
    base,
    ...verdict,
    reason,
    allowed,
    stale,
    invalidOverrides: invalid,
    versetzteOverrides: versetzt,
    failed: (violated && !allowed) || stale || messfehler > 0,
  };
}

/** Der Befehl, der die Berichte erzeugt (der Gate-Befehl der Projekt-Config, `scripts/gate-befehl.mjs`). */
export const COVERAGE_BEFEHL = "node scripts/gate-befehl.mjs coverage";

// ── CLI ──────────────────────────────────────────────────────────────────────
/** Pur: ` (aus <Bericht>[, <Bericht>])` oder leer ohne bekannten Bericht. */
const berichtHinweis = (berichte) => (berichte?.length > 0 ? ` (aus ${berichte.join(", ")})` : "");

/** Pur: die Detailzeilen zu einer roten Schicht (factory#208, factory#215): je Datei mit ungetesteten Zeilen `Datei: ungetestet in Zeile n, m (aus <Bericht>[, <Bericht>])`, der Bericht je Datei, nicht die Liste aller; ohne ungetestete Zeile leer. */
export function rotZeilen(b) {
  return b.files
    .filter((f) => f.uncovered.length > 0)
    .map((f) => `    ${f.path}: ungetestet in Zeile ${f.uncovered.join(", ")}${berichtHinweis(f.berichte)}`);
}

/** Rendert die Schicht-Zeilen des Reports (gegatete zuerst, dann die berichtenden); die Rot-Details gehen auf denselben Strom wie die Summenzeile. */
function renderBuckets(r, { dim, red, green }) {
  for (const [layer, b] of Object.entries(r.buckets)) {
    if (b.total === 0) continue;
    const zahl = `${b.covered}/${b.total} geänderte Zeilen getestet (${b.pct.toFixed(1)} %)`;
    if (b.floor === null) {
      console.log(dim(`• ${layer}: ${zahl} — nur berichtend (Schicht ohne Floor, siehe Skript-Kopf)`));
      continue;
    }
    const paint = b.below ? red : green;
    console.log(paint(`${b.below ? "✖" : "✔"} ${layer}: ${zahl}, Floor ${b.floor} %`));
    if (b.below) for (const z of rotZeilen(b)) console.log(z);
  }
}

/** Pur: die Meldung bei fehlenden Berichten: je Bericht eine Zeile „Erwartet: <pfad>“ und der Befehl, der sie erzeugt. */
export function fehlenderBerichtText(fehlend) {
  return `${fehlend.map((p) => `Erwartet: ${p}`).join("\n")}\nErst messen lassen:  ${COVERAGE_BEFEHL}`;
}

/** Pur: die Meldung bei mehrdeutigen JaCoCo-Pfaden: je Eintrag Schlüssel und Kandidaten, dazu der Fix. */
export function mehrdeutigText(mehrdeutig) {
  const zeilen = mehrdeutig.map((e) => `    ${e.pfad}: „${e.schluessel}“ gibt es unter ${e.kandidaten.join(", ")}`);
  return `${zeilen.join("\n")}\n\nDer JaCoCo-Bericht nennt nur paket/Datei, nicht den Ordner: die Zuordnung ist nicht eindeutig, es wurde NICHTS gemessen.\nFix: die Quellwurzeln (struktur.quelle in der Projekt-Config) so fassen, dass die Datei nur unter einer Wurzel liegt, oder eine der gleichnamigen Dateien umbenennen (ein anderer Zuschnitt hilft nur bei überlappenden Wurzeln)`;
}

/** Die Messfehler (fehlende Berichte, fehlende Datei im Bericht, mehrdeutiger Pfad) als Fehlertext oder `null`; bewusst NICHT über das Override abkürzbar. */
export function messfehlerText(r, red) {
  if (r.noReport) return `${red("✖ Kein Coverage-Bericht gefunden — es wurde NICHTS gemessen.")}\n\n${fehlenderBerichtText(r.fehlendeBerichte)}`;
  if (r.missing.length > 0) {
    return `${red(`✖ ${r.missing.length} geänderte Quelldatei(en) fehlen im Coverage-Bericht:`)}\n${r.missing.map((p) => `    ${p}`).join("\n")}\n\nFür sie wurde NICHTS gemessen — Bericht veraltet. Neu messen:  ${COVERAGE_BEFEHL}`;
  }
  if (r.mehrdeutig.length > 0) return `${red(`✖ ${r.mehrdeutig.length} geänderte Quelldatei(en) mit mehrdeutigem JaCoCo-Pfad:`)}\n${mehrdeutigText(r.mehrdeutig)}`;
  return null;
}

/** Der Text zu „nichts zu messen“: die Wurzeln und Endungen, die das Gate misst. */
function messbereichText(quelle) {
  const q = quellenObjekt(quelle);
  return `(Wurzeln: ${q.wurzeln.join(", ")}; Endungen: ${q.endungen.join(" ")})`;
}

/** Ergebnis ohne Messung (nichts zu messen, Diff nicht lesbar) → Exit-Code oder `null`, wenn gemessen wurde. */
export function ohneMessung(r, { zeilen, quelle, colors }) {
  const { red, green, dim } = colors;
  if (r.nothingToMeasure) {
    meldeUngueltigeOverrides(r.invalidOverrides, { dim });
    const text = `dieser Slice ändert keinen gemessenen Quellcode ${messbereichText(quelle)}`;
    if (!r.stale) console.log(green(`✔ check:diffcoverage ok — ${text}.`));
    else console.error(red(staleOverrideHinweis(zeilen.diffcovOverride, text)));
    return r.stale ? 1 : 0;
  }
  if (!r.diffUnlesbar) return null;
  console.error(red("✖ Diff nicht lesbar (Ausgabe über dem Puffer, ENOBUFS) — es wurde NICHTS gemessen."));
  console.error("Slice verkleinern (check:diffsize) oder den Diff lokal prüfen.");
  return 1;
}

function ladeConfigOderBeende(red) {
  try {
    const config = ladeProjektConfig();
    return { quelle: quellenAus(config), berichte: berichteAus(config) };
  } catch (e) {
    console.error(red(`✖ ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
}

function main() {
  // Die Commit-Zeilen kommen aus der Projekt-Config; ein Ladefehler endet mit der Meldung des Laders (Pfad, Schlüssel, Fix:).
  const zeilen = ladeCommitZeilenOderBeende();
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const colors = { red: (s) => paint("31", s), green: (s) => paint("32", s), dim: (s) => paint("2", s) };
  const { red, green, dim } = colors;

  const { quelle, berichte } = ladeConfigOderBeende(red);
  const r = checkDiffCoverage({ zeilen, quelle, berichte });

  if (r.skipped) {
    console.log(dim("• check:diffcoverage übersprungen — keine Vergleichs-Basis (flacher Checkout / nichts gegenüber main)."));
    return;
  }
  const ohne = ohneMessung(r, { zeilen, quelle, colors });
  if (ohne !== null) process.exit(ohne);
  const fehler = messfehlerText(r, red);
  if (fehler !== null) {
    if (r.noReport) console.error(fehler);
    else {
      renderBuckets(r, colors);
      console.error(fehler);
    }
    process.exit(1);
  }

  renderBuckets(r, colors);
  if (r.partial.length > 0) {
    console.log(dim("• Teilweise getestet (ungetesteter Zweig auf ausgeführter geänderter Zeile, nur berichtet):"));
    for (const p of r.partial) console.log(dim(`    ${p.path}: Zeile ${p.line} (${p.taken} von ${p.total} Zweigen)`));
  }

  meldeUngueltigeOverrides(r.invalidOverrides, { dim });

  if (r.stale) {
    console.error(red(staleOverrideHinweis(zeilen.diffcovOverride, "der Slice erfüllt die Floors")));
    process.exit(1);
  }

  if (r.allowed) {
    console.log(dim(`• geduldet: Floors gerissen — bewusst durchgelassen: ${r.reason}`));
    console.log(green("✔ check:diffcoverage ok (Override mit Begründung)."));
    return;
  }

  if (r.failed) {
    for (const h of versetzteOverrideHinweis(zeilen.diffcovOverride, r.versetzteOverrides)) console.error(h);
    console.error(
      `\nTests für genau diese Zeilen ergänzen (TDD: erst der fehlschlagende Test, AGENTS.md) —\n` +
        `ODER, wenn die Lücke bewusst ist, mit Pflicht-Begründung als Commit-Trailer im Slice\n` +
        `durchlassen (wirkt lokal, im PR und auf main gleich):\n` +
        `  git commit --allow-empty -m "chore: Lücke bewusst (#<nr>)" -m "${zeilen.diffcovOverride}: #<nr> warum ungetestet"`,
    );
    process.exit(1);
  }

  console.log(green("✔ check:diffcoverage ok — die geänderten Zeilen sind getestet."));
}

if (istDirektaufruf(import.meta.url)) main();
