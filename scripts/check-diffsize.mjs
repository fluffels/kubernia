// Kein Shebang: dieses Skript wird über `node scripts/check-diffsize.mjs`
// (npm run check:diffsize) gestartet UND von test/diffsize.test.ts importiert. Eine
// `#!`-Zeile bricht genau diesen Test-Import (Vitest/esbuild stolpert über das `#!`),
// darum bewusst weggelassen — analog zu check-size.mjs / check-docdrift.mjs.
/**
 * Diff-Größenbudget-Wächter (#533) — Frühwarnung gegen zu breite Änderungen.
 *
 * Hintergrund (Vorbild: produktiv eingesetzte KI-Entwicklungspipelines): so eine
 * Pipeline plant Code in **Commit-Slices mit hartem Größenbudget** und prüft das
 * programmatisch,
 * LLM-frei. kubequest hat das Budget bisher nur auf DATEI-Ebene (check-size.mjs,
 * 800 LOC je Modul), aber KEIN Budget für die Größe EINER Änderung/eines Tickets.
 * Ein Epic, das eigentlich in session-große Kinder gehört (siehe AGENTS.md), kann
 * so als ein Riesen-Commit durchrutschen und wird unreviewbar.
 *
 * Dieser Wächter misst den Diff des aktuellen Standes gegen `main` und wird ROT,
 * wenn er ein Budget an geänderten Dateien ODER Zeilen überschreitet.
 *
 * WO er beißt (seit #592 primär server-seitig, PR-gegated):
 *  - Auf einem PR (CI-Checkout mit fetch-depth:0 + KQ_DIFF_BASE=PR-Basis, siehe
 *    ci.yml) ist die Vergleichs-Basis auflösbar → der Slice wird als **Required
 *    Check** gemessen und ein zu breiter PR am Merge gehindert. Das ist der
 *    eigentliche Durchsetzungspunkt.
 *  - Auf einem Feature-Branch (lokales `npm run verify`) greift er ebenso
 *    (volle Historie da) — als schnelle Vorab-Rückmeldung vor dem PR.
 *  - Auf dem push-auf-main-Event (nach dem Merge) setzt ci.yml die Basis auf den
 *    Vorgänger-Commit (KQ_DIFF_BASE=github.event.before) → der Check misst den
 *    gerade gemergten Slice AUCH auf main nach (#605, zweite Grenze hinter dem
 *    PR-Gate #592; ein roter main-Lauf blockiert nichts, löst aber den Alarm-Job aus).
 *  - Nur wo keine sinnvolle Basis auflösbar ist (flacher Checkout, workflow_dispatch,
 *    origin/main == HEAD) degradiert der Check bewusst zu GRÜN (No-op), statt `main`
 *    rot zu machen — kein falsches Rot.
 *
 * Override mit Pflicht-Begründung (#1269, gleiches Muster wie die check-size-ALLOWLIST,
 * inkl. stale-Meldung): ein bewusst breiter Slice (z.B. ein großer God-File-Split) wird
 * über eine Zeile `KQ-Diffsize-Override: #<nr> <warum>` am Zeilenanfang einer Commit-
 * Message IM SLICE durchgelassen (am besten ein eigener leerer Commit). Gelesen wird
 * `git log <basis>..HEAD` mit derselben Basis wie der Diff. So wirkt derselbe Mechanismus
 * lokal, im PR (der Merge-Checkout enthält die PR-Commits) und auf push:main (der
 * Squash-Commit trägt die Branch-Messages, Repo-Einstellung
 * squash_merge_commit_message = COMMIT_MESSAGES). Eine Env-Variable kam in der PR-CI nie
 * an (lokal grün, CI rot) und wird darum nicht mehr ausgewertet. Ist der Trailer gesetzt,
 * der Diff aber gar nicht über Budget, wird er als STALE gemeldet (rot) — genau wie ein
 * stale check-size-Eintrag.
 *
 * `GEN:`-Abschnitte (#1411): Zeilen ZWISCHEN den Markern eines generierten Abschnitts in den Dateien, die
 * `check:docgen` prüft (`markdown` in scripts/docs-gen/config.json), zählen nicht zum Slice. Sie entstehen
 * maschinell, und `check:docgen` prüft sie gegen das Repo; die Marker-Zeilen selbst und GEN-Blöcke in anderen
 * Dateien zählen weiter. Zeilengenau (`git diff -U0`, Maske der alten und der neuen Fassung); ist etwas nicht
 * eindeutig lesbar (kaputte Marker, git-Fehler, Umbenennung), zählt alles.
 *
 * Reines Node-Skript (nur Builtins). Die Mess-/Bewertungslogik ist als pure,
 * git-freie Funktionen exportiert und wird von test/diffsize.test.ts importiert —
 * EINE Quelle der Wahrheit für Budget, Parsing und Override-Logik.
 *
 * Ausführen mit:  npm run check:diffsize   (oder als Teil von: npm run verify)
 */

