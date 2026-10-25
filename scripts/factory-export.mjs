// Export-Werkzeug des Factory-Repos (ADR 0022 F10, Teil 7a, #1923): schreibt den Anfangsstand des Factory-Repos aus einem Commit dieses Repos.
// `node scripts/factory-export.mjs --ziel <leerer Ordner> [--commit <rev>] [--quelle <repo>]`; Exit 0 ok, 1 Befund oder nicht leeres Ziel, 2 Aufruf.
// Einmalig: das Werkzeug samt `factory-export-lib.mjs` und Test entfällt mit K9 (#1882); die Fortschreibung zu ADR 0022 beschreibt den Ablauf.
// Quelle ist ein Commit (Standard `HEAD`, gelesen wie beim Sync per git, nie der Arbeitsbaum). Erst wird alles im Speicher zusammengebaut und geprüft,
// geschrieben wird nur ohne Befund (sortiert, damit zwei Läufe byte-gleich sind). Inhalt: alle Besitz-Einheiten, die mitziehenden Arten der
// Extraktionsliste (`produkt-wurzel` an die Wurzel) und die Vorlagen unter `.factory/produkt/vorlagen/<zielpfad>.vorlage`; zusammengesetzt werden
// AGENTS.md und .claude/settings.json (Kern-Anteile plus Vorlage) und .factory/projekt.json (Überschreibung der obersten Schlüssel), berechnet die
// Projektwert-Blöcke, `package-lock.json` (Auszug) und die Daten-Dateien der Kern-Wächter (Kern-Anteil per Filter).
// In den Factory-Seiten (Art `factory-seite`) wird der Commit-Zeilen-Präfix der Quelle auf den der Factory-Config umgeschrieben (`schreibePraefixUm`, #1932). Danach entlinkt `entlinke` dort jeden Link auf ein Ziel außerhalb des Exports (der Text bleibt) und streicht tote Anker (#1935); der Bericht nennt Zahl und Ziele.
// Bekannte Muster der Prüfungen (Grenzen): siehe Kopf von `factory-export-lib.mjs`.
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { collectHeadingSlugs } from "./check-docdrift.mjs";
import { istGanzeDatei, normalisiereEol, projektwertDateien, pruefeManifest, rendereProjektwerte } from "./besitz-lib.mjs";
import { artVon, EXTRAKTION_PFAD, MITZIEHEND, musterRegex, pruefeExtraktion } from "./besitz-extraktion.mjs";
import { leserVomCommit, liesErgaenzung, pruefeErgebnis, wendeTeileAn } from "./factory-sync-lib.mjs";
import {
  entlinke,
  KANDIDATEN,
  kuberniaBegriffe,
  lockAuszug,
  schreibePraefixUm,
  pruefeLiterale,
  pruefeLokalePfade,
  pruefePaketImporte,
  pruefeRelativeImporte,
  pruefeSchutzliste,
  pruefeSkriptBezuege,
  vorlagenPfad,
  vorlagenZiel,
} from "./factory-export-lib.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { ergaenzungAusText, PROJEKT_CONFIG, pruefeProjektConfig, repoName, ROLLEN_PFADE } from "./projekt-config-lib.mjs";
import { ZEIGER_WURZEL, zeigerText } from "./skill-pfade.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = ".factory/besitz.json";
/** Lock-Datei: von der Literal-Prüfung ausgenommen, weil ihre Integritäts-Hashes (Base64) zufällig als ganzes Wort wie `KQ` enden können; die Wurzel kommt aus der Vorlage. */
const LOCK = "package-lock.json";
/** Schutzliste und ihr Spiegel: Vorlagen im Export, geprüft gegen die Quelle (`pruefeSchutzliste`). */
const SCHUTZ_QUELLE = ".github/protected-paths.json";
const CODEOWNERS = ".github/CODEOWNERS";
const USAGE = "Aufruf: node scripts/factory-export.mjs --ziel <leerer Ordner> [--commit <rev>] [--quelle <repo>]";

