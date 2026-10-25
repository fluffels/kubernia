// Drift-Gate (ADR 0022 F9): ein Projekt ändert den Factory-Besitz nicht still.
// `node scripts/check-factory-drift.mjs [--wurzel <pfad>]`; Exit 0 grün oder entfällt, 1 Drift, 2 Aufruf.
// Referenz ist `.factory/sync-stand.json` (vom Sync geschrieben): Hash des Manifests und je Einheit, dazu die Herkunft (`quelle.tag`,
// `quelle.sauber`): ein Stand ohne Tag oder mit `sauber: false` (Entwurfs-Sync, Version 1) ist rot, der Weg ist ein Sync von einem Tag. Ohne Sync-Stand ist das Projekt
// selbst Quelle des Besitzes, die Besitz-Prüfung entfällt mit einer Zeile. Die Projektwert-Stellen (aus der Config erzeugte Blöcke und
// Frontmatter-Zeilen, `scripts/projektwerte.mjs`) werden immer gegen die Config geprüft, auch ohne Sync-Stand.
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { einheitHash, einheitId, ERGAENZBARE, ergaenzungsBlockVon, istErgaenzbar, leereErgaenzung, pfadSicher, projektwertLauf, textHash, wirdVerteilt } from "./besitz-lib.mjs";
import { ergaenzungAusText, ladeProjektConfig, PROJEKT_CONFIG } from "./projekt-config-lib.mjs";

const MANIFEST_PFAD = ".factory/besitz.json";
const STAND_PFAD = ".factory/sync-stand.json";
const WEG = "Weg: Änderung upstream im Factory-Repo und neu syncen (`node scripts/factory-sync.mjs --quelle <pfad> --tag <name>`), oder den Projektwert in `.factory/projekt.json` auslagern";

const TAG_WEG = "Weg: von einem Tag neu syncen (`node scripts/factory-sync.mjs --quelle <pfad> --tag <name>`)";

const BLOCK_HINWEIS = " (Projektergänzungen gehören außerhalb der Besitz-Marker)";

const ergaenzungHinweis = (e) => ` (Projekt-Ergänzungen gehören nach ${PROJEKT_CONFIG} › ${ergaenzungsBlockVon(e)})`;

/** Pur: die Ergänzung aus dem Text der Projekt-Config; ohne Datei oder Block leer, bei kaputter Datei oder Form wirft es (Fix-Zeile inklusive). */
function ergaenzungAus(lies) {
  return ergaenzungAusText(lies(PROJEKT_CONFIG));
}

/** Der Wert (parsed) der ergänzbaren Einheit `id` (`<pfad>#/<schluessel>`) aus dem Projekt oder `null` (Datei oder Schlüssel fehlt, kein JSON). */
function ergaenzbarerWert(lies, id) {
  const [pfad, schluessel] = id.split("#/");
  try {
    const j = JSON.parse(lies(pfad) ?? "");
    return j?.[schluessel] ?? null;
  } catch {
    return null;
  }
}

/**
 * Prüft die Ergänzungen des Projekts (`berechtigungen` und `sandbox` in der Config) gegen ihre ergänzbaren Einheiten, getrennt vom Kern-Hash und immer,
 * auch ohne Sync-Stand (#1874, #1888): jeder Eintrag steht am Ende seiner Liste, nichts doppelt, kein allow hebt ein deny oder ask auf, die Sandbox-Ergänzung öffnet nichts Breites.
 * Rückgabe: `{ fehler, eintraege }`; jeder Fehler nennt den Weg.
 */
export function pruefeErgaenzung(lies) {
  let erg;
  try {
    erg = ergaenzungAus(lies);
  } catch (e) {
    return { fehler: [`${e.message}. Weg: ${PROJEKT_CONFIG} › berechtigungen und sandbox korrigieren`], eintraege: 0 };
  }
  const fehler = [];
  let eintraege = 0;
  for (const { id, block, anzahl: zaehle, befunde: pruefe } of ERGAENZBARE) {
    const pfad = id.split("#/")[0];
    const anzahl = zaehle(erg);
    eintraege += anzahl;
    if (anzahl === 0) continue;
    const wert = ergaenzbarerWert(lies, id);
    const befunde = wert === null ? [`${id}: Datei oder Schlüssel fehlt, die Ergänzung hat keinen Platz`] : pruefe(wert, erg);
    const weg = `Weg: die Einträge aus ${PROJEKT_CONFIG} › ${block} ans Ende der Liste in ${pfad} setzen und im Zielprojekt neu syncen`;
    fehler.push(...befunde.map((b) => `${b}. ${weg}`));
  }
  return { fehler, eintraege };
}

/**
 * Prüft den Besitz gegen den Sync-Stand. `lies(pfad)` liefert den Dateitext (relativ zur Projektwurzel) oder `null`.
 * Rückgabe: `{ entfaellt, fehler, einheiten }`; jeder Fehler nennt den Weg.
 */
