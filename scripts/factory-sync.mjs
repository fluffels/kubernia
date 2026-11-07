// Sync-Werkzeug (ADR 0022 F9): überträgt den Besitz laut `.factory/besitz.json` aus einer Factory-Quelle in ein Projekt.
// `node scripts/factory-sync.mjs --quelle <pfad> (--tag <name> | --entwurf) [--ziel <pfad>] [--trocken] [--uebernehmen <pfad>]…`; Exit 0 ok, 1 Fehler, 2 Aufruf.
// Der Besitz kommt aus einem Tag der Quelle (Inhalte wie `git show <tag>:<pfad>` über `git cat-file --batch`, Ausführbar-Bit aus `git ls-tree`), nie aus dem Arbeitsbaum; der
// Sync-Stand hält Commit und Tag fest. Ohne `--tag` synct nichts; nur `--entwurf` liest den Arbeitsbaum (Probe, das Drift-Gate bleibt rot).
// Erst-Übernahme-Schutz und Vorlagen (factory#118, `sync-abgleich-lib.mjs`): eine abweichende Ziel-Datei, die noch nicht im Stand steht, überschreibt erst `--uebernehmen <pfad>`; eine Vorlage wird nur angelegt.
// Überschrieben wird nur Besitz (Datei, Block, JSON-Schlüssel), nie gemerged; Projektteile bleiben byte-gleich (einzige Ausnahme: der Link-Schritt unten schreibt Factory-Link-Refs und den Index, er legt fehlende Anker-Stub-Seiten an und erneuert reine Stubs). Hash und Vergleich
// sind CRLF-neutral, geschrieben wird nur bei inhaltlicher Änderung im Zeilenende-Stil der Zieldatei. Erst alles prüfen, dann schreiben.
// Hinweise ohne Fehler: eine Projektkopie einer Test-Hilfe (nicht verteilt), die von der Quelle abweicht (`testHilfeKopienAbweichend`); ein unbekannter Manifest-Versionsfehler trägt den Werkzeug-Hinweis.
// Link-Schritt (factory#131, nur mit `--tag`): auf dem Ergebnis des Sync-Plans (neue Texte, neuer Sync-Stand) prüft `linkSchritt` die Factory-Links des Ziels gegen den Baum des Tags
// und stellt Refs und `.factory/factory-links.json` mit um; ein Link-Befund heißt Exit 1 und nichts geschrieben (auch mit `--trocken`), `--entwurf` macht keinen Link-Schritt.
// Anker-Stubs (factory#167): eine Seite, auf die ein Kern-Link zeigt und die es im Ziel nicht gibt, legt `planeAnkerStubs` mit den verlinkten Überschriften und Factory-Links auf den Tag an; eine reine Stub-Seite (`istReinerStub`, nur Sync-Ausgabe) erneuert er bei jedem Sync (factory#166), jede andere vorhandene Seite wird nie angefasst.
import { istDirektaufruf } from "./direktaufruf.mjs";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { flagsLesen } from "./flag-lib.mjs";
import { collectMarkdown, istGelesenesMarkdown } from "./check-basis.mjs";
import { befundZeile, INDEX_PFAD, istReinerStub, planeAnkerStubs, planeFactoryLinks } from "./factory-links-lib.mjs";
import { factoryRepoAus } from "./factory-seite.mjs";
import { ausnahmenAus, factoryLinkAusnahmenAus, ladeProjektConfig, PROJEKT_CONFIG, PROJEKT_ROLLEN, ROLLEN_PFADE } from "./projekt-config-lib.mjs";
import { einheitAusId, einheitHash, einheitId, eolVon, istErgaenzbar, istGanzeDatei, MANIFEST_PFAD, manifestAusText, normalisiereEol, pruefeManifest, textHash, versionUnbekannt, wirdVerteilt } from "./besitz-lib.mjs";
import { rendereProjektwerte } from "./projektwert-lib.mjs";
import { istModulEinheit, manifestKenntModule, MODUL_STANDARD, modulGewaehlt, modulWahl } from "./modul-wahl-lib.mjs";
import { erstUebernahme, istVorlage } from "./sync-abgleich-lib.mjs";
import { testHilfeKopienAbweichend } from "./besitz-extraktion.mjs";
import { WERKZEUG_HINWEIS } from "./release-tag-lib.mjs";
import { knappeBudgets, ueberBudget } from "./kontext-budget-lib.mjs";
import { gitIn, LEER, leserFuerCommit, leserVomCommit, liesErgaenzung, projektMarkerHinweis, pruefeErgebnis, wendeTeileAn } from "./factory-sync-lib.mjs";
import { quelleRepoAusText, STAND_PFAD, syncStandAusText } from "./sync-stand-lib.mjs";

