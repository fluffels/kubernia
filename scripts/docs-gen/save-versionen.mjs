// Kein Shebang (siehe docs-gen.mjs). Generator `save-versionen` (#1370): die Save-Versionskette
// v0 → … → CURRENT als Mermaid-Diagramm plus Tabelle. Die Zahl CURRENT kommt aus dem Quelltext
// (`CURRENT_SAVE_VERSION`), die Kurzbeschreibung je Schritt aus `src/store/save-versionen.json`.
// Eine Migration ohne Beschreibung (oder eine Beschreibung ohne Migration) macht den Generator und damit
// `check:docgen` rot; ob ein Schritt additiv oder strukturell ist, bindet ein Test an `migrationsSchritte()`.
import { MERMAID_FRONTMATTER, byCodeUnit, ganzzahlKonstante, leseJson, mermaidText, renderTable } from "./markdown.mjs";

const ARTEN = ["additiv", "strukturell"];
const MAX_BESCHREIBUNG = 100;

function lies(rootDir, cfg) {
  const pfad = cfg?.beschreibungen;
  if (!pfad) throw new Error("config.saveVersionen.beschreibungen fehlt");
  const roh = leseJson(rootDir, pfad, "Beschreibungen");
  if (!Array.isArray(roh)) throw new Error(`${pfad} muss ein Array sein`);
  return { pfad, roh };
}

function pruefeSchritt(s, pfad) {
  const wo = `${pfad}: Eintrag ${JSON.stringify(s?.von ?? s)}`;
  if (typeof s !== "object" || s === null) throw new Error(`${wo} ist kein Objekt`);
  if (!Number.isInteger(s.von) || s.von < 0) throw new Error(`${wo}: von muss eine Ganzzahl ≥ 0 sein`);
  if (!ARTEN.includes(s.art)) throw new Error(`${wo}: art muss ${ARTEN.join(" oder ")} sein`);
  if (s.ticket !== null && !(Number.isInteger(s.ticket) && s.ticket > 0)) throw new Error(`${wo}: ticket muss eine positive Ganzzahl oder null sein`);
  if (typeof s.beschreibung !== "string" || s.beschreibung.trim() === "") throw new Error(`${wo}: beschreibung fehlt`);
  if (s.beschreibung.length > MAX_BESCHREIBUNG) throw new Error(`${wo}: beschreibung hat mehr als ${MAX_BESCHREIBUNG} Zeichen (Kurzbeschreibung, Details stehen im Kommentar der Migration)`);
}

/** Generator `save-versionen`: `({rootDir, config}) => string`. */
export function saveVersionenGenerator({ rootDir, config }) {
  const cfg = config.saveVersionen;
  const { pfad, roh } = lies(rootDir, cfg);
  const v = cfg.version;
  if (!v?.datei || !v?.name) throw new Error("config.saveVersionen.version {datei, name} fehlt");
  const aktuell = Number(ganzzahlKonstante(rootDir, v.datei, v.name));
  for (const s of roh) pruefeSchritt(s, pfad);
  const schritte = [...roh].sort((a, b) => a.von - b.von || byCodeUnit(a.beschreibung, b.beschreibung));
  for (let i = 1; i < schritte.length; i++) {
    if (schritte[i].von === schritte[i - 1].von) throw new Error(`${pfad}: Schritt ${schritte[i].von} → ${schritte[i].von + 1} steht doppelt`);
  }
  for (let n = 0; n < aktuell; n++) {
    if (!schritte.some((s) => s.von === n)) {
      throw new Error(`Migration ${n} → ${n + 1} hat keine Beschreibung in ${pfad}. Fix: Eintrag { "von": ${n}, ... } ergänzen, dann npm run docs:gen`);
    }
  }
  const zuviel = schritte.find((s) => s.von >= aktuell);
  if (zuviel) throw new Error(`${pfad}: Schritt ${zuviel.von} → ${zuviel.von + 1} gehört nicht zur Kette (${v.name} = ${aktuell}); Eintrag entfernen`);

  const knoten = [];
  for (let n = 0; n < aktuell; n++) knoten.push(`  v${n}["v${n}"]`);
  knoten.push(`  v${aktuell}[["v${aktuell} · aktuell"]]`);
  const kanten = schritte.map((s) => {
    const pfeil = s.art === "strukturell" ? "==>" : "-->";
    const label = s.ticket === null ? "" : `|"${mermaidText(`#${s.ticket}`)}"|`;
    return `  v${s.von} ${pfeil}${label} v${s.von + 1}`;
  });
  const diagramm = ["```mermaid", MERMAID_FRONTMATTER, "flowchart TB", ...knoten, ...kanten, "```"].join("\n");
  const tabelle = renderTable(
    ["Schritt", "Ticket", "Art", "Kurzbeschreibung"],
    schritte.map((s) => [`${s.von} → ${s.von + 1}`, s.ticket === null ? "–" : `#${s.ticket}`, s.art, s.beschreibung]),
  );
  return `${diagramm}\n\n${tabelle}`;
}
