// Kein Shebang: wird als agent-skopierter PreToolUse-Hook gestartet UND von test/harness/lens-edit-guard.test.ts importiert.
/**
 * Lens-Sabotage-Guard (#1349): `kubernia-lens` hat das Tool `Edit`, ausschließlich für die Sabotage-Probe der Test-Lens
 * (Implementierung testweise verfälschen, Test wird rot?). Die Probe gehört in einen eigenen Lens-Worktree
 * (`.claude/worktrees/kq-<nr>-lens-r<runde>`); ein Edit im Feature-Worktree verfälscht die Basis der parallel lesenden
 * anderen Lenses (so passiert im Review von #1331). Die Regel stand bisher nur als Text in der Lens-Definition.
 *
 * Dieser Hook (Frontmatter von `.claude/agents/kubernia-lens.md`, Matcher `Edit`, gilt nur für diesen Subagenten) erzwingt sie:
 * `Edit` ist erlaubt, wenn der aufgelöste Zielpfad in einem Lens-Worktree liegt, sonst `deny`. Ein fehlender Pfad ist `deny`.
 *
 * Bewusste Grenzen:
 *   - Bash/PowerShell (`sed -i`, `Set-Content`) fängt er nicht ab; die Lens-Definition verbietet es per Text, der
 *     Frische-Guard der Folge-Runde und `git status --porcelain` im Feature-Worktree machen eine Änderung sichtbar.
 *   - Ein Pfad per Symlink/Junction in einen Lens-Worktree wird nicht aufgelöst (lexikalische Prüfung); jeder Pfad mit einem Segment `.claude/worktrees/kq-<nr>-lens-r<n>/` gilt als Lens-Worktree, auch ein verschachtelter.
 *
 * Nur Node-Builtins.
 */
import { posix } from "node:path";
import { buildDenyOutput, emit, istDirektaufruf, readStdin } from "./hook-io.mjs";

const LENS_WORKTREE = /\/\.claude\/worktrees\/kq-\d+-lens-r\d+\//i;

/** Pfad lexikalisch normalisieren (Backslashes → Slashes, `..` auflösen), relative Pfade gegen `cwd`. */
const normalisiere = (pfad, cwd) => {
  const p = String(pfad).replace(/\\/g, "/");
  const absolut = /^([a-z]:)?\//i.test(p);
  const basis = String(cwd ?? "").replace(/\\/g, "/");
  return posix.normalize(absolut || !basis ? p : `${basis}/${p}`);
};

/**
 * Darf `kubernia-lens` diese Datei per `Edit` ändern? Pur. Liefert `{ block: false }` oder `{ block: true, reason }`.
 * `cwd` löst relative Pfade auf (die Edit-Tools liefern normalerweise absolute).
 */
export function bewerteLensEdit(filePath, cwd = "") {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return { block: true, reason: "Lens-Edit ohne Dateipfad: nicht prüfbar, darum abgelehnt." };
  }
  const norm = normalisiere(filePath, cwd);
  if (LENS_WORKTREE.test(norm)) return { block: false };
  return {
    block: true,
    reason:
      "kubernia-lens ändert nichts im Feature-Worktree: Edit ist nur im eigenen Lens-Worktree erlaubt " +
      "(.claude/worktrees/kq-<nr>-lens-r<runde>, siehe Regel „Sabotage nur im Lens-Worktree“ in kubernia-lens.md). " +
      "Ist der Lens-Worktree nicht anlegbar: Befund „Sabotage nicht möglich“ melden, kein Ersatz.",
  };
}

/** Hook-stdin → Entscheidung. Kaputter Input: durchlassen (ein Hook darf nie selbst alles blockieren). */
export function entscheideHook(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data?.tool_name !== undefined && data.tool_name !== "Edit") return null;
  const e = bewerteLensEdit(data?.tool_input?.file_path, data?.cwd);
  return e.block ? buildDenyOutput(e.reason) : null;
}

if (istDirektaufruf(import.meta.url)) emit(entscheideHook(readStdin()));
