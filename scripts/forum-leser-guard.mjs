// Kein Shebang: wird als agent-skopierter PreToolUse-Hook gestartet UND von test/harness/forum-quarantaene.test.ts importiert.
/**
 * Read-Guard des Quarantäne-Agenten `forum-leser` (#1435): der Subagent liest Forum-Fremdtext und hat darum nur das
 * Tool `Read`. Dieser Hook (Frontmatter von `.claude/agents/forum-leser.md`, Matcher `Read`, gilt nur für diesen
 * Subagenten) erlaubt `Read` ausschließlich auf die Quarantäne-Datei `.claude/forum-quarantaene/forum-<n>.txt`
 * (geschrieben von `scripts/forum-quarantaene.mjs`); jeder andere Pfad, auch ein fehlender, ist `deny`.
 *
 * Bewusste Grenzen:
 *   - Der Guard prüft nur den Pfadtail: eine gleichnamige Datei unter einer anderen Wurzel (z. B. im Benutzer-Home) wird erlaubt.
 *   - Der privilegierte Lauf wird nicht technisch am Lesen der Datei gehindert (ein Read-Deny sperrte auch `forum-leser`);
 *     „nie selbst lesen“ steht als Anweisung im Skill `forum`.
 *   - Lexikalische Prüfung: ein Symlink/Junction auf diesen Namen wird nicht aufgelöst.
 *   - Frontmatter-Hooks laufen nur in vertrauten Ordnern; ohne Vertrauen bleiben die Whitelist `tools: Read`
 *     und die Read-Denies aus `.claude/settings.json`.
 *
 * Nur Node-Builtins.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { emit, normalisierePfad, pfadGuardHook, readStdin } from "./hook-io.mjs";

// Groß-/Kleinschreibung egal (Windows-Pfade); Dateiname exakt `forum-<Ziffern>.txt` im Ordner `.claude/forum-quarantaene/`.
const QUARANTAENE_DATEI = /\/\.claude\/forum-quarantaene\/forum-\d+\.txt$/i;

/** Darf `forum-leser` diese Datei lesen? Pur. Liefert `{ block: false }` oder `{ block: true, reason }`. */
export function bewerteForumLeserRead(filePath, cwd = "") {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return { block: true, reason: "forum-leser: Read ohne Dateipfad ist nicht prüfbar, darum abgelehnt." };
  }
  if (QUARANTAENE_DATEI.test(normalisierePfad(filePath, cwd))) return { block: false };
  return {
    block: true,
    reason:
      "forum-leser liest nur die Quarantäne-Datei .claude/forum-quarantaene/forum-<n>.txt aus dem Prompt " +
      "(Quarantäne-Muster, docs/sicherheit-agenten.md). Andere Dateien sind für diesen Agenten gesperrt.",
  };
}

/** Hook-stdin → Entscheidung. Kaputter Input: durchlassen (ein Hook darf nie selbst alles blockieren). */
export const entscheideHook = pfadGuardHook("Read", bewerteForumLeserRead);

if (istDirektaufruf(import.meta.url)) emit(entscheideHook(readStdin()));
