// Kein Shebang: wird als agent-skopierter PreToolUse-Hook gestartet UND von test/harness/lens-edit-guard.test.ts importiert.
/**
 * Lens-Sabotage-Guard (#1349): die Lens (`agenten.lens` der Projekt-Config) hat das Tool `Edit`, ausschließlich für die Sabotage-Probe der Test-Lens
 * (Implementierung testweise verfälschen, Test wird rot?). Die Probe gehört in einen eigenen Lens-Worktree
 * (`.claude/worktrees/<worktree-präfix><nr>-lens-r<runde>`, bei der Merge-Delta-Lens `…-lens-m<n>`, bei der Delta-Lens nach einem Abnahme-Fix `…-lens-a<n>`; für einen fremden Klon: `git -C <klon> worktree add <klon>/.claude/worktrees/<präfix><nr>-lens-r<n>`, das Präfix liest der Guard aus `<klon>/.factory/projekt.json`, ohne lesbare Config gilt das der Session); ein Edit im Feature-Worktree verfälscht die Basis der parallel lesenden
 * anderen Lenses (so passiert im Review von #1331). Die Regel stand bisher nur als Text in der Lens-Definition.
 *
 * Dieser Hook (Frontmatter der Lens-Definition unter `.claude/agents/`, Matcher `Edit`, gilt nur für diesen Subagenten) erzwingt sie:
 * `Edit` ist erlaubt, wenn der aufgelöste Zielpfad in einem Lens-Worktree liegt, sonst `deny`. Ein fehlender Pfad ist `deny`.
 *
 * Bewusste Grenzen:
 *   - Außerhalb von `.claude/worktrees/` (auch ein Klon selbst) erlaubt der Guard nie.
 *   - Bash/PowerShell (`sed -i`, `Set-Content`) fängt er nicht ab; die Lens-Definition verbietet es per Text, der
 *     Frische-Guard der Folge-Runde und `git status --porcelain` im Feature-Worktree machen eine Änderung sichtbar.
 *   - Ein Pfad per Symlink/Junction in einen Lens-Worktree wird nicht aufgelöst (lexikalische Prüfung); jeder Pfad mit einem Segment `.claude/worktrees/<worktree-präfix><nr>-lens-r<n>/`, `-lens-m<n>/` oder `-lens-a<n>/` gilt als Lens-Worktree, auch ein verschachtelter.
 *
 * Präfixe und Agentenname kommen je Aufruf aus der Projekt-Config (`ticket-namen.mjs`); ist sie nicht nutzbar, lehnt der Guard ab (fail-closed).
 * Nur Node-Builtins.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { emit, normalisierePfad, pfadGuardHook, readStdin } from "./hook-io.mjs";
import { ROLLEN_PFADE, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { namenOderGrund, worktreeNamenOderGrund } from "./ticket-namen.mjs";

// Pfadform: Groß-/Kleinschreibung egal (Windows-Pfade), der Ordnername selbst für das Aufräumen exakt (kein Flag oben).
const lensWorktree = (namen) => namen.lensPfadMuster;

/**
 * Repo-Root eines Pfads unter `.claude/worktrees/` (alles vor dem ersten Segment) oder null (#78 L3f/L9d). Liegt dort eine lesbare Config,
 * gilt deren Worktree-Präfix (Lens-Worktree eines fremden Klons, angelegt per `git -C <klon> worktree add`); sonst null → Präfix der Session.
 */
function zielNamen(norm) {
  const i = norm.search(/\/\.claude\/worktrees\//i);
  if (i <= 0) return null;
  let config;
  try {
    config = ladeProjektConfig({ rootDir: norm.slice(0, i), pruefen: false }); // expliziter rootDir: die Probe-Variable greift nicht
  } catch {
    return null;
  }
  return worktreeNamenOderGrund("Lens-Edit-Guard", { config }).namen ?? null;
}

/**
 * Darf die Lens diese Datei per `Edit` ändern? Pur (die Config kommt über `deps.config` oder wird geladen). Liefert `{ block: false }` oder `{ block: true, reason }`.
 * `cwd` löst relative Pfade auf (die Edit-Tools liefern normalerweise absolute).
 */
export function bewerteLensEdit(filePath, cwd = "", deps = {}) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return { block: true, reason: "Lens-Edit ohne Dateipfad: nicht prüfbar, darum abgelehnt." };
  }
  const { namen, grund } = namenOderGrund("Lens-Edit-Guard", deps);
  if (grund) return { block: true, reason: grund };
  const norm = normalisierePfad(filePath, cwd);
  if (lensWorktree(zielNamen(norm) ?? namen).test(norm)) return { block: false };
  return {
    block: true,
    reason:
      `${namen.agenten.lens} ändert nichts im Feature-Worktree: Edit ist nur im eigenen Lens-Worktree erlaubt ` +
      `(.claude/worktrees/${namen.worktreeName("<nr>")}-lens-r<runde> (fremder Klon: git -C <klon> worktree add <klon>/.claude/worktrees/<präfix><nr>-lens-r<runde>) bzw. ${namen.worktreeName("<nr>")}-lens-m<n> bzw. -lens-a<n>, siehe Regel „Sabotage nur im Lens-Worktree“ in ${ROLLEN_PFADE.lens}). ` +
      "Ist der Lens-Worktree nicht anlegbar: Befund „Sabotage nicht möglich“ melden, kein Ersatz.",
  };
}

/** Hook-stdin → Entscheidung. Kaputter Input: durchlassen (ein Hook darf nie selbst alles blockieren). `deps` wie bei `bewerteLensEdit` (Test: injizierte Config). */
export const entscheideHook = (text, deps = {}) => pfadGuardHook("Edit", (p, cwd) => bewerteLensEdit(p, cwd, deps))(text);

if (istDirektaufruf(import.meta.url)) emit(entscheideHook(readStdin()));
