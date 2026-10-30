// Kein Shebang: dieses Skript wird über `node scripts/check-diffcoverage.mjs`
// (npm run check:diffcoverage) gestartet UND von test/diffcoverage.test.ts importiert.
// Eine `#!`-Zeile bricht genau diesen Test-Import (Vitest/esbuild stolpert über das
// `#!`), darum bewusst weggelassen — analog zu check-diffsize.mjs / check-size.mjs.
/**
 * Diff-Coverage-Wächter (#1021) — die geänderten Zeilen eines Slices müssen getestet sein.
 *
 * WARUM zusätzlich zum Coverage-Gate (#495): jenes misst ein Schicht-AGGREGAT. Neuer,
 * komplett ungetesteter Code verschwindet im Nenner der ganzen Schicht und reißt keinen
 * Floor (bei ~4000 Domänen-Zeilen fallen 40 neue unter die Rundungsschwelle). Dieser
 * Wächter dreht den Nenner um: gemessen wird nur, was der aktuelle Slice ANFASST.
 *
 * Mechanik: die Hunk-Header aus `git diff -U0 <basis>...HEAD -- <quelle>` liefern die
 * geänderten Zeilen der NEUEN Seite; geschnitten mit den `DA:`-Records aus
 * `coverage/lcov.info` (v8) ergibt das je Zeile „getestet / nicht getestet". Bewertet
 * wird PRO SCHICHT über `layerOf()` aus der Schicht-SSOT scripts/layers.cjs — dieselben
 * Grenzen, an denen auch die Aggregat-Floors in vite.config.ts hängen. Die Basis-Semantik
 * teilt es sich mit check:diffsize (#533): `resolveBase` steht in check-basis.mjs.
 *
 * Die volle Begründung (Floors je Schicht, asymmetrische Degradation, Ratchet) steht als
 * Regel in AGENTS.md › Abdeckung und Bundle. Reines Node-Skript (nur Builtins); die Parse-/
 * Bewertungslogik ist als pure, IO-freie Funktionen exportiert und wird von
 * test/diffcoverage.test.ts importiert — EINE Quelle der Wahrheit.
 *
 * Ausführen mit:  npm run check:diffcoverage   (nach: npm run test:coverage)
 */

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolveBase } from "./check-basis.mjs";
import { ladeProjektConfig, strukturAus } from "./projekt-config-lib.mjs";
import { ladeCommitZeilen, ladeCommitZeilenOderBeende, meldeUngueltigeOverrides, sliceOverride, staleOverrideHinweis, versetzteOverrideHinweis } from "./slice-override.mjs";

// Die Schichtdaten sind CommonJS (der dependency-cruiser-Config `require`t sie) und liegen im Projekt: der Pfad steht in
// scripts/docs-gen/config.json › schichten.layers, ein Kern-Modul importiert sie nie statisch (Kern-Reinheit, ADR 0022 F7).
const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const schichtenPfad = JSON.parse(readFileSync(`${WURZEL}scripts/docs-gen/config.json`, "utf8")).schichten?.layers;
if (typeof schichtenPfad !== "string") throw new Error("scripts/docs-gen/config.json: schichten.layers fehlt");
const { LAYERS, layerOf } = createRequire(import.meta.url)(`${WURZEL}${schichtenPfad}`);

/** Wo der v8-Reporter das lcov ablegt (reportsDirectory in vite.config.ts) — relativ zur
 *  Skript-Datei aufgelöst, damit der Wächter unabhängig vom cwd misst. */
export const LCOV_PATH = fileURLToPath(new URL("../coverage/lcov.info", import.meta.url));

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

/** Vereinheitlicht Pfad-Trenner auf POSIX. Nötig, weil der v8-lcov-Reporter unter
 *  Windows `SF:src\sim\pods.ts` schreibt, `git diff` aber `src/sim/pods.ts` — ohne
 *  Normalisierung fände der Schnitt NIE einen Treffer und das Gate wäre still blind. */
