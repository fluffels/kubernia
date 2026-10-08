// Kein Shebang: wird von board-place.mjs gestartet UND von test/board.test.ts importiert.
/**
 * Board-Helfer (#1217): Einsortieren mehrerer Tickets mit EINER Listenabfrage als pure, getestete
 * Funktion (test/board.test.ts); nur die gh-Aufrufe ganz unten sind ungetestet.
 *
 * Item-Form (normalisiert aus der REST-Liste der Board-Items): { id, number, status, title, assignees (Logins), state (open|closed) }.
 *
 * Nur Node-Builtins, analog zu den anderen scripts/-Wächtern.
 */
import { readFileSync } from "node:fs";
import { ghJson, ghText } from "./gh-cli.mjs";

const gh = ghText;

export const PROJECT_ID = "PVT_kwHOD8746c4Barq_";

/** Das Repository (`owner/name`): in GitHub Actions `GITHUB_REPOSITORY`, sonst dieses Repo. EINE Quelle für alle Board-Skripte. */
export const REPO = process.env.GITHUB_REPOSITORY || "fluffels/kubernia";

/** Item-Literal eines frisch angelegten, ungeclaimten Todo-Tickets (die REST-Liste liefert es verzögert; der Aufrufer ergänzt es per `ergaenzeFehlende`). */
export const todoItem = ({ id, number, title }) => ({ id, number, status: "Todo", title, assignees: [], state: "open" });

/** Ein Tag in Millisekunden (Takt-Fenster in langfuse-takt.mjs und board-takt.mjs). */
export const TAG_MS = 24 * 60 * 60 * 1000;

/** Datum aus einem Date oder einer Zeichenkette; wirft bei ungültigem Wert (mit dem Namen des Parameters). Pur. */
export function alsDatum(wert, name) {
  const d = wert instanceof Date ? wert : new Date(wert);
  if (Number.isNaN(d.getTime())) throw new Error(`Ungültiges Datum für ${name}: ${String(wert)}`);
  return d;
}

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

/** Titel des wiederkehrenden Status-Tickets (Langfuse-Takt, ADR 0016). */
export const STATUS_TITEL = "Langfuse-Status überprüfen";

/**
 * Die Notfall-Arten (#1390): EINE Tabelle für `board-place --notfall <art>` (Art), die Titelprüfung (Marker) und den Kopf des Boards
 * (`KOPF_MARKER`). `quelle` ist die Datei, in der der Marker wörtlich steht (Inbox-Workflow bzw. die Doku, wenn ein Mensch oder Agent
 * das Ticket anlegt); test/board.test.ts bindet jeden Eintrag daran. Security hat keinen Workflow: der Marker steht in docs/ticket-reihenfolge.md.
 */
export const NOTFAELLE = [
  { art: "rot-main", marker: "🚨 CI rot auf main", quelle: ".github/workflows/ci.yml" },
  { art: "security", marker: "🔒 Security:", quelle: "docs/ticket-reihenfolge.md" },
  { art: "dependabot", marker: "🤖 Dependabot-PRs auflösen", quelle: ".github/workflows/dependabot-inbox.yml" },
  { art: "forum", marker: "Forum #", quelle: ".github/workflows/forum-inbox.yml" },
];

/** Arten für `--notfall`, abgeleitet aus `NOTFAELLE`. */
export const NOTFALL_ARTEN = NOTFAELLE.map((n) => n.art);

/** Titel-Marker der Kopf-Items (Notfälle; das Status-Ticket kommt über `STATUS_TITEL` dazu), abgeleitet aus `NOTFAELLE`. */
export const KOPF_MARKER = NOTFAELLE.map((n) => n.marker);

/**
 * Prüft, ob die Tickets `numbers` den Titelmarker der Notfall-Art tragen (sonst endet `kopfEnde` vor ihnen: ein unmarkierter Notfall
 * oben ließe den Kopf bei 0 enden). Liefert die Fehlermeldung des ersten Verstoßes oder null. Items, die nicht in `items` stehen, kann
 * die Prüfung nicht beurteilen (der Aufrufer ergänzt sie vorher per GraphQL-Fallback). Pur.
 */
