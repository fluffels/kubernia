// Kein Shebang: dieses Skript wird über `node scripts/check-diffsize.mjs`
// (npm run check:diffsize) gestartet UND von test/diffsize.test.ts importiert. Eine
// `#!`-Zeile bricht genau diesen Test-Import (Vitest/esbuild stolpert über das `#!`),
// darum bewusst weggelassen — analog zu check-size.mjs / check-docdrift.mjs.
/**
 * Diff-Größenbudget-Wächter (#533) — Frühwarnung gegen zu breite Änderungen.
 *
 * Hintergrund (Quelle: WPS `roads/ki-fabrik`-Pipeline): eine KI-Fabrik plant Code
 * in **Commit-Slices mit hartem Größenbudget** und prüft das programmatisch,
 * LLM-frei. kubequest hat das Budget bisher nur auf DATEI-Ebene (check-size.mjs,
 * 800 LOC je Modul), aber KEIN Budget für die Größe EINER Änderung/eines Tickets.
 * Ein Epic, das eigentlich in session-große Kinder gehört (siehe AGENTS.md), kann
 * so als ein Riesen-Commit durchrutschen und wird unreviewbar.
 *
 * Dieser Wächter misst den Diff des aktuellen Standes gegen `main` und wird ROT,
 * wenn er ein Budget an geänderten Dateien ODER Zeilen überschreitet.
 *
 * WO er beißt (bewusst asymmetrisch, passend zum Direct-Push-auf-main-Workflow):
 *  - Auf einem Feature-Branch bzw. im pre-push-Hook (#528) VOR dem Push auf `main`
 *    liegt die volle Historie vor → die Vergleichs-Basis (Merge-Base gegen
 *    origin/main) ist auflösbar → der Slice wird gemessen und ein zu breiter Push
 *    lokal abgebrochen. Das ist der eigentliche Durchsetzungspunkt.
 *  - In flachen CI-Checkouts (fetch-depth 1) bzw. wenn origin/main == HEAD (auf
 *    `main` nach dem Push) ist keine sinnvolle Basis da → der Check degradiert
 *    bewusst zu GRÜN (No-op), statt `main` rot zu machen. Kein falsches Rot.
 *
 * Override mit Pflicht-Begründung (gleiches Muster wie die check-size-ALLOWLIST,
 * inkl. stale-Meldung): ein bewusst breiter Slice (z.B. ein großer God-File-Split)
 * darf über `KQ_DIFFSIZE_OVERRIDE="<Begründung>"` durchgelassen werden. Ist das
 * Override gesetzt, der Diff aber gar nicht über Budget, wird das Override als
 * STALE gemeldet (rot) — genau wie ein stale check-size-Eintrag.
 *
 * Reines Node-Skript (nur Builtins). Die Mess-/Bewertungslogik ist als pure,
 * git-freie Funktionen exportiert und wird von test/diffsize.test.ts importiert —
 * EINE Quelle der Wahrheit für Budget, Parsing und Override-Logik.
 *
 * Ausführen mit:  npm run check:diffsize   (oder als Teil von: npm run verify)
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Budget für EINE Änderung. Kalibriert an echten kubequest-Tickets: die letzten
 *  liegen bei ~5–8 Dateien und bis ~450 geänderten Zeilen (#529: 8 Dateien / 453).
 *  Bewusst mit Kopffreiheit darüber, damit ein normales Ticket NICHT trippt (sonst
 *  Override-Inflation → der Wächter wird ignoriert, siehe #395-Antipattern), aber
 *  ein Epic-als-Riesen-Commit auffällt. 800 Zeilen spiegeln das LOC_BUDGET aus
 *  check-size.mjs: ein Slice soll nicht mehr Zeilen ändern, als eine ganze Datei
 *  groß sein darf. Über Env überschreibbar (KQ_DIFFSIZE_MAX_FILES/-MAX_LINES). */
export const MAX_FILES = 20;
export const MAX_LINES = 800;

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

/** Bewertet Summen gegen das Budget. „Über" heißt STRIKT größer (== Budget ist ok),
 *  analog zu check-size (`loc > budget`). Pure. */
export function evaluate({ fileCount, changedLines }, { maxFiles, maxLines }) {
  const overFiles = fileCount > maxFiles;
  const overLines = changedLines > maxLines;
  return { overFiles, overLines, over: overFiles || overLines };
}

/** Eine Override-Begründung zählt nur, wenn sie nicht leer/whitespace ist —
 *  so lässt sich ein zu breiter Slice NICHT ohne echte Begründung stillstellen
 *  (Pflicht-Begründung). Gibt die getrimmte Begründung oder null zurück. */
export function overrideReason(env = process.env) {
  const r = (env.KQ_DIFFSIZE_OVERRIDE ?? "").trim();
  return r === "" ? null : r;
}

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

/** Führt die komplette Prüfung aus (Basis auflösen → Diff messen → bewerten →
 *  Override/stale einordnen). `runGit`/`env` injizierbar für den Test. Rückgabe
 *  ist ein strukturiertes Ergebnis; das CLI rendert es nur noch. */
export function checkDiffSize({ runGit, env = process.env } = {}) {
  const git = runGit ?? ((args) => execFileSync("git", args, { encoding: "utf8" }));
  const thresholds = readThresholds(env);
  const base = resolveBase(git, env);

  // Keine Basis (flacher Checkout / origin/main == HEAD) → bewusst No-op-grün.
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
    numstat = git(["diff", "--numstat", base, "HEAD"]);
  } catch {
    // Diff nicht messbar → nicht rot machen, degradieren.
    return { skipped: true, base, ...thresholds, fileCount: 0, changedLines: 0 };
  }

  const { files, fileCount, changedLines } = parseNumstat(numstat);
  const { overFiles, overLines, over } = evaluate({ fileCount, changedLines }, thresholds);
  const reason = overrideReason(env);

  return {
    skipped: false,
    base,
    ...thresholds,
    files,
    fileCount,
    changedLines,
    overFiles,
    overLines,
    over,
    reason,
    allowed: over && reason !== null, // bewusst durchgelassen
    stale: !over && reason !== null, // Override unnötig → melden
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

  if (r.stale) {
    console.error(
      red(
        `✖ KQ_DIFFSIZE_OVERRIDE ist gesetzt, aber der Diff liegt im Budget (${measured} ≤ ${budget}).\n` +
          `  Das Override ist stale — entfernen (KQ_DIFFSIZE_OVERRIDE leeren).`,
      ),
    );
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
    console.error(
      `\nDieser Slice ist zu breit für ein reviewbares Ticket. Aufteilen (ein Epic → session-große\n` +
        `Kinder, siehe AGENTS.md) — ODER, wenn die Breite bewusst und begründet ist (z.B. ein großer\n` +
        `God-File-Split), mit Pflicht-Begründung durchlassen:\n` +
        `  KQ_DIFFSIZE_OVERRIDE="#<nr> warum bewusst breit" npm run check:diffsize`,
    );
    process.exit(1);
  }

  console.log(green(`✔ check:diffsize ok — ${measured} ≤ ${budget}.`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
