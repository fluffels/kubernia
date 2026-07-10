// Kein Shebang: wird über `.claude/settings.json` per `node scripts/worktree-guard-hook.mjs`
// gestartet UND von test/worktree-guard.test.ts importiert (ein `#!` bricht den
// Test-Import, analog zu check-diffsize.mjs).
/**
 * Worktree-Guard-Hook (#735) — Claude-Code-`PreToolUse`-Hook für `Bash`.
 *
 * Hintergrund: AGENTS.md verlangt "IMMER im eigenen `git worktree` arbeiten, nie im
 * main-Checkout committen/pushen" — bisher nur eine BITTE an den Agenten. Real
 * vorgekommen: eine parallele Sitzung committete 2026-07-07 eigenständig
 * uncommittete Änderungen im geteilten main-Checkout, weil zwei Sessions denselben
 * Checkout nutzten (siehe #735). Dieser Hook macht daraus eine kleine, technische
 * Mauer: `git commit`/`git push`, dessen cwd der GETEILTE Haupt-Checkout dieses
 * Repos ist (nicht ein Linked Worktree), wird über `PreToolUse` geblockt.
 *
 * Bewusste Grenzen (siehe #735-Diskussion + docs/agent-harness-faq.md „Warum prüft
 * die Mauer erst im PR-Gate"):
 *  - Ersetzt NICHT den PR-Gate (#592) — der bleibt die eigentliche Durchsetzung für
 *    Code-Qualität. Dieser Hook fängt nur die EINE irreversible Fehlaktion
 *    "Commit/Push vom falschen Ort", analog zum dokumentierten "block rm -rf"-Muster.
 *  - Erkennt den Haupt- vs. Linked-Worktree-Unterschied über gits eigene Konvention:
 *    am Toplevel eines Linked Worktree ist `.git` eine DATEI ("gitdir: …"), im
 *    Haupt-Checkout ein VERZEICHNIS — robuster als eine Pfad-Namenskonvention wie
 *    ".claude/worktrees/*" zu erraten.
 *  - Scoped auf DIESES Repo: `git-common-dir` des cwd wird gegen das eigene `.git`
 *    verglichen (aus dem Skript-Pfad abgeleitet) — ein Bash-Aufruf gegen ein
 *    komplett anderes Repo im selben Claude-Code-Workspace wird nie angefasst.
 *  - Grobe Kommando-Erkennung (Segment-Split auf `&&`/`||`/`;`/Zeilenumbruch, dann
 *    Wortgrenzen-Suche nach "git" + "commit"/"push" im selben Segment) statt vollem
 *    Shell-Parsing — bewusst einfach gehalten (siehe Tests für dokumentierte
 *    Grenzfälle), kann in seltenen Fällen ein rein lesendes Kommando wie
 *    `git log --grep=push` mit-treffen (false positive, nur Reibung) — nie
 *    umgekehrt ein echtes commit/push mit `-C`/Flags übersehen (false negative
 *    wäre hier die schlimmere Richtung, siehe Tests).
 *  - Fail-open bei Unsicherheit (kein cwd im Payload, cwd ist gar kein Git-Repo,
 *    cwd gehört zu einem anderen Repo): NICHT blocken — dieselbe "kein falsches
 *    Rot"-Philosophie wie check-diffsize.mjs bei fehlender Vergleichsbasis.
 *  - Verteilung: `.claude/settings.json` ist bewusst NICHT gitignored (Ausnahme wie
 *    `.claude/skills/`) — als getrackte Datei liegt sie automatisch in jedem
 *    frischen Checkout/Worktree, ohne eigenen `npm run setup`-Verteilschritt.
 *  - Offen/nicht abschließend verifiziert: ob Claude Code `.claude/settings.json`
 *    zuverlässig auflöst, wenn die Session-Root ein ELTERN-Verzeichnis dieses Repos
 *    ist (verschachtelter Checkout), war zum Zeitpunkt der Umsetzung nicht
 *    empirisch prüfbar (siehe PR-Beschreibung zu #735) — einmal in echter Session
 *    gegenprüfen.
 *
 * Reines Node-Skript (nur Builtins). Die Entscheidungslogik ist pure/exportiert
 * und testbar (execFile/stat injizierbar) — EINE Quelle für Hook-CLI und Test.
 */