export function normalizePath(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Parst `git diff -U0` und liefert je Datei die Zeilennummern der NEUEN Seite.
 *
 *  Gelesen werden nur die Hunk-Header (`@@ -a,b +c,d @@`): `c` ist die erste Zeile der
 *  neuen Seite, `d` ihre Anzahl (ohne `,d`: genau eine). `d === 0` ist eine reine
 *  LÖSCHUNG und darf nichts beitragen, sonst zählte entfernter Code als neuer
 *  ungetesteter; `+++ /dev/null` fällt ganz raus. Pure — kein git, voll testbar. */
export function parseDiffLines(text) {
  const byFile = new Map();
  let current = null;
  // `+++ ` zählt nur im Kopfbereich (zwischen `diff --git` und dem ersten `@@`) als
  // Datei-Header — sonst kapert eine INHALTS-Zeile, die mit `++ ` beginnt, den Pfad und
  // die folgenden Hunks fallen unter einer Phantom-Datei still aus der Messung.
  // `diff --git ` ist der fälschungssichere Anker: eine Inhaltszeile trägt immer ein
  // `+`/`-` davor (`--- ` dagegen kann eine entfernte Zeile `-- a/x` sein).
  let imKopf = false;
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.startsWith("diff --git ")) {
      imKopf = true;
      current = null;
      continue;
    }
    if (imKopf && raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      current = target === "/dev/null" ? null : normalizePath(target.replace(/^b\//, ""));
      continue;
    }
    if (!raw.startsWith("@@") || current === null) continue;
    imKopf = false;
    const m = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (!m) continue;
    const start = Number.parseInt(m[1], 10);
    const count = m[2] === undefined ? 1 : Number.parseInt(m[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(count) || count <= 0) continue;
    const lines = byFile.get(current) ?? new Set();
    for (let i = 0; i < count; i++) lines.add(start + i);
    byFile.set(current, lines);
  }
  return byFile;
}

/** Parst ein lcov-Info-File zu `Datei → (Zeile → Trefferzahl)`. Es interessieren nur
 *  die `SF:`/`DA:`-Records; `DA:` existiert ausschließlich für AUSFÜHRBARE Zeilen —
 *  Kommentare, Typen und Leerzeilen fehlen also von Haus aus im Nenner. Pure. */
export function parseLcov(text) {
  const byFile = new Map();
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      current = normalizePath(line.slice(3));
      if (!byFile.has(current)) byFile.set(current, new Map());
      continue;
    }
    if (line === "end_of_record") {
      current = null;
      continue;
    }
    if (!line.startsWith("DA:") || current === null) continue;
    const [no, hits] = line.slice(3).split(",");
    const lineNo = Number.parseInt(no, 10);
    const count = Number.parseInt(hits, 10);
    if (!Number.isFinite(lineNo)) continue;
    byFile.get(current).set(lineNo, Number.isFinite(count) ? count : 0);
  }
  return byFile;
}

/** Parst die `BRDA:`-Records eines lcov-Files zu `Datei → (Zeile → { total, taken })` (#1425): je Zeile die
 *  Zahl der Zweige und wie viele davon mindestens einmal genommen wurden. `BRDA:<zeile>,<block>,<zweig>,<taken>`,
 *  `taken` = `-` heißt „nie erreicht“ (zählt als nicht genommen). Kaputte Records werden übersprungen. Pure. */
export function parseLcovBranches(text) {
  const byFile = new Map();
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      current = normalizePath(line.slice(3));
      if (!byFile.has(current)) byFile.set(current, new Map());
      continue;
    }
    if (line === "end_of_record") {
      current = null;
      continue;
    }
    if (!line.startsWith("BRDA:") || current === null) continue;
    const teile = line.slice(5).split(",");
    if (teile.length !== 4) continue;
    const lineNo = Number.parseInt(teile[0], 10);
    if (!Number.isFinite(lineNo)) continue;
    const taken = teile[3] === "-" ? 0 : Number.parseInt(teile[3], 10);
    if (!Number.isFinite(taken)) continue;
    const zeilen = byFile.get(current);
    const e = zeilen.get(lineNo) ?? { total: 0, taken: 0 };
    e.total++;
    if (taken > 0) e.taken++;
    zeilen.set(lineNo, e);
  }
  return byFile;
}