import { execFileSync } from "node:child_process";
import { meldeUngueltigeOverrides, sliceOverride, staleOverrideHinweis, versetzteOverrideHinweis } from "./slice-override.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { leseJson, parseSections } from "./docs-gen/markdown.mjs";

/** Budget für EINE Änderung. Kalibriert an echten kubequest-Tickets: die letzten
 *  liegen bei ~5–8 Dateien und bis ~450 geänderten Zeilen (#529: 8 Dateien / 453).
 *  Bewusst mit Kopffreiheit darüber, damit ein normales Ticket NICHT trippt (sonst
 *  Override-Inflation → der Wächter wird ignoriert, siehe #395-Antipattern), aber
 *  ein Epic-als-Riesen-Commit auffällt. 800 Zeilen spiegeln das LOC_BUDGET aus
 *  check-size.mjs: ein Slice soll nicht mehr Zeilen ändern, als eine ganze Datei
 *  groß sein darf. Über Env überschreibbar (KQ_DIFFSIZE_MAX_FILES/-MAX_LINES). */
export const MAX_FILES = 20;
export const MAX_LINES = 800;

/** Generierte, NICHT von Hand geschriebene Artefakte, die aus der Slice-Messung
 *  fallen (#612): Ein Paketmanager-Lockfile ist kein reviewbarer Slice — es wird
 *  MASCHINELL aus package.json erzeugt und Zeile-für-Zeile gar nicht gelesen. Es
 *  mitzuzählen bedeutet, dass JEDE Dependency-Ergänzung (z.B. jscpd/#612 zog ~1100
 *  Lockfile-Zeilen für 90 transitive Pakete) das Budget sprengt und einen Override
 *  erzwingt — genau die Override-Inflation, vor der der Wächter selbst warnt
 *  (#395-Antipattern). Der Budget-Zweck („ein unreviewbarer Epic-Riesen-Commit fällt
 *  auf") zielt auf von Hand geschriebenen Code; das Lockfile-Volumen ist dafür Rauschen.
 *  Der eigentliche Code-Slice einer Dep-Ergänzung bleibt klein und wird weiter gemessen. */
export const GENERATED_ARTIFACTS = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

/** True, wenn `path` ein generiertes Lockfile ist (Basename-Vergleich, damit es
 *  auch in Unterordnern greift). Aus der Slice-Messung ausgenommen (#612). */
export function isGeneratedArtifact(path) {
  const base = String(path).split(/[\\/]/).pop() ?? "";
  return GENERATED_ARTIFACTS.has(base);
}

/** Liest die Schwellen aus der Umgebung (Fallback: die Defaults oben). Eine
 *  nicht-positive/nicht-numerische Angabe wird ignoriert (Default gilt). */