export function notfallTitelFehler(items, numbers, art) {
  const eintrag = NOTFAELLE.find((n) => n.art === art);
  if (!eintrag) return `Unbekannte Notfall-Art „${String(art)}“.`;
  for (const nr of numbers) {
    const i = items.find((x) => x.number === nr);
    if (i && !String(i.title ?? "").startsWith(eintrag.marker)) {
      return `#${nr} trägt nicht den Titelmarker „${eintrag.marker}“ der Art ${art} (Titel: „${i.title}“): ohne ihn zählt es nicht zum Kopf. Titel anpassen, dann erneut.`;
    }
  }
  return null;
}

/** True für ein Kopf-Item: das Status-Ticket oder ein Titel, der mit einem Marker aus `KOPF_MARKER` beginnt. Pur. */
export function istKopfItem(i) {
  const t = String(i?.title ?? "");
  return t === STATUS_TITEL || KOPF_MARKER.some((m) => t.startsWith(m));
}

/**
 * Index des ersten Items hinter dem Kopf: Kopf-Items (offen, auch geclaimt) vorn zählen mit, geschlossene Items dazwischen
 * überspringt die Zählung; das erste offene Nicht-Kopf-Item beendet den Kopf. Ohne Kopf 0. Pur.
 */
export function kopfEnde(items) {
  let ende = 0;
  for (const [idx, i] of items.entries()) {
    if (i.state !== "open") continue;
    if (!istKopfItem(i)) break;
    ende = idx + 1;
  }
  return ende;
}

/** True, wenn das Item mit der Nummer schon im Kopf (vor `kopfEnde`) steht: dann muss es nicht mehr nach oben. Pur. */
export function imKopf(items, nr) {
  const idx = items.findIndex((i) => i.number === nr);
  return idx >= 0 && idx < kopfEnde(items);
}

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
 * Harness-Sammelticket beginnt der Block hinter dem Kopf (`kopfEnde`: Status-, Notfall-, Dependabot-, Forum-Ticket stehen
 * regelkonform oben und stören ihn nicht). Geschlossene, geclaimte und gerade einsortierte (`ohne`) Items überspringt der Block, sie beenden ihn nicht.
 * In Board-Reihenfolge. Pur.
 */
