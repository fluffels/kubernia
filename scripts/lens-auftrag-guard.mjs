// Kein Shebang: wird vom PreToolUse-Dispatcher (`scripts/pretooluse-hook.mjs`) und vom Wächter-Test importiert.
/**
 * Lens-Auftrag-Guard (#1425): ein `kubernia-lens`-Spawn mit übrig gebliebenen Platzhaltern wird abgewiesen.
 *
 * Anlass: Beim Spawn einer Lens (Skill `review-lenses`) setzt der Orchestrator Handarbeit-Werte in den Prompt
 * (Worktree, Patch-Pfad, erwarteter HEAD) und kopiert die Blöcke wörtlich. Blieb ein `<…>` stehen, startete die Lens
 * ohne Patch, HEAD oder Format und prüfte nichts (PR #1423). Der Guard läuft als PreToolUse auf `Agent`, fail-closed
 * (deny) bei einem klar erkennbaren Rest, fail-open bei allem Unklaren (kein Lens-Spawn, kaputte Eingabe).
 *
 * Bewusst KEIN generischer `<…>`-Test: das Findings-Format (`<Befund>`, `<warum>`), die Kontext-Diät
 * (`node <Arbeitsverzeichnis>/scripts/patch-abschnitte.mjs <patch>`) und der Lens-Worktree-Pfad
 * (`kq-<nr>-lens-r<runde>`) tragen absichtlich Platzhalter. Geprüft werden nur die Kopf-Felder des Auftrags:
 *  R1  `WÖRTLICH>` irgendwo (der Platzhalter `<Brille WÖRTLICH>` / `<Kontext-Diät WÖRTLICH>` blieb stehen),
 *  R2  der Wert von `Arbeitsverzeichnis:`, `Patch:`, `Delta-Patch:` oder `erwarteter HEAD:` enthält noch `<…>`,
 *  R3  `erwarteter HEAD:` beginnt nicht mit einem Hex-Hash von 7 bis 40 Zeichen (Backticks und ein Zusatz dahinter sind erlaubt;
 *      der Workflow-Fallback „der HEAD des Feature-Worktrees …“ ebenfalls).
 * Fehlende Felder bleiben Sache der Lens-Definition (`.claude/agents/kubernia-lens.md`).
 * Bewusste Grenzen: die Feldnamen stehen hier einmal und in der Spawn-Vorlage des Skills `review-lenses` (benennt jemand sie
 *  um, öffnet der Guard still, fail-open); ausgewertet wird je Feld der letzte Treffer im Prompt; die R3-Ausnahme für den
 *  Workflow-Fallback ist eine Kopie seines Textes in `.claude/workflows/kubernia-ticket.js`.
 *
 * Reines Node-Skript (nur Builtins), pure Funktionen.
 */

/** Kopf-Felder des Auftrags, deren Wert kein `<…>` mehr tragen darf. `(?<![\w-])` trennt `Patch:` von `Delta-Patch:`. */
const FELDER = ["Arbeitsverzeichnis", "Delta-Patch", "Patch", "erwarteter HEAD"];

/** Liest die Kopf-Felder aus dem Prompt: Wert reicht bis zum Trenner ` · ` oder Zeilenende. Zählt der LETZTE Treffer je Feld:
 *  die Brille davor darf ein Feld als Beispiel nennen („… mit `Patch: <TMP>/x.patch`“), der echte Kopf steht dahinter. Pure. */
export function parseLensAuftrag(text) {
  const felder = {};
  for (const name of FELDER) {
    const treffer = [...String(text ?? "").matchAll(new RegExp(String.raw`(?<![\w-])${name}:[ \t]*([^\r\n]*?)(?:[ \t]+·[ \t]|[ \t]*$)`, "gim"))];
    if (treffer.length > 0) felder[name] = treffer[treffer.length - 1][1].trim();
  }
  return felder;
}

/** Liest `subagent_type` und `prompt` aus dem Hook-Payload eines `Agent`-Aufrufs; kaputtes JSON → leeres Objekt. Pure. */
export function parseAgentInput(text) {
  try {
    const eingabe = JSON.parse(text)?.tool_input;
    return { subagentType: eingabe?.subagent_type, prompt: eingabe?.prompt };
  } catch {
    return {};
  }
}

/** Wird dieser Spawn als Lens-Spawn behandelt? Typ `kubernia-lens`, oder der Fallback (`general-purpose`/ohne Typ),
 *  dessen Prompt die Lens-Definition nennt. */
function istLensSpawn(subagentType, prompt) {
  if (subagentType === "kubernia-lens") return true;
  const fallback = subagentType === undefined || subagentType === "general-purpose";
  return fallback && String(prompt ?? "").includes("kubernia-lens.md");
}

const HINWEIS =
  "Setze die Werte aus Stufe 0 ein (Worktree, Patch-Pfad mit Runde, `git rev-parse HEAD`) und kopiere Brille, Kontext-Diät und Findings-Format wörtlich aus dem Skill `review-lenses`.";

/** Grund für ein Deny oder `null` (durchlassen). Pure. */
export function lensAuftragBlockade({ subagentType, prompt } = {}) {
  if (!istLensSpawn(subagentType, prompt)) return null;
  const text = String(prompt ?? "");
  if (text.includes("WÖRTLICH>")) {
    return `Lens-Auftrag unvollständig: der Platzhalter „… WÖRTLICH>“ steht noch im Prompt (Brille, Kontext-Diät oder Findings-Format wurden nicht eingesetzt). ${HINWEIS}`;
  }
  const felder = parseLensAuftrag(text);
  for (const [name, wert] of Object.entries(felder)) {
    if (/<[^<>\r\n]*>/.test(wert)) {
      return `Lens-Auftrag unvollständig: das Feld „${name}:“ trägt noch einen Platzhalter (${wert}). Ein Zusatz in derselben Zeile zählt mit, auch ein erklärendes „<…>“: Erklärungen in eine eigene Zeile schreiben. ${HINWEIS}`;
    }
  }
  const head = felder["erwarteter HEAD"];
  // Der Hash zählt, nicht die Verzierung: Backticks und ein Zusatz nach dem Hash („abc1234 (origin/main + Fix)“) sind erlaubt.
  const hash = head?.replace(/^`+/, "").split(/[\s`]/, 1)[0];
  if (head !== undefined && !/^[0-9a-f]{7,40}$/i.test(hash ?? "") && !head.startsWith("der HEAD des Feature-Worktrees")) {
    return `Lens-Auftrag unvollständig: „erwarteter HEAD:“ ist kein Commit-Hash (7 bis 40 Hex-Zeichen), sondern „${head}“. ${HINWEIS}`;
  }
  return null;
}
