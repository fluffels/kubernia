// Besitz-Manifest-Leser und Bearbeitungs-Primitive (ADR 0022 F9): Einheiten des Besitz-Manifests `.factory/besitz.json`
// (ganze Datei, Markdown-Block zwischen Markern, JSON-Schlüssel der obersten Ebene) lesen, prüfen, hashen und setzen.
// Nur Node-Builtins; Sync-Werkzeug, Drift-Gate und Kern-Wächter teilen diese eine Auslegung.
import { createHash } from "node:crypto";

export const RINGE = ["kern", "kern-nach-entkopplung"];

export const markerStart = (id) => `<!-- factory-besitz:start ${id} -->`;
export const markerEnde = (id) => `<!-- factory-besitz:ende ${id} -->`;

/** Zeilenenden auf LF (Hash und Vergleich sind CRLF-neutral). */
export const normalisiereEol = (text) => text.replace(/\r\n/g, "\n");

/** Zeilenende-Stil eines Textes: CRLF, sobald eines vorkommt, sonst LF. */
export const eolVon = (text) => (text.includes("\r\n") ? "\r\n" : "\n");

export function einheitId(e) {
  if (e.block !== undefined) return `${e.pfad}#${e.block}`;
  if (e.schluessel !== undefined) return `${e.pfad}#/${e.schluessel}`;
  return e.pfad;
}

const zaehleVorkommen = (text, s) => text.split(s).length - 1;

/** Text der Einheit oder `null`, wenn Block/Schlüssel nicht auflösbar ist. */
export function einheitText(e, text) {
  if (e.block !== undefined) {
    const a = text.indexOf(markerStart(e.block));
    const b = text.indexOf(markerEnde(e.block));
    if (a < 0 || b < a) return null;
    return text.slice(a, b + markerEnde(e.block).length);
  }
  if (e.schluessel !== undefined) {
    try {
      const j = JSON.parse(text);
      return e.schluessel in j ? JSON.stringify(j[e.schluessel]) : null;
    } catch {
      return null;
    }
  }
  return text;
}

/** Ein Manifest-Pfad bleibt im Projekt: relativ, Schrägstrich-Form, keine leeren oder `..`-Segmente. */
export function pfadSicher(pfad) {
  if (typeof pfad !== "string" || pfad === "" || pfad.startsWith("/") || pfad.includes("\\") || /^[A-Za-z]:/.test(pfad)) return false;
  return pfad.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/** Manifest-Fehler (leer = gültig). `lies` liefert den Dateitext oder `null`. */
export function pruefeManifest(m, lies) {
  const out = [];
  if (m.version !== 1) out.push(`version ${String(m.version)} unbekannt (erwartet 1)`);
  const ids = new Set();
  const ganze = new Set();
  const teile = new Set();
  for (const e of m.eintraege) {
    const id = einheitId(e);
    if (!pfadSicher(e.pfad)) {
      out.push(`${id}: Pfad unsicher (absolut, '..', Backslash oder leeres Segment)`);
      continue;
    }
    if (ids.has(id)) out.push(`${id}: doppelte Einheit`);
    ids.add(id);
    if (!RINGE.includes(e.ring)) out.push(`${id}: unbekannter Ring '${e.ring}'`);
    if (e.quelle.trim() === "") out.push(`${id}: quelle fehlt`);
    if (e.block !== undefined && e.schluessel !== undefined) out.push(`${id}: block und schluessel zugleich`);
    if (e.block === undefined && e.schluessel === undefined) ganze.add(e.pfad);
    else teile.add(e.pfad);
    const text = lies(e.pfad);
    if (text === null) {
      out.push(`${id}: Pfad existiert nicht`);
      continue;
    }
    if (e.block !== undefined) {
      const na = zaehleVorkommen(text, markerStart(e.block));
      const nb = zaehleVorkommen(text, markerEnde(e.block));
      if (na !== 1 || nb !== 1) out.push(`${id}: Marker müssen je genau einmal stehen (start ${na}, ende ${nb})`);
      else if (einheitText(e, text) === null) out.push(`${id}: Ende-Marker steht vor dem Start-Marker`);
    } else if (e.schluessel !== undefined && einheitText(e, text) === null) {
      out.push(`${id}: JSON-Schlüssel fehlt oder Datei ist kein gültiges JSON`);
    }
  }
  for (const p of ganze) if (teile.has(p)) out.push(`${p}: Datei ganz und als Teil-Einheit gelistet`);
  return out;
}

/** `sha256:<hex>` über den LF-normalisierten Einheitentext, `null` wenn die Einheit nicht auflösbar ist. */
export function einheitHash(e, text) {
  const t = einheitText(e, text);
  if (t === null) return null;
  return `sha256:${createHash("sha256").update(normalisiereEol(t)).digest("hex")}`;
}

/** `sha256:<hex>` über einen Text, LF-normalisiert. */
export function textHash(text) {
  return `sha256:${createHash("sha256").update(normalisiereEol(text)).digest("hex")}`;
}

// ── JSON-Schlüssel der obersten Ebene als Textbereich ─────────────────────────

const WS = /\s/;

function ueberspringeWs(t, i) {
  while (i < t.length && WS.test(t[i])) i++;
  return i;
}

function stringEnde(t, i) {
  // t[i] ist das öffnende Anführungszeichen; Rückgabe: Index nach dem schließenden.
  i++;
  while (i < t.length) {
    if (t[i] === "\\") i += 2;
    else if (t[i] === '"') return i + 1;
    else i++;
  }
  throw new Error("JSON: Zeichenkette nicht abgeschlossen");
}

function wertEnde(t, i) {
  const c = t[i];
  if (c === '"') return stringEnde(t, i);
  if (c === "{" || c === "[") {
    let tiefe = 0;
    while (i < t.length) {
      const z = t[i];
      if (z === '"') {
        i = stringEnde(t, i);
        continue;
      }
      if (z === "{" || z === "[") tiefe++;
      else if (z === "}" || z === "]") tiefe--;
      i++;
      if (tiefe === 0) return i;
    }
    throw new Error("JSON: Klammer nicht abgeschlossen");
  }
  while (i < t.length && !/[\s,}\]]/.test(t[i])) i++;
  return i;
}