export function readThresholds(env = process.env) {
  const num = (v, def) => {
    const n = Number.parseInt(v ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    maxFiles: num(env.KQ_DIFFSIZE_MAX_FILES, MAX_FILES),
    maxLines: num(env.KQ_DIFFSIZE_MAX_LINES, MAX_LINES),
  };
}

/** Parst die Ausgabe von `git diff --numstat`. Jede Zeile ist
 *  "<added>\t<deleted>\t<pfad>"; bei Binärdateien steht "-" statt der Zahlen
 *  (zählt als geänderte Datei, aber 0 Zeilen). Liefert die geänderten Dateien
 *  sowie die Summen. Pure — kein git, voll testbar. */
export function parseNumstat(text) {
  const files = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === "") continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [a, d, ...rest] = parts;
    const binary = a === "-" || d === "-";
    const added = binary ? 0 : Number.parseInt(a, 10) || 0;
    const deleted = binary ? 0 : Number.parseInt(d, 10) || 0;
    files.push({ path: rest.join("\t"), added, deleted, binary });
  }
  const fileCount = files.length;
  const changedLines = files.reduce((s, f) => s + f.added + f.deleted, 0);
  return { files, fileCount, changedLines };
}

/** Menge der 1-basierten Zeilennummern ZWISCHEN den Markern gültiger `GEN:`-Abschnitte von `text`
 *  (die Marker-Zeilen selbst nicht). Kaputte Marker (Parse-Fehler) → leere Menge: dann zählt alles. Pure. */
export function genKoerperZeilen(text) {
  const { sections, errors } = parseSections(String(text ?? ""));
  const maske = new Set();
  if (errors.length > 0) return maske;
  // 0-basiert liegt der Körper in startLine+1 … endLine-1, 1-basiert in startLine+2 … endLine.
  for (const s of sections) for (let z = s.startLine + 2; z <= s.endLine; z++) maske.add(z);
  return maske;
}

/** True, wenn `pfad` eine Markdown-Datei unter einer der Wurzeln ist, die `check:docgen` prüft (Datei oder Ordner). Pure. */
export function istDocgenDatei(pfad, wurzeln) {
  const p = String(pfad).replaceAll("\\", "/");
  if (!p.endsWith(".md")) return false;
  return wurzeln.some((w) => {
    const r = String(w).replaceAll("\\", "/").replace(/\/+$/, "");
    return r === "." || p === r || p.startsWith(`${r}/`);
  });
}

/**
 * Zählt je Datei die Zeilen eines `git diff -U0`-Patches, die in einem `GEN:`-Abschnitt liegen: entfernte Zeilen
 * gegen die Maske der alten, hinzugefügte gegen die der neuen Fassung. `ladeAlt(pfad)`/`ladeNeu(pfad)` liefern den
 * Dateitext oder null (fehlt → leere Maske, alles zählt). Nur Dateien, für die `prueft(pfad)` gilt. Ergebnis: Map
 * Pfad (neu, bei Löschung alt) → Zahl. Pure. Gelesen werden nur Datei- und Hunk-Köpfe; eine Inhaltszeile beginnt
 * immer mit `+`, `-` oder Leerzeichen, nie mit `diff --git` oder `@@ `.
 */
