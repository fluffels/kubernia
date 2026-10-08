/* ===== Kubernia – kubectl get: die Anfrage lesen (sim/kubectl/get.ts, #1444) =====
 * Der Dispatcher von `kubectl get`. Er liest die Anfrage wie echtes kubectl:
 *   - `get pods`            ein Typ (Plural, Singular oder echter Kurzname, ./resources)
 *   - `get pods web db`     Typ + Namen: nur diese Objekte, fehlende melden NotFound
 *   - `get pods,svc`        Komma-Liste: ein Block je Typ, NAME mit `kind[.group]/`-Präfix
 *   - `get all`             die Kategorie `all` (Pods, Services, Deployments, StatefulSets, Grafana-CRDs)
 *   - `get pod/web svc/db`  Slash-Form
 * Die Tabellen selbst liefern die Renderer aus ./inspect (`GET_RENDERERS`); hier liegen nur Lesen der
 * Anfrage, Namespace-Wache, Namensfilter und das Zusammensetzen. inspect.ts importiert dieses Modul nie.
 *
 * Phaser-frei (pure Domäne). */
import { table } from "../util";
import { DEFAULT_NAMESPACE } from "../state";
import type { KubectlHost } from "./host";
import { GET_RENDERERS, noResourcesIn, type GetTable } from "./inspect";
import { allNamespaces, foreignNamespace, requestedNamespace } from "./namespace";
import { allKinds, qualified, resolveKind, type ResourceKind } from "./resources";
import { notSimulated, positionals, slashRef, SLASH_SINGLE_ERROR, unknownResourceType } from "./args";

/** Was verlangt wurde: ein Typ mit den (möglicherweise leeren) gewünschten Namen. */
interface Request { kind: ResourceKind; names: string[] }
type Parsed = { requests: Request[] } | { error: string };

const NO_TYPE_NEEDED_ERROR = "error: there is no need to specify a resource type as a separate argument when passing arguments in resource/name form (e.g. 'kubectl get resource/<resource_name>' instead of 'kubectl get resource resource/<resource_name>'";

/** Die Typen einer Komma-Liste (`pods,svc`, `all`), ohne Doppelte, in Eingabereihenfolge. */
function expandTypes(host: KubectlHost, list: string): ResourceKind[] | string {
  const out: ResourceKind[] = [];
  for (const tok of list.split(",").filter(s => s !== "")) {
    const kinds = tok.toLowerCase() === "all" ? allKinds() : [resolveKind(tok)];
    for (const k of kinds) {
      if (!k) return unknownResourceType(host, tok);
      if (!out.includes(k)) out.push(k);
    }
  }
  return out;
}

/** Die Slash-Form `typ/name …` (auch gemischte Typen). */
function parsePairs(host: KubectlHost, pos: string[]): Parsed {
  const requests: Request[] = [];
  for (const tok of pos) {
    const ref = slashRef(tok) ?? { error: SLASH_SINGLE_ERROR }; // ein Token ohne Slash mitten in der Slash-Form
    if ("error" in ref) return { error: host._err(ref.error) };
    const kind = resolveKind(ref.typ);
    if (!kind) return { error: unknownResourceType(host, ref.typ) };
    const existing = requests.find(r => r.kind === kind);
    if (existing) existing.names.push(ref.name); else requests.push({ kind, names: [ref.name] });
  }
  return { requests };
}

function parseRequests(host: KubectlHost, pos: string[]): Parsed {
  if (pos[0].includes("/")) return parsePairs(host, pos);
  if (pos.slice(1).some(a => a.includes("/"))) return { error: host._err(NO_TYPE_NEEDED_ERROR) };
  const kinds = expandTypes(host, pos[0]);
  if (typeof kinds === "string") return { error: kinds };
  const names = pos.slice(1);
  if (names.length > 0 && kinds.length > 1) return { error: host._err("error: you may only specify a single resource type") };
  return { requests: kinds.map(kind => ({ kind, names })) };
}

/** Das Ergebnis eines Typs: die gezeigten Zeilen (mit Kopf) und die nicht gefundenen Namen. */
interface Block { kind: ResourceKind; table: GetTable; missing: string[]; foreign: string | null }

