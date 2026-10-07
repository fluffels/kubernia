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

/** Titel des Sammeltickets für Langfuse-Befunde (Mechanik: docs/ticket-reihenfolge.md). */
export const LANGFUSE_SAMMELTICKET_TITEL = "Langfuse-Befunde (gesammelt)";

/** Alle Sammeltickets, die das Einsortieren kennt (die Klemmung rechnet mit allen, nicht nur mit dem Harness-Sammelticket). */
export const SAMMELTICKET_TITEL_LISTE = [SAMMELTICKET_TITEL, LANGFUSE_SAMMELTICKET_TITEL];

const ungeclaimt = (i) => (i.assignees ?? []).length === 0;

/**
 * Das ungeclaimte Sammelticket: offen, ohne Assignee, Titel `SAMMELTICKET_TITEL`. Ein geclaimtes (zugewiesenes) oder
 * geschlossenes zählt nicht, ebenso nicht die Nummern aus `ohne` (das Ticket, das gerade einsortiert wird). Bei mehreren
 * das oberste in Board-Reihenfolge. Pur.
 */
export function sammelticketItem(items, ohne = []) {
  return items.find((i) => i.title === SAMMELTICKET_TITEL && i.state === "open" && ungeclaimt(i) && !ohne.includes(i.number)) ?? null;
}

/**
 * Der Sammelblock des Boards: die ungeclaimten Sammeltickets (alle Titel aus `SAMMELTICKET_TITEL_LISTE`), die ab dem ungeclaimten
 * Harness-Sammelticket bis zum nächsten offenen, ungeclaimten Nicht-Sammelticket aufeinander folgen. Ohne ungeclaimtes
 * Harness-Sammelticket beginnt der Block an der Spitze. Ein Status- oder Notfall-Ticket DAVOR (die stehen regelkonform oben)
 * stört ihn so nicht. Geschlossene, geclaimte und gerade einsortierte (`ohne`) Items überspringt der Block, sie beenden ihn nicht.
 * In Board-Reihenfolge. Pur.
 */
export function sammelblock(items, ohne = []) {
  const harness = sammelticketItem(items, ohne);
  const start = harness ? items.findIndex((i) => i.id === harness.id) : 0;
  const block = [];
  for (const i of items.slice(start)) {
    if (i.state !== "open" || !ungeclaimt(i) || ohne.includes(i.number)) continue;
    if (!SAMMELTICKET_TITEL_LISTE.includes(i.title)) break;
    block.push(i);
  }
  return block;
}

/**
 * Neue Tickets landen nie VOR den ungeclaimten Sammeltickets (sonst rücken sie nicht nach vorn): der Klemm-Anker ist das am
 * weitesten hinten stehende von (a) dem ungeclaimten Harness-Sammelticket, wo es auch steht, und (b) den ungeclaimten
 * Sammeltickets im Sammelblock (`sammelblock`). Ist der Anker `null` (Spitze) oder steht er im Board davor, wird
 * dieser Anker genommen. Der Anker selbst, alles dahinter, ein Anker außerhalb der Liste (meldet der Aufrufer), ein Board ohne
 * ungeclaimtes Sammelticket und `notfall` bleiben unverändert. Das Sammelticket selbst klemmt nicht (es steht in `numbers`).
 * Liefert `{ anker, geklemmt, sammelticket }`. Pur.
 */
export function klemmeAnker(items, ankerNr, { numbers = [], notfall = false } = {}) {
  const unveraendert = { anker: ankerNr, geklemmt: false, sammelticket: null };
  if (notfall) return unveraendert;
  const kandidaten = [sammelticketItem(items, numbers), ...sammelblock(items, numbers)].filter(Boolean);
  if (kandidaten.length === 0) return unveraendert;
  const idx = (item) => items.findIndex((i) => i.id === item.id);
  const ziel = kandidaten.reduce((hinten, k) => (idx(k) > idx(hinten) ? k : hinten));
  const ankerIdx = ankerNr === null ? -1 : items.findIndex((i) => i.number === ankerNr);
  if (ankerNr !== null && ankerIdx < 0) return unveraendert;
  if (ankerIdx >= idx(ziel)) return unveraendert;
  return { anker: ziel.number, geklemmt: true, sammelticket: ziel.number };
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
const gh = (args, { token } = {}) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: token ? { ...process.env, GH_TOKEN: token } : process.env });

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

/** Alle offenen Issues (und PRs) als Liste von Seiten, wie `gh api --paginate --slurp` sie liefert (REST). */
export function loadOpenIssuePages(repo = "fluffels/kubernia") {
  return JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=open&per_page=100`]));
}

/** Nummern aller offenen Issues (REST; PRs herausgefiltert). */
export function loadOpenIssueNumbers() {
  return loadOpenIssuePages().flat().filter((i) => !i.pull_request).map((i) => i.number);
}

const graphql = (query, vars, opts) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) if (v !== null && v !== undefined) args.push("-f", `${k}=${v}`);
  return JSON.parse(gh(args, opts));
};

/** Position setzen: hinter `afterId`, null = an die Spitze. `opts.token` = anderer GH_TOKEN (Projekt-Scope im Workflow). */
export function setPosition(itemId, afterId, opts = {}) {
  graphql(
    "mutation($p:ID!,$i:ID!,$a:ID){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){ items(first:1){ nodes{ id } } } }",
    { p: PROJECT_ID, i: itemId, a: afterId },
    opts,
  );
}

/** Issue (node_id) ins Board holen (idempotent) und Status Todo setzen. Liefert die Item-ID `PVTI_…`. */
export function addToBoardTodo(nodeId, opts = {}) {
  const item = graphql("mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }", { p: PROJECT_ID, c: nodeId }, opts);
  const itemId = item.data.addProjectV2ItemById.item.id;
  graphql(
    "mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ projectV2Item{ id } } }",
    { p: PROJECT_ID, i: itemId, f: STATUS_FIELD_NODE_ID, o: TODO_OPTION_ID },
    opts,
  );
  return itemId;
}

/** Node-ID des Single-Select-Feldes „Status“ (GraphQL-Mutationen; die REST-Liste nutzt `STATUS_FIELD_ID`). */
export const STATUS_FIELD_NODE_ID = "PVTSSF_lAHOD8746c4Barq_zhVhdTM";
/** Option „Todo“ des Status-Feldes. */
export const TODO_OPTION_ID = "f75ad846";