/** Verzeichnisname des Ticket-Skills der Rolle `ticketSkill` (Quelle `ROLLEN_PFADE.ticketSkill`) und sein Zeiger unter der Zeiger-Wurzel. */
const TICKET_ORDNER = posix.basename(posix.dirname(ROLLEN_PFADE.ticketSkill));
const TICKET_ZEIGER = `${ZEIGER_WURZEL}/${TICKET_ORDNER}/SKILL.md`;

/** Dateien, die der Export aus einer Vorlage nicht braucht: er filtert sie aus dem Quellstand (Lint- und Any-Suppressionen) oder berechnet sie (Zeiger des Ticket-Skills aus seiner Vorlage). */
const BERECHNET = ["eslint-suppressions.json", "any-suppressions.json", TICKET_ZEIGER];

const json = (wert) => `${JSON.stringify(wert, null, 2)}\n`;
const nurSchluessel = (text, erlaubt) => json(Object.fromEntries(Object.entries(JSON.parse(text)).filter(([k]) => erlaubt(k))));

/** Arten der Extraktionsliste, die im Export stehen bleiben (Kern-Anteil der Liste). */
const LISTEN_ARTEN = ["kern-test", "test-hilfe", "fixture"];

/**
 * Daten-Dateien der Kern-Wächter (geschlossen): Kern-Anteil per Filter auf die exportierten Pfade. Jede Datei, die ein Kern-Test als
 * Daten-Datei liest, steht hier (der Test `factory-export.test.ts` gleicht das mit `test/harness/extraktion.test.ts` ab).
 */
export const WAECHTER_DATEN = {
  ".factory/besitz.json": (text) => text,
  [EXTRAKTION_PFAD]: (text) => json({ ...JSON.parse(text), eintraege: JSON.parse(text).eintraege.filter((e) => LISTEN_ARTEN.includes(e.art)) }),
  "test/harness/kern-abdeckung.json": (text, pfade) => nurSchluessel(text, (k) => [...pfade].some((p) => musterRegex(k).test(p))),
  "eslint-suppressions.json": (text, pfade) => nurSchluessel(text, (k) => pfade.has(k)),
  "any-suppressions.json": (text, pfade) => nurSchluessel(text, (k) => pfade.has(k)),
  "test/harness/kern-literale-baseline.json": () => "{}\n",
  "test/harness/kern-links-baseline.json": (text) => text,
};

