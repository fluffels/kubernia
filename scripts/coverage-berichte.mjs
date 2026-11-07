// Blatt-Modul (factory#185): die Leser der Coverage-Berichte (lcov und JaCoCo-XML) und die Projekt-Config `coverage.berichte`. Kein Shebang, kein Direktaufruf; `check-diffcoverage.mjs` nutzt es.
// Importiert nur Node-Builtins, `pfad-glob.mjs`, `relativ-pfad.mjs` und `quellwurzeln-lib.mjs`; nie `projekt-config-lib` oder `check-basis` (Zyklus), darum sagen die Meldungen „in der Projekt-Config“
// ohne Dateipfad. Kein Projektliteral.
//
// `coverage.berichte` ist eine Liste `{ format: "lcov" | "jacoco", pfad, basis? }`; `pfad` ist ein repo-relativer POSIX-Pfad oder ein Glob (Syntax von `pfad-glob.mjs`, etwa `*/target/site/jacoco/jacoco.xml`,
// Multi-Modul ohne Zuordnung je Modul), `basis` (nur lcov) wird vor relative `SF:`-Pfade gesetzt (etwa `frontend`). Ohne Block gilt `STANDARD_BERICHTE`. Jeder konfigurierte Bericht ist Pflicht.
//
// JaCoCo-Zählweise: nur Zeilen mit `<line>` stehen im Nenner; eine Zeile gilt als gedeckt bei `ci > 0`; `mb` und `cb` (verfehlte und gedeckte Zweige) speisen die Meldung „teilweise getestet“.
// JaCoCo nennt Dateien als `paket/Datei.java`, nicht als Repo-Pfad: der Pfad wird per Suffix gegen die Quellwurzeln aufgelöst; gibt es dieselbe Datei unter zwei Wurzelordnern, ist das mehrdeutig (rot, fail-closed).
// Bekannte Grenze (geschlossene Liste) des Regex-Lesers für JaCoCo: kein Entity-Decoding in Namen (`&amp;` bleibt wörtlich), keine Auswertung von Kommentaren oder CDATA, `<group>` wird ignoriert.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { globMaengel, globRegex } from "./pfad-glob.mjs";
import { istRelativPosix, normalizePath } from "./relativ-pfad.mjs";
import { istGlob, ordnerZuMuster, wurzelPraefixe } from "./quellwurzeln-lib.mjs";

export const COVERAGE_FORMATE = Object.freeze(["lcov", "jacoco"]);

/** Gilt, wenn die Projekt-Config keinen Block `coverage` hat (das bisherige Verhalten). */
export const STANDARD_BERICHTE = Object.freeze([Object.freeze({ format: "lcov", pfad: "coverage/lcov.info" })]);

const istObjekt = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function eintragMaengel(e, i) {
  const wo = `coverage.berichte[${i}]`;
  if (!istObjekt(e)) return [`${wo} muss ein Objekt { format, pfad, basis? } sein`];
  const fehler = [];
  if (!COVERAGE_FORMATE.includes(e.format)) fehler.push(`${wo}.format muss "lcov" oder "jacoco" sein: ${JSON.stringify(e.format)}`);
  fehler.push(...globMaengel([e.pfad], `${wo}.pfad`).map((m) => m.replace(`${wo}.pfad[0]`, `${wo}.pfad`)));
  if (e.basis !== undefined) {
    if (e.format !== "lcov") fehler.push(`${wo}.basis gilt nur bei format "lcov" (JaCoCo-Pfade werden gegen die Quellwurzeln aufgelöst)`);
    else if (typeof e.basis !== "string" || !istRelativPosix(e.basis) || istGlob(e.basis)) fehler.push(`${wo}.basis muss ein wörtlicher repo-relativer POSIX-Ordner sein (etwa frontend): ${JSON.stringify(e.basis)}`);
  }
  return fehler;
}

/** Pur: Fehlertexte des Blocks `coverage` (`berichte` nicht leer, je Eintrag Format, Pfad, Basis, keine Dubletten); leer = gültig. */
export function berichteMaengel(coverage) {
  if (!istObjekt(coverage)) return ["coverage muss ein Objekt mit der Liste berichte sein"];
  const liste = coverage.berichte;
  if (!Array.isArray(liste) || liste.length === 0) return ["coverage.berichte muss eine nicht-leere Liste von { format, pfad, basis? } sein"];
  const gesehen = new Set();
  return liste.flatMap((e, i) => {
    const fehler = eintragMaengel(e, i);
    if (fehler.length > 0) return fehler;
    const schluessel = `${e.format}|${e.pfad}|${e.basis ?? ""}`;
    if (gesehen.has(schluessel)) return [`coverage.berichte[${i}] steht doppelt (${e.format} ${e.pfad})`];
    gesehen.add(schluessel);
    return [];
  });
}