export function sammelblock(items, ohne = []) {
  const harness = sammelticketItem(items, ohne);
  const start = harness ? items.findIndex((i) => i.id === harness.id) : kopfEnde(items);
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

/**
 * Die Position des Sammeltickets aus dem Text von AGENTS.md (SSOT, #1390): genau ein Treffer von „Position <N>“ (auch mit Doppelpunkt
 * oder Zeilenumbruch), sonst wirft die Funktion; dieselbe Regel erzwingt test/harness/sammelticket.test.ts. Pur.
 */
export function sammelticketPosition(agentsText) {
  const treffer = [...String(agentsText ?? "").matchAll(/Position\s*:?\s*(\d+)/g)];
  if (treffer.length !== 1) throw new Error(`AGENTS.md muss die Sammelticket-Position genau einmal nennen („Position <N>“), gefunden: ${treffer.length}`);
  return Number(treffer[0][1]);
}

/** Neue Liste, in der das Item `id` hinter `afterId` steht (null = Spitze); die Eingabe bleibt unverändert. Wirft bei unbekannter ID. Pur. */
export function verschiebe(items, id, afterId) {
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error(`Item ${String(id)} steht nicht in der Liste.`);
  const rest = items.filter((i) => i.id !== id);
  if (afterId === null) return [item, ...rest];
  const idx = rest.findIndex((i) => i.id === afterId);
  if (idx < 0) throw new Error(`Anker ${String(afterId)} steht nicht in der Liste.`);
  return [...rest.slice(0, idx + 1), item, ...rest.slice(idx + 1)];
}

/**
 * Positionskorrektur des ungeclaimten Harness-Sammeltickets (#1390): steht es weiter hinten als `n` (Position laut AGENTS.md),
 * liefert die Funktion `{ nr, id, afterId, vonRang, nachRang }` (Ränge 1-basiert in der Liste), sonst null. Nur nach vorn, nie in den
 * Kopf (liegt das Ziel vor dem letzten Kopf-Item, gilt das letzte Kopf-Item als Anker). Ohne ungeclaimtes Sammelticket null. Pur.
 */
export function sammelticketKorrektur(items, n) {
  const ticket = sammelticketItem(items);
  if (!ticket) return null;
  let afterId = afterIdForPosition(items, n, ticket.number);
  const ende = kopfEnde(items);
  const zielIdx = afterId === null ? -1 : items.findIndex((i) => i.id === afterId);
  if (zielIdx < ende - 1) afterId = ende > 0 ? items[ende - 1].id : null;
  const idx = items.findIndex((i) => i.id === ticket.id);
  // Der Rang zählt freie Todo-Items (ohne geclaimte): steht das Ticket schon auf Position n oder davor, wandert es nicht, auch nicht
  // vor ein geclaimtes Item, das zwischen den freien steht.
  const rang = items.slice(0, idx).filter((i) => istFreiesTodo(i, ticket.number)).length + 1;
  if (rang <= n) return null;
  const neuIdx = verschiebe(items, ticket.id, afterId).findIndex((i) => i.id === ticket.id);
  if (neuIdx >= idx) return null;
  return { nr: ticket.number, id: ticket.id, afterId, vonRang: idx + 1, nachRang: neuIdx + 1 };
}

/**
 * Fehlende Items (aus der verzögerten REST-Liste) hinten anhängen, sofern ihre Nummer noch nicht in der Liste steht.
 * `gefunden`: normalisierte Items (z.B. aus `itemAusIssueAntwort`), null-Einträge fliegen raus. Pur.
 */
export function ergaenzeFehlende(items, gefunden) {
  const bekannt = new Set(items.map((i) => i.number));
  const neu = (gefunden ?? []).filter((g) => g && !bekannt.has(g.number));
  return [...items, ...neu];
}

/**
 * Antwort der GraphQL-Abfrage `repository.issue.projectItems` → normalisiertes Item des eigenen Boards (`PROJECT_ID`) oder
 * null (Issue unbekannt, nicht im Board, nur in fremdem Projekt). Der Status ist leer (nur der Listenfall braucht ihn). Pur.
 */
export function itemAusIssueAntwort(antwort) {
  const issue = antwort?.data?.repository?.issue;
  if (!issue || !Number.isInteger(issue.number)) return null;
  const node = (issue.projectItems?.nodes ?? []).find((n) => n?.project?.id === PROJECT_ID && typeof n.id === "string");
  if (!node) return null;
  return {
    id: node.id,
    number: issue.number,
    status: "",
    title: typeof issue.title === "string" ? issue.title : "",
    assignees: (issue.assignees?.nodes ?? []).map((a) => a?.login).filter((l) => typeof l === "string"),
    state: typeof issue.state === "string" ? issue.state.toLowerCase() : "",
  };
}

/** Nummern aus `args` (Tickets und Anker), die in der REST-Liste `items` fehlen und per GraphQL nachgeholt werden müssen. Pur. */
export function fehlendeNummern(items, args) {
  const bekannt = new Set(items.map((i) => i.number));
  return [...args.numbers, ...(args.anchor ? [args.anchor] : [])].filter((n) => !bekannt.has(n));
}

/** True bei GitHubs Rate-Limit-Fehler (Meldung der gh-CLI/GraphQL). */
export const isRateLimit = (message) => /rate limit/i.test(String(message ?? ""));

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
/** `gh` aufrufen und stdout liefern; `token` setzt GH_TOKEN (Projekt-Scope im Workflow). */
export { ghText as gh, ghJson };

/** Position laut AGENTS.md (SSOT): liest die Datei relativ zu diesem Skript; wirft, wenn sie fehlt oder die Zahl nicht eindeutig ist. */
export function positionLautAgentsMd() {
  return sammelticketPosition(readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8"));
}

/**
 * Antwort von `gh api --paginate --slurp repos/<repo>/issues?state=open` (Liste von Seiten) → offene Issues
 * `{ number, titel, assignees, createdAt }`. Pull Requests fliegen raus. Wirft bei unerwarteter Form, statt still
 * ein Ticket zu übersehen (das führte zu einem Doppel-Ticket). Pur.
 */
export function normalizeOffene(pages) {
  if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p))) {
    throw new Error("Unerwartete Antwortform der offenen Issues (keine Liste von Seiten).");
  }
  return pages
    .flat()
    .filter((i) => !i?.pull_request)
    .map((i) => {
      if (!Number.isInteger(i?.number) || typeof i.title !== "string" || typeof i.created_at !== "string") {
        throw new Error(`Unerwartete Form eines Issues: ${JSON.stringify(i)?.slice(0, 120)}`);
      }
      return {
        number: i.number,
        titel: i.title,
        assignees: Array.isArray(i.assignees) ? i.assignees.map((a) => a?.login).filter((l) => typeof l === "string") : [],
        createdAt: i.created_at,
      };
    });
}

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

