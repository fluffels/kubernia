// Kein Shebang: dieses Skript wird über `node scripts/check-diffcoverage.mjs`
// (npm run check:diffcoverage) gestartet UND von test/diffcoverage.test.ts importiert.
// Eine `#!`-Zeile bricht genau diesen Test-Import (Vitest/esbuild stolpert über das
// `#!`), darum bewusst weggelassen — analog zu check-diffsize.mjs / check-size.mjs.
/**
 * Diff-Coverage-Wächter (#1021) — die geänderten Zeilen eines Slices müssen getestet sein.
 *
 * WARUM zusätzlich zum bestehenden Coverage-Gate (#495): jenes misst ein Schicht-
 * AGGREGAT. Neuer, komplett ungetesteter Code in einer bereits hoch abgedeckten
 * Schicht reißt den Floor NICHT — er verschwindet im Nenner der ganzen Schicht
 * (bei ~4000 Domänen-Zeilen fallen 40 neue ungetestete unter die Rundungsschwelle).
 * Dieser Wächter dreht den Nenner um: gemessen wird ausschließlich, was der aktuelle
 * Slice ANFASST.
 *
 * Mechanik: `git diff -U0 <basis> HEAD -- src` liefert über die Hunk-Header die
 * geänderten Zeilen der NEUEN Seite; geschnitten mit den `DA:`-Records aus
 * `coverage/lcov.info` (v8-Provider) ergibt das je Zeile „getestet / nicht getestet".
 * Bewertet wird PRO SCHICHT-BUCKET über `layerOf()` aus der Schicht-SSOT
 * scripts/layers.cjs — dieselben Grenzen, die dependency-cruiser erzwingt und an
 * denen auch die Aggregat-Floors in vite.config.ts hängen.
 *
 * WARUM pro Schicht statt pauschal 100 %: eine Kalibrierung an den letzten zehn
 * `src`-Commits zeigt die pure Domäne durchgehend bei 100 % Diff-Coverage, die
 * Präsentation/den Einstieg dagegen bei 0-47 % — Phaser/DOM ist per Architektur
 * unit-untestbar und wird nur vom e2e-Smoke berührt (#391/#480). Ein globaler
 * Floor wäre bei JEDEM Szenen-PR rot und würde binnen weniger Tickets abgeschaltet
 * (das #395-Antipattern). Präsentation/Einstieg werden darum gemessen und
 * BERICHTET, aber nicht gegatet; hart sind Domäne und Anwendung.
 *
 * WO er beißt — dieselbe Basis-Semantik wie check:diffsize (#533), dessen
 * `resolveBase` bewusst IMPORTIERT statt kopiert wird (eine Quelle für „was ist die
 * Basis"): auf einem PR die PR-Basis (CI setzt KQ_DIFF_BASE, fetch-depth: 0), auf
 * push:main der Vorgänger-Commit, lokal die Merge-Base gegen origin/main.
 *
 * Degradation bewusst ASYMMETRISCH:
 *  - keine auflösbare Basis / leerer Diff / keine geänderte `src`-.ts → GRÜN (No-op),
 *    genau wie check:diffsize; ein Doku-PR soll nicht an einem fehlenden Coverage-
 *    Lauf scheitern.
 *  - `coverage/lcov.info` fehlt, obwohl `src` geändert wurde → ROT mit Hinweis
 *    „erst npm run test:coverage". Präzedenz check-bundle.mjs: ein Gate, das nichts
 *    gemessen hat, darf nicht grün melden.
 *  - eine geänderte `src/**\/*.ts` fehlt im lcov → ROT. Mit `all: true` MUSS sie dort
 *    stehen; sie still zu überspringen wäre der Gaming-Vektor (Code verstecken).
 *
 * Kein Grün-durch-Aufweichen: das Druckventil ist NICHT das Absenken eines Floors,
 * sondern `KQ_DIFFCOV_OVERRIDE="#<nr> warum"` mit Pflicht-Begründung — inklusive
 * stale-Meldung (Override gesetzt, Slice aber im Budget ⇒ rot), 1:1 das etablierte
 * KQ_DIFFSIZE_OVERRIDE-Muster.
 *
 * Reines Node-Skript (nur Builtins). Die Parse-/Bewertungslogik ist als pure,
 * IO-freie Funktionen exportiert und wird von test/diffcoverage.test.ts importiert —
 * EINE Quelle der Wahrheit für Parsing, Floors und Override-Logik.
 *
 * Ausführen mit:  npm run check:diffcoverage   (nach: npm run test:coverage)
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBase } from "./check-diffsize.mjs";

// layers.cjs ist bewusst CommonJS (der dependency-cruiser-Config `require`t es) —
// dasselbe createRequire-Muster wie in check-docmap.mjs / vite.config.ts.
const require = createRequire(import.meta.url);
const { LAYERS, layerOf } = require("./layers.cjs");

/** Wo der v8-Reporter das lcov ablegt (reportsDirectory `coverage` in vite.config.ts).
 *  Relativ zur Skript-Datei aufgelöst, damit der Wächter unabhängig vom cwd misst. */