function parse(text, name, befunde) {
  if (text === null) {
    befunde.push(`${name}: Datei fehlt`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    befunde.push(`${name}: kein gültiges JSON`);
    return null;
  }
}

/** Anteil der Teil-Einheiten des Manifests je Pfad (Pfad -> Einträge). */
const teileJePfad = (eintraege) => {
  const teile = new Map();
  for (const e of eintraege.filter((x) => !istGanzeDatei(x))) teile.set(e.pfad, [...(teile.get(e.pfad) ?? []), e]);
  return teile;
};

/** Vorprüfung und Eingaben: Manifest, Liste, Configs, Vorlagen (Befunde stehen in `befunde`, bei Befund ist `null` zurückgegeben). */
function vorpruefung(leser, befunde) {
  const lies = (p) => leser.lies(p);
  const manifest = parse(lies(MANIFEST), MANIFEST, befunde);
  const liste = parse(lies(EXTRAKTION_PFAD), EXTRAKTION_PFAD, befunde);
  const kubConfig = parse(lies(PROJEKT_CONFIG), PROJEKT_CONFIG, befunde);
  if (manifest === null || liste === null || kubConfig === null) return null;
  if (!Array.isArray(manifest.eintraege) || !Array.isArray(liste.eintraege)) {
    befunde.push("Manifest oder Extraktionsliste ohne Liste 'eintraege'");
    return null;
  }
  if (typeof kubConfig.struktur?.quelle !== "string" || kubConfig.struktur.quelle === "") {
    befunde.push(`${PROJEKT_CONFIG}: struktur.quelle fehlt`);
    return null;
  }
  const teile = teileJePfad(manifest.eintraege);
  const anteil = leser.pfade.filter((p) => artVon(liste, p) === "infrastruktur-anteil" && !BERECHNET.includes(p));
  const vorlagenZiele = [...new Set([...teile.keys(), PROJEKT_CONFIG, ...anteil])];
  const gebraucht = new Set([
    MANIFEST,
    "package.json",
    "package-lock.json",
    ...manifest.eintraege.map((e) => e.pfad),
    ...Object.keys(WAECHTER_DATEN),
    ...leser.pfade.filter((p) => (artVon(liste, p) ?? "projekt-test") !== "projekt-test" || vorlagenZiel(p) !== null),
  ]);
  leser.vorladen([...gebraucht]);
  befunde.push(...pruefeManifest(manifest, lies).map((m) => `Manifest: ${m}`));
  befunde.push(...pruefeExtraktion(liste, { getrackt: leser.pfade, besitz: manifest.eintraege, quelle: kubConfig.struktur.quelle }).map((m) => `Extraktionsliste: ${m}`));
  const vorlagen = new Map();
  for (const ziel of vorlagenZiele) {
    const text = lies(vorlagenPfad(ziel));
    if (text === null) befunde.push(`${vorlagenPfad(ziel)}: Vorlage fehlt`);
    else vorlagen.set(ziel, normalisiereEol(text));
  }
  for (const p of leser.pfade) {
    const ziel = vorlagenZiel(p);
    if (ziel !== null && !vorlagenZiele.includes(ziel)) befunde.push(`${p}: Vorlage ohne Verwendung (kein Besitz-Teil, keine Config, kein infrastruktur-anteil)`);
  }
  return befunde.length > 0 ? null : { manifest, liste, kubConfig, teile, vorlagen, anteil };
}

/**
 * Baut den Export im Speicher. `leser` ist der Rückgabewert von `leserVomCommit` (`commit`, `pfade`, `lies`, `ausfuehrbar`, `vorladen`).
 * Rückgabe `{ dateien: Map<Pfad, { text, ausfuehrbar }>, befunde, bericht }`; bei einem Befund ist `dateien` leer.
 */
export function baueExport({ leser }) {
  const befunde = [];
  const bericht = { sha: leser.commit, anzahl: 0, herkunft: { besitz: 0, extraktion: 0, vorlage: 0, berechnet: 0 }, durchgelassen: 0, durchgelassenJeMuster: [], relativUnaufloesbar: 0, paketUnbekannt: [], literalRest: [], praefixUmgeschrieben: 0 };
  const aus = () => ({ dateien: new Map(), befunde, bericht });
  const eingabe = vorpruefung(leser, befunde);
  if (eingabe === null) return aus();
  const { manifest, liste, kubConfig, teile, vorlagen, anteil } = eingabe;
  const lies = (p) => leser.lies(p);
  const dateien = new Map();
  const lege = (pfad, text, herkunft, ausfuehrbar = false) => {
    if (text === null) befunde.push(`${pfad}: nicht lesbar`);
    else if (text.includes("\0")) befunde.push(`${pfad}: Binärdatei, der Export kennt nur Text`);
    else if (dateien.has(pfad)) befunde.push(`${pfad}: Kollision zweier Quellen auf demselben Zielpfad`);
    else {
      dateien.set(pfad, { text, ausfuehrbar });
      bericht.herkunft[herkunft]++;
    }
  };

  // Config des Factory-Repos: die Config von kubernia mit den obersten Schlüsseln der Vorlage überschrieben.
  const vorlageConfig = parse(vorlagen.get(PROJEKT_CONFIG), `${vorlagenPfad(PROJEKT_CONFIG)}`, befunde);
  if (vorlageConfig === null) return aus();
  const factoryConfig = { ...kubConfig, ...vorlageConfig };
  befunde.push(...pruefeProjektConfig(factoryConfig).map((m) => `${PROJEKT_CONFIG} des Exports: ${m}`));
  const factoryText = json(factoryConfig);
  let ergaenzung;
  try {
    ergaenzung = { quelle: liesErgaenzung(lies), ziel: ergaenzungAusText(factoryText) };
  } catch (err) {
    befunde.push(`Berechtigungs-Ergänzung: ${err.message}`);
    return aus();
  }
  lege(PROJEKT_CONFIG, factoryText, "berechnet");

  for (const e of manifest.eintraege.filter(istGanzeDatei)) lege(e.pfad, lies(e.pfad), "besitz", leser.ausfuehrbar(e.pfad));
  for (const p of leser.pfade) {
    const art = artVon(liste, p);
    if (art === null || !MITZIEHEND.includes(art) || art === "infrastruktur-anteil") continue;
    lege(art === "produkt-wurzel" ? posix.basename(p) : p, lies(p), "extraktion", leser.ausfuehrbar(p));
  }
  for (const p of anteil) lege(p, vorlagen.get(p), "vorlage");
  const ticketQuelle = vorlagen.get(ROLLEN_PFADE.ticketSkill);
  if (ticketQuelle === undefined) befunde.push(`${ROLLEN_PFADE.ticketSkill}: Vorlage der Rolle ticketSkill fehlt im Export`);
  else lege(TICKET_ZEIGER, zeigerText(TICKET_ORDNER, ticketQuelle), "berechnet");
  for (const [pfad, eintraege] of teile) {
    const vorlageLf = vorlagen.get(pfad);
    const quelleLf = normalisiereEol(lies(pfad));
    const eigene = eintraege.filter((e) => e.schluessel !== undefined).map((e) => e.schluessel);
    try {
      if (pfad.endsWith(".json")) {
        const doppelt = Object.keys(JSON.parse(vorlageLf)).filter((k) => eigene.includes(k));
        for (const k of doppelt) befunde.push(`${vorlagenPfad(pfad)}: Kern-Schlüssel '${k}' gehört nicht in die Vorlage`);
      }
      const ergebnis = wendeTeileAn(eintraege, quelleLf, vorlageLf, factoryConfig, ergaenzung);
      befunde.push(...pruefeErgebnis(pfad, eintraege, quelleLf, vorlageLf, ergebnis, ergaenzung));
      lege(pfad, ergebnis, "berechnet");
    } catch (err) {
      befunde.push(err.message.startsWith(`${pfad}:`) ? err.message : `${pfad}: ${err.message}`);
    }
  }
  const pkgVorlage = parse(vorlagen.get("package.json"), vorlagenPfad("package.json"), befunde);
  const kubPkg = parse(lies("package.json"), "package.json", befunde);
  const kubLock = parse(lies("package-lock.json"), "package-lock.json", befunde);
  if (pkgVorlage === null || kubPkg === null || kubLock === null) return aus();
  const lock = lockAuszug(kubLock, pkgVorlage);
  befunde.push(...lock.befunde);
  if (lock.lock !== null) lege("package-lock.json", json(lock.lock), "berechnet");
  const exportPfade = new Set([...dateien.keys(), ...Object.keys(WAECHTER_DATEN)]);
  for (const [pfad, filter] of Object.entries(WAECHTER_DATEN)) {
    const text = lies(pfad);
    try {
      lege(pfad, text === null ? null : filter(text, exportPfade), "berechnet");
    } catch (err) {
      befunde.push(`${pfad}: Filter der Daten-Datei scheitert: ${err.message}`);
    }
  }
  const schutz = dateien.get(SCHUTZ_QUELLE);
  const eigner = dateien.get(CODEOWNERS);
  if (schutz === undefined || eigner === undefined) {
    befunde.push(`${SCHUTZ_QUELLE} und ${CODEOWNERS} gehören in den Export (je eine Vorlage, Art infrastruktur-anteil)`);
  } else {
    befunde.push(...pruefeSchutzliste({ vorlage: schutz.text, codeowners: eigner.text, quelle: lies(SCHUTZ_QUELLE), pfade: [...exportPfade] }));
  }
  const manifestPfade = manifest.eintraege.map((e) => e.pfad);
  for (const pfad of projektwertDateien(manifestPfade, [...dateien.keys()])) {
    const d = dateien.get(pfad);
    try {
      d.text = rendereProjektwerte(d.text, factoryConfig, pfad);
    } catch (err) {
      befunde.push(err.message);
    }
  }
  if (befunde.length > 0) return aus();

  // Factory-Seiten: der Commit-Zeilen-Präfix der Quelle wird auf den der Factory-Config umgeschrieben (nur vor Großbuchstaben).
  const seiten = new Set([...dateien.keys()].filter((p) => artVon(liste, p) === "factory-seite"));
  let praefixUmgeschrieben = 0;
  const [vonPraefix, nachPraefix] = [kubConfig.praefixe.commitZeile, factoryConfig.praefixe.commitZeile];
  if (vonPraefix !== "" && vonPraefix !== nachPraefix) {
    for (const p of seiten) {
      const d = dateien.get(p);
      const r = schreibePraefixUm(d.text, vonPraefix, nachPraefix);
      d.text = r.text;
      praefixUmgeschrieben += r.anzahl;
    }
  }

  // Entlinken: Links auf Ziele außerhalb des Exports (Spielinhalte, Projekt-Skripte) werden Text, tote Anker gestrichen; Besitz, Vorlagen und berechnete Dateien bleiben byte-gleich.
  const dateiPfade = [...exportPfade];
  const gibt = (ziel) => ziel === "" || exportPfade.has(ziel) || dateiPfade.some((p) => p.startsWith(`${ziel}/`));
  const ueberschriftenCache = new Map();
  const ueberschriften = (ziel) => {
    if (!ueberschriftenCache.has(ziel)) {
      const d = dateien.get(ziel);
      ueberschriftenCache.set(ziel, d !== undefined && ziel.endsWith(".md") ? new Set(collectHeadingSlugs(d.text)) : null);
    }
    return ueberschriftenCache.get(ziel);
  };
  const entlinkt = { links: 0, anker: 0, ziele: new Map() };
  for (const pfad of [...seiten].sort()) {
    const d = dateien.get(pfad);
    const r = entlinke(d.text, pfad, { gibt, ueberschriften });
    d.text = r.text;
    entlinkt.links += r.links;
    entlinkt.anker += r.anker;
    for (const [z, n] of r.ziele) entlinkt.ziele.set(z, (entlinkt.ziele.get(z) ?? 0) + n);
  }

  // Prüfungen auf dem zusammengebauten Stand.
  const texte = new Map([...dateien].map(([p, d]) => [p, d.text]));
  const rel = pruefeRelativeImporte(texte, new Set(leser.pfade));
  const pak = pruefePaketImporte(texte, kubPkg, pkgVorlage);
  const pfade = pruefeLokalePfade(texte, [repoName(factoryConfig), repoName(kubConfig)]);
  const lit = pruefeLiterale(texte, kuberniaBegriffe(kubConfig, factoryConfig), (p) => (p === LOCK ? "frei" : p === PROJEKT_CONFIG || seiten.has(p) ? "zaehlen" : null));
  befunde.push(...rel.befunde, ...pak.befunde, ...pruefeSkriptBezuege(texte).befunde, ...pfade.befunde, ...lit.befunde);
  Object.assign(bericht, {
    anzahl: dateien.size,
    durchgelassen: pfade.durchgelassen,
    durchgelassenJeMuster: pfade.jeMuster,
    relativUnaufloesbar: rel.unaufloesbar,
    paketUnbekannt: pak.unbekannt,
    literalRest: [...lit.rest].sort(([a], [b]) => (a < b ? -1 : 1)),
    praefixUmgeschrieben,
    entlinkt: { ...entlinkt, ziele: [...entlinkt.ziele].sort(([a], [b]) => (a < b ? -1 : 1)) },
  });
  return befunde.length > 0 ? aus() : { dateien, befunde, bericht };
}

/** Zeilen des Berichts. */
function berichtZeilen(b) {
  const h = b.herkunft;
  return [
    `Export-SHA ${b.sha}`,
    `Dateien: ${b.anzahl} (Besitz ${h.besitz}, Extraktionsliste ${h.extraktion}, Vorlagen ${h.vorlage}, berechnet ${h.berechnet})`,
    `Lokale Pfade durchgelassen (Zeilen mit Platzhalter oder Fixture-Wurzel, ohne Befund; eine Zeile kann mehrere Muster treffen, darum ist die Summe je Muster größer): ${b.durchgelassen}; je Muster ${KANDIDATEN.map((re, k) => `${re.source} = ${b.durchgelassenJeMuster[k]}`).join("; ")}`,
    `Relative Importe, in der Quelle schon unauflösbar (Fixture-Text): ${b.relativUnaufloesbar}`,
    `Paket-Spezifizierer, die kubernia nicht kennt (Fixture-Text): ${b.paketUnbekannt.length} (Namen: ${b.paketUnbekannt.filter((n) => !n.startsWith("?")).join(", ")}; ${b.paketUnbekannt.filter((n) => n.startsWith("?")).length} Texte, die kein Paketname sind)`,
    `Commit-Präfix in Factory-Seiten umgeschrieben: ${b.praefixUmgeschrieben}`,
    `Factory-Seiten entlinkt: ${b.entlinkt.links} Links auf ${b.entlinkt.ziele.length} Ziele, ${b.entlinkt.anker} Anker gestrichen`,
    ...b.entlinkt.ziele.map(([z, n]) => `  ${z}: ${n}`),
    `kubernia-Rest (Factory-Seiten und .factory/projekt.json, ganze Wörter, überlappende Treffer zählen einmal): ${b.literalRest.reduce((s, [, n]) => s + n, 0)} in ${b.literalRest.length} Dateien`,
    ...b.literalRest.map(([p, n]) => `  ${p}: ${n}`),
  ];
}

/** Kommandozeile; Rückgabe = Exit-Code (0 ok, 1 Befund oder nicht leeres Ziel, 2 Aufruf). `leser` ersetzt den git-Leser (Tests). */
export function cli(argv, { leser, quelle = ROOT, out = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const optionen = { ziel: { type: "string" }, commit: { type: "string" }, quelle: { type: "string" } };
  const { werte, fehler } = flagsLesen(argv, optionen, { pflicht: ["ziel"] });
  if (fehler !== null) {
    err(`factory-export: ${fehler.text}\n${USAGE}`);
    return AUFRUF_EXIT;
  }
  const ziel = werte.ziel;
  if (existsSync(ziel) && (!statSync(ziel).isDirectory() || readdirSync(ziel).length > 0)) {
    err(`factory-export: Ziel '${ziel}' ist kein leerer Ordner\nfactory-export: nichts geschrieben`);
    return 1;
  }
  const l = leser ?? leserVomCommit(werte.quelle ?? quelle, werte.commit ?? "HEAD");
  if (l.fehler !== undefined) {
    err(`factory-export: ${l.fehler}\nfactory-export: nichts geschrieben`);
    return 1;
  }
  const r = baueExport({ leser: l });
  if (r.befunde.length > 0) {
    for (const b of r.befunde) err(`factory-export: ${b}`);
    err(`factory-export: ${r.befunde.length} Befunde, nichts geschrieben`);
    return 1;
  }
  for (const pfad of [...r.dateien.keys()].sort()) {
    const d = r.dateien.get(pfad);
    const voll = join(ziel, ...pfad.split("/"));
    mkdirSync(dirname(voll), { recursive: true });
    writeFileSync(voll, d.text);
    if (d.ausfuehrbar && process.platform !== "win32") chmodSync(voll, 0o755);
  }
  for (const z of berichtZeilen(r.bericht)) out(z);
  return 0;
}

if (istDirektaufruf(import.meta.url)) {
  process.exitCode = cli(process.argv.slice(2));
}