/** Die Coverage-Berichte aus der Config als Liste `{ format, pfad, basis? }`; ohne Block `STANDARD_BERICHTE` (als Kopie), kaputte Form wirft mit Fix-Zeile (fail-closed). */
export function berichteAus(config) {
  const block = config?.coverage;
  if (block === undefined) return STANDARD_BERICHTE.map((b) => ({ ...b }));
  const fehler = berichteMaengel(block);
  if (fehler.length > 0) {
    throw new Error(`${fehler.join("; ")} in der Projekt-Config\nFix: coverage.berichte als Liste von { format: "lcov" | "jacoco", pfad (auch Glob, etwa "*/target/site/jacoco/jacoco.xml"), basis? } in der Projekt-Config eintragen oder den Block coverage streichen`);
  }
  return block.berichte.map((b) => ({ format: b.format, pfad: b.pfad, ...(b.basis === undefined ? {} : { basis: b.basis }) }));
}

// ── lcov ─────────────────────────────────────────────────────────────────────

const ABSOLUT = /^(?:\/|[A-Za-z]:\/)/;

/** `SF:`-Pfad → repo-relativer Schlüssel: Trenner vereinheitlicht, `basis/` vor einen relativen Pfad gesetzt, ein absoluter bleibt. */
function sfPfad(roh, basis) {
  const p = normalizePath(roh);
  return basis === undefined || ABSOLUT.test(p) ? p : `${basis}/${p}`;
}

/** Parst ein lcov-Info-File zu `Datei → (Zeile → Trefferzahl)`. Es interessieren nur die `SF:`/`DA:`-Records; `DA:` existiert ausschließlich für AUSFÜHRBARE Zeilen —
 *  Kommentare, Typen und Leerzeilen fehlen also von Haus aus im Nenner. Mit `basis` steht `basis/` vor jedem relativen `SF:`-Pfad. Pure. */
export function parseLcov(text, basis) {
  const byFile = new Map();
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      current = sfPfad(line.slice(3), basis);
      if (!byFile.has(current)) byFile.set(current, new Map());
      continue;
    }
    if (line === "end_of_record") {
      current = null;
      continue;
    }
    if (!line.startsWith("DA:") || current === null) continue;
    const [no, hits] = line.slice(3).split(",");
    const lineNo = Number.parseInt(no, 10);
    const count = Number.parseInt(hits, 10);
    if (!Number.isFinite(lineNo)) continue;
    byFile.get(current).set(lineNo, Number.isFinite(count) ? count : 0);
  }
  return byFile;
}

/** Parst die `BRDA:`-Records eines lcov-Files zu `Datei → (Zeile → { total, taken })` (quellprojekt#1425): je Zeile die Zahl der Zweige und wie viele davon mindestens einmal genommen wurden.
 *  `BRDA:<zeile>,<block>,<zweig>,<taken>`, `taken` = `-` heißt „nie erreicht“ (zählt als nicht genommen). Kaputte Records werden übersprungen. Pure. */
export function parseLcovBranches(text, basis) {
  const byFile = new Map();
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      current = sfPfad(line.slice(3), basis);
      if (!byFile.has(current)) byFile.set(current, new Map());
      continue;
    }
    if (line === "end_of_record") {
      current = null;
      continue;
    }
    if (!line.startsWith("BRDA:") || current === null) continue;
    const teile = line.slice(5).split(",");
    if (teile.length !== 4) continue;
    const lineNo = Number.parseInt(teile[0], 10);
    if (!Number.isFinite(lineNo)) continue;
    const taken = teile[3] === "-" ? 0 : Number.parseInt(teile[3], 10);
    if (!Number.isFinite(taken)) continue;
    const zeilen = byFile.get(current);
    const e = zeilen.get(lineNo) ?? { total: 0, taken: 0 };
    e.total++;
    if (taken > 0) e.taken++;
    zeilen.set(lineNo, e);
  }
  return byFile;
}

// ── JaCoCo ───────────────────────────────────────────────────────────────────

const JACOCO_TAG = /<(package|sourcefile|line)\b([^>]*)>|<\/(package|sourcefile)\s*>/g;

