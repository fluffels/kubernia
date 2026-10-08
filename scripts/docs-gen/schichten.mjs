// Kein Shebang (siehe docs-gen.mjs). Generatoren `schichten-soll` und `schichten-ist` (#1368):
// Schichtdiagramm aus scripts/layers.cjs (SCHICHT_MODELL, dieselbe Tabelle wie die Regeln von
// `check:arch`) und aus der Ausgabe von dependency-cruiser, auf Schicht-Ebene verdichtet.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { MERMAID_FRONTMATTER } from "./markdown.mjs";

const MIB = 1024 * 1024;

/**
 * Lädt SCHICHT_MODELL aus der konfigurierten layers-Datei relativ zu `rootDir` und prüft es mit dem
 * `pruefeModell`, das dieselbe Datei exportiert (die Prüfung lebt bei der Modell-Definition, #1392).
 */
export function ladeModell(rootDir, layersPfad) {
  const abs = join(rootDir, layersPfad);
  if (!existsSync(abs)) throw new Error(`Schicht-Definition ${layersPfad} fehlt`);
  const mod = createRequire(abs)(abs);
  if (!mod.SCHICHT_MODELL) throw new Error(`${layersPfad} exportiert kein SCHICHT_MODELL`);
  if (typeof mod.pruefeModell !== "function") throw new Error(`${layersPfad} exportiert kein pruefeModell`);
  mod.pruefeModell(mod.SCHICHT_MODELL);
  // Fail-closed auch bei einem trivialen Prüfer der fremden Datei: ohne Quellwurzel gäbe es keine Auffang-Zuordnung.
  const q = mod.SCHICHT_MODELL.quellwurzel;
  if (typeof q !== "string" || !q.endsWith("/") || q === "/") throw new Error(`${layersPfad}: SCHICHT_MODELL.quellwurzel fehlt oder ist ungültig (Verzeichnis mit Slash am Ende)`);
  return mod.SCHICHT_MODELL;
}

/** Ordnet einen (ggf. verdichteten) Pfad einer Schicht-/Extern-ID zu; `null` für alles andere. */
export function schichtVon(pfad, modell) {
  const p = String(pfad).replace(/\\/g, "/");
  for (const x of modell.extern) if (new RegExp(x.muster).test(p)) return x.id;
  for (const s of modell.schichten) if (s.muster && new RegExp(s.muster).test(p)) return s.id;
  const auffang = modell.schichten.find((s) => s.muster === null);
  return p.startsWith(modell.quellwurzel) && auffang ? auffang.id : null;
}

/** Reihenfolge-Index: Schichten in Modell-Reihenfolge, Externe dahinter. */
function indexVon(modell) {
  const m = new Map();
  [...modell.schichten, ...modell.extern].forEach((s, i) => m.set(s.id, i));
  return m;
}

function sortiere(kanten, modell) {
  const idx = indexVon(modell);
  return [...kanten].sort((a, b) => idx.get(a[0]) - idx.get(b[0]) || idx.get(a[1]) - idx.get(b[1]));
}

/** Erlaubte Richtungen `[von, nach]` des Modells, sortiert. */
export function sollKanten(modell) {
  return sortiere(modell.schichten.flatMap((s) => s.darf.map((z) => [s.id, z])), modell);
}

/** Optionaler Config-Schlüssel `schichten.pruefbefehl` (z.B. der Befehl des Schicht-Gates) für die Fehlertexte. */
const hinweisAuf = (befehl) => (typeof befehl === "string" && befehl !== "" ? ` (${befehl})` : "");

/** Verdichtet das JSON von dependency-cruiser auf Schicht-Kanten; wirft bei einer Kante außerhalb des Solls. */
export function istKanten(cruiseJson, modell, pruefbefehl) {
  const darf = new Map(modell.schichten.map((s) => [s.id, new Set(s.darf)]));
  const gefunden = new Map();
  for (const m of cruiseJson?.modules ?? []) {
    const source = String(m.source).replace(/\\/g, "/");
    if (source.endsWith(".d.ts")) continue;
    const von = schichtVon(source, modell);
    if (!von || !darf.has(von)) continue;
    for (const d of m.dependencies ?? []) {
      const nach = schichtVon(d.resolved, modell);
      if (!nach || nach === von) continue;
      gefunden.set(`${von}>${nach}`, [von, nach]);
    }
  }
  const verboten = [...gefunden.values()].filter(([v, n]) => !darf.get(v).has(n));
  if (verboten.length)
    throw new Error(
      `Import-Richtung(en) außerhalb des Solls: ${sortiere(verboten, modell).map(([v, n]) => `${v} → ${n}`).join(", ")} (die Schichtprüfung des Projekts${hinweisAuf(pruefbefehl)} müsste rot sein)`,
    );
  return sortiere([...gefunden.values()], modell);
}

