// Kein Shebang: wird von board-place.mjs gestartet UND von test/board.test.ts importiert.
/**
 * Board-Helfer (#1217): Einsortieren mehrerer Tickets mit EINER Listenabfrage als pure, getestete
 * Funktion (test/board.test.ts); nur die gh-Aufrufe ganz unten sind ungetestet.
 *
 * Item-Form (normalisiert aus der REST-Liste der Board-Items): { id, number, status, title, assignees (Logins), state (open|closed) }.
 *
 * Nur Node-Builtins, analog zu den anderen scripts/-Wächtern.
 */
import { execFileSync } from "node:child_process";

export const PROJECT_ID = "PVT_kwHOD8746c4Barq_";

/**
 * Einsortieren mehrerer Tickets: `numbers` in der gewünschten Reihenfolge hinter `afterNumber`
 * (oder an die Spitze bei null). Liefert die Positionsschritte [{ item, afterId }], wobei jedes Item
 * am Vorgänger hängt (Reihenfolge bleibt erhalten), und `missing`: Nummern, die (noch) nicht in der
 * Liste stehen (die Board-Liste liefert frische Items verzögert).
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

/** Titel des Sammeltickets für Harness-Befunde (AGENTS.md § Harness-Befunde sind Zeilen). */
export const SAMMELTICKET_TITEL = "Harness-Härtung (gesammelt)";

/**
 * Das ungeclaimte Sammelticket: offen, ohne Assignee, Titel `SAMMELTICKET_TITEL`. Ein geclaimtes (zugewiesenes) oder
 * geschlossenes zählt nicht, ebenso nicht die Nummern aus `ohne` (das Ticket, das gerade einsortiert wird). Bei mehreren
 * das oberste in Board-Reihenfolge. Pur.
 */
export function sammelticketItem(items, ohne = []) {
  return (
    items.find(
      (i) => i.title === SAMMELTICKET_TITEL && i.state === "open" && (i.assignees ?? []).length === 0 && !ohne.includes(i.number),
    ) ?? null
  );
}

/**
 * Neue Tickets landen nie VOR dem ungeclaimten Sammelticket (sonst rückt es nicht nach vorn): ist der Anker `null` (Spitze)
 * oder steht er im Board vor dem Sammelticket, wird das Sammelticket der Anker. Der Anker selbst, alles dahinter, ein Anker
 * außerhalb der Liste (meldet der Aufrufer), ein Board ohne Sammelticket und `notfall` bleiben unverändert. Das Sammelticket
 * selbst klemmt nicht (es steht in `numbers`). Liefert `{ anker, geklemmt, sammelticket }`. Pur.
 */
export function klemmeAnker(items, ankerNr, { numbers = [], notfall = false } = {}) {
  const unveraendert = { anker: ankerNr, geklemmt: false, sammelticket: null };
  if (notfall) return unveraendert;
  const sammel = sammelticketItem(items, numbers);
  if (!sammel) return unveraendert;
  const sammelIdx = items.findIndex((i) => i.id === sammel.id);
  const ankerIdx = ankerNr === null ? -1 : items.findIndex((i) => i.number === ankerNr);
  if (ankerNr !== null && ankerIdx < 0) return unveraendert;
  if (ankerIdx >= sammelIdx) return unveraendert;
  return { anker: sammel.number, geklemmt: true, sammelticket: sammel.number };
}

/**
 * Der ganze Planungsweg von board-place (--top/--after/--position, Klemmung, Notfall) als pure Funktion: `args` wie aus parseArgs
 * (`anchor`, `position`, `numbers`, `notfall`). Liefert den Plan von planPlacements plus `klemmung` (`{ geklemmt, sammelticket }`).
 */
export function planFuerArgs(items, args) {
  const anker = args.position ? ankerNummerFuerPosition(items, args.position, args.numbers[0]) : (args.anchor ?? null);
  const k = klemmeAnker(items, anker, { numbers: args.numbers, notfall: !!args.notfall });
  return { ...planPlacements(items, args.numbers, k.anker), klemmung: { geklemmt: k.geklemmt, sammelticket: k.sammelticket } };
}

/** True bei GitHubs Rate-Limit-Fehler (Meldung der gh-CLI/GraphQL). */
export const isRateLimit = (message) => /rate limit/i.test(String(message ?? ""));

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Feld-ID von „Status“ im Board (REST braucht sie als `fields=`, sonst fehlt der Status). */
export const STATUS_FIELD_ID = 358708531;