/** Geänderte Zeilen, die ausgeführt wurden (DA > 0), aber mindestens einen ungenommenen Zweig tragen
 *  (z. B. ein `catch` mit Weiterwurf auf derselben Zeile): die Zeilen-Coverage zählt sie als getestet,
 *  der Zweig bleibt unsichtbar. Nur berichtend, kein Gate (v8 meldet implizite Zweige, keine Kalibrierung).
 *  Gemessen werden nur Dateien, für die `isMeasured` gilt. Pure. */
export function teilweiseGetestet(changed, lcov, branches, quelle = strukturAus(ladeProjektConfig()).quelle) {
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

/** Ist die Datei überhaupt Gegenstand der Coverage-Messung? Deckungsgleich mit dem
 *  `include` der Coverage-Config für die Quellwurzel (`struktur.quelle` der Projekt-Config) — Content-JSON, Assets und Skripte
 *  außerhalb der Quellwurzel sind kein ausführbarer Quellcode und fallen raus.
 *
 *  Endungen `.ts`, `.mts`, `.mjs`, `.cjs`, `.js` (das Factory-Repo hat seine Quellwurzel unter `scripts` mit `.mjs`; in einem Repo mit `src/` als Quellwurzel liegt dort nur `.ts`).
 *  `.d.ts` (auch `.d.mts`, `.d.cts`) ist ausgenommen: reine Typdeklarationen haben keine ausführbare Zeile, und ein
 *  Vitest-Bump, der sie aus dem Report nimmt, machte jeden PR darauf falsch rot. */
export function isMeasured(path, quelle = strukturAus(ladeProjektConfig()).quelle) {
  return path.startsWith(`${quelle}/`) && /\.(?:ts|mts|mjs|cjs|js)$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
}

/** Schneidet die geänderten Zeilen gegen das lcov und aggregiert PRO SCHICHT.
 *
 *  Der Floor-Vergleich läuft ganzzahlig (`covered * 100 < floor * total`) statt über
 *  einen Prozent-Float: `9/10*100` ist in IEEE754 `90.00000000000001`, ein Float-Vergleich
 *  entschiede je nach Zahlenpaar mal zu streng, mal zu lasch. `pct` ist nur Anzeige. Pure. */
export function evaluateByLayer(changed, lcov, floors = LAYER_DIFF_FLOORS, quelle = strukturAus(ladeProjektConfig()).quelle) {
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
    bucket.files.push({ path, total, covered, uncovered });
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

/** Führt die komplette Prüfung aus (Basis → Diff → lcov → Bewertung → Override).
 *  `runGit`/`readFile`/`env` sind injizierbar, damit der Test ohne git, ohne
 *  Coverage-Lauf und ohne Repo-Zustand deterministisch läuft. */
export function checkDiffCoverage({ runGit, readFile, env = process.env, zeilen = ladeCommitZeilen(), quelle = strukturAus(ladeProjektConfig()).quelle } = {}) {
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
    diff = git(["diff", "-U0", `${base}...HEAD`, "--", quelle]);
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

  let lcovText;
  try {
    lcovText = read(LCOV_PATH);
  } catch {
    // Quellcode geändert, aber kein Messergebnis da → NICHT still grün melden.
    return { skipped: false, failed: true, base, noReport: true };
  }

  const lcov = parseLcov(lcovText);
  const verdict = evaluateByLayer(changed, lcov, LAYER_DIFF_FLOORS, quelle);
  const partial = teilweiseGetestet(changed, lcov, parseLcovBranches(lcovText), quelle);
  // `below` ist eine COVERAGE-Lücke (bewertbar, darum override-bar), `missing` ein
  // MESSfehler — für diese Datei wurde gar nichts gemessen. Ihn durchzuwinken wäre
  // dasselbe „grün ohne Messung", das der noReport-Zweig verbietet: nicht override-bar.
  const violated = verdict.below.length > 0;
  const { reason, invalid, versetzt } = sliceOverride(git, base, zeilen.diffcovOverride);
  const allowed = violated && reason !== null;
  const stale = !violated && verdict.missing.length === 0 && reason !== null;

  return {
    skipped: false,
    base,
    ...verdict,
    partial,
    reason,
    allowed,
    stale,
    invalidOverrides: invalid,
    versetzteOverrides: versetzt,
    failed: (violated && !allowed) || stale || verdict.missing.length > 0,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
/** Rendert die Schicht-Zeilen des Reports (gegatete zuerst, dann die berichtenden). */
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
    if (!b.below) continue;
    for (const f of b.files.filter((f) => f.uncovered.length > 0)) {
      console.error(`    ${f.path}: ungetestet in Zeile ${f.uncovered.join(", ")}`);
    }
  }
}

function main() {
  // Die Commit-Zeilen kommen aus der Projekt-Config; ein Ladefehler endet mit der Meldung des Laders (Pfad, Schlüssel, Fix:).
  const zeilen = ladeCommitZeilenOderBeende();
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const colors = { red: (s) => paint("31", s), green: (s) => paint("32", s), dim: (s) => paint("2", s) };
  const { red, green, dim } = colors;

  let quelle;
  try {
    quelle = strukturAus(ladeProjektConfig()).quelle;
  } catch (e) {
    console.error(red(`✖ ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
  const r = checkDiffCoverage({ zeilen, quelle });

  if (r.skipped) {
    console.log(dim("• check:diffcoverage übersprungen — keine Vergleichs-Basis (flacher Checkout / nichts gegenüber main)."));
    return;
  }
  if (r.nothingToMeasure && r.stale) {
    meldeUngueltigeOverrides(r.invalidOverrides, { dim });
    console.error(red(staleOverrideHinweis(zeilen.diffcovOverride, `dieser Slice ändert keinen gemessenen Quellcode (${quelle}/**/*.ts)`)));
    process.exit(1);
  }
  if (r.nothingToMeasure) {
    meldeUngueltigeOverrides(r.invalidOverrides, { dim });
    console.log(green(`✔ check:diffcoverage ok — dieser Slice ändert keinen gemessenen Quellcode (${quelle}/**/*.ts).`));
    return;
  }
  if (r.diffUnlesbar) {
    console.error(red("✖ Diff nicht lesbar (Ausgabe über dem Puffer, ENOBUFS) — es wurde NICHTS gemessen."));
    console.error("Slice verkleinern (check:diffsize) oder den Diff lokal prüfen.");
    process.exit(1);
  }
  if (r.noReport) {
    console.error(red("✖ Kein Coverage-Report gefunden — es wurde NICHTS gemessen."));
    console.error(`\nErwartet: ${LCOV_PATH}\nErst messen lassen:  npm run test:coverage`);
    process.exit(1);
  }

  renderBuckets(r, colors);
  if (r.partial.length > 0) {
    console.log(dim("• Teilweise getestet (ungetesteter Zweig auf ausgeführter geänderter Zeile, nur berichtet):"));
    for (const p of r.partial) console.log(dim(`    ${p.path}: Zeile ${p.line} (${p.taken} von ${p.total} Zweigen)`));
  }

  // Messfehler, nicht Coverage-Lücke — bewusst NICHT über das Override abkürzbar.
  if (r.missing.length > 0) {
    console.error(red(`✖ ${r.missing.length} geänderte Quelldatei(en) fehlen im Coverage-Report:`));
    for (const p of r.missing) console.error(`    ${p}`);
    console.error(`\nFür sie wurde NICHTS gemessen — Report veraltet. Neu messen:  npm run test:coverage`);
    process.exit(1);
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