export const LCOV_PATH = fileURLToPath(new URL("../coverage/lcov.info", import.meta.url));

/** Mindest-Abdeckung der GEÄNDERTEN Zeilen je Schicht, in Prozent. `null` heißt
 *  „messen und berichten, aber nicht gaten".
 *
 *  Kalibriert an den letzten zehn `src`-Commits (Domäne 6/6-mal bei 100 %,
 *  Anwendung 100 %, Präsentation/Einstieg 0-47 %). Die 90/80 liegen bewusst UNTER
 *  dem gemessenen Ist: sie fangen echten Zuwachs an ungetestetem Code, lassen aber
 *  Luft für defensive `throw`-/Guard-Zweige, die v8 als coverbar zählt — sonst
 *  erzwingt jede Kleinigkeit ein Override und der Wächter wird ignoriert (#395).
 *  RATCHET: diese Zahlen werden per reviewtem Commit ANGEHOBEN, nie gesenkt, um
 *  einen roten Lauf grün zu bekommen (dann greift das Override mit Begründung). */
export const LAYER_DIFF_FLOORS = {
  [LAYERS.DOMAIN]: 90,
  [LAYERS.APPLICATION]: 80,
  // Präsentation/Einstieg: Phaser/DOM, per Architektur unit-untestbar (nur e2e-Smoke).
  // Gemessen und im Report sichtbar, aber bewusst nicht gegatet — siehe Kopf.
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
 *  Nur die Hunk-Header werden gelesen (`@@ -a,b +c,d @@`): `c` ist die erste Zeile
 *  der neuen Seite, `d` ihre Anzahl (fehlt `,d`, ist es genau eine Zeile). `d === 0`
 *  markiert eine reine LÖSCHUNG — die darf keine Zeile beitragen, sonst zählte
 *  entfernter Code als ungetesteter neuer Code. Eine gelöschte Datei (`+++ /dev/null`)
 *  fällt komplett raus. Pure — kein git, voll testbar. */
export function parseDiffLines(text) {
  const byFile = new Map();
  let current = null;
  let prevWasOldHeader = false;
  for (const raw of String(text).split(/\r?\n/)) {
    // `+++ ` gilt NUR als Datei-Header, wenn direkt davor die `--- `-Zeile stand.
    // Sonst kapert eine hinzugefügte INHALTS-Zeile, die mit `++ ` beginnt (im Diff
    // also als `+++ …` erscheint), den Pfad: die folgenden Hunks würden einer
    // Phantom-Datei zugeschlagen und fielen still aus der Messung — genau die
    // Klasse „Gate misst weniger als es soll", gegen die der missing-Pfad schützt.
    const isOldHeader = raw.startsWith("--- ");
    if (raw.startsWith("+++ ") && prevWasOldHeader) {
      const target = raw.slice(4).trim();
      current = target === "/dev/null" ? null : normalizePath(target.replace(/^b\//, ""));
      prevWasOldHeader = false;
      continue;
    }
    prevWasOldHeader = isOldHeader;
    if (!raw.startsWith("@@") || current === null) continue;
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

/** Ist die Datei überhaupt Gegenstand der Coverage-Messung? Deckungsgleich mit dem
 *  `include: ["src/**\/*.ts"]` in vite.config.ts — Content-JSON, Assets und Skripte
 *  außerhalb von `src` sind kein ausführbarer Spielcode und fallen raus.
 *
 *  `.d.ts` ist bewusst ausgenommen: reine Typdeklarationen enthalten keine
 *  ausführbare Zeile. Sie stehen heute zwar im Report (Vitest schließt sie per
 *  Default nicht aus), aber sich darauf zu verlassen wäre spröde — ein Vitest-Bump,
 *  der sie ausschließt, würde jeden PR auf `src/vite-env.d.ts` über den
 *  missing-Pfad falsch rot machen. */
export function isMeasured(path) {
  return path.startsWith("src/") && path.endsWith(".ts") && !path.endsWith(".d.ts");
}

/** Schneidet die geänderten Zeilen gegen das lcov und aggregiert PRO SCHICHT.
 *
 *  Der Floor-Vergleich läuft bewusst ganzzahlig (`covered * 100 < floor * total`)
 *  statt über einen Prozent-Float: `9/10*100` ist in IEEE754 `90.00000000000001`,
 *  ein Float-Vergleich würde also je nach Zahlenpaar mal knapp zu streng, mal knapp
 *  zu lasch entscheiden. `pct` bleibt daneben nur für die Anzeige stehen. Pure. */
export function evaluateByLayer(changed, lcov, floors = LAYER_DIFF_FLOORS) {
  const buckets = {};
  for (const layer of Object.values(LAYERS)) {
    buckets[layer] = { covered: 0, total: 0, pct: 100, floor: floors[layer] ?? null, below: false, files: [] };
  }
  const missing = [];

  for (const [path, lines] of changed) {
    if (!isMeasured(path)) continue;
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

/** Eine Override-Begründung zählt nur, wenn sie nicht leer/whitespace ist — so lässt
 *  sich ein ungetesteter Slice NICHT ohne echte Begründung stillstellen. */
export function overrideReason(env = process.env) {
  const r = (env.KQ_DIFFCOV_OVERRIDE ?? "").trim();
  return r === "" ? null : r;
}

/** Führt die komplette Prüfung aus (Basis → Diff → lcov → Bewertung → Override).
 *  `runGit`/`readFile`/`env` sind injizierbar, damit der Test ohne git, ohne
 *  Coverage-Lauf und ohne Repo-Zustand deterministisch läuft. */
export function checkDiffCoverage({ runGit, readFile, env = process.env } = {}) {
  const git = runGit ?? ((args) => execFileSync("git", args, { encoding: "utf8" }));
  const read = readFile ?? ((p) => readFileSync(p, "utf8"));
  const base = resolveBase(git, env);

  // Keine Basis (flacher Checkout / nichts gegenüber main) → bewusst No-op-grün.
  if (!base) return { skipped: true, failed: false, base: null };

  let diff;
  try {
    // Drei-Punkt (`base...HEAD`), NICHT `base HEAD`: die CI setzt KQ_DIFF_BASE auf
    // `pull_request.base.sha`, also den aktuellen Kopf von main — nicht den
    // Branchpunkt. Ein Zwei-Punkt-Diff würde jede Änderung, die main NACH dem
    // Abzweigen bekam, spiegelverkehrt als Addition dieses Slices ausweisen und
    // fremde Zeilen in den Nenner ziehen (falsches Rot aus fremdem Code). Die
    // Drei-Punkt-Form misst gegen die Merge-Base und damit genau den eigenen Slice;
    // wo `resolveBase` ohnehin schon eine Merge-Base liefert, ist sie identisch.
    diff = git(["diff", "-U0", `${base}...HEAD`, "--", "src"]);
  } catch {
    return { skipped: true, failed: false, base };
  }

  const changed = parseDiffLines(diff);
  const measuredFiles = [...changed.keys()].filter(isMeasured);
  // Kein Spielcode angefasst (reiner Doku-/Tooling-Slice) → nichts zu messen, grün.
  if (measuredFiles.length === 0) {
    return { skipped: false, failed: false, base, nothingToMeasure: true };
  }

  let lcovText;
  try {
    lcovText = read(LCOV_PATH);
  } catch {
    // src geändert, aber kein Messergebnis da → NICHT still grün melden.
    return { skipped: false, failed: true, base, noReport: true };
  }

  const verdict = evaluateByLayer(changed, parseLcov(lcovText));
  // Bewusste Trennung: `below` ist eine COVERAGE-Lücke (bewertbar, darum override-bar),
  // `missing` ist ein MESSfehler — der Report kennt eine geänderte Datei nicht, es wurde
  // also gar nicht gemessen. Den still zu übergehen wäre dasselbe „grün ohne Messung",
  // das der noReport-Zweig oben verbietet; darum deckt ihn das Override NICHT ab, es
  // gibt nur einen Ausweg: neu messen.
  const violated = verdict.below.length > 0;
  const reason = overrideReason(env);
  const allowed = violated && reason !== null;
  const stale = !violated && verdict.missing.length === 0 && reason !== null;

  return {
    skipped: false,
    base,
    ...verdict,
    reason,
    allowed,
    stale,
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
      console.log(dim(`• ${layer}: ${zahl} — nur berichtend (Phaser/DOM, siehe Skript-Kopf)`));
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
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const colors = { red: (s) => paint("31", s), green: (s) => paint("32", s), dim: (s) => paint("2", s) };
  const { red, green, dim } = colors;

  const r = checkDiffCoverage();

  if (r.skipped) {
    console.log(dim("• check:diffcoverage übersprungen — keine Vergleichs-Basis (flacher Checkout / nichts gegenüber main)."));
    return;
  }
  if (r.nothingToMeasure) {
    console.log(green("✔ check:diffcoverage ok — dieser Slice ändert keinen gemessenen Spielcode (src/**/*.ts)."));
    return;
  }
  if (r.noReport) {
    console.error(red("✖ Kein Coverage-Report gefunden — es wurde NICHTS gemessen."));
    console.error(`\nErwartet: ${LCOV_PATH}\nErst messen lassen:  npm run test:coverage`);
    process.exit(1);
  }

  renderBuckets(r, colors);

  // Messfehler, nicht Coverage-Lücke: bewusst NICHT über das Override abkürzbar
  // (`failed` bleibt gesetzt, der allowed-Zweig unten greift dann nicht).
  if (r.missing.length > 0) {
    console.error(red(`✖ ${r.missing.length} geänderte src-Datei(en) fehlen im Coverage-Report:`));
    for (const p of r.missing) console.error(`    ${p}`);
    console.error(
      `\nDer Report ist veraltet oder unvollständig — es wurde für diese Dateien NICHTS gemessen.\n` +
        `Neu messen:  npm run test:coverage`,
    );
    process.exit(1);
  }

  if (r.stale) {
    console.error(
      red(
        "✖ KQ_DIFFCOV_OVERRIDE ist gesetzt, aber der Slice erfüllt die Floors.\n" +
          "  Das Override ist stale — entfernen (KQ_DIFFCOV_OVERRIDE leeren).",
      ),
    );
    process.exit(1);
  }

  if (r.allowed) {
    console.log(dim(`• geduldet: Floors gerissen — bewusst durchgelassen: ${r.reason}`));
    console.log(green("✔ check:diffcoverage ok (Override mit Begründung)."));
    return;
  }

  if (r.failed) {
    console.error(
      `\nDie in diesem Slice geänderten Zeilen sind nicht ausreichend getestet. Tests für genau\n` +
        `diese Zeilen ergänzen (TDD: erst der fehlschlagende Test, siehe AGENTS.md) — ODER, wenn\n` +
        `die Lücke bewusst und begründet ist, mit Pflicht-Begründung durchlassen:\n` +
        `  KQ_DIFFCOV_OVERRIDE="#<nr> warum ungetestet" npm run check:diffcoverage`,
    );
    process.exit(1);
  }

  console.log(green("✔ check:diffcoverage ok — die geänderten Zeilen sind getestet."));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