import { execFileSync } from "node:child_process";
import { statSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Normalisiert einen Pfad für den Vergleich: Backslashes -> Slashes, unter
 *  Windows zusätzlich klein geschrieben (case-insensitives Dateisystem); Linux
 *  bleibt case-sensitive. */
function normalizePath(p) {
  const slashed = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? slashed.toLowerCase() : slashed;
}

/** True, wenn `command` (irgendwo, nach Aufteilen auf `&&`/`||`/`;`/Zeilenumbruch)
 *  ein Segment enthält, das sowohl "git" als auch "commit"/"push" als eigenes
 *  Wort trägt. Pure, kein Shell-Parsing (Grenzfälle: siehe Datei-Kopf-Kommentar). */
export function isProtectedGitCommand(command) {
  if (!command) return false;
  const segments = String(command).split(/&&|\|\||;|\n/);
  return segments.some((seg) => /\bgit\b/.test(seg) && /\b(commit|push)\b/.test(seg));
}

/** Ermittelt, ob `cwd` zu DEMSELBEN Repo gehört wie `repoRoot` (Vergleich über
 *  `git-common-dir`, NICHT über `<repoRoot>/.git` als Pfad-Konstruktion — das
 *  Skript liegt selbst in `scripts/`, aber `repoRoot` kann je nach Checkout ein
 *  Linked Worktree sein, dessen `.git` nur eine Datei ist, kein Verzeichnis. Der
 *  `git-common-dir` von `repoRoot` selbst ist deshalb die verlässliche Referenz,
 *  nicht `resolve(repoRoot, ".git")`) und ob es der Haupt-Checkout oder ein
 *  Linked Worktree ist (`.git` als Verzeichnis vs. Datei am Toplevel). Wirft nie —
 *  bei jedem git-/fs-Fehler (kein Repo, Pfad existiert nicht, …) `{ relevant:
 *  false }`. `deps` injizierbar fürs Testen (execFileSync/statSync). */
export function resolveGitContext(cwd, repoRoot, deps = {}) {
  const exec = deps.execFileSync ?? execFileSync;
  const stat = deps.statSync ?? statSync;

  const run = (dir, args) => {
    try {
      return exec("git", args, { cwd: dir, encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };

  // Referenz: der git-common-dir DIESES Skript-Checkouts (egal ob Haupt-Checkout
  // oder selbst ein Linked Worktree) — zeigt in beiden Fällen korrekt auf das
  // eine geteilte `.git` des Repos.
  const referenceCommonDirRaw = run(repoRoot, ["rev-parse", "--git-common-dir"]);
  if (!referenceCommonDirRaw) return { relevant: false };
  const referenceCommonDir = resolve(repoRoot, referenceCommonDirRaw);

  const toplevel = run(cwd, ["rev-parse", "--show-toplevel"]);
  if (!toplevel) return { relevant: false };

  const commonDirRaw = run(cwd, ["rev-parse", "--git-common-dir"]);
  if (!commonDirRaw) return { relevant: false };
  const commonDir = resolve(toplevel, commonDirRaw);

  if (normalizePath(commonDir) !== normalizePath(referenceCommonDir)) {
    return { relevant: false }; // cwd gehört zu einem anderen Repo — nicht unsere Sache
  }

  let isMainWorktree;
  try {
    isMainWorktree = stat(join(toplevel, ".git")).isDirectory();
  } catch {
    isMainWorktree = true; // .git nicht lesbar -> im Zweifel konservativ blocken
  }

  return { relevant: true, toplevel, isMainWorktree };
}

/** Gesamtentscheidung: block=true nur, wenn (a) das Kommando wirklich commit/push
 *  ist, (b) cwd bekannt ist, (c) cwd zu diesem Repo gehört UND (d) es der
 *  Haupt-Checkout ist (kein Linked Worktree). Alles andere: durchlassen. */
export function decide({ cwd, command, repoRoot, deps }) {
  if (!isProtectedGitCommand(command)) return { block: false };
  if (!cwd) return { block: false }; // kein cwd im Payload -> nicht entscheidbar, fail-open

  const ctx = resolveGitContext(cwd, repoRoot, deps);
  if (!ctx.relevant || !ctx.isMainWorktree) return { block: false };

  return {
    block: true,
    reason:
      `git commit/push ist im geteilten main-Checkout (${ctx.toplevel}) blockiert. ` +
      `Bitte in einem eigenen \`git worktree\` arbeiten (siehe AGENTS.md § Git-Workflow) ` +
      `— z.B. \`git worktree add .claude/worktrees/kq-<nr> -b feature/kq-<nr>-<slug>\`. (#735)`,
  };
}

/** Parst das Hook-stdin-JSON tolerant: liefert bei kaputtem/leerem Input `{}`
 *  statt zu werfen (der Hook soll NIE selbst crashen und damit versehentlich
 *  jeden Bash-Aufruf blockieren). */
export function parseHookInput(text) {
  try {
    const data = JSON.parse(text);
    return { cwd: data.cwd, command: data.tool_input?.command };
  } catch {
    return {};
  }
}

/** Baut die dokumentierte `hookSpecificOutput`-JSON für ein `PreToolUse`-Deny. */
export function buildDenyOutput(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/** Repo-Root aus dem Skript-Pfad ableiten (`scripts/worktree-guard-hook.mjs` liegt
 *  eine Ebene unter dem Root) — portabel, kein hartcodierter absoluter Pfad. */
function repoRootFromScriptUrl(importMetaUrl) {
  return dirname(dirname(fileURLToPath(importMetaUrl)));
}

// ── CLI (vom PreToolUse-Hook aufgerufen) ────────────────────────────────────
function main() {
  let stdinText;
  try {
    stdinText = readFileSync(0, "utf8");
  } catch {
    stdinText = "";
  }

  const { cwd, command } = parseHookInput(stdinText);
  const repoRoot = repoRootFromScriptUrl(import.meta.url);
  const result = decide({ cwd, command, repoRoot });

  if (result.block) {
    console.log(JSON.stringify(buildDenyOutput(result.reason)));
  }
  // Bewusst KEIN process.exit(0) hier: auf Windows kann ein Pipe-stdout asynchron
  // sein, ein sofortiges exit() nach console.log() hat die Ausgabe abgeschnitten
  // (empirisch beobachtet). Natürliches Skript-Ende flusht zuverlässig und
  // beendet mit Exit-Code 0 (Default bei erfolgreichem Durchlauf ohne Fehler).
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