function attribut(attribute, name) {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attribute);
  return m === null ? undefined : m[1];
}

const zahl = (v) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : 0;
};

function jacocoZeile(attribute, eintrag) {
  const nr = Number.parseInt(attribut(attribute, "nr") ?? "", 10);
  if (!Number.isFinite(nr)) return;
  const ci = zahl(attribut(attribute, "ci"));
  eintrag.zeilen.set(nr, (eintrag.zeilen.get(nr) ?? 0) + ci);
  const mb = zahl(attribut(attribute, "mb"));
  const cb = zahl(attribut(attribute, "cb"));
  if (mb + cb === 0) return;
  const alt = eintrag.zweige.get(nr);
  eintrag.zweige.set(nr, alt === undefined ? { total: mb + cb, taken: cb } : { total: Math.max(alt.total, mb + cb), taken: Math.max(alt.taken, cb) });
}

/** Parst ein JaCoCo-XML (einzeilig oder umbrochen) zu `„paket/Datei.java“ → { zeilen: Map<nr, ci>, zweige: Map<nr, { total: mb + cb, taken: cb }> }`.
 *  Nur `<package>`, `<sourcefile>` und `<line>` zählen; ein `<line>` außerhalb eines `<sourcefile>` wird ignoriert, das Default-Paket (`name=""`) ergibt den Dateinamen allein. Pure. */
export function parseJacoco(text) {
  const byFile = new Map();
  let paket = "";
  let aktuell = null;
  for (const m of String(text).matchAll(JACOCO_TAG)) {
    const tag = m[1] ?? m[3];
    const geschlossen = m[1] === undefined;
    if (tag === "package") {
      paket = geschlossen ? "" : (attribut(m[2], "name") ?? "");
      aktuell = null;
    } else if (tag === "sourcefile") {
      const name = geschlossen ? undefined : attribut(m[2], "name");
      const schluessel = name === undefined ? null : paket === "" ? name : `${paket}/${name}`;
      if (schluessel !== null && !byFile.has(schluessel)) byFile.set(schluessel, { zeilen: new Map(), zweige: new Map() });
      aktuell = schluessel === null ? null : byFile.get(schluessel);
    } else if (aktuell !== null) jacocoZeile(m[2], aktuell);
  }
  return byFile;
}

// ── Berichtsdateien und Abdeckung ────────────────────────────────────────────

/** Die Dateien eines Berichtspfads (repo-relativ, POSIX, sortiert): ein wörtlicher Pfad ergibt sich selbst (ob es ihn gibt, zeigt erst das Lesen), ein Glob die Treffer
 *  (Ordnerteil über `ordnerZuMuster`, letztes Segment gegen die Dateinamen; `node_modules` und Punkt-Ordner werden nicht betreten). */
export function berichtDateien(rootDir, pfad) {
  if (!istGlob(pfad)) return [pfad];
  const segmente = pfad.split("/");
  const datei = globRegex(segmente.pop());
  const treffer = [];
  for (const ordner of ordnerZuMuster(rootDir, segmente.join("/"))) {
    for (const ent of readdirSync(join(rootDir, ...ordner.split("/")), { withFileTypes: true })) {
      if (ent.isFile() && datei.test(ent.name)) treffer.push(ordner === "" ? ent.name : `${ordner}/${ent.name}`);
    }
  }
  return [...new Set(treffer)].sort();
}

function mischeZeilen(ziel, zeilen) {
  for (const [nr, hits] of zeilen) ziel.set(nr, (ziel.get(nr) ?? 0) + hits);
}

function mischeZweige(ziel, zweige) {
  for (const [nr, z] of zweige) {
    const alt = ziel.get(nr);
    ziel.set(nr, alt === undefined ? { ...z } : { total: Math.max(alt.total, z.total), taken: Math.max(alt.taken, z.taken) });
  }
}

/** Merkt, aus welchem Bericht Daten zu einer Datei stammen (factory#215): je Repo-Pfad die Berichtsdateien in Lesereihenfolge, ohne Dublette. */
function merkeBericht(berichteJe, pfad, bericht) {
  const alt = berichteJe.get(pfad) ?? [];
  if (!alt.includes(bericht)) berichteJe.set(pfad, [...alt, bericht]);
}

