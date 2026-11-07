// Factory-Link-Wächter (ADR 0022 F10, factory#130; Kern): Links ins Factory-Repo stehen auf dem Sync-Tag und zeigen auf Pfade und Anker, die es dort gibt.
// `node scripts/check-factory-links.mjs [--wurzel <pfad>]` prüft hermetisch (kein Git, kein Netz): Doku-Links gegen den Index `.factory/factory-links.json`,
// der selbst zu `STAND_PFAD` (`.factory/sync-stand.json`) › `quelle` passen muss. `--schreiben --quelle <klon>` schreibt nach einem Sync auf einen neuen Tag
// die Refs um und erzeugt den Index aus dem Tag der Quelle (Klon des Factory-Repos): Befund ⇒ nichts geschrieben, Exit 1. Das ist der Reparaturweg: Refs und Index
// schreibt `factory-sync --tag` im selben Lauf mit (factory#131, Bausteine in `factory-links-lib.mjs`).
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
//                   (`sync-stand.einheiten`: ganze `*.md`-Dateien und Blöcke `datei#id` zwischen den Besitz-Markern nach `besitzSpannen`, wie die Doku-Drift-
//                   Prüfung: erstes Marker-Vorkommen, auch in Code; JSON-Schlüssel-Einheiten `#/…` tragen keine Doku-Links). Schnappschuss-Marker innerhalb
//                   von Code (Fence, Inline-Code) öffnen keinen Block; ein Schnappschuss-Start ohne Ende maskiert nichts (fail-closed).
//   Anker-Stubs (factory#132): jeder relative `.md`-Link einer Besitz-Einheit (ganze Datei oder Block) auf ein Ziel ohne Einheit muss auf eine vorhandene Datei zeigen
//                   (`stub-ziel`); mit Anker trägt sie eine Überschrift mit gleichem Anker (`stub-anker`, roh verglichen) und darunter (bis zur nächsten Überschrift
//                   gleicher oder höherer Ebene) einen Factory-Link auf genau `pfad#anker` am Sync-Tag, gebaut über `factorySeite`; ohne Anker irgendwo in der Datei einen
//                   Factory-Link auf die Seite (`stub-link`). Links in Schnappschuss-Blöcken des Ziels zählen nicht; Ziele mit Einheit (auch Block-Dateien wie `AGENTS.md`),
//                   Nicht-`.md`-Ziele, reine Anker und Links in Code bleiben ungeprüft. Nur der Wächter prüft das; der Sync schreibt keine Stubs (der Bezieher legt sie im Sync-PR an).
//   rot (`form`):   jede andere URL auf dieses Repo (z.B. ein Commit-Link, oder eine Blob-URL ohne Pfad), damit kein Link ungeprüft bleibt.
// Bekannte Grenzen: der Index unterscheidet blob und tree nicht; Anker nur bei `blob` auf `*.md` (GitHub-Slugs).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectMarkdown } from "./check-basis.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { INDEX_PFAD, befund, befundZeile, factoryLinkStellen, planeFactoryLinks, sammleLinksAus, stubBefunde } from "./factory-links-lib.mjs";
import { factoryRepo } from "./factory-seite.mjs";
import { leserVomCommit } from "./factory-sync-lib.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { PROJEKT_CONFIG, factoryLinkAusnahmenAus, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { STAND_PFAD, liesSyncStand } from "./sync-stand-lib.mjs";

export { factoryLinkStellen };

/** Alle erfassten Links im Umfang einer Wurzel: `{ datei, ...stelle }`, sortiert nach Datei und Position. `ausnahmen` sind Pfad-Globs (`factoryLinks.ausnahmen`). */
export function sammleLinks(rootDir, optionen) {
  const lies = (datei) => readFileSync(join(rootDir, ...datei.split("/")), "utf8");
  return sammleLinksAus({ dateien: collectMarkdown(rootDir), lies }, optionen);
}

const SCHREIB_WEG = "Weg: `npm run check:factorylinks -- --schreiben --quelle <klon des Factory-Repos>`";

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

/** Textleser einer Wurzel für die Lib: Text oder `null` (Datei fehlt); `datei` ist ein repo-relativer POSIX-Pfad. */
const leserVon = (rootDir) => (datei) => (existsSync(join(rootDir, ...datei.split("/"))) ? readFileSync(join(rootDir, ...datei.split("/")), "utf8") : null);

/** Prüfmodus auf einem Projektbaum: `{ befunde, links, stubs }` oder `{ nichtsZuPruefen: true }` ohne Sync-Stand. */
export function auditFactoryLinks(rootDir) {
  const v = vorbedingungen(rootDir);
  if (v.nichtsZuPruefen) return { nichtsZuPruefen: true, befunde: [], links: [] };
  if (v.befunde) return { befunde: v.befunde, links: [] };
  const einheiten = Object.keys(v.sync.einheiten ?? {});
  const links = sammleLinks(rootDir, { repo: v.repo, einheiten, ausnahmen: v.ausnahmen });
  const index = pruefeIndex({ links, index: liesJson(rootDir, INDEX_PFAD), sync: v.sync, repo: v.repo });
  const stubs = v.sync.quelle?.tag ? stubBefunde({ lies: leserVon(rootDir), einheiten, repo: v.repo, tag: v.sync.quelle.tag }) : { befunde: [], geprueft: 0 };
  return { befunde: [...index, ...stubs.befunde], links, stubs: stubs.geprueft };
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
  const plan = planeFactoryLinks({ dateien: collectMarkdown(rootDir), lies: leserVon(rootDir), repo, einheiten: Object.keys(sync.einheiten ?? {}), ausnahmen: v.ausnahmen, tag, commit, leser });
  if (plan.befunde.length > 0) return { befunde: plan.befunde, geschrieben: 0 };
  for (const [datei, text] of plan.dateien) writeFileSync(join(rootDir, ...datei.split("/")), text);
  return { befunde: [], geschrieben: plan.geschrieben, ziele: plan.ziele, tag };
}

const AUFRUF = "Aufruf: node scripts/check-factory-links.mjs [--wurzel <pfad>] | --schreiben --quelle <klon>";
const AUSNAHMEN_HINWEIS = `  Hinweis: historische Dateien nimmt \`factoryLinks.ausnahmen\` (Pfad-Globs) in ${PROJEKT_CONFIG} aus.`;

function meldeBefunde(name, befunde, err) {
  err(`${name}: ${befunde.length} Befund(e)`);
  for (const b of befunde) err(`  ✖ ${befundZeile(b)}`);
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
  const { befunde, links, stubs, nichtsZuPruefen } = auditFactoryLinks(w);
  if (nichtsZuPruefen) {
    out(`check-factory-links: kein Sync-Stand (${STAND_PFAD}), nichts zu prüfen`);
    return 0;
  }
  if (befunde.length > 0) {
    meldeBefunde("check-factory-links", befunde, err);
    return 1;
  }
  out(`check-factory-links: ${links.length} Factory-Links auf ${new Set(links.map((l) => l.pfad)).size} Ziele am Sync-Tag und ${stubs} Anker-Stubs ohne Befund`);
  return 0;
}

if (istDirektaufruf(import.meta.url)) {
  process.exitCode = cli(process.argv.slice(2));
}