/** Rendert einen Typ und wendet Namespace-Wache und Namensfilter an. Ein fremder Namespace liefert
 *  nichts (dort liegt nichts); bei Namen kommen die Zeilen in Eingabereihenfolge, fehlende in `missing`. */
function renderBlock(host: KubectlHost, t: string[], req: Request): Block {
  const entry = GET_RENDERERS.get(req.kind.plural);
  if (!entry) throw new Error("get: kein Renderer für " + req.kind.plural);   // vorher per rendererMissing abgefangen
  const foreign = foreignNamespace(t, req.kind.namespaced, entry.extraNamespaces);
  const full: GetTable = foreign ? { header: [], rows: [], names: [] } : entry.render(host, t);
  if (req.names.length === 0) return { kind: req.kind, table: full, missing: [], foreign };
  const rows: string[][] = [];
  const names: string[] = [];
  const missing: string[] = [];
  for (const n of req.names) {
    const i = full.names.indexOf(n);
    if (i < 0) { missing.push(n); continue; }
    rows.push(full.rows[i]);
    names.push(n);
  }
  return { kind: req.kind, table: { header: full.header, rows, names }, missing, foreign };
}

/** Die Leermeldung eines Typs: `No resources found in <ns> namespace.` bzw. bei cluster-weiten Typen. */
function emptyMessage(b: Block, t: string[]): string {
  if (b.kind.plural === "alerts") return "No alerts firing.";
  if (!b.kind.namespaced) return "No resources found.";
  return noResourcesIn(b.foreign ?? requestedNamespace(t) ?? DEFAULT_NAMESPACE);
}

/** Tabelle eines Blocks; bei mehreren Typen trägt die NAME-Zelle den Präfix `kind[.group]/`. */
function blockTable(b: Block, prefixed: boolean): string {
  const { header, rows } = b.table;
  const col = header.indexOf("NAME");
  const shown = prefixed ? rows.map(r => r.map((c, i) => (i === col ? qualified(b.kind, "singular") + "/" + c : c))) : rows;
  return table(header, shown);
}

function notFoundLines(b: Block): string[] {
  return b.missing.map(n => 'Error from server (NotFound): ' + qualified(b.kind, "plural") + ' "' + n + '" not found');
}

/** Typen, die die Registry kennt, die der Simulator aber nicht auflisten kann (z.B. `namespaces`). */
function rendererMissing(host: KubectlHost, requests: Request[]): string | null {
  const bad = requests.find(r => !GET_RENDERERS.has(r.kind.plural));
  if (!bad) return null;
  return notSimulated(host, "'kubectl get " + bad.kind.plural + "'.", ["kubectl get " + [...GET_RENDERERS.keys()].join(", ")]);
}

export function kubectlGet(host: KubectlHost, t: string[]): string {
  host._recheckReadiness();
  const pos = positionals("get", t);
  if (pos.length === 0) return host._err("kubectl get: Was möchtest du sehen?", "z.B. 'kubectl get pods' oder 'kubectl get nodes'");
  const parsed = parseRequests(host, pos);
  if ("error" in parsed) return parsed.error;
  const missingRenderer = rendererMissing(host, parsed.requests);
  if (missingRenderer) return missingRenderer;
  if (allNamespaces(t) && parsed.requests.some(r => r.names.length > 0)) {
    return host._err("error: a resource cannot be retrieved by name across all namespaces");
  }

  const blocks = parsed.requests.map(r => renderBlock(host, t, r));
  const prefixed = blocks.length > 1;
  const parts: string[] = [];
  const errors: string[] = [];
  for (const b of blocks) {
    const lines: string[] = [];
    if (b.table.rows.length > 0) lines.push(blockTable(b, prefixed));
    const nf = notFoundLines(b);
    errors.push(...nf);
    lines.push(...nf);
    if (lines.length > 0) parts.push(lines.join("\n"));
  }
  const text = parts.length > 0 ? parts.join("\n\n") : emptyMessage(blocks[0], t);
  return errors.length > 0 ? host._err(text, "Namen siehst du mit 'kubectl get " + blocks.find(b => b.missing.length)!.kind.plural + "'.") : text;
}