/**
 * Antwort von `gh api --paginate --slurp users/fluffels/projectsV2/1/items` (Liste von Seiten) →
 * Issue-Items in Board-Reihenfolge als `{ id (node_id PVTI_…), number, status, title, assignees, state }`. Pur, damit die Form
 * mit einer echten JSON-Probe testbar ist. Bricht laut ab bei unerwarteter Form, statt Nummern still
 * als fehlend zu melden. Drafts und PRs fliegen raus. REST statt GraphQL: das Core-Kontingent ist
 * getrennt vom GraphQL-Kontingent, das bei Board-Arbeit binnen Minuten leer war.
 */
export function normalizeItems(pages) {
  if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p))) {
    throw new Error("Unerwartete Antwortform der Board-Items (keine Liste von Seiten).");
  }
  return pages
    .flat()
    .filter((i) => i?.content_type === "Issue" && Number.isInteger(i.content?.number) && typeof i.node_id === "string")
    .map((i) => ({
      id: i.node_id,
      number: i.content.number,
      status: i.fields?.find((f) => f?.name === "Status")?.value?.name?.raw ?? "",
      title: typeof i.content.title === "string" ? i.content.title : "",
      assignees: Array.isArray(i.content.assignees) ? i.content.assignees.map((a) => a?.login).filter((l) => typeof l === "string") : [],
      state: typeof i.content.state === "string" ? i.content.state : "",
    }));
}

/**
 * Eine gemeinsame Abbruch-Meldung. `gh` meldet bei erschöpftem GraphQL-Limit auch „unknown owner type“;
 * das ist irreführend und wird hier als Rate-Limit gezeigt.
 */
export function abortMessage(message) {
  const first = String(message ?? "").split("\n")[0];
  if (isRateLimit(first) || /unknown owner type/i.test(first)) {
    return `API-Rate-Limit (oder Owner/Scope: gh meldet ein erschöpftes GraphQL-Limit teils als „unknown owner type“): ${first}`;
  }
  return first;
}

/**
 * `afterId` für „Ticket landet auf Position N unter den Todo-Items“: das (N-1). Todo-Item ohne das
 * Ticket selbst (`ohneNr`). N=1 → null (Spitze). Ist das Board kürzer, das letzte Todo-Item; ganz ohne
 * Todo-Item null. Pur.
 */
export function afterIdForPosition(items, n, ohneNr = null) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Position muss eine ganze Zahl ≥ 1 sein, war ${n}`);
  if (n === 1) return null;
  const todo = items.filter((i) => i.status === "Todo" && i.number !== ohneNr);
  if (todo.length === 0) return null;
  return (todo[n - 2] ?? todo[todo.length - 1]).id;
}

/** Anker-Ticketnummer für „Position N“ (für `planPlacements`): die Nummer des Items, hinter das einsortiert wird; null = Spitze. Pur. */
export function ankerNummerFuerPosition(items, n, ohneNr = null) {
  const afterId = afterIdForPosition(items, n, ohneNr);
  return afterId === null ? null : (items.find((i) => i.id === afterId)?.number ?? null);
}

/** Offene Issue-Nummern, die nicht im Board stehen (Abgleich, nur Bericht). Aufsteigend. */
export function missingFromBoard(openNumbers, items) {
  const known = new Set(items.map((i) => i.number));
  return [...new Set(openNumbers)].filter((n) => !known.has(n)).sort((a, b) => a - b);
}

/** Eine Listenabfrage über REST: alle Issue-Items des Boards in Board-Reihenfolge. */
export function loadItems() {
  const out = gh(["api", "--paginate", "--slurp", `users/fluffels/projectsV2/1/items?per_page=100&fields=${STATUS_FIELD_ID}`]);
  return normalizeItems(JSON.parse(out));
}

/** Nummern aller offenen Issues (REST; PRs herausgefiltert). */
export function loadOpenIssueNumbers() {
  const pages = JSON.parse(gh(["api", "--paginate", "--slurp", "repos/fluffels/kubernia/issues?state=open&per_page=100"]));
  return pages.flat().filter((i) => !i.pull_request).map((i) => i.number);
}

/** Position setzen: hinter `afterId`, null = an die Spitze. */
export function setPosition(itemId, afterId) {
  const query =
    "mutation($p:ID!,$i:ID!,$a:ID){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){ items(first:1){ nodes{ id } } } }";
  const args = ["api", "graphql", "-f", `query=${query}`, "-f", `p=${PROJECT_ID}`, "-f", `i=${itemId}`];
  if (afterId) args.push("-f", `a=${afterId}`);
  gh(args);
}
