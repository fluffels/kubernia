/* ===== Kubernia – Terminal-Ausgabe in Tabellen- und Textblöcke teilen (#1484) =====
 * Pure Domäne (DOM-frei, unit-testbar). Die Sim liefert ihre Ausgabe als EIN String;
 * breite CLI-Tabellen (`kubectl get pods -A -o wide`) sollen im schmalen Spiel-Terminal
 * nicht umbrechen, sondern einzeln horizontal scrollen (wie `less -S`), Fließtext
 * (Hinweise, Fehler, `help`) bricht weiter um. Dafür erkennt diese Funktion die
 * Tabellen anhand ihres Kopfs; die DOM-Anbindung (`termOutputHtml`) liegt dünn in
 * `ui/radio.ts`. Die Kopf-Regel ist an das Format von `sim/util.ts › table()` gekoppelt
 * (Vertragstest in `test/termblocks.test.ts`). */

export interface TermBlock {
  kind: "table" | "text";
  text: string;
}

/** Hinweis-Marker: eine Zeile, die (nach dem Einzug) so beginnt, beendet eine Tabelle. */
const HINT_MARKERS = ["💡", "▸", "ℹ", "⚠"];

const COLUMN_GAP = /\s{2,}/;
const HEAD_CHARS = /^[A-Z0-9 %/_.-]+$/;
const DASH_ROW = /^[- ]+$/;

function columnCount(line: string): number {
  return line.trim().split(COLUMN_GAP).length;
}

/** Kopf A: CLI-Konvention (`NAME   READY   STATUS`), Klammergruppen wie `CPU(cores)` zählen nicht. */
function isUpperHead(line: string): boolean {
  const flat = line.replace(/\([^)]*\)/g, "").trim();
  if (!/^[A-Z]/.test(flat) || !HEAD_CHARS.test(flat)) return false;
  return columnCount(flat) >= 2;
}

/** Kopf B: describe-Events (`Type   Reason   Age` + Strich-Zeile darunter). */
function isDashedHead(line: string, next: string | undefined): boolean {
  if (next === undefined || line.trim() === "" || columnCount(line) < 2) return false;
  const dash = next.trim();
  return dash !== "" && DASH_ROW.test(dash) && dash.split(COLUMN_GAP).length >= 2;
}

function isHead(lines: string[], i: number): boolean {
  return isUpperHead(lines[i]) || isDashedHead(lines[i], lines[i + 1]);
}

function endsTable(line: string): boolean {
  const t = line.trimStart();
  return t === "" || HINT_MARKERS.some(m => t.startsWith(m));
}

/** Teilt die Sim-Ausgabe in Blöcke; `blocks.map(b => b.text).join("\n") === output`. */
export function splitTermBlocks(output: string): TermBlock[] {
  const lines = output.split("\n");
  const blocks: TermBlock[] = [];
  let text: string[] = [];
  const flushText = () => {
    if (text.length) blocks.push({ kind: "text", text: text.join("\n") });
    text = [];
  };
  let i = 0;
  while (i < lines.length) {
    if (!isHead(lines, i)) {
      text.push(lines[i++]);
      continue;
    }
    flushText();
    let j = i + 1;
    while (j < lines.length && !endsTable(lines[j])) j++;
    blocks.push({ kind: "table", text: lines.slice(i, j).join("\n") });
    i = j;
  }
  flushText();
  return blocks;
}