// Teile der Bibliothek, die die Tests über dieses Modul kennen (das Export-Werkzeug importiert aus der Bibliothek).
export { leserVomCommit, liesErgaenzung, pruefeErgebnis, wendeTeileAn };

export const PROJEKT_PFAD = PROJEKT_CONFIG;

const leseAltStand = (zielLies) => syncStandAusText(zielLies(STAND_PFAD)).stand;

/** Fehler des Quell-Manifests: Schema, Projekt-Config nie Besitz, jede Besitz-Rolle (#1871) eine ganze, verteilte Einheit (die Rollen des Projekts stehen nicht im Manifest). */
function manifestFehler(manifest, quelleLies) {
  const fehler = pruefeManifest(manifest, quelleLies).map((m) => `Quell-Manifest: ${m}${versionUnbekannt(m) ? `
Fix: ${WERKZEUG_HINWEIS}` : ""}`);
  if (manifest.eintraege.some((e) => e.pfad === PROJEKT_PFAD)) fehler.push(`Quell-Manifest: ${PROJEKT_PFAD} ist Projekt-Config und nie Besitz`);
  for (const [rolle, pfad] of Object.entries(ROLLEN_PFADE)) {
    if (PROJEKT_ROLLEN.includes(rolle)) continue;
    const ganz = manifest.eintraege.some((e) => e.pfad === pfad && istGanzeDatei(e) && wirdVerteilt(e) && !istVorlage(e));
    if (!ganz) fehler.push(`Quell-Manifest: Rollen-Pfad '${pfad}' (${rolle}) ist keine verteilte Einheit (ganze Datei)`);
  }
  return fehler;
}

/** Meldungen für Rollen-Dateien des Projekts, die im Ziel fehlen. */
function fehlendeRollen(zielLies) {
  return PROJEKT_ROLLEN.filter((rolle) => zielLies(ROLLEN_PFADE[rolle]) === null).map(
    (rolle) => `Rollen-Pfad '${ROLLEN_PFADE[rolle]}' (${rolle}) fehlt im Ziel; das Projekt legt seine Datei dort selbst an`,
  );
}

/** Ergänzungen (Block-/Schlüssel-Einheiten) aus Quelle und Ziel, nur gelesen, wenn eine verteilte Einheit ergänzbar ist. → `{ erg, fehler }`. */
function liesErgaenzungen(verteilt, quelleLies, zielLies) {
  const erg = LEER();
  const fehler = [];
  if (!verteilt.some(istErgaenzbar)) return { erg, fehler };
  for (const [seite, lies] of [["quelle", quelleLies], ["ziel", zielLies]]) {
    try {
      erg[seite] = liesErgaenzung(lies);
    } catch (err) {
      fehler.push(`${seite === "quelle" ? "Quelle" : "Ziel"}: ${err.message}`);
    }
  }
  return { erg, fehler };
}

/** Eine neu anzulegende Vorlage (wird nie überschrieben): Text mit den Projektwerten des Ziels. */
function vorlagenDatei(pfad, quelleLies, zielConfig, quelleAusfuehrbar) {
  return { text: rendereProjektwerte(normalisiereEol(quelleLies(pfad)), zielConfig, pfad), neu: true, vorlage: true, ausfuehrbar: quelleAusfuehrbar(pfad) };
}

/** Hinweise auf Dateien im Ziel am Pfad einer Moduleinheit, deren Modul nicht gewählt ist (vermutlich Projektkopie; geschrieben wird nichts). */
function projektkopienAbgewaehlt(manifest, gewaehlt, zielLies) {
  return manifest.eintraege
    .filter((e) => istModulEinheit(e) && !modulGewaehlt(e, gewaehlt) && zielLies(e.pfad) !== null)
    .map((e) => `Modul '${e.modul}' nicht gewählt, im Ziel liegt ${e.pfad} (Projektkopie?): Modul wählen oder als Projektdatei führen`);
}