/** Freies Todo-Item (zählt im Rang): Status „Todo“, offen, ohne Assignee, nicht das Ticket `ohneNr`. Pur. */
const istFreiesTodo = (i, ohneNr = null) => i.status === "Todo" && i.number !== ohneNr && i.state !== "closed" && ungeclaimt(i);

/**
 * `afterId` für „Ticket landet auf Position N unter den freien Todo-Items“: das (N-1). freie Todo-Item ohne das
 * Ticket selbst (`ohneNr`). Frei heißt offen und ohne Assignee: ein geclaimtes Ticket ist in Arbeit (der Assignee ist der einzige
 * In-Arbeit-Marker, AGENTS.md), bleibt im Board aber auf „Todo“ und würde sonst jeden Rang verschieben. N=1 → null (Spitze). Ist das
 * Board kürzer, das letzte freie Todo-Item; ganz ohne freies Todo-Item null. Pur.
 */
export function afterIdForPosition(items, n, ohneNr = null) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Position muss eine ganze Zahl ≥ 1 sein, war ${n}`);
  if (n === 1) return null;
  const todo = items.filter((i) => istFreiesTodo(i, ohneNr));
  if (todo.length === 0) return null;
  return (todo[n - 2] ?? todo[todo.length - 1]).id;
}

/** Anker-Ticketnummer für „Position N“ (für `planPlacements`): die Nummer des Items, hinter das einsortiert wird; null = Spitze. Pur. */
export function ankerNummerFuerPosition(items, n, ohneNr = null) {
  const afterId = afterIdForPosition(items, n, ohneNr);
  return afterId === null ? null : (items.find((i) => i.id === afterId)?.number ?? null);
}

/**
 * Aufnahme-Plan für Nummern, die weder die REST-Liste noch der GraphQL-Fallback im Board fand (#1428 Z37): ein frisch angelegtes Issue
 * stand nie im Board, `board-place` meldete nur „nicht gefunden“. `issues`: Nummer → REST-Antwort von `repos/<repo>/issues/<nr>` (oder
 * null/fehlend, wenn nicht ladbar). Aufgenommen werden nur offene Issues (keine PRs) mit `node_id`; der `--after`-Anker (`ankerNr`) nie
 * automatisch. Liefert `{ aufnehmen: [{ number, nodeId, title }], abgelehnt: [{ number, grund }] }`. Pur.
 */
export function aufnahmePlan(fehlend, issues, ankerNr = null) {
  const aufnehmen = [];
  const abgelehnt = [];
  for (const nr of fehlend) {
    const i = issues?.[nr] ?? null;
    if (nr === ankerNr) abgelehnt.push({ number: nr, grund: "Anker wird nie automatisch aufgenommen" });
    else if (!i || i.number !== nr) abgelehnt.push({ number: nr, grund: "Issue nicht ladbar oder unbekannt" });
    else if (i.pull_request) abgelehnt.push({ number: nr, grund: "ist ein Pull Request" });
    else if (i.state !== "open") abgelehnt.push({ number: nr, grund: "Issue ist geschlossen" });
    else if (typeof i.node_id !== "string" || i.node_id === "") abgelehnt.push({ number: nr, grund: "Antwort ohne node_id" });
    else aufnehmen.push({ number: nr, nodeId: i.node_id, title: typeof i.title === "string" ? i.title : "" });
  }
  return { aufnehmen, abgelehnt };
}

/** Offene Issue-Nummern, die nicht im Board stehen (Abgleich, nur Bericht). Aufsteigend. */
export function missingFromBoard(openNumbers, items) {
  const known = new Set(items.map((i) => i.number));
  return [...new Set(openNumbers)].filter((n) => !known.has(n)).sort((a, b) => a - b);
}

/** Eine Listenabfrage über REST: alle Issue-Items des Boards in Board-Reihenfolge. `opts.token` = anderer GH_TOKEN (Projekt-Scope im Workflow). */
export function loadItems(opts = {}) {
  return normalizeItems(loadItemPages(opts));
}

/** Die rohen Board-Seiten (REST, Liste von Seiten): enthalten auch Body, Autor und Labels der Issues, für die Ticket-Auswahl (naechstes-ticket.mjs). */
export function loadItemPages(opts = {}) {
  return JSON.parse(gh(["api", "--paginate", "--slurp", `users/fluffels/projectsV2/1/items?per_page=100&fields=${STATUS_FIELD_ID}`], opts));
}

/** Alle offenen Issues (und PRs) als Liste von Seiten, wie `gh api --paginate --slurp` sie liefert (REST). */
export function loadOpenIssuePages(repo = REPO) {
  return JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=open&per_page=100`]));
}

