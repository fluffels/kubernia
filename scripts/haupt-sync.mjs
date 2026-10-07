// Kein Shebang: wird als SessionStart-Hook gestartet UND von test/harness/haupt-sync.test.ts importiert.
/**
 * Haupt-Checkout aktuell halten (#1349): Tickets laufen in Worktrees von `origin/main`, der Haupt-Checkout (`main`) wird
 * dadurch nie aktualisiert. Eine Session dort las Agenten-Definitionen und Doku vom Vorabend (Beleg #1304: 15 Commits
 * Rückstand, der Planer lief mit veralteter Definition). Dieser `SessionStart`-Hook holt `origin/main` und hebt `main`
 * per `git merge --ff-only`, aber nur, wenn das gefahrlos geht:
 *
 *   - nur im Haupt-Checkout (ein Linked Worktree bleibt unberührt),
 *   - nur auf dem Branch `main`,
 *   - nur bei sauberem Arbeitsbaum (getrackte Änderungen; untracked stört ein Fast-Forward nicht),
 *   - nur fast-forward (hat `main` lokale Commits, wird nicht angefasst).
 *
 * Sonst bleibt alles liegen, und der Hook meldet „N Commits hinter origin/main“ samt Grund in den Kontext der Session.
 * Er gibt IMMER `Sitzungsbasis: <HEAD vor dem Pull>` aus: der Skill `kubernia` prüft damit vor dem Spawn, ob sich
 * Agenten-Definitionen seit dem Start der Session geändert haben (der Hook-/Definitions-Snapshot wird beim Start
 * eingefroren, ein Pull ändert die laufende Session nicht). Hat der Pull `.claude/` oder `AGENTS.md` geändert, sagt er das
 * zusätzlich ausdrücklich. Fail-open: jeder Fehler (kein Netz, kein git) ergibt nur eine kurze Notiz, nie einen Abbruch.
 *
 * Hook-Ausgabe: `hookSpecificOutput.additionalContext` (SessionStart). Wächter: test/harness/haupt-sync.test.ts.
 * Nur Node-Builtins.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { istDirektaufruf } from "./hook-io.mjs";

/**
 * Was tut der Sync? Pur. `hinter`/`vor` = Commits, die `main` gegenüber `origin/main` hinten/vorn liegt.
 * Liefert `{ aktion: "pull" | "melden" | "nichts", grund }`.
 */
export function entscheideSync({ istLinkedWorktree, branch, sauber, hinter, vor }) {
  if (istLinkedWorktree) return { aktion: "nichts", grund: "Linked Worktree (läuft von origin/main, wird nicht angefasst)" };
  if (!Number.isInteger(hinter) || hinter < 0 || !Number.isInteger(vor) || vor < 0) {
    return { aktion: "nichts", grund: "Rückstand nicht bestimmbar" };
  }
  if (hinter === 0) return { aktion: "nichts", grund: "aktuell" };
  if (branch !== "main") return { aktion: "melden", grund: `Branch ${branch}, nicht main (nicht angefasst)` };
  if (!sauber) return { aktion: "melden", grund: "Arbeitsbaum nicht sauber (nicht angefasst)" };
  if (vor > 0) return { aktion: "melden", grund: `main hat ${vor} lokale Commits, kein Fast-Forward (nicht angefasst)` };
  return { aktion: "pull", grund: "main ist sauber und nur zurück: Fast-Forward" };
}

/** True, wenn unter den geänderten Dateien Agenten-Definitionen, Hooks, Skills oder AGENTS.md sind (die Session kennt sie nur im Startstand). Pur. */
export const agentenGeaendert = (dateien) => dateien.some((d) => /^\.claude\//.test(d) || /(^|\/)AGENTS\.md$/.test(d));

/** Der Kontext-Text der Session. Pur. `ergebnis` = `{ aktion, grund, hinter, basis, gepullt, agentenGeaendert, notiz }`. */
export function baueText(ergebnis) {
  const zeilen = [];
  if (ergebnis.notiz) zeilen.push(`Haupt-Sync: ${ergebnis.notiz}`);
  if (ergebnis.aktion === "melden") zeilen.push(`Haupt-Checkout: ${ergebnis.hinter} Commits hinter origin/main (${ergebnis.grund}).`);
  if (ergebnis.gepullt) {
    zeilen.push(`Haupt-Checkout: main per Fast-Forward um ${ergebnis.hinter} Commits auf origin/main gehoben.`);
    if (ergebnis.agentenGeaendert) {
      zeilen.push("Hooks, Agenten, Skills und AGENTS.md dieser Session stammen vom alten Stand (der Snapshot wird beim Start eingefroren): für den neuen Stand die Session neu starten.");
    }
  }
  if (ergebnis.basis) zeilen.push(`Sitzungsbasis: ${ergebnis.basis}`);
  return zeilen.join("\n");
}

const git = (dir, args, opts = {}) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: opts.timeout ?? 10_000 }).trim();

/** Die ganze Ablaufkette gegen ein echtes Repo in `dir` (nur CLI). Wirft nie; Fehler landen in `notiz`. */
export function fuehreSyncAus(dir) {
  const ergebnis = { aktion: "nichts", grund: "", hinter: 0, basis: "", gepullt: false, agentenGeaendert: false, notiz: "" };
  try {
    ergebnis.basis = git(dir, ["rev-parse", "HEAD"]);
    const istLinkedWorktree = resolve(dir, git(dir, ["rev-parse", "--git-dir"])) !== resolve(dir, git(dir, ["rev-parse", "--git-common-dir"]));
    if (istLinkedWorktree) return { ...ergebnis, ...entscheideSync({ istLinkedWorktree, branch: "", sauber: false, hinter: 0, vor: 0 }) };
    try {
      git(dir, ["fetch", "origin"], { timeout: 20_000 });
    } catch (e) {
      ergebnis.notiz = `git fetch fehlgeschlagen (${String(e.message).split("\n")[0].slice(0, 100)}), Rückstand aus dem letzten bekannten Stand`;
    }
    const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const [vor, hinter] = git(dir, ["rev-list", "--left-right", "--count", "HEAD...origin/main"]).split(/\s+/).map(Number);
    const sauber = git(dir, ["status", "--porcelain", "--untracked-files=no"]) === "";
    const e = entscheideSync({ istLinkedWorktree, branch, sauber, hinter, vor });
    Object.assign(ergebnis, e, { hinter });
    if (e.aktion === "pull") {
      git(dir, ["merge", "--ff-only", "origin/main"], { timeout: 30_000 });
      ergebnis.gepullt = true;
      ergebnis.agentenGeaendert = agentenGeaendert(git(dir, ["diff", "--name-only", ergebnis.basis, "HEAD"]).split("\n").filter(Boolean));
    }
  } catch (e) {
    ergebnis.notiz = `${ergebnis.notiz ? `${ergebnis.notiz}; ` : ""}Fehler (${String(e.message).split("\n")[0].slice(0, 100)}), nichts verändert`;
  }
  return ergebnis;
}

function main() {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const text = baueText(fuehreSyncAus(dir));
  if (!text) return;
  if (process.argv.includes("--text")) console.log(text);
  else console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
}

if (istDirektaufruf(import.meta.url)) main();
