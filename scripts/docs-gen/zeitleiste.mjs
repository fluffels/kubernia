// Kein Shebang (siehe docs-gen.mjs). Generator `zeitleiste` (#1367): Tabelle „Datum | Was passierte“
// aus den ADR-Köpfen (docs/adr/NNNN-*.md, gelesen von adr.mjs) und einer kleinen Meilenstein-Datei für Ereignisse ohne ADR.
// Das Datum kommt aus dem ADR-Kopf, nicht aus `git log` (flacher CI-Klon, Ausgabe bleibt deterministisch).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brauche, byCodeUnit, renderTable } from "./markdown.mjs";
import { german, readAdrs, validIso } from "./adr.mjs";

function readMeilensteine(rootDir, file, errors) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(rootDir, file), "utf8"));
  } catch (err) {
    errors.push(`${file}: nicht lesbar (${err instanceof Error ? err.message : err})`);
    return [];
  }
  if (!Array.isArray(data?.meilensteine)) {
    errors.push(`${file}: "meilensteine" muss ein Array sein`);
    return [];
  }
  const rows = [];
  data.meilensteine.forEach((m, i) => {
    if (typeof m?.datum !== "string" || !validIso(m.datum)) errors.push(`${file}: Meilenstein ${i}: "datum" fehlt oder ist kein gültiges JJJJ-MM-TT`);
    else if (typeof m.text !== "string" || m.text.trim() === "") errors.push(`${file}: Meilenstein ${i}: "text" fehlt oder ist leer`);
    else rows.push({ date: m.datum, order: 1, text: m.text });
  });
  return rows;
}

export function zeitleisteGenerator({ rootDir, config }) {
  const c = config.zeitleiste;
  if (!c?.adr || !c?.meilensteine) throw new Error('Config-Block "zeitleiste" mit "adr" und "meilensteine" fehlt');
  const errors = [];
  const rows = [];
  if (brauche(rootDir, c.adr, "ADR-Ordner", errors)) rows.push(...readAdrs(rootDir, c.adr, errors));
  if (brauche(rootDir, c.meilensteine, "Meilenstein-Datei", errors)) rows.push(...readMeilensteine(rootDir, c.meilensteine, errors));
  if (errors.length) throw new Error(errors.join("; "));
  // Array.prototype.sort ist stabil: Gleichstand ADR (order 0, nach Nummer eingelesen) vor Meilenstein (order 1, Dateireihenfolge).
  rows.sort((a, b) => byCodeUnit(a.date, b.date) || a.order - b.order);
  return renderTable(["Datum", "Was passierte"], rows.map((r) => [german(r.date), r.text]));
}