/** Alle Eigenschaften der obersten Ebene: `{ name, start, ende, keyStart }` (Textbereich des Werts). Wirft bei ungültigem JSON,
 *  Wurzel ohne Objekt und doppeltem Schlüssel. */
function eigenschaften(text) {
  JSON.parse(text); // wirft bei ungültigem JSON
  const start = ueberspringeWs(text, 0);
  if (text[start] !== "{") throw new Error("JSON: Wurzel ist kein Objekt");
  const out = [];
  const gesehen = new Set();
  let i = ueberspringeWs(text, start + 1);
  while (text[i] !== "}") {
    const keyStart = i;
    const keyEnde = stringEnde(text, i);
    const name = JSON.parse(text.slice(keyStart, keyEnde));
    if (gesehen.has(name)) throw new Error(`JSON: doppelter Schlüssel '${name}' auf oberster Ebene`);
    gesehen.add(name);
    i = ueberspringeWs(text, keyEnde);
    i = ueberspringeWs(text, i + 1); // ':'
    const vStart = i;
    const vEnde = wertEnde(text, i);
    out.push({ name, keyStart, start: vStart, ende: vEnde });
    i = ueberspringeWs(text, vEnde);
    if (text[i] === ",") i = ueberspringeWs(text, i + 1);
  }
  return { objStart: start, objEnde: i, eigenschaften: out };
}

/** Textbereich `{ start, ende }` des Werts von `schluessel` oder `null`, wenn er fehlt. */
export function jsonSchluesselSpanne(text, schluessel) {
  const p = eigenschaften(text).eigenschaften.find((x) => x.name === schluessel);
  return p ? { start: p.start, ende: p.ende } : null;
}

/** Ersetzt den Werttext von `schluessel` wörtlich durch `wertText`; fehlt der Schlüssel, wird er als letzte Eigenschaft
 *  eingefügt (Einrückung der ersten Eigenschaft, Zeilenende des Textes). Alles andere bleibt byte-gleich. */
export function setzeJsonSchluessel(text, schluessel, wertText) {
  const info = eigenschaften(text);
  const vorhanden = info.eigenschaften.find((x) => x.name === schluessel);
  if (vorhanden) return text.slice(0, vorhanden.start) + wertText + text.slice(vorhanden.ende);
  const eol = eolVon(text);
  const zeile = `${JSON.stringify(schluessel)}: ${wertText}`;
  if (info.eigenschaften.length === 0) return `${text.slice(0, info.objStart)}{${eol}  ${zeile}${eol}${text.slice(info.objEnde)}`;
  const erste = info.eigenschaften[0];
  const letzte = info.eigenschaften[info.eigenschaften.length - 1];
  const dazwischen = text.slice(info.objStart + 1, erste.keyStart);
  const nl = dazwischen.lastIndexOf("\n");
  const trenner = nl < 0 ? " " : `${eol}${dazwischen.slice(nl + 1)}`;
  return `${text.slice(0, letzte.ende)},${trenner}${zeile}${text.slice(letzte.ende)}`;
}

/** Ersetzt den Bereich vom Start- bis einschließlich Ende-Marker durch `blockText`; fehlen die Marker, ist das ein Fehler. */
export function setzeBlock(text, block, blockText) {
  const na = zaehleVorkommen(text, markerStart(block));
  const nb = zaehleVorkommen(text, markerEnde(block));
  if (na !== 1 || nb !== 1) throw new Error(`Block '${block}': Marker müssen im Ziel je genau einmal stehen (start ${na}, ende ${nb})`);
  const a = text.indexOf(markerStart(block));
  const b = text.indexOf(markerEnde(block));
  if (b < a) throw new Error(`Block '${block}': Ende-Marker steht vor dem Start-Marker`);
  return text.slice(0, a) + blockText + text.slice(b + markerEnde(block).length);
}
