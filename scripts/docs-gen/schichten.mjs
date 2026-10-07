// Kein Shebang (siehe docs-gen.mjs). Generatoren `schichten-soll` und `schichten-ist` (#1368):
// Schichtdiagramm aus scripts/layers.cjs (SCHICHT_MODELL, dieselbe Tabelle wie die Regeln von
// `check:arch`) und aus der Ausgabe von dependency-cruiser, auf Schicht-Ebene verdichtet.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { MERMAID_FRONTMATTER } from "./markdown.mjs";

const MIB = 1024 * 1024;
const ID = /^[a-z][a-z0-9]*$/;
const AUFFANG_TEXT = "alles übrige unter src/";

/** Lädt SCHICHT_MODELL aus der konfigurierten layers-Datei relativ zu `rootDir`. */
export function ladeModell(rootDir, layersPfad) {
  const abs = join(rootDir, layersPfad);
  if (!existsSync(abs)) throw new Error(`Schicht-Definition ${layersPfad} fehlt`);
  const modell = createRequire(abs)(abs).SCHICHT_MODELL;
  if (!modell) throw new Error(`${layersPfad} exportiert kein SCHICHT_MODELL`);
  return modell;
}

/** Wirft bei einem unbrauchbaren Modell (alle Probleme in einer Meldung). */
export function pruefeModell(modell) {
  const probleme = [];
  const schichten = Array.isArray(modell?.schichten) ? modell.schichten : [];
  const extern = Array.isArray(modell?.extern) ? modell.extern : [];
  if (schichten.length === 0) probleme.push("keine Schichten");
  const alle = [...schichten, ...extern];
  const ids = new Set();
  for (const s of alle) {
    if (typeof s.id !== "string" || !ID.test(s.id) || s.id === "end") probleme.push(`ungültige oder reservierte ID "${String(s.id)}"`);
    else if (ids.has(s.id)) probleme.push(`doppelte ID "${s.id}"`);
    ids.add(s.id);
    if (typeof s.label !== "string" || s.label === "" || /["<>\r\n]/.test(s.label)) probleme.push(`ungültiges Label bei "${String(s.id)}"`);
    if (s.technik !== undefined && /["<>\r\n]/.test(s.technik)) probleme.push(`ungültige Technik bei "${String(s.id)}"`);
  }
  const auffang = schichten.filter((s) => s.muster === null).length;
  if (schichten.length > 0 && auffang !== 1) probleme.push(`genau eine Auffang-Schicht (muster: null) nötig, gefunden: ${auffang}`);
  for (const s of schichten) {
    if (!Array.isArray(s.darf)) probleme.push(`"${s.id}": darf ist keine Liste`);
    else for (const z of s.darf) if (!ids.has(z)) probleme.push(`"${s.id}" darf unbekanntes Ziel "${z}" importieren`);
  }
  if (probleme.length) throw new Error(`SCHICHT_MODELL ungültig: ${probleme.join("; ")}`);
}

/** Ordnet einen (ggf. verdichteten) Pfad einer Schicht-/Extern-ID zu; `null` für alles andere. */
export function schichtVon(pfad, modell) {
  const p = String(pfad).replace(/\\/g, "/");
  for (const x of modell.extern) if (new RegExp(x.muster).test(p)) return x.id;
  for (const s of modell.schichten) if (s.muster && new RegExp(s.muster).test(p)) return s.id;
  const auffang = modell.schichten.find((s) => s.muster === null);
  return /^src\//.test(p) && auffang ? auffang.id : null;
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

/** Verdichtet das JSON von dependency-cruiser auf Schicht-Kanten; wirft bei einer Kante außerhalb des Solls. */
export function istKanten(cruiseJson, modell) {
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
      `Import-Richtung(en) außerhalb des Solls: ${sortiere(verboten, modell).map(([v, n]) => `${v} → ${n}`).join(", ")} (npm run check:arch müsste rot sein)`,
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
    const unten = s.muster === null ? AUFFANG_TEXT : s.wurzeln.join(" · ");
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
  pruefeModell(modell);
  return { modell, cfg };
}

export function schichtenSollGenerator(ctx) {
  const { modell } = geladenesModell(ctx);
  return renderDiagramm(modell, sollKanten(modell));
}

/** Startet dependency-cruiser (Argumente aus der Config) und liefert dessen JSON. */
function cruise(rootDir, args) {
  if (!Array.isArray(args) || args.length === 0) throw new Error('config.json: "schichten.cruise" fehlt');
  let out;
  try {
    out = execFileSync(process.execPath, args, { cwd: rootDir, encoding: "utf8", maxBuffer: 256 * MIB, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const detail = err instanceof Error ? err.message.split(/\r?\n/)[0] : String(err);
    throw new Error(`dependency-cruiser fehlgeschlagen (erst npm run check:arch grün machen): ${detail}`, { cause: err });
  }
  try {
    return JSON.parse(out);
  } catch {
    throw new Error("dependency-cruiser lieferte kein gültiges JSON");
  }
}

export function schichtenIstGenerator(ctx) {
  const { modell, cfg } = geladenesModell(ctx);
  const ist = istKanten(cruise(ctx.rootDir, cfg.cruise), modell);
  return `${renderDiagramm(modell, ist)}\n\n${ungenutztZeile(modell, sollKanten(modell), ist)}`;
}
