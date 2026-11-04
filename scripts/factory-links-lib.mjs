// Factory-Link-Bausteine (ADR 0022 F10, factory#130/factory#131; Kern): pure Teile des Link-Wächters, geteilt von `check-factory-links.mjs` und `factory-sync.mjs`
// (ein Einstiegsskript importiert kein anderes, `einstieg-importe`). Nichts hier liest oder schreibt Dateien: Texte kommen über einen Leser, Ergebnisse als Plan.
import { besitzSpannen, einheitAusId, eolVon, normalisiereEol } from "./besitz-lib.mjs";
import { codeMaskiert, collectHeadingSlugs, externeLinkStellen, schnappschussBloecke } from "./docs-gen/markdown.mjs";
import { factoryUrlTeile } from "./factory-seite.mjs";
import { globRegex } from "./pfad-glob.mjs";

export const INDEX_PFAD = ".factory/factory-links.json";

/** Zeile (1-basiert) einer Position im Text. */
const zeileVon = (md, pos) => md.slice(0, pos).split("\n").length;

/**
 * Pur: die Factory-Links (blob, tree, fremd) eines Markdown-Textes für das Repo `repo` (`owner/name`, Groß-/Kleinschreibung egal).
 * Stelle: `{ start, ende, zeile, url, form, ref, pfad, anker, refStart }`; Pfad und Anker sind dekodiert, Positionen gelten im Original.
 */
export function factoryLinkStellen(md, repo) {
  const stellen = [];
  for (const { start, ende, url } of externeLinkStellen(md)) {
    const k = factoryUrlTeile(url, repo);
    if (k) stellen.push({ start, ende, zeile: zeileVon(md, start), url, form: k.form, ref: k.ref, pfad: k.pfad, anker: k.anker, refStart: start + k.refOffset });
  }
  return stellen;
}

/** Zeilen (0-basiert) in den geschlossenen Schnappschuss-Blöcken (`schnappschussBloecke`; ein Start ohne Ende maskiert nichts, fail-closed); Marker in Code zählen nicht. */
function maskierteZeilen(text) {
  const aus = new Set();
  for (const [start, ende] of schnappschussBloecke(codeMaskiert(text).split("\n")).bloecke) for (let i = start; i <= ende; i++) aus.add(i);
  return aus;
}

/**
 * Alle erfassten Links im Umfang über einen Leser: `dateien` (repo-relative Pfade) und `lies(pfad)` (Text oder `null`). Ergebnis `{ datei, ...stelle }`,
 * in der Reihenfolge von `dateien`. `ausnahmen` sind Pfad-Globs (`factoryLinks.ausnahmen`), `einheiten` die Ids des Sync-Stands.
 */
export function sammleLinksAus({ dateien, lies }, { repo, einheiten = [], ausnahmen = [] }) {
  const besitz = einheiten.map(einheitAusId);
  const ausgenommen = ausnahmen.map(globRegex);
  const links = [];
  for (const datei of dateien) {
    if (ausgenommen.some((re) => re.test(datei))) continue;
    const text = lies(datei);
    if (text === null || text === undefined) continue;
    const aus = maskierteZeilen(text);
    const spannen = besitzSpannen(besitz, datei, text);
    for (const s of factoryLinkStellen(text, repo)) if (!aus.has(s.zeile - 1) && !spannen.some(([von, bis]) => s.start >= von && s.start <= bis)) links.push({ datei, ...s });
  }
  return links;
}

export const befund = (art, text, l) => ({ art, datei: l?.datei, zeile: l?.zeile, text });

/** Eine Befund-Zeile `datei:zeile: [art] text` (ohne Datei `[art] text`); einzige Quelle für Wächter und Sync. */
export const befundZeile = (b) => `${b.datei ? `${b.datei}:${b.zeile}: ` : ""}[${b.art}] ${b.text}`;

/** Pfad und Anker eines Links am Tag der Quelle: `pfad-tot` oder `anker-tot` als Befund, sonst `null`. */
export function zielBefund(l, leser) {
  const gibtEs = l.form === "tree" ? leser.pfade.some((p) => p.startsWith(`${l.pfad}/`)) : leser.pfade.includes(l.pfad);
  if (!gibtEs) return befund("pfad-tot", `${l.url}: ${l.pfad} gibt es am Tag nicht`, l);
  if (l.anker === "" || l.form !== "blob" || !l.pfad.endsWith(".md")) return null;
  return collectHeadingSlugs(leser.lies(l.pfad) ?? "").includes(l.anker) ? null : befund("anker-tot", `${l.url}: Anker #${l.anker} gibt es in ${l.pfad} am Tag nicht`, l);
}

