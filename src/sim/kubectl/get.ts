/* ===== Kubernia – kubectl get: die Anfrage lesen (sim/kubectl/get.ts, #1444) =====
 * Der Dispatcher von `kubectl get`. Er liest die Anfrage wie echtes kubectl:
 *   - `get pods`            ein Typ (Plural, Singular oder echter Kurzname, ./resources)
 *   - `get pods web db`     Typ + Namen: nur diese Objekte, fehlende melden NotFound
 *   - `get pods,svc`        Komma-Liste: ein Block je Typ, NAME mit `kind[.group]/`-Präfix
 *   - `get all`             die Kategorie `all` (Pods, Services, Deployments, ReplicaSets, StatefulSets, Grafana-CRDs)
 *   - `get pod/web svc/db`  Slash-Form
 *   - `-o wide`             die Zusatzspalten (`GetTable.wide`), geprüft in ./output
 *   - `-o yaml`             die Objekte statt der Tabelle (Bausteine in ./get-yaml): ein Name ergibt das Einzelobjekt,
 *                           sonst eine `kind: List`; NotFound-Zeilen wie bei der Tabelle
 * Die Tabellen selbst liefern die Renderer aus ./inspect (`GET_RENDERERS`); hier liegen nur Lesen der
 * Anfrage, Namespace-Wache, Namensfilter und das Zusammensetzen. inspect.ts importiert dieses Modul nie.
 *
 * Phaser-frei (pure Domäne). */
import { table } from "../util";
import { DEFAULT_NAMESPACE } from "../state";
import type { KubectlHost } from "./host";
import { GET_RENDERERS, noResourcesIn, type GetTable } from "./inspect";
import { allNamespaces, foreignNamespace, requestedNamespace } from "./namespace";
import { qualified, serverWarnings, type ResourceKind } from "./resources";
import { notSimulated } from "./args";
import { readTargets, type Target } from "./targets";
import type { Call } from "../cliargs";
import { isWide, isYaml } from "./output";
import { emitYaml } from "../yaml-emit";
import { yamlKinds, yamlList, yamlObjects } from "./get-yaml";

/** Das Ergebnis eines Typs: die gezeigten Zeilen (mit Kopf) und die nicht gefundenen Namen. */
interface Block { kind: ResourceKind; table: GetTable; missing: string[]; foreign: string | null }

/** Ohne `-o wide` fallen die Endspalten weg, die nur wide zeigt (`GetTable.wide`). */
function narrow(full: GetTable, wide: boolean): GetTable {
  if (wide || !full.wide) return full;
  const keep = (r: string[]): string[] => r.slice(0, r.length - full.wide!);
  return { header: keep(full.header), rows: full.rows.map(keep), names: full.names };
}

/** Rendert einen Typ und wendet Namespace-Wache und Namensfilter an. Ein fremder Namespace liefert
 *  nichts (dort liegt nichts); bei Namen kommen die Zeilen in Eingabereihenfolge, fehlende in `missing`. */
function renderBlock(host: KubectlHost, c: Call, req: Target, wide: boolean): Block {
  const entry = GET_RENDERERS.get(req.kind.plural);
  if (!entry) throw new Error("get: kein Renderer für " + req.kind.plural);   // vorher per rendererMissing abgefangen
  const foreign = foreignNamespace(c, req.kind.namespaced, entry.extraNamespaces);
  const full: GetTable = foreign ? { header: [], rows: [], names: [] } : narrow(entry.render(host, c), wide);
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
function emptyMessage(b: Block, c: Call): string {
  if (b.kind.plural === "alerts") return "No alerts firing.";
  if (!b.kind.namespaced) return "No resources found.";
  return noResourcesIn(b.foreign ?? requestedNamespace(c) ?? DEFAULT_NAMESPACE);
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
function rendererMissing(host: KubectlHost, requests: Target[]): string | null {
  const bad = requests.find(r => !GET_RENDERERS.has(r.kind.plural));
  if (!bad) return null;
  return notSimulated(host, "'kubectl get " + bad.kind.plural + "'.", ["kubectl get " + [...GET_RENDERERS.keys()].join(", ")]);
}

/** Der Fehlerrahmen der NotFound-Zeilen samt Tipp (Tabelle und `-o yaml` teilen ihn). */
function withNotFound(host: KubectlHost, text: string, blocks: Block[]): string {
  return host._err(text, "Namen siehst du mit 'kubectl get " + blocks.find(b => b.missing.length)!.kind.plural + "'.");
}

/** `-o yaml`: die Objekte der gefundenen Namen. Genau eine Anfrage mit genau einem Namen ergibt das Einzelobjekt
 *  (fehlt er, nur die NotFound-Zeile), sonst eine `kind: List` mit den NotFound-Zeilen dahinter (wie `printGeneric`).
 *  Kann eine Art nicht vollständig abgebildet werden (kein Baustein, System-Pods), lehnt die Sim ehrlich ab. */
function yamlOutput(host: KubectlHost, requests: Target[], blocks: Block[], warn: (text: string) => string): string {
  const found = blocks.map(b => yamlObjects(host, b.kind, b.table.names));
  if (found.some(o => o === null)) {
    return notSimulated(host, "'kubectl get -o yaml' für diese Art (oder die System-Pods).", ["kubectl get " + yamlKinds().join("|") + " [<name>] -o yaml"]);
  }
  const items = found.flatMap(o => o ?? []);
  const errors = blocks.flatMap(notFoundLines);
  const single = requests.length === 1 && requests[0].names.length === 1;
  if (single && items.length === 1) return warn(emitYaml(items[0]));
  const text = single ? errors.join("\n") : [emitYaml(yamlList(items)), ...errors].join("\n");
  return warn(errors.length > 0 ? withNotFound(host, text, blocks) : text);
}

export function kubectlGet(host: KubectlHost, c: Call): string {
  host._recheckReadiness();
  const parsed = readTargets(host, c.args);
  if ("error" in parsed) return parsed.error;
  if (parsed.targets.length === 0) return host._err("kubectl get: Was möchtest du sehen?", "z.B. 'kubectl get pods' oder 'kubectl get nodes'");
  const missingRenderer = rendererMissing(host, parsed.targets);
  if (missingRenderer) return missingRenderer;
  if (allNamespaces(c) && parsed.targets.some(r => r.names.length > 0)) {
    return host._err("error: a resource cannot be retrieved by name across all namespaces");
  }

  const blocks = parsed.targets.map(r => renderBlock(host, c, r, isWide(c)));
  // Die Warnungen des API-Servers stehen vor jeder Antwort, die er wirklich gibt (nicht vor Client-Fehlern oder "Nicht simuliert").
  const warnings = serverWarnings(parsed.targets.map(r => r.kind));
  const warn = (text: string): string => (warnings.length > 0 ? warnings.join("\n") + "\n" + text : text);
  if (isYaml(c)) return yamlOutput(host, parsed.targets, blocks, warn);
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
  const text = parts.length > 0 ? parts.join("\n\n") : emptyMessage(blocks[0], c);
  return warn(errors.length > 0 ? withNotFound(host, text, blocks) : text);
}
