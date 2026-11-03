// Blatt-Modul ohne Importe (factory#119): Sicherheits-Module als wählbarer Besitz; die Libs für Besitz und Config nutzen sie, ein Zyklus wäre sonst unvermeidbar.
// Eine Besitz-Einheit mit Manifest-Feld `modul` wird nur an Bezieher verteilt, die den Namen in der Config-Liste `module` gewählt haben; ohne den Schlüssel gilt `MODUL_STANDARD`.
// Die erlaubten Namen sind die `modul`-Felder des Manifests (eine Quelle). Pfade der Config für Meldungen reicht der Aufrufer als `configPfad` herein.
// Bekannte Grenze: geprüft wird nur die Form und die Namensmenge, nicht ob der Bezieher die Workflows des Moduls tatsächlich braucht.

/** Module, die ohne Schlüssel `module` in der Config gelten (der Stand vor factory#119). */
export const MODUL_STANDARD = ["dependabot-inbox"];
/** Form eines Modulnamens und einer CodeQL-Sprache. */
export const NAME_MUSTER = /^[a-z][a-z0-9-]*$/;
/** Modul, dessen Workflow die Sprachen der Config braucht. */
const CODEQL = "codeql";

const istListe = (w) => Array.isArray(w);

/** Alle Modulnamen des Manifests, sortiert und ohne Doppelte. */
export const modulNamenAus = (manifest) => [...new Set((manifest?.eintraege ?? []).map((e) => e.modul).filter((m) => typeof m === "string"))].sort();

/** Gewählte Module der Config; fehlt der Schlüssel, gilt der Standard. */
export const gewaehlteModule = (config) => (istListe(config?.module) ? config.module : MODUL_STANDARD);

/** Wird die Einheit verteilt? Ohne `modul` immer, sonst nur bei gewähltem Modul. */
export const modulGewaehlt = (e, gewaehlt) => e.modul === undefined || gewaehlt.includes(e.modul);

/** Darf `von` die Einheit `nach` lokal importieren? Eine Einheit ohne `modul` importiert keine Moduleinheit, eine Moduleinheit nur ihr eigenes Modul oder Einheiten ohne `modul`. */
export const modulImportErlaubt = (von, nach) => nach.modul === undefined || nach.modul === von.modul;

const namenListe = (l) => istListe(l) && l.every((n) => typeof n === "string" && NAME_MUSTER.test(n));
const SPRACHEN_FIX = 'codeql.sprachen als nicht leere Liste eintragen, z. B. ["javascript-typescript"]';

function moduleFehler(m) {
  if (m === undefined) return [];
  if (!namenListe(m)) return [`module muss eine Liste von Namen (Kleinbuchstaben, Ziffern, '-') sein\nFix: module als Liste eintragen, z. B. ["dependabot-inbox"]`];
  return new Set(m).size === m.length ? [] : ["module enthält einen Namen doppelt\nFix: den doppelten Namen entfernen"];
}

function sprachenFehler(c, m) {
  const s = c?.sprachen;
  const formFalsch = c !== undefined && (c === null || typeof c !== "object" || (s !== undefined && !namenListe(s)));
  if (formFalsch) return [`codeql.sprachen muss eine Liste von Sprachen (Kleinbuchstaben, Ziffern, '-') sein\nFix: ${SPRACHEN_FIX}`];
  if (istListe(m) && m.includes(CODEQL) && !(istListe(s) && s.length > 0)) {
    return [`Modul ${CODEQL} ist gewählt, aber codeql.sprachen fehlt oder ist leer (ein Workflow ohne Sprachen ist wertlos)\nFix: ${SPRACHEN_FIX}`];
  }
  return [];
}

/** Fehler der Form von `module` und `codeql.sprachen` in der Config (leer = in Ordnung); Namen gegen das Manifest prüft `modulWahl`. */
export const modulFormFehler = (config) => [...moduleFehler(config?.module), ...sprachenFehler(config?.codeql, config?.module)];

/** Modulwahl gegen das Manifest: `{ gewaehlt, erlaubt, nichtGewaehlt, fehlt, fehler }`; `fehlt` heißt, der Schlüssel `module` steht nicht in der Config. */
export function modulWahl(config, manifest, { configPfad = "die Projekt-Config" } = {}) {
  const gewaehlt = gewaehlteModule(config);
  const erlaubt = modulNamenAus(manifest);
  const fehler = gewaehlt
    .filter((n) => !erlaubt.includes(n))
    .map((n) => `unbekanntes Modul '${n}' in module (${configPfad})\nFix: einen wählbaren Namen eintragen (${erlaubt.join(", ") || "keine"}) oder den Eintrag entfernen`);
  return { gewaehlt, erlaubt, nichtGewaehlt: erlaubt.filter((n) => !gewaehlt.includes(n)), fehlt: !istListe(config?.module), fehler };
}

/** Manifest-Fehler des Felds `modul` an einer Einheit (leer = gültig oder nicht gesetzt): Name nach Muster, nur an ganzen Dateien, weder Vorlage noch `pflichtChecks`, nicht im Ring `oberflaeche`. */
export function modulFehler(e) {
  if (e.modul === undefined) return [];
  if (typeof e.modul !== "string" || !NAME_MUSTER.test(e.modul)) return ["modul muss ein Name aus Kleinbuchstaben, Ziffern und '-' sein"];
  const f = [];
  if (e.block !== undefined || e.schluessel !== undefined) f.push("modul nur an einer ganzen Datei (kein block, kein schluessel)");
  if (e.art !== undefined) f.push("modul und art zugleich (eine Vorlage gehört keinem Modul)");
  if (e.pflichtChecks !== undefined) f.push("modul trägt keine pflichtChecks (Kern-Pflicht-Checks müssen in jedem Bezieher existieren)");
  if (e.ring === "oberflaeche") f.push("modul nicht im Ring oberflaeche");
  return f;
}

/** Doctor-Punkt `Sicherheits-Module`: fehlender Schlüssel ist eine Lücke, eine Teilauswahl OK mit Hinweis auf die nicht gewählten Module; `null`, wenn das Manifest fehlt (das meldet der Doctor als Kern-Pflicht-Checks nicht prüfbar) oder keine Module kennt und die Config nichts wählt (es gibt nichts zu wählen). */
export function modulPunkt(config, manifest, { configPfad = "die Projekt-Config" } = {}) {
  const punkt = "Sicherheits-Module";
  const w = modulWahl(config, manifest, { configPfad });
  if (!manifest || (w.erlaubt.length === 0 && w.fehlt)) return null;
  if (w.fehlt) {
    return { punkt, ok: false, befund: `der Schlüssel module fehlt in ${configPfad} (es gilt nur ${MODUL_STANDARD.join(", ")})`, fix: `module in ${configPfad} als Liste der gewünschten Sicherheits-Module eintragen (wählbar: ${w.erlaubt.join(", ") || "siehe Manifest"}); [] wählt bewusst keines` };
  }
  const fehler = [...modulFormFehler(config), ...w.fehler];
  if (fehler.length > 0) return { punkt, ok: false, befund: fehler[0].split("\n")[0], fix: fehler[0].split("\nFix: ")[1] ?? `module in ${configPfad} korrigieren` };
  return w.nichtGewaehlt.length > 0 ? { punkt, ok: true, hinweis: `nicht gewählt: ${w.nichtGewaehlt.join(", ")}` } : { punkt, ok: true };
}
