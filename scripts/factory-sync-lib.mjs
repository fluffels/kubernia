// Bibliothek des Sync-Werkzeugs (ADR 0022 F9, F10): Teil-Einheiten anwenden und prüfen, Ergänzung lesen und Commit-Leser. Ohne Direktaufruf-Guard, damit
// `factory-sync.mjs` und `factory-export.mjs` (zwei Einstiegsskripte) daraus teilen statt voneinander zu importieren (#1398).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ergaenzungAusText, istRepoForm, PROJEKT_CONFIG } from "./projekt-config-lib.mjs";
import {
  ergaenzungsAnzahlVon,
  ergaenzungsBefundeVon,
  istErgaenzbar,
  kernAnteilVon,
  leereErgaenzung,
  mitErgaenzungVon,
  einheitId,
  einheitText,
  jsonSchluesselSpanne,
  normalisierterEinheitText,
  rendereProjektwerte,
  setzeBlock,
  setzeJsonSchluessel,
} from "./besitz-lib.mjs";

const PROJEKT_PFAD = PROJEKT_CONFIG;

/** Pfad des Sync-Stands im Projekt (Schrägstrich-Form, relativ zur Wurzel). */
export const STAND_PFAD = ".factory/sync-stand.json";

/**
 * Pur: der Sync-Stand aus seinem Dateitext (#97). `zustand`: `fehlt` (kein Text: kein Bezieher), `kaputt` (kein JSON oder kein Objekt, auch `null`,
 * Liste, Zahl) oder `ok` mit dem Objekt in `stand`. Der einzige Leser des Formats; `stand` ist sonst `null`.
 */
export function syncStandAusText(text) {
  if (text === null || text === undefined) return { zustand: "fehlt", stand: null };
  try {
    const stand = JSON.parse(text);
    if (stand === null || typeof stand !== "object" || Array.isArray(stand)) return { zustand: "kaputt", stand: null };
    return { zustand: "ok", stand };
  } catch {
    return { zustand: "kaputt", stand: null };
  }
}

/** Pur: das `repo` (`owner/name`) der Projekt-Config der Quelle (Dateitext oder `null`); `undefined`, wenn es fehlt, keine Form hat oder die Datei kaputt ist. */
export function quelleRepoAusText(text) {
  try {
    const repo = JSON.parse(text ?? "null")?.repo;
    return istRepoForm(repo) ? repo : undefined;
  } catch {
    return undefined;
  }
}

/** Liest den Sync-Stand eines Projekts (`syncStandAusText`); eine nicht lesbare Datei zählt als `fehlt`. Wirft nie. */
export function liesSyncStand(wurzel) {
  let text = null;
  try {
    text = readFileSync(join(wurzel, ...STAND_PFAD.split("/")), "utf8");
  } catch {
    // keine Datei: fehlt.
  }
  return syncStandAusText(text);
}

const gleichJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Leere Ergänzung für Quelle und Ziel. */
export const LEER = () => ({ quelle: leereErgaenzung(), ziel: leereErgaenzung() });

/**
 * Die Ergänzungen aus der Projekt-Config (`berechtigungen` und `sandbox`; `lies` liefert den Dateitext oder `null`), tolerant: fehlende Datei oder fehlender Block
 * heißt leer (weniger Rechte). Wirft bei kaputtem JSON oder falscher Form (dann wird nichts geschrieben).
 */
export function liesErgaenzung(lies) {
  return ergaenzungAusText(lies(PROJEKT_PFAD));
}

const istLeer = (e, erg) => ergaenzungsAnzahlVon(e, erg) === 0;

/** Werttext der ergänzbaren Einheit `e` im Ziel: ohne Ergänzung wörtlich aus der Quelle, sonst Kern-Anteil plus Ziel-Ergänzung (zwei Leerzeichen, Einrückung der Schlüsselzeile). */
function ergaenzterWert(e, srcText, span, erg) {
  const roh = srcText.slice(span.start, span.ende);
  if (istLeer(e, erg.quelle) && istLeer(e, erg.ziel)) return roh;
  const quellBefund = ergaenzungsBefundeVon(e, JSON.parse(roh), erg.quelle);
  const ziel = mitErgaenzungVon(e, kernAnteilVon(e, JSON.parse(roh), erg.quelle), erg.ziel);
  const befund = [...quellBefund.map((b) => `Quelle: ${b}`), ...ergaenzungsBefundeVon(e, ziel, erg.ziel).map((b) => `Ziel: ${b}`)];
  if (befund.length > 0) throw new Error(befund.join("; "));
  const zeilenStart = srcText.lastIndexOf("\n", span.start) + 1;
  const einrueckung = /^[ \t]*/.exec(srcText.slice(zeilenStart))[0];
  return JSON.stringify(ziel, null, 2).replace(/\n/g, `\n${einrueckung}`);
}