/** Mermaid-Flowchart (in einem Code-Fence) für die Kantenmenge `kanten`. */
export function renderDiagramm(modell, kanten) {
  const idx = indexVon(modell);
  const istExtern = (id) => modell.extern.some((x) => x.id === id);
  const zeilen = [];
  for (const s of modell.schichten) {
    const titel = s.technik ? `${s.label} · ${s.technik}` : s.label;
    const unten = s.muster === null ? `alles übrige unter ${modell.quellwurzel}` : s.wurzeln.join(" · ");
    zeilen.push(`  s_${s.id}["${titel}${unten ? `<br/>${unten}` : ""}"]`);
  }
  for (const x of modell.extern) zeilen.push(`  x_${x.id}{{"${x.label}"}}`);
  const paare = new Set(kanten.map(([v, n]) => `${v}>${n}`));
  const innen = kanten.filter(([, n]) => !istExtern(n));
  const aussen = kanten.filter(([, n]) => istExtern(n));
  for (const [v, n] of innen) {
    if (paare.has(`${n}>${v}`)) {
      if (idx.get(v) < idx.get(n)) zeilen.push(`  s_${v} <--> s_${n}`);
    } else zeilen.push(`  s_${v} --> s_${n}`);
  }
  for (const [v, n] of aussen) zeilen.push(`  s_${v} -.-> x_${n}`);
  const engine = modell.schichten.filter((s) => s.technik).map((s) => `s_${s.id}`);
  zeilen.push("  classDef engine fill:#d7e8c6,stroke:#4f7a3a,color:#1f2a17");
  zeilen.push("  classDef extern fill:#e6e1d6,stroke:#6b6455,color:#2b2118,stroke-dasharray:4 3");
  if (engine.length) zeilen.push(`  class ${engine.join(",")} engine`);
  if (modell.extern.length) zeilen.push(`  class ${modell.extern.map((x) => `x_${x.id}`).join(",")} extern`);
  return ["```mermaid", MERMAID_FRONTMATTER, "flowchart TD", ...zeilen, "```"].join("\n");
}

/** Satz zu erlaubten, aber im Ist nicht genutzten Richtungen. */
export function ungenutztZeile(modell, soll, ist) {
  const genutzt = new Set(ist.map(([v, n]) => `${v}>${n}`));
  const label = new Map([...modell.schichten, ...modell.extern].map((s) => [s.id, s.label]));
  const offen = soll.filter(([v, n]) => !genutzt.has(`${v}>${n}`));
  if (offen.length === 0) return `Alle ${soll.length} erlaubten Richtungen sind genutzt.`;
  return `Erlaubt, aber ungenutzt: ${offen.map(([v, n]) => `${label.get(v)} → ${label.get(n)}`).join(", ")}.`;
}

function geladenesModell({ rootDir, config }) {
  const cfg = config.schichten;
  if (!cfg?.layers) throw new Error('config.json: Block "schichten" mit "layers" fehlt');
  const modell = ladeModell(rootDir, cfg.layers);
  return { modell, cfg };
}

export function schichtenSollGenerator(ctx) {
  const { modell } = geladenesModell(ctx);
  return renderDiagramm(modell, sollKanten(modell));
}

/** Startet dependency-cruiser (Argumente aus der Config) und liefert dessen JSON. */
function cruise(rootDir, args, pruefbefehl) {
  if (!Array.isArray(args) || args.length === 0) throw new Error('config.json: "schichten.cruise" fehlt');
  let out;
  try {
    out = execFileSync(process.execPath, args, { cwd: rootDir, encoding: "utf8", maxBuffer: 256 * MIB, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const detail = err instanceof Error ? err.message.split(/\r?\n/)[0] : String(err);
    throw new Error(`Import-Graph-Aufruf fehlgeschlagen (erst die Schichtprüfung${hinweisAuf(pruefbefehl)} grün machen): ${detail}`, { cause: err });
  }
  try {
    return JSON.parse(out);
  } catch {
    throw new Error("Import-Graph-Aufruf lieferte kein gültiges JSON");
  }
}

const escRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Konsistenz der `schichten.cruise`-Argumente mit der Quellwurzel des Modells (#1428 Z13): die Config nennt das Cruise-Ziel und das
 * `--collapse`-Muster als Text; stünde dort ein anderes Verzeichnis als `SCHICHT_MODELL.quellwurzel`, verdichtete das Diagramm
 * still das Falsche. Prüft nur, was vorhanden ist: ein `dependency-cruiser`-Aufruf braucht das Ziel `<quellwurzel ohne Slash>` als
 * erstes Argument danach, ein `--collapse` das Muster `^(<quellwurzel>|node_modules)/[^/]+/`. Liefert die Meldung oder `null`. Pur.
 */
export function pruefeCruiseArgs(args, modell) {
  const q = modell.quellwurzel.replace(/\/$/, "");
  const liste = Array.isArray(args) ? args.map(String) : [];
  const bin = liste.findIndex((a) => /dependency-cruiser/.test(a));
  if (bin >= 0 && liste[bin + 1] !== q) {
    return `schichten.cruise: Ziel „${liste[bin + 1] ?? "(fehlt)"}“ passt nicht zur Quellwurzel „${modell.quellwurzel}“ des Schicht-Modells (erwartet: ${q})`;
  }
  const c = liste.indexOf("--collapse");
  const soll = `^(${escRegex(q)}|node_modules)/[^/]+/`;
  if (c >= 0 && liste[c + 1] !== soll) {
    return `schichten.cruise: --collapse „${liste[c + 1] ?? "(fehlt)"}“ passt nicht zur Quellwurzel „${modell.quellwurzel}“ (erwartet: ${soll})`;
  }
  return null;
}

export function schichtenIstGenerator(ctx) {
  const { modell, cfg } = geladenesModell(ctx);
  const passt = pruefeCruiseArgs(cfg.cruise, modell);
  if (passt) throw new Error(passt);
  const ist = istKanten(cruise(ctx.rootDir, cfg.cruise, cfg.pruefbefehl), modell, cfg.pruefbefehl);
  return `${renderDiagramm(modell, ist)}\n\n${ungenutztZeile(modell, sollKanten(modell), ist)}`;
}