/** Mischt Daten einer Datei in den Gesamtbestand: Hits je Zeile addiert, Zweige je Zeile per `max`. */
function mische(abdeckung, zweige, pfad, zeilenDaten, zweigDaten) {
  if (zeilenDaten !== undefined) {
    if (!abdeckung.has(pfad)) abdeckung.set(pfad, new Map());
    mischeZeilen(abdeckung.get(pfad), zeilenDaten);
  }
  if (zweigDaten !== undefined) {
    if (!zweige.has(pfad)) zweige.set(pfad, new Map());
    mischeZweige(zweige.get(pfad), zweigDaten);
  }
}

/** Liest einen Bericht; ein Fehler (fehlt, nicht lesbar) kommt nach `fehlend`. Rückgabe: der gelesene Text oder `null`. */
function leseBericht(lies, rootDir, datei, fehlend) {
  try {
    return lies(join(rootDir, ...datei.split("/")));
  } catch {
    fehlend.push(datei);
    return null;
  }
}

function jacocoZuordnen({ bestaende, bestandPfade, messDateien, quellen, rootDir, wurzelOrdner, existiert, abdeckung, zweige, mehrdeutig, berichteJe }) {
  const ordner = [...new Set(wurzelOrdner ?? quellen.wurzeln.flatMap((w) => ordnerZuMuster(rootDir, w)))];
  const gibt = existiert ?? ((p) => existsSync(join(rootDir, ...p.split("/"))));
  for (const pfad of messDateien) {
    for (const praefix of wurzelPraefixe(pfad, quellen.wurzeln)) {
      const schluessel = pfad.slice(praefix.length + 1);
      const treffer = bestaende.filter((b) => b.has(schluessel));
      if (treffer.length === 0) continue;
      const kandidaten = ordner.map((o) => `${o}/${schluessel}`).filter(gibt);
      if (kandidaten.length > 1) {
        mehrdeutig.push({ pfad, schluessel, kandidaten });
        continue;
      }
      for (const b of treffer) {
        mische(abdeckung, zweige, pfad, b.get(schluessel).zeilen, b.get(schluessel).zweige);
        merkeBericht(berichteJe, pfad, bestandPfade[bestaende.indexOf(b)]);
      }
    }
  }
}

/** Liest alle konfigurierten Berichte und liefert die Abdeckung je Repo-Pfad: `{ abdeckung: Map<pfad, Map<zeile, hits>>, zweige: Map<pfad, Map<zeile, { total, taken }>>, fehlend: string[],
 *  mehrdeutig: { pfad, schluessel, kandidaten }[], berichteJe: Map<pfad, string[]> }` (`berichteJe`: die Berichtsdateien, aus denen die Daten einer Datei stammen). `fehlend` nennt jeden nicht lesbaren Berichtspfad bzw. einen Glob ohne Treffer. JaCoCo-Dateien werden nur für die gemessenen geänderten
 *  Dateien (`messDateien`) aufgelöst: Schlüssel = Pfad ohne Wurzel-Präfix; gibt es den Schlüssel im Bericht und unter mehr als einem Wurzelordner eine Datei dazu, ist das `mehrdeutig`.
 *  Dieselbe Datei in mehreren Berichten wird gemischt (Hits addiert, Zweige per `max`). `wurzelOrdner` und `existiert` sind injizierbar (Standard: Dateisystem unter `rootDir`), nur bei JaCoCo gebraucht. */
export function ladeAbdeckung({ berichte, rootDir, lies, messDateien, quellen, wurzelOrdner, existiert }) {
  const abdeckung = new Map();
  const zweige = new Map();
  const fehlend = [];
  const mehrdeutig = [];
  const bestaende = [];
  const bestandPfade = [];
  const berichteJe = new Map();
  for (const b of berichte) {
    const dateien = berichtDateien(rootDir, b.pfad);
    if (dateien.length === 0) fehlend.push(b.pfad);
    for (const datei of dateien) {
      const text = leseBericht(lies, rootDir, datei, fehlend);
      if (text === null) continue;
      if (b.format === "jacoco") {
        bestaende.push(parseJacoco(text));
        bestandPfade.push(datei);
        continue;
      }
      const zeilen = parseLcov(text, b.basis);
      const br = parseLcovBranches(text, b.basis);
      for (const [pfad, daten] of zeilen) {
        mische(abdeckung, zweige, pfad, daten, br.get(pfad));
        merkeBericht(berichteJe, pfad, datei);
      }
    }
  }
  if (bestaende.length > 0) jacocoZuordnen({ bestaende, bestandPfade, messDateien, quellen, rootDir, wurzelOrdner, existiert, abdeckung, zweige, mehrdeutig, berichteJe });
  return { abdeckung, zweige, fehlend, mehrdeutig, berichteJe };
}