/** Wendet alle Teil-Einheiten einer Datei nacheinander auf den Zieltext an (LF-normalisiert). Wirft bei Marker- oder JSON-Fehlern. */
export function wendeTeileAn(eintraege, srcText, zielLf, zielConfig, erg) {
  let arbeit = zielLf;
  for (const e of eintraege) {
    if (e.block !== undefined) {
      if (arbeit === null) throw new Error(`${einheitId(e)}: Datei fehlt im Ziel, die Marker fehlen`);
      arbeit = setzeBlock(arbeit, e.block, rendereProjektwerte(einheitText(e, srcText), zielConfig, einheitId(e)));
    } else {
      if (arbeit === null) arbeit = "{\n}\n";
      const span = jsonSchluesselSpanne(srcText, e.schluessel);
      arbeit = setzeJsonSchluessel(arbeit, e.schluessel, istErgaenzbar(e) ? ergaenzterWert(e, srcText, span, erg) : srcText.slice(span.start, span.ende));
    }
  }
  return arbeit;
}

/** Selbstprüfung einer Teil-Datei: JSON parst, Besitz-Schlüssel = Quelle, alle anderen = Vorher; Block-Einheit = Quelle. */
export function pruefeErgebnis(pfad, eintraege, srcText, zielLf, ergebnis, erg = LEER()) {
  const fehler = [];
  if (eintraege.some((e) => e.schluessel !== undefined)) {
    const neu = JSON.parse(ergebnis);
    const quelle = JSON.parse(srcText);
    const vorher = zielLf === null ? {} : JSON.parse(zielLf);
    const besitz = new Set(eintraege.filter((e) => e.schluessel !== undefined).map((e) => e.schluessel));
    const ergEinheiten = new Map(eintraege.filter(istErgaenzbar).map((e) => [e.schluessel, e]));
    for (const k of besitz) {
      const ergE = ergEinheiten.get(k);
      const gleich = ergE ? gleichJson(kernAnteilVon(ergE, neu[k], erg.ziel), kernAnteilVon(ergE, quelle[k], erg.quelle)) : gleichJson(neu[k], quelle[k]);
      if (!gleich) fehler.push(`${pfad}: Schlüssel '${k}' weicht nach dem Sync von der Quelle ab`);
      if (ergE) fehler.push(...ergaenzungsBefundeVon(ergE, neu[k], erg.ziel).map((b) => `${pfad}: ${b}`));
    }
    for (const k of Object.keys(vorher)) if (!besitz.has(k) && !gleichJson(neu[k], vorher[k])) fehler.push(`${pfad}: Projektschlüssel '${k}' wurde verändert`);
    for (const k of Object.keys(neu)) if (!besitz.has(k) && !(k in vorher)) fehler.push(`${pfad}: Schlüssel '${k}' ist neu und kein Besitz`);
  }
  for (const e of eintraege) {
    if (e.block !== undefined && normalisierterEinheitText(e, ergebnis) !== normalisierterEinheitText(e, srcText)) fehler.push(`${einheitId(e)}: Block weicht nach dem Sync von der Quelle ab`);
  }
  return fehler;
}

const GIT_PUFFER = 256 * 1024 * 1024;

export function gitIn(quelle, args, input) {
  try {
    return { ok: true, out: execFileSync("git", ["-C", quelle, ...args], { input, maxBuffer: GIT_PUFFER, stdio: ["pipe", "pipe", "ignore"] }) };
  } catch {
    return { ok: false, out: Buffer.alloc(0) };
  }
}

/** Baum eines aufgelösten Commits lesen: `null`, wenn er nicht lesbar ist, sonst `{ commit, pfade, lies, ausfuehrbar, vorladen }`. */
export function leserFuerCommit(quelle, commit) {
  const baum = gitIn(quelle, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  if (!baum.ok) return null;
  const modi = new Map();
  for (const zeile of baum.out.toString("utf8").split("\0")) {
    const m = /^(\d+) blob [0-9a-f]+\t(.*)$/s.exec(zeile);
    if (m && m[1] !== "120000") modi.set(m[2], m[1]); // Symlinks sind nicht verteilbar: der Link-Text wäre kein Dateiinhalt
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
  return { commit, pfade: [...modi.keys()], lies, ausfuehrbar: (pfad) => modi.get(pfad) === "100755", vorladen };
}

/**
 * Leser für einen Commit der Quelle (ADR 0022 F10): `rev` ist ein beliebiger Verweis (Commit-SHA, `HEAD`, Branch, Tag). Ergebnis `{ fehler }` oder
 * `{ commit, pfade, lies, ausfuehrbar, vorladen }`: `commit` der aufgelöste SHA, `pfade` die Blob-Pfade des Baums (ohne Symlinks).
 */
export function leserVomCommit(quelle, rev) {
  const aufgeloest = gitIn(quelle, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  if (!aufgeloest.ok) return { fehler: gitIn(quelle, ["rev-parse", "--git-dir"]).ok ? `Commit '${rev}' gibt es in der Quelle nicht` : "Quelle ist kein Git-Repo" };
  const commit = aufgeloest.out.toString("utf8").trim();
  return leserFuerCommit(quelle, commit) ?? { fehler: `der Baum von ${commit} ist nicht lesbar` };
}

