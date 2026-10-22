// Sync-Werkzeug (ADR 0022 F9): überträgt den Besitz laut `.factory/besitz.json` aus einer Factory-Quelle in ein Projekt.
// `node scripts/factory-sync.mjs --quelle <pfad> (--tag <name> | --entwurf) [--ziel <pfad>] [--trocken]`; Exit 0 ok, 1 Fehler, 2 Aufruf.
// Der Besitz kommt aus einem Tag der Quelle (Inhalte wie `git show <tag>:<pfad>` über `git cat-file --batch`, Ausführbar-Bit aus `git ls-tree`), nie aus dem Arbeitsbaum; der
// Sync-Stand hält Commit und Tag fest. Ohne `--tag` synct nichts; nur `--entwurf` liest den Arbeitsbaum (Probe, das Drift-Gate bleibt rot).
// Überschrieben wird nur Besitz (Datei, Block, JSON-Schlüssel), nie gemerged; Projektteile bleiben byte-gleich. Hash und Vergleich
// sind CRLF-neutral, geschrieben wird nur bei inhaltlicher Änderung im Zeilenende-Stil der Zieldatei. Erst alles prüfen, dann schreiben.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { flagsLesen } from "./flag-lib.mjs";
import { ladeProjektConfig, PROJEKT_CONFIG, PROJEKT_ROLLEN, ROLLEN_PFADE } from "./projekt-config-lib.mjs";
import {
  einheitHash,
  einheitId,
  einheitText,
  eolVon,
  jsonSchluesselSpanne,
  normalisiereEol,
  normalisierterEinheitText,
  pruefeManifest,
  rendereProjektwerte,
  setzeBlock,
  setzeJsonSchluessel,
  textHash,
  wirdVerteilt,
} from "./besitz-lib.mjs";

export const MANIFEST_PFAD = ".factory/besitz.json";
export const STAND_PFAD = ".factory/sync-stand.json";
export const PROJEKT_PFAD = PROJEKT_CONFIG;

const gleichJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Wendet alle Teil-Einheiten einer Datei nacheinander auf den Zieltext an (LF-normalisiert). Wirft bei Marker- oder JSON-Fehlern. */
function wendeTeileAn(eintraege, srcText, zielLf, zielConfig) {
  let arbeit = zielLf;
  for (const e of eintraege) {
    if (e.block !== undefined) {
      if (arbeit === null) throw new Error(`${einheitId(e)}: Datei fehlt im Ziel, die Marker fehlen`);
      arbeit = setzeBlock(arbeit, e.block, rendereProjektwerte(einheitText(e, srcText), zielConfig, einheitId(e)));
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
    if (e.block !== undefined && normalisierterEinheitText(e, ergebnis) !== normalisierterEinheitText(e, srcText)) fehler.push(`${einheitId(e)}: Block weicht nach dem Sync von der Quelle ab`);
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
 * `unveraendert` (Zahl) und der `stand`. `zielConfig` liefert die Projekt-Config des Ziels, nur gerufen, wenn eine Datei Projektwert-Stellen hat.
 */
export function planeSync({
  quelleLies,
  zielLies,
  quelleAusfuehrbar = () => false,
  quelleStand = { commit: "unbekannt", sauber: false },
  zielConfig = () => {
    throw new Error("keine Projekt-Config des Ziels übergeben");
  },
}) {
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
  // Rollen-Pfade (#1871): jede Besitz-Rolle muss eine ganze, verteilte Einheit sein; die Rollen des Projekts stehen nicht im Manifest.
  for (const [rolle, pfad] of Object.entries(ROLLEN_PFADE)) {
    if (PROJEKT_ROLLEN.includes(rolle)) continue;
    const ganz = manifest.eintraege.some((e) => e.pfad === pfad && e.block === undefined && e.schluessel === undefined && wirdVerteilt(e));
    if (!ganz) res.fehler.push(`Quell-Manifest: Rollen-Pfad '${pfad}' (${rolle}) ist keine verteilte Einheit (ganze Datei)`);
  }
  if (res.fehler.length > 0) return res;
  for (const rolle of PROJEKT_ROLLEN) {
    if (zielLies(ROLLEN_PFADE[rolle]) === null) res.meldungen.push(`Rollen-Pfad '${ROLLEN_PFADE[rolle]}' (${rolle}) fehlt im Ziel; das Projekt legt seine Datei dort selbst an`);
  }

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
      const ergebnis = ganz ? rendereProjektwerte(srcText, zielConfig, pfad) : wendeTeileAn(eintraege, srcText, zielLf, zielConfig);
      if (!ganz) res.fehler.push(...pruefeErgebnis(pfad, eintraege, srcText, zielLf, ergebnis));
      ziele.set(pfad, { ergebnis, zielRoh, zielLf, srcText });
    } catch (err) {
      res.fehler.push(err.message.startsWith(`${pfad}:`) ? err.message : `${pfad}: ${err.message}`);
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
  const herkunft = quelleStand.tag ? { commit: quelleStand.commit, tag: quelleStand.tag, sauber: quelleStand.sauber } : { commit: quelleStand.commit, sauber: quelleStand.sauber };
  res.stand = { version: 2, quelle: herkunft, manifest: textHash(manifestText), einheiten: sortiert };
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

const GIT_PUFFER = 256 * 1024 * 1024;

function gitIn(quelle, args, input) {
  try {
    return { ok: true, out: execFileSync("git", ["-C", quelle, ...args], { input, maxBuffer: GIT_PUFFER, stdio: ["pipe", "pipe", "ignore"] }) };
  } catch {
    return { ok: false, out: Buffer.alloc(0) };
  }
}

/**
 * Leser für einen Tag der Quelle (#1871): `{ fehler }` oder `{ stand, lies, ausfuehrbar, vorladen }`. Nur Tags zählen, ein Branch gleichen Namens nicht;
 * der Commit ist der aufgelöste Commit (auch bei einem annotierten Tag). `lies` liefert `null` für Pfade ohne Blob im Tag, `vorladen` holt viele
 * Pfade mit einem `git cat-file --batch` (die Länge im Kopf zählt Bytes).
 */
export function quelleVomTag(quelle, tag) {
  const aufgeloest = gitIn(quelle, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]);
  if (!aufgeloest.ok) {
    if (!gitIn(quelle, ["rev-parse", "--git-dir"]).ok) return { fehler: "Quelle ist kein Git-Repo" };
    if (!gitIn(quelle, ["check-ref-format", `refs/tags/${tag}`]).ok) return { fehler: `'${tag}' ist kein gültiger Tag-Name` };
    const branch = gitIn(quelle, ["rev-parse", "--verify", "--quiet", `refs/heads/${tag}`]).ok;
    return { fehler: branch ? `'${tag}' ist ein Branch, kein Tag; der Sync nimmt nur Tags` : `Tag '${tag}' gibt es in der Quelle nicht` };
  }
  const commit = aufgeloest.out.toString("utf8").trim();
  const baum = gitIn(quelle, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  if (!baum.ok) return { fehler: `Tag '${tag}': der Baum von ${commit} ist nicht lesbar` };
  const modi = new Map();
  for (const zeile of baum.out.toString("utf8").split("\0")) {
    const m = /^(\d+) blob [0-9a-f]+\t(.*)$/s.exec(zeile);
    if (m) modi.set(m[2], m[1]);
  }
  const cache = new Map();
  const vorladen = (pfade) => {
    const gesucht = [...new Set(pfade)].filter((p) => modi.has(p) && !cache.has(p) && !p.includes("\n"));
    if (gesucht.length === 0) return;
    const r = gitIn(quelle, ["cat-file", "--batch"], gesucht.map((p) => `${commit}:${p}\n`).join(""));
    if (!r.ok) return;
    let pos = 0;
    for (const p of gesucht) {
      const ende = r.out.indexOf(0x0a, pos);
      if (ende < 0) return;
      const kopf = r.out.toString("utf8", pos, ende).split(" ");
      pos = ende + 1;
      if (kopf[1] === "missing") continue;
      const laenge = Number(kopf[2]);
      cache.set(p, r.out.subarray(pos, pos + laenge).toString("utf8"));
      pos += laenge + 1;
    }
  };
  const lies = (pfad) => {
    if (!modi.has(pfad)) return null;
    if (!cache.has(pfad)) {
      const r = gitIn(quelle, ["show", `${commit}:${pfad}`]);
      if (!r.ok) return null;
      cache.set(pfad, r.out.toString("utf8"));
    }
    return cache.get(pfad);
  };
  return { stand: { commit, tag, sauber: true }, lies, ausfuehrbar: (pfad) => modi.get(pfad) === "100755", vorladen };
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
  const unbekannt = (flag) => `unbekannte Option '${flag}'`;
  const meldung = { unbekannt, positional: unbekannt, "ohne-wert": (flag) => `${flag} braucht ${flag === "--tag" ? "einen Namen" : "einen Pfad"}`, fehlt: "--quelle <pfad> fehlt" };
  const optionen = { quelle: { type: "string" }, ziel: { type: "string" }, tag: { type: "string" }, entwurf: { type: "boolean" }, trocken: { type: "boolean" } };
  const { werte, fehler } = flagsLesen(argv, optionen, { pflicht: ["quelle"], meldung });
  const beide = fehler === null && werte.tag !== undefined && werte.entwurf === true ? "--tag und --entwurf schließen sich aus" : null;
  return { quelle: werte.quelle ?? null, ziel: werte.ziel ?? null, tag: werte.tag ?? null, entwurf: werte.entwurf === true, trocken: werte.trocken === true, fehler: fehler?.text ?? beide };
}

/** Kommandozeile; Rückgabe = Exit-Code (0 ok, 1 Fehler, 2 Aufruf). */
export function cli(argv, { cwd = process.cwd(), out = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const opt = parseArgs(argv);
  const usage = "Aufruf: node scripts/factory-sync.mjs --quelle <pfad> (--tag <name> | --entwurf) [--ziel <pfad>] [--trocken]";
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
  if (opt.tag === null && !opt.entwurf) {
    err("factory-sync: ohne --tag synct factory-sync nicht (nur --entwurf liest den Arbeitsbaum)\nWeg: die Quelle taggen und mit --tag <name> syncen\nfactory-sync: nichts geschrieben");
    return 1;
  }
  let leser = { quelleLies: liesDatei(quelle), quelleAusfuehrbar: (pfad) => (statSync(join(quelle, ...pfad.split("/"))).mode & 0o111) !== 0, quelleStand: quelleGit(quelle) };
  if (opt.tag !== null) {
    const v = quelleVomTag(quelle, opt.tag);
    if (v.fehler !== undefined) {
      err(`factory-sync: ${v.fehler}\nfactory-sync: nichts geschrieben`);
      return 1;
    }
    try {
      const m = JSON.parse(v.lies(MANIFEST_PFAD) ?? "");
      if (Array.isArray(m.eintraege)) v.vorladen(m.eintraege.filter((e) => typeof e?.pfad === "string").map((e) => e.pfad));
    } catch {
      // kein lesbares Manifest: planeSync meldet es.
    }
    leser = { quelleLies: v.lies, quelleAusfuehrbar: v.ausfuehrbar, quelleStand: v.stand };
  }
  const plan = planeSync({ ...leser, zielLies: liesDatei(ziel), zielConfig: () => ladeProjektConfig({ rootDir: ziel }) });
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
  if (opt.tag === null) out("Hinweis: Entwurf aus dem Arbeitsbaum, check:factorydrift im Ziel bleibt rot bis zum Sync von einem Tag");
  out(`factory-sync: ${plan.dateien.size} ${opt.trocken ? "zu ändern" : "geändert"}, ${plan.unveraendert} unverändert`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = cli(process.argv.slice(2));
}