/** Meldungen zu Einheiten des alten Stands, die jetzt nicht mehr verteilt werden (Vorlage, kein Besitz mehr, anderer Ring); im Ziel wird nie gelöscht. */
function altStandMeldungen(alt, sortiert, alle, manifest, gewaehlteModule) {
  const meldungen = [];
  for (const id of Object.keys(alt?.einheiten ?? {})) {
    if (id in sortiert) continue;
    if (alle.some((e) => istVorlage(e) && einheitId(e) === id)) {
      meldungen.push(`Einheit '${id}' ist jetzt Vorlage, nicht mehr im Sync-Stand, das Projekt pflegt sie selbst`);
      continue;
    }
    const nurFactory = manifest.eintraege.find((e) => einheitId(e) === id);
    meldungen.push(
      nurFactory !== undefined && istModulEinheit(nurFactory) && !modulGewaehlt(nurFactory, gewaehlteModule)
        ? `Modul '${nurFactory.modul}' nicht gewählt (Einheit '${id}'), im Ziel nicht gelöscht (bei Bedarf von Hand entfernen)`
        : nurFactory === undefined
        ? `Einheit '${id}' ist kein Besitz mehr, im Ziel nicht gelöscht (bei Bedarf von Hand entfernen)`
        : `Einheit '${id}' wird nicht mehr verteilt (Ring ${nurFactory.ring}), im Ziel nicht gelöscht (bei Bedarf von Hand entfernen)`,
    );
  }
  return meldungen;
}

/**
 * Modulwahl des Ziels (factory#119): `{ gewaehlt, fehler, meldungen }`. Nur wenn das Quell-Manifest Einheiten mit `modul` hat, wird die Ziel-Config gelesen;
 * ohne den Schlüssel `module` gilt der Standard, die Namen prüft `modulWahl` gegen das Quell-Manifest (ein neues Modul ist sofort wählbar).
 */
function waehleModule(manifest, zielConfig) {
  if (!manifestKenntModule(manifest)) return { gewaehlt: MODUL_STANDARD, fehler: [], meldungen: [] };
  let config;
  try {
    config = zielConfig();
  } catch (err) {
    return { gewaehlt: [], fehler: [`Ziel-Config: ${err.message}`], meldungen: [] };
  }
  const w = modulWahl(config, manifest, { configPfad: PROJEKT_CONFIG });
  const liste = (l) => (l.length > 0 ? l.join(", ") : "keine");
  return { gewaehlt: w.gewaehlt, fehler: w.fehler, meldungen: [`Module: gewählt ${liste(w.gewaehlt)}; nicht gewählt ${liste(w.nichtGewaehlt)} (Wahl: module in ${PROJEKT_CONFIG})`] };
}

/**
 * Plan eines Syncs, ohne zu schreiben. `quelleLies`/`zielLies` liefern den Dateitext (relativer Pfad, Schrägstrich-Form) oder `null`.
 * Ergebnis: `fehler` (nicht leer: nichts schreiben), `meldungen`, `dateien` (Pfad → { text, neu, ausfuehrbar }, nur Geändertes),
 * `unveraendert` (Zahl, dazu `unveraendertePfade`) und der `stand`. `zielConfig` liefert die Projekt-Config des Ziels, nur gerufen, wenn eine Datei Projektwert-Stellen hat oder das Manifest Einheiten mit `modul` kennt (Modulwahl).
 */