/** Nummern aller offenen Issues (REST; PRs herausgefiltert). */
export function loadOpenIssueNumbers() {
  return loadOpenIssuePages().flat().filter((i) => !i.pull_request).map((i) => i.number);
}

/** Die Mutationen als Konstanten, damit ein Wächter-Test ihre Klammern prüfen kann (eine überzählige `}` machte den Aufruf einmal unbrauchbar). */
export const MUTATION_POSITION =
  "mutation($p:ID!,$i:ID!,$a:ID){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){ items(first:1){ nodes{ id } } } }";
export const MUTATION_ADD = "mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }";
export const MUTATION_STATUS =
  "mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ projectV2Item{ id } } }";

const graphql = (query, vars, opts) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) if (v !== null && v !== undefined) args.push("-f", `${k}=${v}`);
  return JSON.parse(gh(args, opts));
};

/** Höchstzahl Nummern je GraphQL-Abfrage des Fallbacks (Aliase `i0…`). */
export const ALIAS_MAX = 50;

/**
 * Gebündelte GraphQL-Abfragen für den Fallback (#1390): je bis zu `ALIAS_MAX` Nummern ein Aliasblock `i0: issue(number: N){…}`.
 * Liefert `[{ nummern, query }]`. Die Nummern stehen inline und müssen positive Ganzzahlen sein (sonst wirft die Funktion: keine
 * Injektion), `repo` muss `owner/name` aus Wortzeichen, Punkt und Bindestrich sein. Leere Liste → keine Abfrage. Pur.
 */
