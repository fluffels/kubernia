// Factory-Link-Wächter (ADR 0022 F10, #1966): Links ins Factory-Repo stehen auf dem Sync-Tag und zeigen auf Pfade und Anker, die es dort gibt.
// `node scripts/check-factory-links.mjs [--wurzel <pfad>]` prüft hermetisch (kein Git, kein Netz): Doku-Links gegen den Index `.factory/factory-links.json`,
// der selbst zu `.factory/sync-stand.json` › `quelle` passen muss. `--schreiben --quelle <klon>` schreibt nach einem Sync auf einen neuen Tag
// die Refs um und erzeugt den Index aus dem Tag der Quelle (Klon des Factory-Repos): Befund ⇒ nichts geschrieben, Exit 1.
// Exit 0 grün, 1 Befund, 2 Aufruf.
//
// Scan-Umfang (geschlossene Liste), Faktenquelle ist dieser Kopfkommentar:
//   erfasst:        Inline-Link und Bild `[t](url)` (auch `[t](<url>)`) und Autolink `<url>`, jeweils nach dem Maskieren von Code-Fences und Inline-Code;
//                   die URL `https://github.com/<repo>/(blob|tree)/<ref>/<pfad>[#anker]` mit `<repo>` aus `.factory/projekt.json` (Board mit Rolle `factory`).
//   nicht erfasst:  nackte URLs im Text, Referenz-Links (`[t][r]`, `[r]: url`), Links auf `/issues` und `/pull`, die Repo-Wurzel.
//   ausgenommen:    Dateien `AUSNAHMEN` (ADRs, Lessons Learned, Gegenproben), Schnappschuss-Blöcke, Besitz-Einheiten (`sync-stand.einheiten`: ganze `*.md`-
//                   Dateien und Blöcke `datei#id` zwischen den Besitz-Markern; JSON-Schlüssel-Einheiten `#/…` tragen keine Doku-Links).
//   rot (`form`):   jede andere URL auf dieses Repo (z.B. `/commit/<sha>`, `/blob/<ref>` ohne Pfad), damit kein Link ungeprüft bleibt.
// Bekannte Grenzen: der Index unterscheidet blob und tree nicht; Anker nur bei `blob` auf `*.md` (GitHub-Slugs); `codeMaskiert` ist eine Kopie aus
// `docs-gen/markdown.mjs` (nicht exportiert dort).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectMarkdown } from "./check-basis.mjs";
import { markerEnde, markerStart } from "./besitz-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { collectHeadingSlugs, fenceMaske } from "./docs-gen/markdown.mjs";
import { leserVomCommit } from "./factory-sync-lib.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";

// ── PROJEKTWERTE (hier steht das Projektspezifische; der Rest sind reine, parametrisierte Funktionen) ──
/** Dateien ohne Prüfung: ADRs und datierte Schnappschüsse nennen bewusst den damaligen Stand (Brain-Regel: historisch, nie umschreiben). */
export const AUSNAHMEN = [
  (pfad) => pfad.startsWith("docs/adr/"),
  (pfad) => pfad === "docs/lessons-learned.md",
  (pfad) => /^docs\/[^/]*-gegenprobe-[^/]*\.md$/.test(pfad),
];
/** Marker eines Schnappschuss-Blocks (Glossar „Schnappschuss-Block“). */
export const SCHNAPPSCHUSS_START = "<!-- schnappschuss:start -->";
export const SCHNAPPSCHUSS_ENDE = "<!-- schnappschuss:ende -->";
// ── Ende PROJEKTWERTE ──

const INDEX_PFAD = ".factory/factory-links.json";
const STAND_PFAD = ".factory/sync-stand.json";
const CONFIG_PFAD = ".factory/projekt.json";
const SCHREIB_WEG = "Weg: `npm run check:factorylinks -- --schreiben --quelle <klon des Factory-Repos>`";

