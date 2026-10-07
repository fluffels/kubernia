// Kein Shebang (siehe docs-gen.mjs). Generator `zeitleiste` (#1367): Tabelle „Datum | Was passierte“
// aus den ADR-Köpfen (docs/adr/NNNN-*.md) und einer kleinen Meilenstein-Datei für Ereignisse ohne ADR.
// Das Datum kommt aus dem ADR-Kopf, nicht aus `git log` (flacher CI-Klon, Ausgabe bleibt deterministisch).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brauche, byCodeUnit, renderTable } from "./markdown.mjs";

// Kopf-Formate als Konstanten (projektabhängig, Pfade stehen in der Config).
const ADR_FILE = /^(\d{4})-.+\.md$/;
const ADR_H1 = /^# ADR (\d{4}): (.+?)\s*$/;
const DATE_KEY = /Datum:\s*([^\s·]+)/;
// Status: Blockquote-Kopf "Status: **akzeptiert**" oder Listenform "- **Status:** akzeptiert (JJJJ-MM-TT)".
const STATUS_QUOTE = /\bStatus:\s*\*\*([^*\n]+)\*\*/;
const STATUS_LIST = /\*\*Status:\*\*\s*([^(·\n]+?)\s*(?:[(·]|$)/m;
const DATE_STATUS = /\*\*Status:\*\*[^\n]*\(([^)\s]+)\)/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Gültiges Kalenderdatum (ohne Locale): UTC-Roundtrip muss die Komponenten zurückgeben. */
function validIso(s) {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

const german = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Kopf = alles von der H1 bis vor die erste `## `-Überschrift. */
function head(text) {
  const i = text.search(/^## /m);
  return i < 0 ? text : text.slice(0, i);
}

/** Liest alle ADR-Köpfe (Nummer, Titel, Datum, Status); Formatfehler landen in `errors`. */
export function readAdrs(rootDir, dir, errors) {
  const adrs = [];
  const seen = new Set();
  const names = readdirSync(join(rootDir, dir), { withFileTypes: true })
    .filter((e) => e.isFile() && ADR_FILE.test(e.name))
    .map((e) => e.name)
    .sort(byCodeUnit);
  for (const name of names) {
    const nr = ADR_FILE.exec(name)[1];
    const text = readFileSync(join(rootDir, dir, name), "utf8");
    const h1 = ADR_H1.exec(text.split(/\r?\n/).find((l) => l.startsWith("# ")) ?? "");
    if (!h1) {
      errors.push(`${dir}/${name}: erste Überschrift muss "# ADR ${nr}: Titel" lauten`);
      continue;
    }
    if (h1[1] !== nr) {
      errors.push(`${dir}/${name}: Überschrift nennt ADR ${h1[1]}, der Dateiname ${nr}`);
      continue;
    }
    if (seen.has(nr)) {
      errors.push(`${dir}/${name}: ADR-Nummer ${nr} kommt doppelt vor`);
      continue;
    }
    seen.add(nr);
    const h = head(text);
    const date = (DATE_KEY.exec(h) ?? DATE_STATUS.exec(h))?.[1];
    if (!date) {
      errors.push(`${dir}/${name}: kein Datum im Kopf (erwartet "Datum: JJJJ-MM-TT" oder "**Status:** … (JJJJ-MM-TT)" vor der ersten ##-Überschrift)`);
    } else if (!validIso(date)) {
      errors.push(`${dir}/${name}: ungültiges Datum ${date}`);
    } else {
      const status = (STATUS_QUOTE.exec(h) ?? STATUS_LIST.exec(h))?.[1].trim();
      if (!status) errors.push(`${dir}/${name}: kein Status im Kopf (erwartet "Status: **…**" oder "- **Status:** …")`);
      else adrs.push({ nr, date, status, title: h1[2], link: `/${dir}/${name}`, order: 0, text: `[ADR ${nr}](/${dir}/${name}): ${h1[2]}` });
    }
  }
  return adrs;
}

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

/** Generator `adr-liste` (#1392): Tabelle aller ADRs (Nummer, Titel, Status, Datum) aus den ADR-Köpfen. */
export function adrListeGenerator({ rootDir, config }) {
  const dir = config.zeitleiste?.adr;
  if (!dir) throw new Error('Config-Block "zeitleiste" mit "adr" fehlt');
  const errors = [];
  const adrs = brauche(rootDir, dir, "ADR-Ordner", errors) ? readAdrs(rootDir, dir, errors) : [];
  if (errors.length) throw new Error(errors.join("; "));
  return renderTable(
    ["ADR", "Titel", "Status", "Datum"],
    adrs.map((a) => [`[${a.nr}](${a.link})`, a.title, a.status, german(a.date)]),
  );
}
