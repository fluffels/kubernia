// Sync-Werkzeug (ADR 0022 F9): überträgt den Besitz laut `.factory/besitz.json` aus einer Factory-Quelle in ein Projekt.
// `node scripts/factory-sync.mjs --quelle <pfad> [--ziel <pfad>] [--trocken]`; Exit 0 ok, 1 Fehler, 2 Aufruf.
// Überschrieben wird nur Besitz (Datei, Block, JSON-Schlüssel), nie gemerged; Projektteile bleiben byte-gleich. Hash und Vergleich
// sind CRLF-neutral, geschrieben wird nur bei inhaltlicher Änderung im Zeilenende-Stil der Zieldatei. Erst alles prüfen, dann schreiben.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  einheitHash,
  einheitId,
  einheitText,
  eolVon,
  jsonSchluesselSpanne,
  normalisiereEol,
  pruefeManifest,
  setzeBlock,
  setzeJsonSchluessel,
  textHash,
  wirdVerteilt,
} from "./besitz-lib.mjs";

export const MANIFEST_PFAD = ".factory/besitz.json";
export const STAND_PFAD = ".factory/sync-stand.json";
export const PROJEKT_PFAD = ".factory/projekt.json";

const gleichJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Wendet alle Teil-Einheiten einer Datei nacheinander auf den Zieltext an (LF-normalisiert). Wirft bei Marker- oder JSON-Fehlern. */
function wendeTeileAn(eintraege, srcText, zielLf) {
  let arbeit = zielLf;
  for (const e of eintraege) {
    if (e.block !== undefined) {
      if (arbeit === null) throw new Error(`${einheitId(e)}: Datei fehlt im Ziel, die Marker fehlen`);
      arbeit = setzeBlock(arbeit, e.block, einheitText(e, srcText));
    } else {
      if (arbeit === null) arbeit = "{\n}\n";
      const span = jsonSchluesselSpanne(srcText, e.schluessel);
      arbeit = setzeJsonSchluessel(arbeit, e.schluessel, srcText.slice(span.start, span.ende));
    }
  }
  return arbeit;
}

/** Selbstprüfung einer Teil-Datei: JSON parst, Besitz-Schlüssel = Quelle, alle anderen = Vorher; Block-Einheit = Quelle. */
export function pruefeErgebnis(pfad, eintraege, srcText, zielLf, ergebnis) {
  const fehler = [];
  if (eintraege.some((e) => e.schluessel !== undefined)) {
    const neu = JSON.parse(ergebnis);
    const quelle = JSON.parse(srcText);
    const vorher = zielLf === null ? {} : JSON.parse(zielLf);
    const besitz = new Set(eintraege.filter((e) => e.schluessel !== undefined).map((e) => e.schluessel));
    for (const k of besitz) if (!gleichJson(neu[k], quelle[k])) fehler.push(`${pfad}: Schlüssel '${k}' weicht nach dem Sync von der Quelle ab`);
    for (const k of Object.keys(vorher)) if (!besitz.has(k) && !gleichJson(neu[k], vorher[k])) fehler.push(`${pfad}: Projektschlüssel '${k}' wurde verändert`);
    for (const k of Object.keys(neu)) if (!besitz.has(k) && !(k in vorher)) fehler.push(`${pfad}: Schlüssel '${k}' ist neu und kein Besitz`);
  }
  for (const e of eintraege) {
    if (e.block !== undefined && einheitText(e, ergebnis) !== einheitText(e, srcText)) fehler.push(`${einheitId(e)}: Block weicht nach dem Sync von der Quelle ab`);
  }
  return fehler;
}