export function aliasAbfrage(nummern, repo = REPO) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Ungültiges Repo: ${String(repo)}`);
  if (!Array.isArray(nummern) || nummern.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error(`Nummern müssen positive Ganzzahlen sein: ${JSON.stringify(nummern)}`);
  }
  const [owner, name] = repo.split("/");
  const felder = "number title state assignees(first:5){ nodes{ login } } projectItems(first:20){ nodes{ id project{ id } } }";
  const bloecke = [];
  for (let von = 0; von < nummern.length; von += ALIAS_MAX) {
    const teil = nummern.slice(von, von + ALIAS_MAX);
    const aliase = teil.map((n, k) => `i${k}: issue(number: ${n}){ ${felder} }`).join(" ");
    bloecke.push({ nummern: teil, query: `query{ repository(owner:"${owner}",name:"${name}"){ ${aliase} } }` });
  }
  return bloecke;
}

/**
 * Antwort EINES Alias-Blocks → normalisierte Items in der Reihenfolge von `nummern` (null: Issue unbekannt oder nicht im eigenen Board).
 * Wirft bei unerwarteter Antwortform, statt Nummern still als fehlend zu melden. Pur.
 */
export function itemsAusAliasAntwort(antwort, nummern) {
  const repository = antwort?.data?.repository;
  if (!repository || typeof repository !== "object") throw new Error("Unerwartete Antwortform des GraphQL-Fallbacks (kein repository).");
  return nummern.map((_, k) => itemAusIssueAntwort({ data: { repository: { issue: repository[`i${k}`] } } }));
}

/**
 * Eine Abfrage ausführen. `gh` endet bei einem unbekannten Issue (`NOT_FOUND`) mit Exit ≠ 0, liefert aber die Teilantwort auf stdout:
 * dann zählt diese (das unbekannte Issue ist `null`), sonst wirft der Fehler weiter (Rate-Limit, Netz, kaputte Abfrage).
 */
export function graphqlTeilantwort(query, opts, run = gh) {
  try {
    return JSON.parse(run(["api", "graphql", "-f", `query=${query}`], opts));
  } catch (e) {
    const antwort = teilantwortAusStdout(e.stdout);
    if (antwort) return antwort;
    throw e;
  }
}

/**
 * Die Teilantwort eines fehlgeschlagenen `gh api graphql`-Aufrufs (stdout) oder null, wenn der Fehler weiterzuwerfen ist: nur eine
 * parsebare Antwort mit `data.repository`, deren Fehler ALLE `NOT_FOUND` sind (unbekanntes Issue), gilt. Rate-Limit oder jeder andere
 * Fehler daneben, kaputtes oder fehlendes stdout und eine Antwort ohne `repository` geben null. Pur.
 */
export function teilantwortAusStdout(stdout) {
  let antwort;
  try {
    antwort = JSON.parse(String(stdout ?? ""));
  } catch {
    return null;
  }
  const fehler = Array.isArray(antwort?.errors) ? antwort.errors : [];
  if (!antwort?.data?.repository || typeof antwort.data.repository !== "object") return null;
  return fehler.every((x) => x?.type === "NOT_FOUND") ? antwort : null;
}

/**
 * Fallback für Items, die die REST-Liste nicht liefert (frisch aufgenommene Items fehlen dort teils lange): Items der Issues
 * `nummern` per GraphQL (`issue.projectItems`, gebündelte Aliase), gefiltert auf das eigene Board; null-Einträge für Issues, die
 * nicht im Board stehen.
 */
export function itemsUeberIssues(nummern, opts = {}, repo = REPO) {
  return aliasAbfrage(nummern, repo).flatMap((b) => itemsAusAliasAntwort(graphqlTeilantwort(b.query, opts), b.nummern));
}

/** Position setzen: hinter `afterId`, null = an die Spitze. `opts.token` = anderer GH_TOKEN (Projekt-Scope im Workflow). */
export function setPosition(itemId, afterId, opts = {}) {
  graphql(MUTATION_POSITION, { p: PROJECT_ID, i: itemId, a: afterId }, opts);
}

/** Issue (node_id) ins Board holen (idempotent) und Status Todo setzen. Liefert die Item-ID `PVTI_…`. */
export function addToBoardTodo(nodeId, opts = {}) {
  const item = graphql(MUTATION_ADD, { p: PROJECT_ID, c: nodeId }, opts);
  const itemId = item.data.addProjectV2ItemById.item.id;
  graphql(MUTATION_STATUS, { p: PROJECT_ID, i: itemId, f: STATUS_FIELD_NODE_ID, o: TODO_OPTION_ID }, opts);
  return itemId;
}

/** Node-ID des Single-Select-Feldes „Status“ (GraphQL-Mutationen; die REST-Liste nutzt `STATUS_FIELD_ID`). */
export const STATUS_FIELD_NODE_ID = "PVTSSF_lAHOD8746c4Barq_zhVhdTM";
/** Option „Todo“ des Status-Feldes. */
export const TODO_OPTION_ID = "f75ad846";

/**
 * Der Planungsweg von main als pure Funktion (#1390): zuerst die Selbstkorrektur des ungeclaimten Harness-Sammeltickets (nicht bei
 * `--notfall`, nicht wenn das Sammelticket selbst einsortiert wird), dann `planFuerArgs` auf der korrigierten Liste. `n` = Position
 * laut AGENTS.md; `null` heißt „Position unbekannt“: dann entfällt die Korrektur, der Plan läuft ohne sie. Liefert
 * `{ korrektur, items, plan }` (`korrektur` null, wenn nichts zu korrigieren war).
 */
export function planMitKorrektur(items, args, n) {
  const ticket = args.notfall || n === null ? null : sammelticketItem(items, args.numbers);
  const korrektur = ticket ? sammelticketKorrektur(items, n) : null;
  const korrigiert = korrektur ? verschiebe(items, korrektur.id, korrektur.afterId) : items;
  return { korrektur, items: korrigiert, plan: planFuerArgs(korrigiert, args) };
}

/** Position laut AGENTS.md (SSOT) oder null mit Warnung, wenn die Datei nicht lesbar ist oder die Zahl nicht eindeutig (nur die Selbstkorrektur entfällt). */
export function positionOderWarnung(lies = positionLautAgentsMd) {
  try {
    return lies();
  } catch (e) {
    console.error(`⚠ Sammelticket-Selbstkorrektur übersprungen: ${String(e.message).split("\n")[0]}`);
    return null;
  }
}
