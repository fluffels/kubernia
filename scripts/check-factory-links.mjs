// Factory-Link-Wächter (ADR 0022 F10, factory#130; Kern): Links ins Factory-Repo stehen auf dem Sync-Tag und zeigen auf Pfade und Anker, die es dort gibt.
// `node scripts/check-factory-links.mjs [--wurzel <pfad>]` prüft hermetisch (kein Git, kein Netz): Doku-Links gegen den Index `.factory/factory-links.json`,
// der selbst zu `STAND_PFAD` (`.factory/sync-stand.json`) › `quelle` passen muss. `--schreiben --quelle <klon>` schreibt nach einem Sync auf einen neuen Tag
// die Refs um und erzeugt den Index aus dem Tag der Quelle (Klon des Factory-Repos): Befund ⇒ nichts geschrieben, Exit 1.
// Ohne Sync-Stand (das Factory-Repo selbst, ein Projekt ohne Sync) gibt es nichts zu prüfen: Exit 0. Mit Sync-Stand ohne `quelle.tag` ist es rot.
// Exit 0 grün, 1 Befund, 2 Aufruf.
//
// Projektwerte: das Factory-Repo und die URL-Form kommen aus `factory-seite.mjs` (Bau und Zerlegung), die Ausnahmen aus der Projekt-Config
// (`factoryLinks.ausnahmen`, Pfad-Globs mit * ? **; ohne Schlüssel keine), Code-Maske, Link-Stellen und Schnappschuss-Marker aus `docs-gen/markdown.mjs`.
//
// Scan-Umfang (geschlossene Liste), Faktenquelle ist dieser Kopfkommentar:
//   erfasst:        Inline-Link und Bild `[t](url)` (auch `[t](<url>)`) und Autolink `<url>`, jeweils nach dem Maskieren von Code-Fences und Inline-Code;
//                   die URL `https://github.com/<repo>/(blob|tree)/<ref>/<pfad>[#anker]` mit dem Factory-Repo aus `factoryRepo` (`quelle.repo` des Sync-Stands,
//                   sonst das Board mit Rolle `factory`).
//   nicht erfasst:  nackte URLs im Text, Referenz-Links (`[t][r]`, `[r]: url`), Links auf `/issues` und `/pull`, die Repo-Wurzel.
//   ausgenommen:    Dateien, die ein Glob aus `factoryLinks.ausnahmen` trifft (historische Seiten wie ADRs), Schnappschuss-Blöcke, Besitz-Einheiten
//                   (`sync-stand.einheiten`: ganze `*.md`-Dateien und Blöcke `datei#id` zwischen den Besitz-Markern; JSON-Schlüssel-Einheiten `#/…` tragen
//                   keine Doku-Links). Marker innerhalb von Code (Fence, Inline-Code) öffnen keinen Block.
//   rot (`form`):   jede andere URL auf dieses Repo (z.B. ein Commit-Link, oder eine Blob-URL ohne Pfad), damit kein Link ungeprüft bleibt.
// Bekannte Grenzen: der Index unterscheidet blob und tree nicht; Anker nur bei `blob` auf `*.md` (GitHub-Slugs).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectMarkdown } from "./check-basis.mjs";
import { markerEnde, markerStart } from "./besitz-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { SCHNAPPSCHUSS_ENDE, SCHNAPPSCHUSS_START, codeMaskiert, collectHeadingSlugs, externeLinkStellen } from "./docs-gen/markdown.mjs";
import { factoryRepo, factoryUrlTeile } from "./factory-seite.mjs";
import { leserVomCommit } from "./factory-sync-lib.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { globRegex } from "./pfad-glob.mjs";
import { PROJEKT_CONFIG, factoryLinkAusnahmenAus, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { STAND_PFAD, liesSyncStand } from "./sync-stand-lib.mjs";

const INDEX_PFAD = ".factory/factory-links.json";
const SCHREIB_WEG = "Weg: `npm run check:factorylinks -- --schreiben --quelle <klon des Factory-Repos>`";

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

/** Zeilen (0-basiert) im Schnappschuss-Block und in den Besitz-Blöcken `ids` dieser Datei; Marker in Code zählen nicht. */
function maskierteZeilen(text, ids) {
  const aus = new Set();
  const zeilen = codeMaskiert(text).split("\n");
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

/** Alle erfassten Links im Umfang: `{ datei, ...stelle }`, sortiert nach Datei und Position. `ausnahmen` sind Pfad-Globs (`factoryLinks.ausnahmen`). */
export function sammleLinks(rootDir, { repo, einheiten = [], ausnahmen = [] }) {
  const { ganz, bloecke } = einheitenAufteilen(einheiten);
  const ausgenommen = ausnahmen.map(globRegex);
  const links = [];
  for (const datei of collectMarkdown(rootDir)) {
    if (ausgenommen.some((re) => re.test(datei)) || ganz.has(datei)) continue;
    const text = readFileSync(join(rootDir, ...datei.split("/")), "utf8");
    const aus = maskierteZeilen(text, bloecke.get(datei) ?? []);
    for (const s of factoryLinkStellen(text, repo)) if (!aus.has(s.zeile - 1)) links.push({ datei, ...s });
  }
  return links;
}

const befund = (art, text, l) => ({ art, datei: l?.datei, zeile: l?.zeile, text });
const paarSchluessel = (pfad, anker) => `${pfad}\0${anker}`;

/** Sync-Stand und Index gegeneinander und gegen das Factory-Repo: `index-fehlt`, `sync-stand`, `index-stand`. */
function standBefunde({ index, sync, repo }) {
  const quelle = sync?.quelle;
  if (!quelle?.tag || !quelle?.commit) return [befund("sync-stand", `${STAND_PFAD} hat keine quelle.tag/quelle.commit (Sync von einem Tag)`)];
  if (!index) return [befund("index-fehlt", `${INDEX_PFAD} fehlt oder ist kein JSON. ${SCHREIB_WEG}`)];
  const out = [];
  if (index.repo !== repo) out.push(befund("index-stand", `${INDEX_PFAD}: repo ${index.repo} ≠ Factory-Repo ${repo}. ${SCHREIB_WEG}`));
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
      out.push(befund("form", `${l.url}: keine geprüfte Form (erwartet blob oder tree, Ref, Pfad, optional Anker)`, l));
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

/**
 * Die Voraussetzungen eines Laufs in fester Reihenfolge: `{ nichtsZuPruefen: true }` (kein Sync-Stand), `{ befunde }` (Sync-Stand kaputt, Config-Block
 * `factoryLinks` kaputt oder Factory-Repo nicht bestimmbar) oder `{ sync, repo, ausnahmen }`. Erst der Sync-Stand, dann die Config: ohne Sync gibt es nichts zu
 * prüfen, auch bei kaputtem Schlüssel (die Config prüfen andere Gates).
 */
function vorbedingungen(w) {
  const { zustand, stand } = liesSyncStand(w);
  if (zustand === "fehlt") return { nichtsZuPruefen: true };
  if (zustand === "kaputt") return { befunde: [befund("sync-stand", `${STAND_PFAD} ist kein JSON-Objekt`)] };
  let ausnahmen;
  try {
    ausnahmen = factoryLinkAusnahmenAus(ladeProjektConfig({ rootDir: w, pruefen: false }));
  } catch (e) {
    return { befunde: [befund("config", e instanceof Error ? e.message : String(e))] };
  }
  const repo = factoryRepo(w);
  if (!repo) return { befunde: [befund("projekt", `weder quelle.repo im Sync-Stand noch repo am Board mit Rolle factory in ${PROJEKT_CONFIG}`)] };
  return { sync: stand, repo, ausnahmen };
}

/** Prüfmodus auf einem Projektbaum: `{ befunde, links }` oder `{ nichtsZuPruefen: true }` ohne Sync-Stand. */
export function auditFactoryLinks(rootDir) {
  const v = vorbedingungen(rootDir);
  if (v.nichtsZuPruefen) return { nichtsZuPruefen: true, befunde: [], links: [] };
  if (v.befunde) return { befunde: v.befunde, links: [] };
  const links = sammleLinks(rootDir, { repo: v.repo, einheiten: Object.keys(v.sync.einheiten ?? {}), ausnahmen: v.ausnahmen });
  return { befunde: pruefeIndex({ links, index: liesJson(rootDir, INDEX_PFAD), sync: v.sync, repo: v.repo }), links };
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
 * Rückgabe `{ befunde, geschrieben }`; zusätzliche Befund-Arten `quelle`, `tag-commit`, `pfad-tot`, `anker-tot`, `form`. Ohne Sync-Stand gibt es keinen Tag: Befund `sync-stand`.
 */
export function schreibeFactoryLinks(rootDir, quelle) {
  const v = vorbedingungen(rootDir);
  if (v.nichtsZuPruefen) return { befunde: [befund("sync-stand", `${STAND_PFAD} fehlt: ohne Sync-Stand gibt es keinen Tag, auf den geschrieben werden könnte`)], geschrieben: 0 };
  if (v.befunde) return { befunde: v.befunde, geschrieben: 0 };
  const { sync, repo } = v;
  if (!sync.quelle?.tag || !sync.quelle.commit) return { befunde: [befund("sync-stand", `${STAND_PFAD} hat keine quelle.tag/quelle.commit`)], geschrieben: 0 };
  const { tag, commit } = sync.quelle;
  const leser = leserVomCommit(quelle, tag);
  if (leser.fehler) return { befunde: [befund("quelle", `Tag ${tag} in ${quelle}: ${leser.fehler}`)], geschrieben: 0 };
  if (leser.commit !== commit) return { befunde: [befund("tag-commit", `Tag ${tag} zeigt auf ${leser.commit}, ${STAND_PFAD} nennt ${commit}`)], geschrieben: 0 };
  const links = sammleLinks(rootDir, { repo, einheiten: Object.keys(sync.einheiten ?? {}), ausnahmen: v.ausnahmen });
  const echte = links.filter((l) => l.form !== "fremd");
  leser.vorladen(echte.filter((l) => l.anker !== "" && l.form === "blob" && l.pfad.endsWith(".md")).map((l) => l.pfad));
  const befunde = [
    ...links.filter((l) => l.form === "fremd").map((l) => befund("form", `${l.url}: keine geprüfte Form (erwartet blob oder tree, Ref, Pfad, optional Anker)`, l)),
    ...echte.map((l) => zielBefund(l, leser)).filter(Boolean),
  ];
  if (befunde.length > 0) return { befunde, geschrieben: 0 };
  schreibeRefs(rootDir, echte, tag);
  writeFileSync(join(rootDir, ...INDEX_PFAD.split("/")), indexText({ repo, tag, commit }, echte));
  return { befunde: [], geschrieben: echte.length, ziele: new Set(echte.map((l) => l.pfad)).size, tag };
}

const AUFRUF = "Aufruf: node scripts/check-factory-links.mjs [--wurzel <pfad>] | --schreiben --quelle <klon>";
const AUSNAHMEN_HINWEIS = `  Hinweis: historische Dateien nimmt \`factoryLinks.ausnahmen\` (Pfad-Globs) in ${PROJEKT_CONFIG} aus.`;

function meldeBefunde(name, befunde, err) {
  err(`${name}: ${befunde.length} Befund(e)`);
  for (const b of befunde) err(`  ✖ ${b.datei ? `${b.datei}:${b.zeile}: ` : ""}[${b.art}] ${b.text}`);
  if (befunde.some((b) => b.art === "ref")) err(AUSNAHMEN_HINWEIS);
}

function schreibModus(w, quelle, { out, err }) {
  const r = schreibeFactoryLinks(w, quelle);
  if (r.befunde.length > 0) {
    meldeBefunde("check-factory-links", r.befunde, err);
    err("  Nichts geschrieben.");
    return 1;
  }
  out(`check-factory-links: ${r.geschrieben} Factory-Links auf ${r.ziele} Ziele am Tag ${r.tag} geschrieben (Refs und Index)`);
  return 0;
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
  if (werte.schreiben) return schreibModus(w, werte.quelle, { out, err });
  const { befunde, links, nichtsZuPruefen } = auditFactoryLinks(w);
  if (nichtsZuPruefen) {
    out(`check-factory-links: kein Sync-Stand (${STAND_PFAD}), nichts zu prüfen`);
    return 0;
  }
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