function leseAltStand(zielLies) {
  const t = zielLies(STAND_PFAD);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/**
 * Plan eines Syncs, ohne zu schreiben. `quelleLies`/`zielLies` liefern den Dateitext (relativer Pfad, Schrägstrich-Form) oder `null`.
 * Ergebnis: `fehler` (nicht leer: nichts schreiben), `meldungen`, `dateien` (Pfad → { text, neu, ausfuehrbar }, nur Geändertes),
 * `unveraendert` (Zahl) und der `stand`.
 */
export function planeSync({ quelleLies, zielLies, quelleAusfuehrbar = () => false, quelleStand = { commit: "unbekannt", sauber: false } }) {
  const res = { fehler: [], meldungen: [], dateien: new Map(), unveraendert: 0, stand: null };
  const manifestText = quelleLies(MANIFEST_PFAD);
  if (manifestText === null) {
    res.fehler.push(`Quelle hat kein ${MANIFEST_PFAD}`);
    return res;
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    res.fehler.push(`${MANIFEST_PFAD} der Quelle ist kein gültiges JSON`);
    return res;
  }
  if (!Array.isArray(manifest.eintraege)) {
    res.fehler.push(`${MANIFEST_PFAD} der Quelle hat keine Liste 'eintraege'`);
    return res;
  }
  res.fehler.push(...pruefeManifest(manifest, quelleLies).map((m) => `Quell-Manifest: ${m}`));
  if (manifest.eintraege.some((e) => e.pfad === PROJEKT_PFAD)) res.fehler.push(`Quell-Manifest: ${PROJEKT_PFAD} ist Projekt-Config und nie Besitz`);
  if (res.fehler.length > 0) return res;

  const nachPfad = new Map();
  const verteilt = manifest.eintraege.filter(wirdVerteilt);
  for (const e of verteilt) nachPfad.set(e.pfad, [...(nachPfad.get(e.pfad) ?? []), e]);
  const ziele = new Map(); // Pfad -> { ergebnis (LF), quelleText }
  for (const [pfad, eintraege] of nachPfad) {
    const srcText = normalisiereEol(quelleLies(pfad));
    const zielRoh = zielLies(pfad);
    const zielLf = zielRoh === null ? null : normalisiereEol(zielRoh);
    try {
      const ganz = eintraege.some((e) => e.block === undefined && e.schluessel === undefined);
      const ergebnis = ganz ? srcText : wendeTeileAn(eintraege, srcText, zielLf);
      if (!ganz) res.fehler.push(...pruefeErgebnis(pfad, eintraege, srcText, zielLf, ergebnis));
      ziele.set(pfad, { ergebnis, zielRoh, zielLf, srcText });
    } catch (err) {
      res.fehler.push(`${pfad}: ${err.message}`);
    }
  }
  if (res.fehler.length > 0) return res;
  const ziehe = (pfad, ergebnis, zielRoh, ausfuehrbar) => {
    if (zielRoh !== null && normalisiereEol(zielRoh) === ergebnis) {
      res.unveraendert++;
      return;
    }
    const eol = zielRoh === null ? "\n" : eolVon(zielRoh);
    res.dateien.set(pfad, { text: eol === "\n" ? ergebnis : ergebnis.replace(/\n/g, eol), neu: zielRoh === null, ausfuehrbar });
  };
  for (const [pfad, z] of ziele) ziehe(pfad, z.ergebnis, z.zielRoh, quelleAusfuehrbar(pfad));
  ziehe(MANIFEST_PFAD, normalisiereEol(manifestText), zielLies(MANIFEST_PFAD), false);

  const einheiten = {};
  for (const e of verteilt) einheiten[einheitId(e)] = einheitHash(e, ziele.get(e.pfad).srcText);
  const sortiert = Object.fromEntries(Object.entries(einheiten).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  res.stand = { version: 1, quelle: { commit: quelleStand.commit, sauber: quelleStand.sauber }, manifest: textHash(manifestText), einheiten: sortiert };
  ziehe(STAND_PFAD, `${JSON.stringify(res.stand, null, 2)}\n`, zielLies(STAND_PFAD), false);

  const alt = leseAltStand(zielLies);
  for (const id of Object.keys(alt?.einheiten ?? {})) {
    if (id in sortiert) continue;
    const nurFactory = manifest.eintraege.find((e) => einheitId(e) === id);
    res.meldungen.push(
      nurFactory === undefined
        ? `Einheit '${id}' ist kein Besitz mehr, im Ziel nicht gelöscht (bei Bedarf von Hand entfernen)`
        : `Einheit '${id}' wird nicht mehr verteilt (Ring ${nurFactory.ring}), im Ziel nicht gelöscht (bei Bedarf von Hand entfernen)`,
    );
  }
  return res;
}

function quelleGit(quelle) {
  try {
    const git = (args) => execFileSync("git", ["-C", quelle, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { commit: git(["rev-parse", "HEAD"]).trim(), sauber: git(["status", "--porcelain"]).trim() === "" };
  } catch {
    return { commit: "unbekannt", sauber: false };
  }
}

const liesDatei = (wurzel) => (pfad) => {
  const voll = join(wurzel, ...pfad.split("/"));
  return existsSync(voll) ? readFileSync(voll, "utf8") : null;
};

function parseArgs(argv) {
  const opt = { quelle: null, ziel: null, trocken: false, fehler: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--trocken") opt.trocken = true;
    else if (a === "--quelle" || a === "--ziel") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) opt.fehler = `${a} braucht einen Pfad`;
      else opt[a.slice(2)] = v;
    } else opt.fehler = `unbekannte Option '${a}'`;
  }
  if (opt.fehler === null && opt.quelle === null) opt.fehler = "--quelle <pfad> fehlt";
  return opt;
}

/** Kommandozeile; Rückgabe = Exit-Code (0 ok, 1 Fehler, 2 Aufruf). */
export function cli(argv, { cwd = process.cwd(), out = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const opt = parseArgs(argv);
  const usage = "Aufruf: node scripts/factory-sync.mjs --quelle <pfad> [--ziel <pfad>] [--trocken]";
  if (opt.fehler !== null) {
    err(`factory-sync: ${opt.fehler}\n${usage}`);
    return 2;
  }
  const quelle = opt.quelle;
  const ziel = opt.ziel ?? cwd;
  for (const [name, pfad] of [["Quelle", quelle], ["Ziel", ziel]]) {
    if (!existsSync(pfad) || !statSync(pfad).isDirectory()) {
      err(`factory-sync: ${name} '${pfad}' ist kein Ordner\n${usage}`);
      return 2;
    }
  }
  if (realpathSync(quelle) === realpathSync(ziel)) {
    err("factory-sync: Quelle und Ziel sind derselbe Ordner, ein Projekt synct nicht auf sich selbst");
    return 1;
  }
  const plan = planeSync({
    quelleLies: liesDatei(quelle),
    zielLies: liesDatei(ziel),
    quelleAusfuehrbar: (pfad) => (statSync(join(quelle, ...pfad.split("/"))).mode & 0o111) !== 0,
    quelleStand: quelleGit(quelle),
  });
  if (plan.fehler.length > 0) {
    for (const f of plan.fehler) err(`factory-sync: ${f}`);
    err("factory-sync: nichts geschrieben");
    return 1;
  }
  for (const [pfad, d] of plan.dateien) {
    out(`${opt.trocken ? "würde " : ""}${d.neu ? "neu" : "geändert"}: ${pfad}`);
    if (opt.trocken) continue;
    const voll = join(ziel, ...pfad.split("/"));
    mkdirSync(dirname(voll), { recursive: true });
    writeFileSync(voll, d.text);
    if (d.neu && d.ausfuehrbar && process.platform !== "win32") chmodSync(voll, 0o755);
  }
  for (const m of plan.meldungen) out(`Hinweis: ${m}`);
  out(`factory-sync: ${plan.dateien.size} ${opt.trocken ? "zu ändern" : "geändert"}, ${plan.unveraendert} unverändert`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = cli(process.argv.slice(2));
}