export function pruefeDrift(lies) {
  const standText = lies(STAND_PFAD);
  if (standText === null) return { entfaellt: true, fehler: [], einheiten: 0 };
  const rot = (msg) => ({ entfaellt: false, fehler: [`${msg}. ${WEG}`], einheiten: 0 });
  let stand;
  try {
    stand = JSON.parse(standText);
  } catch {
    return rot(`${STAND_PFAD} ist kein gültiges JSON`);
  }
  if ((stand?.version !== 1 && stand?.version !== 2) || typeof stand.manifest !== "string" || stand.einheiten === null || typeof stand.einheiten !== "object") {
    return rot(`${STAND_PFAD} ist kaputt (Version, Manifest-Hash oder Einheiten fehlen)`);
  }
  const manifestText = lies(MANIFEST_PFAD);
  if (manifestText === null) return rot(`${MANIFEST_PFAD} fehlt`);
  if (textHash(manifestText) !== stand.manifest) return rot(`${MANIFEST_PFAD} weicht vom Sync-Stand ab (Besitz-Liste verändert)`);
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return rot(`${MANIFEST_PFAD} ist kein gültiges JSON`);
  }
  const fehler = [];
  let ergaenzung = leereErgaenzung();
  let configKaputt = false;
  try {
    ergaenzung = ergaenzungAus(lies);
  } catch {
    configKaputt = true; // die Ergänzungs-Prüfung (pruefeErgaenzung) meldet die kaputte Config mit Weg; ihr Hash wäre hier nicht aussagekräftig.
  }
  // Herkunft (#1871): nur ein Sync von einem sauberen Tag gilt, auch ein Stand der Version 1 ist rot.
  const tag = stand.quelle?.tag;
  if (typeof tag !== "string" || tag === "") fehler.push(`Sync-Stand stammt nicht von einem Tag (tag fehlt, Version ${stand.version})`);
  else if (stand.quelle.sauber !== true) fehler.push("Sync-Stand stammt von einem unsauberen Quellstand (sauber: false)");
  const herkunftFehler = fehler.length;
  const ids = new Set();
  for (const e of (manifest.eintraege ?? []).filter(wirdVerteilt)) {
    const id = einheitId(e);
    ids.add(id);
    if (!(id in stand.einheiten)) {
      fehler.push(`${id}: im Manifest, aber nicht im Sync-Stand`);
      continue;
    }
    if (configKaputt && istErgaenzbar(e)) continue;
    const text = pfadSicher(e.pfad) ? lies(e.pfad) : null;
    const hash = text === null ? null : einheitHash(e, text, ergaenzung);
    const hinweis = e.block !== undefined ? BLOCK_HINWEIS : istErgaenzbar(e) ? ergaenzungHinweis(e) : "";
    if (hash === null) fehler.push(`${id}: Besitz fehlt oder ist nicht auflösbar (Datei gelöscht, Marker oder Schlüssel entfernt, Projektwert-Marker kaputt)`);
    else if (hash !== stand.einheiten[id]) fehler.push(`${id}: Besitz wurde im Projekt verändert${hinweis}`);
  }
  const nichtVerteilt = new Map((manifest.eintraege ?? []).filter((e) => !wirdVerteilt(e)).map((e) => [einheitId(e), e.ring]));
  for (const id of Object.keys(stand.einheiten)) {
    if (ids.has(id)) continue;
    if (nichtVerteilt.has(id)) fehler.push(`${id}: im Sync-Stand, wird aber nicht verteilt (Ring ${nichtVerteilt.get(id)})`);
    else fehler.push(`${id}: im Sync-Stand, aber nicht im Manifest`);
  }
  return { entfaellt: false, fehler: fehler.map((f, i) => `${f}. ${i < herkunftFehler ? TAG_WEG : WEG}`), einheiten: ids.size };
}

/** Kommandozeile; Rückgabe = Exit-Code. */
export function cli(argv, { wurzel = join(dirname(fileURLToPath(import.meta.url)), ".."), out = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const gelesen = flagsLesen(argv, { wurzel: { type: "string" } });
  if (gelesen.fehler) {
    err(`check-factory-drift: ${gelesen.fehler.text}`);
    err("Aufruf: node scripts/check-factory-drift.mjs [--wurzel <pfad>]");
    return AUFRUF_EXIT;
  }
  const w = gelesen.werte.wurzel ?? wurzel;
  const lies = (pfad) => {
    const voll = join(w, ...pfad.split("/"));
    return existsSync(voll) ? readFileSync(voll, "utf8") : null;
  };
  const r = pruefeDrift(lies);
  // Projektwert-Stellen sind aus der Config erzeugt und werden immer geprüft, auch ohne Sync-Stand.
  const pw = projektwertLauf(w, () => ladeProjektConfig({ rootDir: w }));
  if (r.entfaellt) out(`check-factory-drift: kein ${STAND_PFAD}, dieses Projekt ist Quelle des Besitzes, Besitz-Prüfung entfällt`);
  if (r.fehler.length > 0) {
    err(`check-factory-drift: ${r.fehler.length} Drift-Befund(e)`);
    for (const f of r.fehler) err(`  ${f}`);
  }
  if (pw.fehler.length > 0) {
    err(`check-factory-drift: ${pw.fehler.length} Projektwert-Befund(e)`);
    for (const f of pw.fehler) err(`  ${f}`);
    if (pw.abweichungen.length > 0) err(`  Fix: \`node scripts/projektwerte.mjs --write\` (Werte kommen aus ${PROJEKT_CONFIG})`);
  }
  const ergPruefung = pruefeErgaenzung(lies);
  if (ergPruefung.fehler.length > 0) {
    err(`check-factory-drift: ${ergPruefung.fehler.length} Befund(e) der Projekt-Ergänzungen`);
    for (const f of ergPruefung.fehler) err(`  ${f}`);
  }
  if (r.fehler.length > 0 || pw.fehler.length > 0 || ergPruefung.fehler.length > 0) return 1;
  if (!r.entfaellt) out(`check-factory-drift: ${r.einheiten} Einheiten ohne Drift`);
  out(`check-factory-drift: ${pw.dateien} Dateien mit Projektwert-Stellen ohne Abweichung`);
  out(`check-factory-drift: ${ergPruefung.eintraege} Einträge der Projekt-Ergänzungen ohne Befund`);
  return 0;
}

if (istDirektaufruf(import.meta.url)) {
  process.exitCode = cli(process.argv.slice(2));
}