/** Kopie von `codeMaskiert` aus docs-gen/markdown.mjs (dort nicht exportiert): Code-Fences und Inline-Code längentreu zu Leerzeichen. */
function codeMaskiert(md) {
  const zeilen = md.split("\n");
  const maske = fenceMaske(zeilen.map((z) => z.replace(/\r$/, "")));
  return zeilen
    .map((z, i) => (maske[i] ? z.replace(/[^\r]/g, " ") : z.replace(/`[^`\n]*`/g, (s) => " ".repeat(s.length))))
    .join("\n");
}

const dekodiert = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Ordnet eine URL zu: `null` (nicht dieses Repo oder bewusst nicht erfasst) oder `{ form, ref, pfad, anker, refOffset }` (`form` blob|tree|fremd). */
function klassifiziere(url, repo) {
  const basis = `https://github.com/${repo}`;
  if (url.slice(0, basis.length).toLowerCase() !== basis.toLowerCase()) return null;
  const rest = url.slice(basis.length);
  if (rest !== "" && !/^[/?#]/.test(rest)) return null; // anderes Repo mit gleichem Namensanfang
  if (/^\/?$/.test(rest) || /^[?#]/.test(rest) || /^\/(?:issues|pull)(?:[/?#]|$)/.test(rest)) return null;
  const m = /^\/(blob|tree)\/([^/?#]+)\/([^?#]+)(?:#(.*))?$/.exec(rest);
  if (!m) return { form: "fremd", ref: "", pfad: "", anker: "", refOffset: 0 };
  return { form: m[1], ref: m[2], pfad: dekodiert(m[3]), anker: dekodiert(m[4] ?? ""), refOffset: basis.length + m[1].length + 2 };
}

/** Zeile (1-basiert) einer Position im Text. */
const zeileVon = (md, pos) => md.slice(0, pos).split("\n").length;

/** Alle URL-Kandidaten (Inline-Link/Bild und Autolink) mit Position im maskierten, längentreuen Text. */
function urlKandidaten(maskiert) {
  const out = [];
  const spannen = [];
  for (const m of maskiert.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>\n]*)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/dg)) {
    const [start, ende] = m.indices[1] ?? m.indices[2];
    out.push({ start, ende });
    spannen.push([m.index, m.index + m[0].length]);
  }
  for (const m of maskiert.matchAll(/<(https?:\/\/[^>\s]+)>/dg)) {
    if (spannen.some(([a, b]) => m.index >= a && m.index < b)) continue; // `[t](<url>)` ist schon erfasst
    out.push({ start: m.indices[1][0], ende: m.indices[1][1] });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Pur: die Factory-Links (blob, tree, fremd) eines Markdown-Textes für das Repo `repo` (`owner/name`, Groß-/Kleinschreibung egal).
 * Stelle: `{ start, ende, zeile, url, form, ref, pfad, anker, refStart }`; Pfad und Anker sind dekodiert, Positionen gelten im Original.
 */
export function factoryLinkStellen(md, repo) {
  const stellen = [];
  for (const { start, ende } of urlKandidaten(codeMaskiert(md))) {
    const url = md.slice(start, ende);
    const k = klassifiziere(url, repo);
    if (k) stellen.push({ start, ende, zeile: zeileVon(md, start), url, form: k.form, ref: k.ref, pfad: k.pfad, anker: k.anker, refStart: start + k.refOffset });
  }
  return stellen;
}

export const istAusgenommen = (pfad) => AUSNAHMEN.some((f) => f(pfad));

/** Zeilen (0-basiert) im Schnappschuss-Block und in den Besitz-Blöcken `ids` dieser Datei. */
function maskierteZeilen(zeilen, ids) {
  const aus = new Set();
  const bloecke = [[SCHNAPPSCHUSS_START, SCHNAPPSCHUSS_ENDE], ...ids.map((id) => [markerStart(id), markerEnde(id)])];
  for (const [start, ende] of bloecke) {
    let offen = false;
    zeilen.forEach((z, i) => {
      const t = z.trim();
      if (t === start) offen = true;
      if (offen) aus.add(i);
      if (t === ende) offen = false;
    });
  }
  return aus;
}

/** Besitz-Einheiten-IDs aufgeteilt: ganze Markdown-Dateien und Blöcke je Datei. */
function einheitenAufteilen(einheiten) {
  const ganz = new Set();
  const bloecke = new Map();
  for (const id of einheiten) {
    const [pfad, block] = id.split("#");
    if (block === undefined) {
      if (pfad.endsWith(".md")) ganz.add(pfad);
    } else if (!block.startsWith("/")) bloecke.set(pfad, [...(bloecke.get(pfad) ?? []), block]);
  }
  return { ganz, bloecke };
}

/** Alle erfassten Links im Umfang: `{ datei, ...stelle }`, sortiert nach Datei und Position. */
export function sammleLinks(rootDir, { repo, einheiten = [] }) {
  const { ganz, bloecke } = einheitenAufteilen(einheiten);
  const links = [];
  for (const datei of collectMarkdown(rootDir)) {
    if (istAusgenommen(datei) || ganz.has(datei)) continue;
    const text = readFileSync(join(rootDir, ...datei.split("/")), "utf8");
    const aus = maskierteZeilen(text.split("\n"), bloecke.get(datei) ?? []);
    for (const s of factoryLinkStellen(text, repo)) if (!aus.has(s.zeile - 1)) links.push({ datei, ...s });
  }
  return links;
}

const befund = (art, text, l) => ({ art, datei: l?.datei, zeile: l?.zeile, text });
const paarSchluessel = (pfad, anker) => `${pfad}\0${anker}`;

/** Sync-Stand und Index gegeneinander und gegen die Config: `index-fehlt`, `sync-stand`, `index-stand`. */
function standBefunde({ index, sync, repo }) {
  const quelle = sync?.quelle;
  if (!quelle?.tag || !quelle?.commit) return [befund("sync-stand", `${STAND_PFAD} fehlt oder hat keine quelle.tag/quelle.commit (Sync von einem Tag)`)];
  if (!index) return [befund("index-fehlt", `${INDEX_PFAD} fehlt oder ist kein JSON. ${SCHREIB_WEG}`)];
  const out = [];
  if (index.repo !== repo) out.push(befund("index-stand", `${INDEX_PFAD}: repo ${index.repo} ≠ ${repo} aus ${CONFIG_PFAD}. ${SCHREIB_WEG}`));
  if (index.tag !== quelle.tag) out.push(befund("index-stand", `${INDEX_PFAD}: tag ${index.tag} ≠ Sync-Tag ${quelle.tag}. ${SCHREIB_WEG}`));
  if (index.commit !== quelle.commit) out.push(befund("index-stand", `${INDEX_PFAD}: commit ${index.commit} ≠ ${quelle.commit} aus ${STAND_PFAD}. ${SCHREIB_WEG}`));
  return out;
}

/** Links gegen Sync-Tag und Index: `form`, `ref`, `nicht-im-index`; dazu `verwaist` für Index-Einträge ohne Link. */
function linkBefunde({ links, index, sync }) {
  const tag = sync.quelle.tag;
  const imIndex = new Set(Object.entries(index.ziele ?? {}).flatMap(([pfad, anker]) => anker.map((a) => paarSchluessel(pfad, a))));
  const benutzt = new Set();
  const out = [];
  for (const l of links) {
    if (l.form === "fremd") {
      out.push(befund("form", `${l.url}: keine geprüfte Form (erwartet /blob|tree/<ref>/<pfad>[#anker])`, l));
      continue;
    }
    benutzt.add(paarSchluessel(l.pfad, l.anker));
    if (l.ref !== tag) out.push(befund("ref", `${l.url}: Ref ${l.ref} ≠ Sync-Tag ${tag}. ${SCHREIB_WEG}`, l));
    if (!imIndex.has(paarSchluessel(l.pfad, l.anker))) out.push(befund("nicht-im-index", `${l.url}: ${l.pfad}${l.anker ? `#${l.anker}` : ""} steht nicht im Index. ${SCHREIB_WEG}`, l));
  }
  for (const [pfad, anker] of Object.entries(index.ziele ?? {})) {
    for (const a of anker) if (!benutzt.has(paarSchluessel(pfad, a))) out.push(befund("verwaist", `${INDEX_PFAD}: ${pfad}${a ? `#${a}` : ""} wird von keinem Link genutzt. ${SCHREIB_WEG}`));
  }
  return out;
}

/** Pur: alle Befunde des Prüfmodus (Art `index-fehlt`, `sync-stand`, `index-stand`, `form`, `ref`, `nicht-im-index`, `verwaist`). */
export function pruefeIndex({ links, index, sync, repo }) {
  const stand = standBefunde({ index, sync, repo });
  if (stand.some((b) => b.art === "index-fehlt" || b.art === "sync-stand")) return stand;
  return [...stand, ...linkBefunde({ links, index, sync })];
}

const liesJson = (rootDir, rel) => {
  const voll = join(rootDir, ...rel.split("/"));
  if (!existsSync(voll)) return null;
  try {
    return JSON.parse(readFileSync(voll, "utf8"));
  } catch {
    return null;
  }
};

/** Das Factory-Repo aus der Projekt-Config (Board mit Rolle `factory`) oder `null`. */
const factoryRepo = (config) => config?.boards?.find((b) => b.rolle === "factory")?.repo ?? null;

/** Prüfmodus auf einem Projektbaum: `{ befunde, links }`; ohne Factory-Board in der Config ein Befund (`projekt`). */
export function auditFactoryLinks(rootDir) {
  const repo = factoryRepo(liesJson(rootDir, CONFIG_PFAD));
  if (!repo) return { befunde: [befund("projekt", `${CONFIG_PFAD}: kein Board mit Rolle factory`)], links: [] };
  const sync = liesJson(rootDir, STAND_PFAD);
  const links = sammleLinks(rootDir, { repo, einheiten: Object.keys(sync?.einheiten ?? {}) });
  return { befunde: pruefeIndex({ links, index: liesJson(rootDir, INDEX_PFAD), sync, repo }), links };
}

/** Pfad und Anker eines Links am Tag der Quelle: `pfad-tot` oder `anker-tot` als Befund, sonst `null`. */
function zielBefund(l, leser) {
  const gibtEs = l.form === "tree" ? leser.pfade.some((p) => p.startsWith(`${l.pfad}/`)) : leser.pfade.includes(l.pfad);
  if (!gibtEs) return befund("pfad-tot", `${l.url}: ${l.pfad} gibt es am Tag nicht`, l);
  if (l.anker === "" || l.form !== "blob" || !l.pfad.endsWith(".md")) return null;
  return collectHeadingSlugs(leser.lies(l.pfad) ?? "").includes(l.anker) ? null : befund("anker-tot", `${l.url}: Anker #${l.anker} gibt es in ${l.pfad} am Tag nicht`, l);
}

/** Refs positionsgenau auf `tag` setzen (von hinten nach vorn, Zeilenenden bleiben); schreibt jede Datei mit Factory-Links. */
function schreibeRefs(rootDir, links, tag) {
  const jeDatei = new Map();
  for (const l of links) jeDatei.set(l.datei, [...(jeDatei.get(l.datei) ?? []), l]);
  for (const [datei, liste] of jeDatei) {
    const voll = join(rootDir, ...datei.split("/"));
    let text = readFileSync(voll, "utf8");
    for (const l of [...liste].sort((a, b) => b.refStart - a.refStart)) text = text.slice(0, l.refStart) + tag + text.slice(l.refStart + l.ref.length);
    writeFileSync(voll, text);
  }
}

/** Index-Text: Schlüssel sortiert, je Pfad eine Zeile, abschließender Zeilenumbruch. */
function indexText({ repo, tag, commit }, links) {
  const ziele = new Map();
  for (const l of links) ziele.set(l.pfad, new Set([...(ziele.get(l.pfad) ?? []), l.anker]));
  const sortiert = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const zeilen = [...ziele.keys()].sort(sortiert).map((p) => `    ${JSON.stringify(p)}: ${JSON.stringify([...ziele.get(p)].sort(sortiert))}`);
  const kopf = `{\n  "repo": ${JSON.stringify(repo)},\n  "tag": ${JSON.stringify(tag)},\n  "commit": ${JSON.stringify(commit)},\n`;
  return `${kopf}  "ziele": {\n${zeilen.join(",\n")}\n  }\n}\n`;
}

/**
 * Schreibmodus: prüft die Links gegen den Tag in `quelle` (Klon des Factory-Repos) und schreibt nur ohne Befund Refs und Index.
 * Rückgabe `{ befunde, geschrieben }`; zusätzliche Befund-Arten `quelle`, `tag-commit`, `pfad-tot`, `anker-tot`, `form`.
 */
export function schreibeFactoryLinks(rootDir, quelle) {
  const repo = factoryRepo(liesJson(rootDir, CONFIG_PFAD));
  const sync = liesJson(rootDir, STAND_PFAD);
  if (!repo) return { befunde: [befund("projekt", `${CONFIG_PFAD}: kein Board mit Rolle factory`)], geschrieben: 0 };
  if (!sync?.quelle?.tag || !sync.quelle.commit) return { befunde: [befund("sync-stand", `${STAND_PFAD} fehlt oder hat keine quelle.tag/quelle.commit`)], geschrieben: 0 };
  const { tag, commit } = sync.quelle;
  const leser = leserVomCommit(quelle, tag);
  if (leser.fehler) return { befunde: [befund("quelle", `Tag ${tag} in ${quelle}: ${leser.fehler}`)], geschrieben: 0 };
  if (leser.commit !== commit) return { befunde: [befund("tag-commit", `Tag ${tag} zeigt auf ${leser.commit}, ${STAND_PFAD} nennt ${commit}`)], geschrieben: 0 };
  const links = sammleLinks(rootDir, { repo, einheiten: Object.keys(sync.einheiten ?? {}) });
  const echte = links.filter((l) => l.form !== "fremd");
  leser.vorladen(echte.filter((l) => l.anker !== "" && l.form === "blob" && l.pfad.endsWith(".md")).map((l) => l.pfad));
  const befunde = [
    ...links.filter((l) => l.form === "fremd").map((l) => befund("form", `${l.url}: keine geprüfte Form (erwartet /blob|tree/<ref>/<pfad>[#anker])`, l)),
    ...echte.map((l) => zielBefund(l, leser)).filter(Boolean),
  ];
  if (befunde.length > 0) return { befunde, geschrieben: 0 };
  schreibeRefs(rootDir, echte, tag);
  writeFileSync(join(rootDir, ...INDEX_PFAD.split("/")), indexText({ repo, tag, commit }, echte));
  return { befunde: [], geschrieben: echte.length, ziele: new Set(echte.map((l) => l.pfad)).size, tag };
}

const AUFRUF = "Aufruf: node scripts/check-factory-links.mjs [--wurzel <pfad>] | --schreiben --quelle <klon>";

function meldeBefunde(name, befunde, err) {
  err(`${name}: ${befunde.length} Befund(e)`);
  for (const b of befunde) err(`  ✖ ${b.datei ? `${b.datei}:${b.zeile}: ` : ""}[${b.art}] ${b.text}`);
}

/** Kommandozeile; Rückgabe = Exit-Code. */
export function cli(argv, { wurzel = join(dirname(fileURLToPath(import.meta.url)), ".."), out = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const gelesen = flagsLesen(argv, { wurzel: { type: "string" }, schreiben: { type: "boolean" }, quelle: { type: "string" } });
  const { werte } = gelesen;
  const fehler = gelesen.fehler?.text ?? (Boolean(werte.schreiben) !== (werte.quelle !== undefined) ? "--schreiben und --quelle gehören zusammen" : null);
  if (fehler) {
    err(`check-factory-links: ${fehler}`);
    err(AUFRUF);
    return AUFRUF_EXIT;
  }
  const w = werte.wurzel ?? wurzel;
  if (werte.schreiben) {
    const r = schreibeFactoryLinks(w, werte.quelle);
    if (r.befunde.length > 0) {
      meldeBefunde("check-factory-links", r.befunde, err);
      err("  Nichts geschrieben.");
      return 1;
    }
    out(`check-factory-links: ${r.geschrieben} Factory-Links auf ${r.ziele} Ziele am Tag ${r.tag} geschrieben (Refs und Index)`);
    return 0;
  }
  const { befunde, links } = auditFactoryLinks(w);
  if (befunde.length > 0) {
    meldeBefunde("check-factory-links", befunde, err);
    return 1;
  }
  out(`check-factory-links: ${links.length} Factory-Links auf ${new Set(links.map((l) => l.pfad)).size} Ziele am Sync-Tag ohne Befund`);
  return 0;
}

if (istDirektaufruf(import.meta.url)) {
  process.exitCode = cli(process.argv.slice(2));
}
