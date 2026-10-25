// Kein Shebang: wird als agent-skopierter PreToolUse-Hook gestartet UND von test/harness/holdout-guard.test.ts importiert.
/**
 * Holdout-Pfad-Guard (ADR 0022 F13): zwei Frontmatter-Hooks der Holdout-Agenten (Auftrags-Guard des Dispatchers: `holdout-auftrag-guard.mjs`).
 *
 *  - `bewerteAbnahmeWrite` (Hook von `holdout-abnahme`, Matcher `Write`): geschrieben wird nur unter dem Temp-Verzeichnis.
 *  - `bewerteSzenarioLesen` (Hook von `holdout-szenario`, Matcher `Read|Grep|Glob`): gelesen wird nur unter `<root>/docs/` und `<root>/README.md`;
 *    Grep/Glob brauchen einen `path` dort, ein Glob-Muster mit `..` oder absolutem Pfad wird abgelehnt.
 * Aufruf als Skript: `node holdout-guard.mjs abnahme-write` bzw. `szenario-lesen` (Hook-stdin → deny-Output oder nichts). Kaputte Eingabe lässt durch.
 *
 * Bewusste Grenzen:
 *   - Schreiben über Bash/PowerShell fängt der Hook nicht; das Netz ist die Worktree-Probe in `abnahme.mjs` (Exit 1 „Worktree verändert“).
 *   - `os.tmpdir()` erlaubt das ganze Temp-Verzeichnis, nicht nur das Scratchpad des Laufs.
 *   - Pfade werden lexikalisch geprüft (kein Symlink-/Junction-Auflösen).
 *
 * Reines Node-Skript (nur Builtins und hook-io.mjs), pure Funktionen, keine I/O beim Import.
 */
import { tmpdir } from "node:os";
import { ABNAHME_EMPFAENGER } from "./holdout-auftrag-guard.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { emit, liegtUnter, normalisierePfad, readStdin, toolGuardHook } from "./hook-io.mjs";

const istAbsolut = (p) => /^([a-z]:)?\//i.test(p);

/** Darf der Abnahme-Agent hier per `Write` schreiben? Nur unter dem Temp-Verzeichnis. Pure (`deps.tmp` für Tests). */
export function bewerteAbnahmeWrite(filePath, cwd = "", deps = {}) {
  if (typeof filePath !== "string" || filePath.trim() === "") return { block: true, reason: "Abnahme-Write ohne Dateipfad: nicht prüfbar, darum abgelehnt." };
  const tmp = normalisierePfad(deps.tmp ?? tmpdir(), "");
  const norm = normalisierePfad(filePath, cwd);
  if (liegtUnter(norm, tmp)) return { block: false };
  return {
    block: true,
    reason: `${ABNAHME_EMPFAENGER} schreibt nichts im Repo oder Worktree: Write gilt nur im Scratchpad unter dem Temp-Verzeichnis (${tmp}). Probe-Skripte und Ausgaben dort ablegen.`,
  };
}

const lesenGrund = (was) =>
  `holdout-szenario liest nur Begriffe nach: erlaubt sind Dateien unter docs/ und README.md (${was}). Kein Code, kein Plan, kein Diff (ADR 0022 F13).`;

/** Darf der Szenario-Agent das lesen? Nur unter `<root>/docs/` und `<root>/README.md`. Read prüft `file_path`, Grep/Glob `path`. Pure (`deps.root`). */
export function bewerteSzenarioLesen(toolName, toolInput, cwd = "", deps = {}) {
  const eingabe = toolInput ?? {};
  const root = normalisierePfad(deps.root ?? cwd, "");
  const ziel = toolName === "Read" ? eingabe.file_path : eingabe.path;
  if (typeof ziel !== "string" || ziel.trim() === "") {
    return { block: true, reason: lesenGrund(toolName === "Read" ? "file_path fehlt" : "path fehlt: Grep und Glob brauchen einen Pfad unter docs/") };
  }
  if (toolName === "Glob") {
    const muster = String(eingabe.pattern ?? "").replace(/\\/g, "/");
    if (muster.split("/").includes("..") || istAbsolut(muster)) return { block: true, reason: lesenGrund("das Glob-Muster darf weder „..“ noch einen absoluten Pfad tragen") };
  }
  const norm = normalisierePfad(ziel, root);
  if (liegtUnter(norm, `${root}/docs`) || liegtUnter(norm, `${root}/README.md`)) return { block: false };
  return { block: true, reason: lesenGrund(`${ziel} liegt außerhalb`) };
}

/** Hook-stdin → Entscheidung für die zwei Frontmatter-Hooks. Kaputter Input: durchlassen. Der Abnahme-Hook prüft auch ohne `tool_name`. */
export function entscheideHook(modus, text, deps = {}) {
  if (modus === "abnahme-write") return toolGuardHook(["Write"], (_tool, eingabe, cwd) => bewerteAbnahmeWrite(eingabe?.file_path, cwd, deps), true)(text);
  if (modus === "szenario-lesen") return toolGuardHook(["Read", "Grep", "Glob"], (tool, eingabe, cwd) => bewerteSzenarioLesen(tool, eingabe, cwd, deps))(text);
  return null;
}

if (istDirektaufruf(import.meta.url)) emit(entscheideHook(process.argv[2], readStdin(), { root: process.env.CLAUDE_PROJECT_DIR }));