/** Pur: den Text einer Datei mit allen Refs der übergebenen Links (alle aus dieser Datei) auf `tag` gesetzt; von hinten nach vorn, Zeilenenden bleiben, Links mit `ref === tag` bleiben. */
export function refsGesetzt(text, links, tag) {
  let neu = text;
  for (const l of [...links].filter((x) => x.ref !== tag).sort((a, b) => b.refStart - a.refStart)) neu = neu.slice(0, l.refStart) + tag + neu.slice(l.refStart + l.ref.length);
  return neu;
}

/** Index-Text: Schlüssel sortiert, je Pfad eine Zeile, abschließender Zeilenumbruch; ohne Ziele `"ziele": {}`. */
export function indexText({ repo, tag, commit }, links) {
  const ziele = new Map();
  for (const l of links) ziele.set(l.pfad, new Set([...(ziele.get(l.pfad) ?? []), l.anker]));
  const sortiert = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const zeilen = [...ziele.keys()].sort(sortiert).map((p) => `    ${JSON.stringify(p)}: ${JSON.stringify([...ziele.get(p)].sort(sortiert))}`);
  const kopf = `{\n  "repo": ${JSON.stringify(repo)},\n  "tag": ${JSON.stringify(tag)},\n  "commit": ${JSON.stringify(commit)},\n`;
  return zeilen.length === 0 ? `${kopf}  "ziele": {}\n}\n` : `${kopf}  "ziele": {\n${zeilen.join(",\n")}\n  }\n}\n`;
}

/**
 * Pur: Link-Plan auf einem Leser. Prüft jeden Link gegen den Baum des Tags (`leser`: `{ pfade, lies, vorladen }`; Befunde `form`, `pfad-tot`, `anker-tot`) und
 * setzt ohne Befund die Refs und den Index. Ergebnis `{ befunde, dateien, geschrieben, ziele, tag }`; `dateien` (Pfad → neuer Text) enthält nur Geändertes
 * (Index: nur wenn er sich CRLF-neutral ändert; Zeilenende der vorhandenen Datei bleibt), bei Befunden ist sie leer.
 */
export function planeFactoryLinks({ dateien, lies, repo, einheiten, ausnahmen, tag, commit, leser }) {
  const links = sammleLinksAus({ dateien, lies }, { repo, einheiten, ausnahmen });
  const echte = links.filter((l) => l.form !== "fremd");
  leser.vorladen(echte.filter((l) => l.anker !== "" && l.form === "blob" && l.pfad.endsWith(".md")).map((l) => l.pfad));
  const befunde = [
    ...links.filter((l) => l.form === "fremd").map((l) => befund("form", `${l.url}: keine geprüfte Form (erwartet blob oder tree, Ref, Pfad, optional Anker)`, l)),
    ...echte.map((l) => zielBefund(l, leser)).filter(Boolean),
  ];
  const ergebnis = { befunde, dateien: new Map(), geschrieben: echte.length, ziele: new Set(echte.map((l) => l.pfad)).size, tag };
  if (befunde.length > 0) return { ...ergebnis, geschrieben: 0, ziele: 0 };
  const jeDatei = new Map();
  for (const l of echte) jeDatei.set(l.datei, [...(jeDatei.get(l.datei) ?? []), l]);
  for (const [datei, liste] of jeDatei) {
    const text = lies(datei);
    const neu = refsGesetzt(text, liste, tag);
    if (neu !== text) ergebnis.dateien.set(datei, neu);
  }
  const alt = lies(INDEX_PFAD);
  const soll = indexText({ repo, tag, commit }, echte);
  if (alt === null || alt === undefined || normalisiereEol(alt) !== soll) {
    const eol = alt === null || alt === undefined ? "\n" : eolVon(alt);
    ergebnis.dateien.set(INDEX_PFAD, eol === "\n" ? soll : soll.replace(/\n/g, eol));
  }
  return ergebnis;
}
