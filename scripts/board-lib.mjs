// Kein Shebang: wird von board-rhythm.mjs/board-place.mjs gestartet UND von test/board.test.ts importiert.
/**
 * Board-Helfer (#1217): die Berechnungen für Spielrhythmus und Einsortieren als pure, getestete
 * Funktionen. Vorher stand der Rhythmus als Inline-`jq` in docs/ticket-reihenfolge.md — dort prüfte
 * nur ein Text-Wächter, ob die Formulierungen stehen, nicht ob der Befehl richtig rechnet.
 *
 * Item-Form (normalisiert aus `gh project item-list`): { id, number, title, status, labels[],
 * assignees[], unfree } — `unfree` heißt: offener Blocker („blockiert durch #X“) oder schon ein
 * Branch/Worktree trotz fehlendem Assignee. Solche Items zählen weder als Spielticket noch als
 * Kandidat zum Vorziehen.
 *
 * Nur Node-Builtins, analog zu den anderen scripts/-Wächtern.
 */
import { execFileSync } from "node:child_process";

export const PROJECT_ID = "PVT_kwHOD8746c4Barq_";
export const STATUS_FIELD_ID = "PVTSSF_lAHOD8746c4Barq_zhVhdTM";
export const STATUS_TODO_OPTION_ID = "f75ad846";
/** Wie viele freie Nicht-Vorrang-Items den „Kopf“ bilden, in dem der Rhythmus gepflegt wird. */
export const HEAD_SIZE = 6;

const GAME_LABEL = /^area:(inhalt|lernpfad|grafik)$/;

/** Spielticket: eines der drei Spiel-Labels. */
export const isGame = (item) => (item.labels ?? []).some((l) => GAME_LABEL.test(l));

/** Vorrang (steht oben, zählt nicht für den Rhythmus): 🚨/🤖 im Titel oder Label `forum`. */
export const isPrio = (item) => /🚨|🤖/.test(item.title ?? "") || (item.labels ?? []).includes("forum");

/** Freie Warteschlange in Board-Reihenfolge: Todo, ohne Assignee, ohne Blocker/Branch, kein Vorrang. */
export function freeQueue(items) {
  return items.filter(
    (i) => i.status === "Todo" && (i.assignees ?? []).length === 0 && !i.unfree && !isPrio(i),
  );
}

/**
 * Ein Rhythmus-Schritt: prüft nur den Kopf (erste HEAD_SIZE freie Items), sucht die erste Stelle mit
 * drei Nicht-Spieltickets in Folge und zieht das oberste tiefer liegende Spielticket direkt vor das
 * dritte. Ergebnis: { action: "ok" } | { action: "leer" } | { action: "move", item, afterId }.
 */
export function planRhythmStep(items, headSize = HEAD_SIZE) {
  const q = freeQueue(items);
  const end = Math.min(q.length, headSize);
  for (let i = 2; i < end; i++) {
    if (isGame(q[i]) || isGame(q[i - 1]) || isGame(q[i - 2])) continue;
    const game = q.slice(i + 1).find(isGame);
    if (!game) return { action: "leer" };
    return { action: "move", item: game, afterId: q[i - 1].id };
  }
  return { action: "ok" };
}

/** Setzt `item` direkt hinter `afterId` (null = an die Spitze) — rein lokal, ohne API. */
export function applyMove(items, item, afterId) {
  const rest = items.filter((i) => i.id !== item.id);
  const at = afterId === null ? 0 : rest.findIndex((i) => i.id === afterId) + 1;
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** Alle Rhythmus-Schritte bis `ok`/`leer` lokal durchrechnen (Obergrenze gegen Endlosschleifen). */
export function planRhythm(items, headSize = HEAD_SIZE, maxSteps = 10) {
  const moves = [];
  let cur = items;
  for (let n = 0; n < maxSteps; n++) {
    const step = planRhythmStep(cur, headSize);
    if (step.action !== "move") return { moves, end: step.action };
    moves.push({ item: step.item, afterId: step.afterId });
    cur = applyMove(cur, step.item, step.afterId);
  }
  return { moves, end: "limit" };
}

/**
 * Einsortieren mehrerer Tickets mit EINER Listenabfrage: `numbers` in der gewünschten Reihenfolge
 * hinter `afterNumber` (oder an die Spitze bei null). Liefert die Positionsschritte [{ item, afterId }],
 * wobei jedes Item am Vorgänger hängt (Reihenfolge bleibt erhalten) — und `missing`: Nummern, die
 * (noch) nicht in der Liste stehen (`gh project item-list` liefert frische Items verzögert).
 */
export function planPlacements(items, numbers, afterNumber = null) {
  const byNumber = new Map(items.map((i) => [i.number, i]));
  const missing = numbers.filter((n) => !byNumber.has(n));
  let afterId = null;
  if (afterNumber !== null) {
    const anchor = byNumber.get(afterNumber);
    if (!anchor) return { steps: [], missing, anchorMissing: true };
    afterId = anchor.id;
  }
  const steps = [];
  for (const n of numbers) {
    const item = byNumber.get(n);
    if (!item) continue;
    steps.push({ item, afterId });
    afterId = item.id;
  }
  return { steps, missing, anchorMissing: false };
}

/** „blockiert durch #X“-Referenzen aus einem Issue-Body. */
export function blockerNumbers(body) {
  return [...String(body ?? "").matchAll(/blockiert durch\s+#(\d+)/gi)].map((m) => Number(m[1]));
}

/** True bei GitHubs Rate-Limit-Fehler (Meldung der gh-CLI/GraphQL). */
export const isRateLimit = (message) => /rate limit/i.test(String(message ?? ""));

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Eine Listenabfrage: alle Issue-Items des Boards in Board-Reihenfolge, normalisiert. */
export function loadItems() {
  const raw = JSON.parse(gh(["project", "item-list", "1", "--owner", "fluffels", "--format", "json", "--limit", "800"]));
  return raw.items
    .filter((i) => i.content?.type === "Issue")
    .map((i) => ({
      id: i.id,
      number: i.content.number,
      title: i.title ?? i.content.title ?? "",
      status: i.status ?? "",
      labels: i.labels ?? [],
      assignees: i.assignees ?? [],
      body: i.content.body ?? "",
      unfree: false,
    }));
}

/** Markiert Items mit offenem Blocker oder vorhandenem Branch als nicht frei (nur für freie Todo-Items). */
export function markUnfree(items) {
  const branches = gh(["branch", "-a", "--format=%(refname:short)"]);
  const issueState = new Map();
  const stateOf = (n) => {
    if (!issueState.has(n)) {
      try {
        issueState.set(n, JSON.parse(gh(["issue", "view", String(n), "--json", "state"])).state);
      } catch {
        issueState.set(n, "UNKNOWN");
      }
    }
    return issueState.get(n);
  };
  for (const item of items) {
    if (item.status !== "Todo" || item.assignees.length > 0) continue;
    const hasBranch = new RegExp(`feature/kq-${item.number}-`).test(branches);
    const blocked = blockerNumbers(item.body).some((n) => stateOf(n) === "OPEN");
    item.unfree = hasBranch || blocked;
  }
  return items;
}

/** Position setzen: hinter `afterId`, null = an die Spitze. */
export function setPosition(itemId, afterId) {
  const query =
    "mutation($p:ID!,$i:ID!,$a:ID){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){ items(first:1){ nodes{ id } } } }";
  const args = ["api", "graphql", "-f", `query=${query}`, "-f", `p=${PROJECT_ID}`, "-f", `i=${itemId}`];
  if (afterId) args.push("-f", `a=${afterId}`);
  gh(args);
}