export function planeSync({
  quelleLies,
  zielLies,
  quelleAusfuehrbar = () => false,
  quelleStand = { commit: "unbekannt", sauber: false },
  uebernehmen = [],
  zielConfig = () => {
    throw new Error("keine Projekt-Config des Ziels übergeben");
  },
}) {
  const res = { fehler: [], meldungen: [], dateien: new Map(), unveraendert: 0, unveraendertePfade: new Set(), stand: null };
  const manifestText = quelleLies(MANIFEST_PFAD);
  const geladen = manifestAusText(manifestText);
  if (geladen.fehler !== undefined) {
    res.fehler.push(`Quelle: ${geladen.text}`);
    return res;
  }
  const { manifest } = geladen;
  res.fehler.push(...manifestFehler(manifest, quelleLies));
  if (res.fehler.length > 0) return res;
  const wahl = waehleModule(manifest, zielConfig);
  res.fehler.push(...wahl.fehler);
  if (res.fehler.length > 0) return res;
  res.meldungen.push(...wahl.meldungen, ...fehlendeRollen(zielLies));

  const nachPfad = new Map();
  const alle = manifest.eintraege.filter((e) => wirdVerteilt(e) && modulGewaehlt(e, wahl.gewaehlt));
  const verteilt = alle.filter((e) => !istVorlage(e));
  res.meldungen.push(...projektkopienAbgewaehlt(manifest, wahl.gewaehlt, zielLies));
  const alt = leseAltStand(zielLies);
  for (const e of verteilt) nachPfad.set(e.pfad, [...(nachPfad.get(e.pfad) ?? []), e]);
  const { erg, fehler: ergFehler } = liesErgaenzungen(verteilt, quelleLies, zielLies);
  res.fehler.push(...ergFehler);
  if (res.fehler.length > 0) return res;
  const ziele = new Map(); // Pfad -> { ergebnis (LF), quelleText }
  for (const [pfad, eintraege] of nachPfad) {
    const srcText = normalisiereEol(quelleLies(pfad));
    const zielRoh = zielLies(pfad);
    const zielLf = zielRoh === null ? null : normalisiereEol(zielRoh);
    try {
      const ganz = eintraege.some(istGanzeDatei);
      const ergebnis = ganz ? rendereProjektwerte(srcText, zielConfig, pfad) : wendeTeileAn(eintraege, srcText, zielLf, zielConfig, erg);
      if (!ganz) res.fehler.push(...pruefeErgebnis(pfad, eintraege, srcText, zielLf, ergebnis, erg));
      res.meldungen.push(...projektMarkerHinweis(pfad, eintraege, zielLf));
      ziele.set(pfad, { ergebnis, zielRoh, zielLf, srcText });
    } catch (err) {
      res.fehler.push(err.message.startsWith(`${pfad}:`) ? err.message : `${pfad}: ${err.message}`);
    }
  }
  const abgleich = erstUebernahme({
    kandidaten: [...ziele].filter(([pfad]) => nachPfad.get(pfad).some(istGanzeDatei)).map(([pfad, z]) => ({ pfad, zielLf: z.zielLf, ergebnis: z.ergebnis })),
    altEinheiten: Object.keys(alt?.einheiten ?? {}),
    uebernehmen,
  });
  res.fehler.push(...abgleich.fehler);
  res.meldungen.push(...abgleich.hinweise, ...testHilfeKopienAbweichend({ quelleLies, zielLies }));
  if (res.fehler.length > 0) return res;
  const ziehe = (pfad, ergebnis, zielRoh, ausfuehrbar) => {
    if (zielRoh !== null && normalisiereEol(zielRoh) === ergebnis) {
      res.unveraendert++;
      res.unveraendertePfade.add(pfad);
      return;
    }
    const eol = zielRoh === null ? "\n" : eolVon(zielRoh);
    res.dateien.set(pfad, { text: eol === "\n" ? ergebnis : ergebnis.replace(/\n/g, eol), neu: zielRoh === null, ausfuehrbar });
  };
  for (const [pfad, z] of ziele) ziehe(pfad, z.ergebnis, z.zielRoh, quelleAusfuehrbar(pfad));
  ziehe(MANIFEST_PFAD, normalisiereEol(manifestText), zielLies(MANIFEST_PFAD), false);
  for (const e of alle.filter(istVorlage)) {
    if (zielLies(e.pfad) !== null) {
      res.unveraendert++;
      res.unveraendertePfade.add(e.pfad);
    } else res.dateien.set(e.pfad, vorlagenDatei(e.pfad, quelleLies, zielConfig, quelleAusfuehrbar));
  }

  const einheiten = {};
  for (const e of verteilt) einheiten[einheitId(e)] = einheitHash(e, ziele.get(e.pfad).srcText, erg.quelle);
  const sortiert = Object.fromEntries(Object.entries(einheiten).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const herkunft = quelleStand.tag ? { commit: quelleStand.commit, tag: quelleStand.tag, sauber: quelleStand.sauber } : { commit: quelleStand.commit, sauber: quelleStand.sauber };
  // Das Factory-Repo, aus dem der Besitz kommt: Bezieher lesen daraus Tags und Seiten-Links (nie aus ihrem eigenen Board-Routing).
  const quelleRepo = quelleRepoAusText(quelleLies(PROJEKT_PFAD));
  if (quelleRepo !== undefined) herkunft.repo = quelleRepo;
  res.stand = { version: 2, quelle: herkunft, manifest: textHash(manifestText), einheiten: sortiert };
  ziehe(STAND_PFAD, `${JSON.stringify(res.stand, null, 2)}\n`, zielLies(STAND_PFAD), false);

  res.meldungen.push(...altStandMeldungen(alt, sortiert, alle, manifest, wahl.gewaehlt));
  return res;
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
  const leser = leserFuerCommit(quelle, commit);
  if (leser === null) return { fehler: `Tag '${tag}': der Baum von ${commit} ist nicht lesbar` };
  return { stand: { commit, tag, sauber: true }, lies: leser.lies, ausfuehrbar: leser.ausfuehrbar, vorladen: leser.vorladen, pfade: leser.pfade };
}

function quelleGit(quelle) {
  const kopf = gitIn(quelle, ["rev-parse", "HEAD"]);
  const status = gitIn(quelle, ["status", "--porcelain"]);
  if (!kopf.ok || !status.ok) return { commit: "unbekannt", sauber: false };
  return { commit: kopf.out.toString("utf8").trim(), sauber: status.out.toString("utf8").trim() === "" };
}

const liesDatei = (wurzel) => (pfad) => {
  const voll = join(wurzel, ...pfad.split("/"));
  if (!existsSync(voll) || lstatSync(voll).isSymbolicLink()) return null; // Symlinks sind nicht verteilbar, wie im Tag-Leser
  return readFileSync(voll, "utf8");
};

function parseArgs(argv) {
  const unbekannt = (flag) => `unbekannte Option '${flag}'`;
  const meldung = { unbekannt, positional: unbekannt, "ohne-wert": (flag) => `${flag} braucht ${flag === "--tag" ? "einen Namen" : "einen Pfad"}`, fehlt: "--quelle <pfad> fehlt" };
  const optionen = { quelle: { type: "string" }, ziel: { type: "string" }, tag: { type: "string" }, entwurf: { type: "boolean" }, trocken: { type: "boolean" }, uebernehmen: { type: "string", multiple: true } };
  const { werte, fehler } = flagsLesen(argv, optionen, { pflicht: ["quelle"], meldung });
  const beide = fehler === null && werte.tag !== undefined && werte.entwurf === true ? "--tag und --entwurf schließen sich aus" : null;
  return { quelle: werte.quelle ?? null, ziel: werte.ziel ?? null, tag: werte.tag ?? null, entwurf: werte.entwurf === true, trocken: werte.trocken === true, uebernehmen: werte.uebernehmen ?? [], fehler: fehler?.text ?? beide };
}

/** Unter Windows kennt das Dateisystem kein Ausführbit: ein neu geschriebenes Skript (Hooks) landete mit 100644
 *  im Index des Ziels und liefe nach dem Checkout unter Linux/macOS nicht. Darum den Modus 100755 im Index setzen
 *  und per `ls-files -s` gegenprüfen. Liefert `null` (ok, oder Ziel ohne Git-Arbeitsbaum: kein Index,
 *  dann nur ein Hinweis über `out`) oder die Fehlermeldung samt Fix-Zeile. `git(args)` ist injizierbar. */
function setzeAusfuehrbitImIndex(ziel, pfade, git, out) {
  if (pfade.length === 0) return null;
  const imRepo = git(["-C", ziel, "rev-parse", "--is-inside-work-tree"]);
  if (!imRepo.ok || imRepo.out.toString("utf8").trim() !== "true") {
    out(`Hinweis: Ausführbit nicht gesetzt: Ziel ohne Git-Arbeitsbaum (${pfade.join(", ")}); nach dem Einchecken im Ziel \`git update-index --chmod=+x\` auf diese Pfade`);
    return null;
  }
  git(["-C", ziel, "update-index", "--add", "--chmod=+x", "--", ...pfade]);
  const stand = git(["-C", ziel, "ls-files", "-s", "--", ...pfade]);
  const modi = new Map(stand.out.toString("utf8").split("\n").filter((z) => z !== "").map((z) => [z.split("\t")[1], z.split(" ")[0]]));
  const falsch = pfade.filter((p) => modi.get(p) !== "100755");
  if (falsch.length === 0) return null;
  return `Ausführbit im Index von '${ziel}' fehlt (erwartet 100755): ${falsch.join(", ")}\nFix: git -C <ziel> update-index --add --chmod=+x -- ${falsch.join(" ")}`;
}

/** Hinweiszeilen, wenn eine Kontextdatei nach dem Sync über dem Budget des ausführenden Werkzeugs läge; Text aus dem Plan, sonst aus dem Ziel; geduldete Ausnahmen des Ziels ohne Hinweis. */
function kontextHinweise(plan, ziel) {
  const lies = (datei) => plan.dateien.get(datei)?.text ?? liesDatei(ziel)(datei);
  let ausnahmen = [];
  try {
    ausnahmen = ausnahmenAus(ladeProjektConfig({ rootDir: ziel })).kontext;
  } catch {
    // Config des Ziels nicht lesbar: ohne Ausnahmen messen, die Warnung ist nur ein Hinweis.
  }
  const ueber = ueberBudget({ lies, ausnahmen }).map((k) => `Hinweis: Kontextbudget: ${k.file} hätte ${k.chars} Zeichen > Budget ${k.budget}; im Ziel wird check:contextsize rot, Projekt-Block kürzen (nie Wächter-gebundene Sätze)`);
  const knapp = knappeBudgets({ lies, ausnahmen }).map((k) => `Hinweis: Kontextbudget knapp: ${k.file} ${k.chars} von ${k.budget} Zeichen (Rest ${k.rest}); der nächste Kern-Zuwachs kann check:contextsize rot machen, Projekt-Block kürzen`);
  return [...ueber, ...knapp];
}

/** Trägt die Änderungen des Link-Plans in den Sync-Plan ein: ein Pfad, den der Sync als unverändert zählte, wechselt zu geändert; neue Pfade (der Index) werden angelegt. */
function verschmelzeLinkDateien(plan, geaendert, platte) {
  for (const [pfad, text] of geaendert) {
    const alt = plan.dateien.get(pfad);
    if (alt !== undefined) {
      plan.dateien.set(pfad, { ...alt, text });
      continue;
    }
    if (plan.unveraendertePfade.delete(pfad)) plan.unveraendert--;
    plan.dateien.set(pfad, { text, neu: platte(pfad) === null, ausfuehrbar: false });
  }
}

/**
 * Link-Schritt auf dem Sync-Ergebnis (factory#131): `leser` ist der Leser des Tags (`{ pfade, lies, vorladen }`). Rückgabe `{ fehler, hinweise }`, bei Erfolg sind Refs, Index, angelegte (factory#167) und erneuerte (factory#166) Anker-Stub-Seiten im `plan.dateien`; bei einem Befund liegen die Stubs dort auch, die Kommandozeile schreibt dann nichts.
 * Ohne bestimmbares Factory-Repo (weder `quelle.repo` noch Board mit Rolle factory) gibt es nur einen Hinweis; eine unlesbare Ziel-Config bei bekanntem Repo ist ein Fehler.
 */
function linkSchritt({ plan, ziel, leser }) {
  const { tag, commit } = plan.stand.quelle;
  const ladeConfig = () => ladeProjektConfig({ rootDir: ziel, pruefen: false });
  const repo = factoryRepoAus(plan.stand, ladeConfig);
  if (repo === undefined) return { fehler: [], hinweise: [`Factory-Links: kein Factory-Repo bestimmbar (weder quelle.repo noch Board mit Rolle factory in ${PROJEKT_CONFIG}), kein Link-Schritt`] };
  let ausnahmen;
  try {
    ausnahmen = factoryLinkAusnahmenAus(ladeConfig());
  } catch (err) {
    return { fehler: [`[config] ${err.message}`], hinweise: [] };
  }
  const platte = liesDatei(ziel);
  const lies = (pfad) => plan.dateien.get(pfad)?.text ?? platte(pfad);
  const vorhanden = (pfad) => plan.dateien.has(pfad) || existiertImZiel(join(ziel, ...pfad.split("/")));
  const reineStubs = reineStubPfade({ plan, ziel, platte });
  const stubs = planeAnkerStubs({ lies, einheiten: Object.keys(plan.stand.einheiten), repo, tag, leser, ausnahmen, vorhanden, reineStubs });
  for (const [pfad, text] of stubs.dateien) {
    const erneuert = stubs.erneuert.has(pfad);
    const alt = erneuert ? platte(pfad) : null;
    if (alt !== null && normalisiereEol(alt) === text) continue; // erneuerter Stub inhaltsgleich: nichts schreiben (idempotent, CRLF-neutral)
    plan.dateien.set(pfad, { text: alt === null || eolVon(alt) === "\n" ? text : text.replace(/\n/g, eolVon(alt)), neu: !erneuert, ausfuehrbar: false, stub: true });
  }
  const dateien = [...new Set([...collectMarkdown(ziel), ...[...plan.dateien.keys()].filter(istGelesenesMarkdown)])];
  const r = planeFactoryLinks({ dateien, lies, repo, einheiten: Object.keys(plan.stand.einheiten), ausnahmen, tag, commit, leser });
  if (r.befunde.length > 0) return { fehler: r.befunde.map(befundZeile), hinweise: [] };
  verschmelzeLinkDateien(plan, r.dateien, platte);
  const angelegt = stubs.dateien.size - stubs.erneuert.size;
  const stubHinweise = angelegt === 0 ? [] : [`Anker-Stubs: ${angelegt} Seiten angelegt, ${stubs.ueberschriften} Überschriften, ${stubs.links} Links am Tag ${tag}`];
  const erneuertAnzahl = [...stubs.erneuert].filter((p) => plan.dateien.get(p)?.stub).length;
  if (erneuertAnzahl > 0) stubHinweise.push(`Anker-Stubs: ${erneuertAnzahl} Seiten erneuert am Tag ${tag}`);
  return { fehler: [], hinweise: [...stubs.hinweise, ...stubHinweise, `Factory-Links: ${r.geschrieben} Links auf ${r.ziele} Ziele am Tag ${tag} (Refs und Index in ${INDEX_PFAD})`] };
}

/** Die reinen Stubs des Ziels (factory#166): Markdown-Dateien, die weder der Sync-Plan schreibt noch eine Einheit des Stands sind, reguläre Dateien (kein Symlink, kein Ordner) und `istReinerStub`. */
function reineStubPfade({ plan, ziel, platte }) {
  const einheitPfade = new Set(Object.keys(plan.stand.einheiten).map((id) => einheitAusId(id).pfad));
  const regulaer = (p) => existiertImZiel(join(ziel, ...p.split("/"))) && lstatSync(join(ziel, ...p.split("/"))).isFile();
  return collectMarkdown(ziel).filter((p) => !plan.dateien.has(p) && !einheitPfade.has(p) && regulaer(p) && istReinerStub(platte(p) ?? ""));
}

/** Gibt es den Pfad im Ziel (auch als Symlink oder Ordner, hängend eingeschlossen)? Anker-Stubs schreiben nie über etwas, das schon da ist. */
function existiertImZiel(voll) {
  try {
    lstatSync(voll);
    return true;
  } catch {
    return false;
  }
}

/** Die Art einer Zeile der Ausgabe: `neu (Anker-Stub)` (angelegte Stub-Seite, factory#167), `geändert (Anker-Stub)` (erneuerter reiner Stub, factory#166), `neu (Vorlage)`, `neu` oder `geändert`. */
const artVon = (d) => (d.stub ? (d.neu ? "neu (Anker-Stub)" : "geändert (Anker-Stub)") : d.neu ? (d.vorlage ? "neu (Vorlage)" : "neu") : "geändert");

/** Link-Phase der Kommandozeile: `{ ok, hinweise }`; bei `ok: false` ist die Meldung schon über `err` ausgegeben (nichts geschrieben). */
function linkPhase({ opt, plan, ziel, leser, err }) {
  if (opt.tag === null) return { ok: true, hinweise: [`Entwurf: kein Link-Schritt (Factory-Links und ${INDEX_PFAD} bleiben unverändert)`] };
  const r = linkSchritt({ plan, ziel, leser });
  if (r.fehler.length === 0) return { ok: true, hinweise: r.hinweise };
  for (const f of r.fehler) err(`factory-sync: Factory-Links: ${f}`);
  const nurConfig = r.fehler.every((f) => f.startsWith("[config]"));
  err(nurConfig ? `factory-sync: Weg: ${PROJEKT_CONFIG} des Ziels anlegen bzw. den Block factoryLinks korrigieren, dann neu syncen` : "factory-sync: Weg: den Link im Ziel korrigieren oder per factoryLinks.ausnahmen in der Projekt-Config ausnehmen, dann neu syncen");
  err("factory-sync: nichts geschrieben");
  return { ok: false, hinweise: [] };
}

/** Kommandozeile; Rückgabe = Exit-Code (0 ok, 1 Fehler, 2 Aufruf). */
export function cli(argv, { cwd = process.cwd(), out = (s) => console.log(s), err = (s) => console.error(s), plattform = process.platform, git = (a) => gitIn(a[1], a.slice(2)) } = {}) {
  const opt = parseArgs(argv);
  const usage = "Aufruf: node scripts/factory-sync.mjs --quelle <pfad> (--tag <name> | --entwurf) [--ziel <pfad>] [--trocken] [--uebernehmen <pfad>]…";
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
  let tagLeser = null;
  if (opt.tag !== null) {
    const v = quelleVomTag(quelle, opt.tag);
    if (v.fehler !== undefined) {
      err(`factory-sync: ${v.fehler}\nfactory-sync: nichts geschrieben`);
      return 1;
    }
    try {
      const m = JSON.parse(v.lies(MANIFEST_PFAD) ?? "");
      if (Array.isArray(m.eintraege)) v.vorladen([PROJEKT_PFAD, ...m.eintraege.filter((e) => typeof e?.pfad === "string").map((e) => e.pfad)]);
    } catch {
      // kein lesbares Manifest: planeSync meldet es.
    }
    leser = { quelleLies: v.lies, quelleAusfuehrbar: v.ausfuehrbar, quelleStand: v.stand };
    tagLeser = v;
  }
  const plan = planeSync({ ...leser, uebernehmen: opt.uebernehmen, zielLies: liesDatei(ziel), zielConfig: () => ladeProjektConfig({ rootDir: ziel }) });
  if (plan.fehler.length > 0) {
    for (const f of plan.fehler) err(f.startsWith("ABGLEICH ") ? f : `factory-sync: ${f}`);
    err("factory-sync: nichts geschrieben");
    return 1;
  }
  const links = linkPhase({ opt, plan, ziel, leser: tagLeser, err });
  if (!links.ok) return 1;
  const ausfuehrbarePfade = [];
  for (const [pfad, d] of plan.dateien) {
    out(`${opt.trocken ? "würde " : ""}${artVon(d)}: ${pfad}`);
    if (opt.trocken) continue;
    const voll = join(ziel, ...pfad.split("/"));
    mkdirSync(dirname(voll), { recursive: true });
    writeFileSync(voll, d.text);
    if (d.neu && d.ausfuehrbar) {
      if (plattform !== "win32") chmodSync(voll, 0o755);
      else ausfuehrbarePfade.push(pfad);
    }
  }
  const indexFehler = setzeAusfuehrbitImIndex(ziel, ausfuehrbarePfade, git, out);
  if (indexFehler !== null) {
    err(`factory-sync: ${indexFehler}`);
    return 1;
  }
  for (const m of plan.meldungen) out(`Hinweis: ${m}`);
  for (const h of links.hinweise) out(`Hinweis: ${h}`);
  for (const h of kontextHinweise(plan, ziel)) out(h);
  if (opt.tag === null) out("Hinweis: Entwurf aus dem Arbeitsbaum, check:factorydrift im Ziel bleibt rot bis zum Sync von einem Tag");
  out(`factory-sync: ${plan.dateien.size} ${opt.trocken ? "zu ändern" : "geändert"}, ${plan.unveraendert} unverändert`);
  return 0;
}

if (istDirektaufruf(import.meta.url)) {
  process.exitCode = cli(process.argv.slice(2));
}
