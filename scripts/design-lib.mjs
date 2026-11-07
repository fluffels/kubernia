// Design-Schritt (factory#172): optionaler Block `design` der Projekt-Config, rein, einziger Import das Blatt `relativ-pfad.mjs` (kein Zyklus).
// Ein Ticket mit dem Design-Label (`design.label`) geht erst in die Auswahl, wenn es auch das Freigabe-Label (`design.freigabe`) trägt;
// `design.system` ist der Pfad der Design-System-Seite (Tokens, Komponenten). Ohne Block gibt es den Schritt nicht.
// Grenze: das Freigabe-Label lässt sich nicht nach Autor prüfen (alle Agenten laufen unter demselben Konto); die Regel steht im Text.

import { istRelativPosix } from "./relativ-pfad.mjs";

const SCHLUESSEL = ["label", "freigabe", "system"];
const istText = (w) => typeof w === "string" && w.trim() !== "";
const gleich = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Pur: Formfehler des optionalen Blocks `design` (leer = gültig, auch ohne Block). */
export function pruefeDesign(block) {
  if (block === undefined) return [];
  if (block === null || typeof block !== "object" || Array.isArray(block)) return ["design muss ein Objekt mit label, freigabe und system sein"];
  const fehler = SCHLUESSEL.filter((k) => !istText(block[k])).map((k) => `design.${k} muss ein nicht-leerer String sein`);
  if (istText(block.system) && !istRelativPosix(block.system)) fehler.push("design.system muss ein relativer POSIX-Pfad sein (kein absoluter Pfad, kein `..`, kein Backslash)");
  if (fehler.length === 0 && gleich(block.label, block.freigabe)) fehler.push("design.label und design.freigabe müssen verschieden sein");
  return fehler;
}

/** Pur: `{ label, freigabe, system }` oder `null` ohne Block; ein unvollständiger Block wirft (kein stiller Standardwert). */
export function designAus(config) {
  const block = config?.design;
  if (block === undefined) return null;
  const fehler = pruefeDesign(block);
  if (fehler.length > 0) throw new Error(`design in der Projekt-Config ungültig: ${fehler.join("; ")}`);
  return { label: block.label, freigabe: block.freigabe, system: block.system };
}

/** Pur (factory#162 L47): `aus` (kein Block oder das Ticket trägt das Design-Label nicht), `entwurf-fehlt` (Design-Label ohne Freigabe-Label) oder
 *  `freigegeben` (beide Labels). `design` ist der Block der Config (`config.design`); ein ungültiger Block wirft. Label-Vergleich ohne Groß-/Kleinschreibung. */
export function designZustand(design, labels) {
  const d = designAus({ design });
  if (d === null) return "aus";
  const hat = (l) => labels.some((x) => gleich(String(x), l));
  if (!hat(d.label)) return "aus";
  return hat(d.freigabe) ? "freigegeben" : "entwurf-fehlt";
}

/** Pur: `""` (Ticket darf weiter) oder der Grund, dass der Design-Entwurf fehlt. */
export function designGrund(labels, config) {
  if (designZustand(config?.design, labels) !== "entwurf-fehlt") return "";
  const d = designAus(config);
  return `Design-Entwurf nicht freigegeben (Design-Label ${d.label} ohne Freigabe-Label ${d.freigabe})`;
}
