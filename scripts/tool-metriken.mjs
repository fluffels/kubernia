// Kein Shebang: wird von scripts/token-baseline.mjs und test/tool-metriken.test.ts importiert.
/**
 * Tool-Fehler nach Art und Wiederlesen je Agent (#1379). Pur und ohne IO, arbeitet auf den Tool-Events aus
 * `brain-metrics.mjs` (`{ tool, input, resultChars, agent, fehler }`; `fehler` = Anfang des Fehlertexts, sonst null).
 * Definition: docs/model-routing.md §5 „Messen“.
 */
import { CHARS_PER_TOKEN, commandsOf } from "./brain-metrics.mjs";

/** `ERROR` allein ist kein Signal (der Hook setzt es bei jedem Exit ≠ 0); die Art steht im Text. */
const ARTEN = [
  ["zuGross", /^File content \(\d+ tokens\) exceeds maximum allowed tokens/],
  ["exit", /^Exit code \d+/],
  ["hook", /^PreToolUse:\S+ hook error/],
  ["guard", /^(?:<tool_use_error>)?Blocked:/],
  ["permission", /^Permission (?:to use|for this action)/],
];

/** Art eines Fehlertexts, `null` bei leerem Text. Unbekanntes ist `sonst`. */
export function fehlerArt(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  for (const [art, re] of ARTEN) if (re.test(t)) return art;
  return "sonst";
}

/** Anzahl je Art über alle Events mit Fehlertext. */
export function fehlerArten(events) {
  const out = {};
  for (const ev of events ?? []) {
    const art = fehlerArt(ev?.fehler);
    if (art) out[art] = (out[art] ?? 0) + 1;
  }
  return out;
}

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const dateiKey = (p) => String(p ?? "").replace(/\\/g, "/").toLowerCase();
const basename = (p) => String(p).split("/").pop();
const pfad = (ev) => ev.input?.file_path ?? ev.input?.notebook_path ?? "";

/**
 * Wiederlesen je Agent × Datei. Gelesener Bereich = `[offset||1, offset||1 + (limit ?? 2000) − 1]`. Ein Read, der einen schon
 * gelesenen Bereich desselben Agenten überlappt, ist Wiederlesen: `voll` (ohne offset/limit) oder `gezielt` (mit). Abschnitte ohne
 * Überlappung sind Erst-Lesen. Ein eigenes Edit/Write auf die Datei setzt deren gelesene Bereiche zurück; ein Read mit Fehler zählt nicht.
 * Tokens = Ergebnisgröße / CHARS_PER_TOKEN, eine obere Schranke (der Treffer kann kleiner sein als die Datei).
 */
export function wiederlesen(events) {
  const gelesen = new Map(); // agent + Datei → [[von, bis], …]
  const proDatei = new Map();
  const out = { reads: 0, abschnittsweise: 0, voll: { n: 0, tokens: 0 }, gezielt: { n: 0, tokens: 0 }, top: [] };
  for (const ev of events ?? []) {
    const datei = dateiKey(pfad(ev));
    const key = `${ev.agent ?? ""}|${datei}`;
    if (EDITS.has(ev.tool)) {
      gelesen.delete(key);
      continue;
    }
    if (ev.tool !== "Read" || ev.fehler || !datei) continue;
    out.reads += 1;
    const teil = ev.input.offset !== undefined || ev.input.limit !== undefined;
    const von = Number(ev.input.offset) || 1;
    const bis = von + (Number(ev.input.limit) || 2000) - 1;
    const bereiche = gelesen.get(key) ?? [];
    const wieder = bereiche.some(([a, b]) => von <= b && bis >= a);
    bereiche.push([von, bis]);
    gelesen.set(key, bereiche);
    if (!wieder) {
      if (teil) out.abschnittsweise += 1; // nur Erst-Lesen in Abschnitten; gezieltes Wiederlesen zählt unter `gezielt`
      continue;
    }
    const tokens = Math.round((ev.resultChars ?? 0) / CHARS_PER_TOKEN);
    const klasse = teil ? out.gezielt : out.voll;
    klasse.n += 1;
    klasse.tokens += tokens;
    const d = proDatei.get(datei) ?? { datei: basename(datei), n: 0, tokens: 0 };
    d.n += 1;
    d.tokens += tokens;
    proDatei.set(datei, d);
  }
  out.top = [...proDatei.values()].sort((a, b) => b.n - a.n || b.tokens - a.tokens).slice(0, 5);
  return out;
}

/**
 * Prüfläufe (#1120): wie oft ein Agent die volle Gate-Kette (`npm run verify`, `verify:kompakt`, `verify:full`) bzw. die gezielte
 * (`verify:changed`) gestartet hat. Gezählt nur ein Kommando `npm run <skript>` (oder `node …verify-lauf.mjs`), nie Text in Commit-
 * Message oder `echo`; von Guard, Hook oder Permission blockierte Events zählen nicht, ein roter Lauf (Exit ≠ 0) schon.
 */
const VOLL = new Set(["verify", "verify:kompakt", "verify:full"]);
const BLOCKIERT = new Set(["guard", "hook", "permission"]);

export function pruefLaeufe(events) {
  const out = { voll: 0, gezielt: 0 };
  for (const ev of events ?? []) {
    if (ev?.tool !== "Bash" && ev?.tool !== "PowerShell") continue;
    if (BLOCKIERT.has(fehlerArt(ev.fehler))) continue;
    for (const words of commandsOf(ev.input?.command, ev.tool)) {
      const art = pruefArt(words);
      if (art) out[art] += 1;
    }
  }
  return out;
}

function pruefArt(words) {
  const [cmd, ...rest] = words;
  if (cmd === "npm") {
    const args = rest.filter((w) => !w.startsWith("-"));
    if (args[0] !== "run" && args[0] !== "run-script") return null;
    if (VOLL.has(args[1])) return "voll";
    return args[1] === "verify:changed" ? "gezielt" : null;
  }
  if (cmd === "node" && rest.some((w) => /(?:^|[\/])verify-lauf\.mjs$/.test(w))) return rest.includes("--changed") ? "gezielt" : "voll";
  return null;
}