export function genAnteil(patch, ladeAlt, ladeNeu, prueft) {
  const ergebnis = new Map();
  let alt = null;
  let neu = null;
  let imKopf = false;
  let maskeAlt = null;
  let maskeNeu = null;
  const pfadAus = (zeile, praefix) => {
    const roh = zeile.slice(4).split("\t")[0].trim();
    return roh === "/dev/null" || roh.startsWith('"') ? null : roh.replace(praefix, "");
  };
  for (const zeile of String(patch).split(/\r?\n/)) {
    if (zeile.startsWith("diff --git ")) {
      [imKopf, alt, neu, maskeAlt, maskeNeu] = [true, null, null, null, null];
    } else if (imKopf && zeile.startsWith("--- ")) alt = pfadAus(zeile, /^a\//);
    else if (imKopf && zeile.startsWith("+++ ")) neu = pfadAus(zeile, /^b\//);
    else if (zeile.startsWith("@@ ")) {
      imKopf = false;
      const ziel = neu ?? alt;
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(zeile);
      if (ziel === null || !m || !prueft(ziel)) continue;
      maskeAlt ??= genKoerperZeilen(alt === null ? "" : ladeAlt(alt));
      maskeNeu ??= genKoerperZeilen(neu === null ? "" : ladeNeu(neu));
      const [, a, b, c, d] = m;
      let n = 0;
      for (let i = 0; i < (b === undefined ? 1 : Number(b)); i++) if (maskeAlt.has(Number(a) + i)) n++;
      for (let i = 0; i < (d === undefined ? 1 : Number(d)); i++) if (maskeNeu.has(Number(c) + i)) n++;
      ergebnis.set(ziel, (ergebnis.get(ziel) ?? 0) + n);
    }
  }
  return ergebnis;
}

/** Bewertet Summen gegen das Budget. „Über" heißt STRIKT größer (== Budget ist ok),
 *  analog zu check-size (`loc > budget`). Pure. */
export function evaluate({ fileCount, changedLines }, { maxFiles, maxLines }) {
  const overFiles = fileCount > maxFiles;
  const overLines = changedLines > maxLines;
  return { overFiles, overLines, over: overFiles || overLines };
}

/** Schlüssel des Override-Trailers für dieses Gate (#1269). */
export const OVERRIDE_KEY = "KQ-Diffsize-Override";

/** Löst die Vergleichs-Basis auf (Commit, gegen den der Diff gemessen wird).
 *  Reihenfolge: explizites KQ_DIFF_BASE → Merge-Base gegen origin/main → gegen
 *  main. origin/main ZUERST, weil im pre-push-Hook HEAD == main ist und nur
 *  origin/main (der alte Stand) den zu pushenden Slice sichtbar macht. `runGit`
 *  ist injizierbar (Test); es wirft bei Fehler, wir fangen und gehen weiter.
 *  Rückgabe: Basis-SHA oder null (keine Basis auflösbar → Aufrufer degradiert). */
export function resolveBase(runGit, env = process.env) {
  const tryGit = (args) => {
    try {
      const out = runGit(args).trim();
      return out === "" ? null : out;
    } catch {
      return null;
    }
  };
  const explicit = (env.KQ_DIFF_BASE ?? "").trim();
  if (explicit !== "") {
    const sha = tryGit(["rev-parse", "--verify", "--quiet", `${explicit}^{commit}`]);
    if (sha) return sha;
  }
  return tryGit(["merge-base", "HEAD", "origin/main"]) ?? tryGit(["merge-base", "HEAD", "main"]);
}

const SCRIPTS_ORDNER = dirname(fileURLToPath(import.meta.url));

/** Die Wurzeln, die `check:docgen` liest (`markdown` der docs-gen-Config); nicht lesbar → keine (dann zählt alles). */
function ladeDocgenWurzeln() {
  try {
    const roh = leseJson(join(SCRIPTS_ORDNER, ".."), "scripts/docs-gen/config.json", "docs-gen-Config").markdown;
    return Array.isArray(roh) ? roh.filter((w) => typeof w === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Nimmt aus `files` (numstat-Einträge) die `GEN:`-Zeilen heraus (siehe Kopfkommentar): Zeilen je Datei in
 * `genLines`, eine Datei nur aus GEN-Zeilen fällt ganz weg. Jeder git-Fehler → unverändert (alles zählt).
 */
function ohneGenZeilen(git, base, files, wurzeln) {
  const kandidaten = files.filter((f) => !f.binary && istDocgenDatei(f.path, wurzeln));
  if (kandidaten.length === 0) return { files, genLines: 0 };
  try {
    const mergeBase = (() => {
      try {
        return git(["merge-base", base, "HEAD"]).trim() || base;
      } catch {
        return base;
      }
    })();
    const lade = (ref) => (pfad) => {
      try {
        return git(["show", `${ref}:${pfad}`]);
      } catch {
        return null;
      }
    };
    const patch = git(["diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", `${base}...HEAD`, "--", ...kandidaten.map((f) => f.path)]);
    const anteil = genAnteil(patch, lade(mergeBase), lade("HEAD"), (p) => kandidaten.some((f) => f.path === p));
    let genLines = 0;
    const rest = [];
    for (const f of files) {
      const gen = Math.min(anteil.get(f.path) ?? 0, f.added + f.deleted);
      genLines += gen;
      if (gen > 0 && gen === f.added + f.deleted) continue; // nur GEN-Zeilen: keine zu lesende Änderung
      rest.push(gen > 0 ? { ...f, gen } : f);
    }
    return { files: rest, genLines };
  } catch {
    return { files, genLines: 0 };
  }
}

/** Zeilen einer numstat-Datei, die zum Slice zählen (ohne `GEN:`-Anteil). */
const zaehlZeilen = (f) => f.added + f.deleted - (f.gen ?? 0);

/** Führt die komplette Prüfung aus (Basis auflösen → Diff messen → bewerten →
 *  Override/stale einordnen). `runGit`/`env` injizierbar für den Test. Rückgabe
 *  ist ein strukturiertes Ergebnis; das CLI rendert es nur noch. */
export function checkDiffSize({ runGit, env = process.env, docgenWurzeln } = {}) {
  const git = runGit ?? ((args) => execFileSync("git", args, { encoding: "utf8" }));
  const thresholds = readThresholds(env);
  const base = resolveBase(git, env);

  // Keine Basis (flacher Checkout / origin/main == HEAD) → bewusst No-op-grün. Hier gibt es kein
  // Stale-Urteil über einen Override-Trailer: ohne Slice ist nicht entscheidbar, ob er gebraucht wird
  // (anders als check:diffcoverage, das bei „nichts zu messen" sicher weiß, dass nichts zu durchlassen ist).
  if (!base) {
    return { skipped: true, base: null, ...thresholds, fileCount: 0, changedLines: 0 };
  }
  const headSha = (() => {
    try {
      return git(["rev-parse", "HEAD"]).trim();
    } catch {
      return null;
    }
  })();
  // Basis == HEAD → leerer Diff, ebenfalls No-op-grün.
  if (headSha && base === headSha) {
    return { skipped: true, base, ...thresholds, fileCount: 0, changedLines: 0 };
  }

  let numstat;
  try {
    // Drei-Punkt wie check:diffcoverage: misst gegen die Merge-Base, nie gegen eine Basis, die
    // main inzwischen überholt hat. Die PR-CI setzt KQ_DIFF_BASE auf den ersten Elternteil des
    // Merge-Checkouts (ci.yml „Diff-Basis bestimmen“), nicht auf die veraltete `base.sha` (#1240).
    numstat = git(["diff", "--numstat", `${base}...HEAD`]);
  } catch {
    // Diff nicht messbar → nicht rot machen, degradieren.
    return { skipped: true, base, ...thresholds, fileCount: 0, changedLines: 0 };
  }

  const parsed = parseNumstat(numstat);
  // Generierte Lockfiles zählen nicht zum reviewbaren Slice (#612).
  const lockfileFrei = parsed.files.filter((f) => !isGeneratedArtifact(f.path));
  const excludedCount = parsed.fileCount - lockfileFrei.length;
  // Zeilen in `GEN:`-Abschnitten zählen nicht (#1411): check:docgen prüft sie; nur Dateien, die er liest.
  const { files, genLines } = ohneGenZeilen(git, base, lockfileFrei, docgenWurzeln ?? ladeDocgenWurzeln());
  const fileCount = files.length;
  const changedLines = files.reduce((s, f) => s + zaehlZeilen(f), 0);
  const { overFiles, overLines, over } = evaluate({ fileCount, changedLines }, thresholds);
  const { reason, invalid, versetzt } = sliceOverride(git, base, OVERRIDE_KEY);

  return {
    skipped: false,
    base,
    ...thresholds,
    files,
    fileCount,
    changedLines,
    excludedCount,
    genLines,
    overFiles,
    overLines,
    over,
    reason,
    allowed: over && reason !== null, // bewusst durchgelassen
    stale: !over && reason !== null, // Override unnötig → melden
    invalidOverrides: invalid,
    versetzteOverrides: versetzt,
    legacyEnv: (env.KQ_DIFFSIZE_OVERRIDE ?? "").trim() !== "", // alte Env: nur noch Hinweis
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);
  const dim = (s) => paint("2", s);

  const r = checkDiffSize();

  if (r.skipped) {
    console.log(
      dim(
        `• check:diffsize übersprungen — keine Vergleichs-Basis gegen main (flacher Checkout / ` +
          `nichts gegenüber main). Kein Slice zu messen.`,
      ),
    );
    return;
  }

  const budget = `Budget ${r.maxFiles} Dateien / ${r.maxLines} Zeilen`;
  const measured = `${r.fileCount} Dateien, ${r.changedLines} geänderte Zeilen`;

  if (r.excludedCount > 0) {
    console.log(dim(`• ${r.excludedCount} generierte(s) Lockfile(s) nicht mitgezählt (#612).`));
  }
  if (r.genLines > 0) {
    console.log(dim(`• ${r.genLines} Zeilen in GEN:-Abschnitten nicht mitgezählt (check:docgen prüft sie).`));
  }

  if (r.legacyEnv) {
    console.log(
      dim(`• KQ_DIFFSIZE_OVERRIDE wird nicht mehr ausgewertet (kam in der PR-CI nie an) — Commit-Trailer nutzen, s.u.`),
    );
  }
  meldeUngueltigeOverrides(r.invalidOverrides, { dim });

  if (r.stale) {
    console.error(red(staleOverrideHinweis(OVERRIDE_KEY, `der Diff liegt im Budget (${measured} ≤ ${budget})`)));
    process.exit(1);
  }

  if (r.allowed) {
    console.log(
      dim(
        `• geduldet: Diff über Budget (${measured} > ${budget}) — bewusst durchgelassen: ${r.reason}`,
      ),
    );
    console.log(green(`✔ check:diffsize ok (Override mit Begründung).`));
    return;
  }

  if (r.over) {
    const parts = [];
    if (r.overFiles) parts.push(`${r.fileCount} Dateien > ${r.maxFiles}`);
    if (r.overLines) parts.push(`${r.changedLines} Zeilen > ${r.maxLines}`);
    console.error(red(`✖ Diff-Budget überschritten (${parts.join(", ")}).`));
    for (const h of versetzteOverrideHinweis(OVERRIDE_KEY, r.versetzteOverrides)) console.error(h);
    console.error(
      `\nDieser Slice ist zu breit für ein reviewbares Ticket. Aufteilen (ein Epic → session-große\n` +
        `Kinder, siehe AGENTS.md) — ODER, wenn die Breite bewusst und begründet ist (z.B. ein großer\n` +
        `God-File-Split), mit Pflicht-Begründung als Commit-Trailer im Slice durchlassen\n` +
        `(wirkt lokal, im PR und auf main gleich):\n` +
        `  git commit --allow-empty -m "chore: Slice bewusst breit (#<nr>)" -m "${OVERRIDE_KEY}: #<nr> warum"`,
    );
    process.exit(1);
  }

  console.log(green(`✔ check:diffsize ok — ${measured} ≤ ${budget}.`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
