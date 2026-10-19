// Kein Shebang: wird von den Gate-Skripten, dem Hook-Pfad und ihren Tests importiert.
/**
 * Nachweis-Lib (#1762): Parser und Formate der Commit-Zeilen `Plan`, `Review` und `Abnahme` samt Abnahme-Marker.
 *
 * Eine Quelle für Zeilen-Regex, Hex-Muster (`HEX`, `HEX_HEAD`, streng klein), Wert-Normalisierung und Urteilswerte,
 * damit Gate, Messskript, Abnahme-Skript und Hook dasselbe lesen. Rein (keine I/O auf oberster Ebene, Importe nur `escapeRegex` und `istVertraut`);
 * die Commit-Zeilen kommen als Parameter (`commitZeilen` in slice-override.mjs). Pfad steht in `.github/protected-paths.json`.
 */
import { istVertraut } from "./fremdtext-lib.mjs";
import { escapeRegex } from "./ticket-namen.mjs";

/** Hex-Hash eines Commits (7 bis 40 Zeichen, nur klein); Eingaben mit Großbuchstaben vorher mit `.toLowerCase()` angleichen. */
export const HEX = "[0-9a-f]{7,40}";
export const HEX_HEAD = new RegExp(`^${HEX}$`);

/** Obergrenze der Fix-Runden (Cap 2 Fix-Runden, höchstens 3 Pässe); der Skill `review-lenses` trägt dieselbe Zahl (Wächter test/harness/review-nachweis.test.ts). */
export const MAX_FIX_RUNDEN = 2;
/** Höchstens so viele Review-Pässe: 1 Erstpass + MAX_FIX_RUNDEN nach je einem Fix. */
export const MAX_REVIEW_PAESSE = MAX_FIX_RUNDEN + 1;

/** Regex für eine Zeile `<key>: <wert>` am Zeilenanfang. Eine Definition für Override und Nachweis (#1383):
 *  toleriert wird genau das Präfix `* ` (Stern + ein Leerzeichen), mit dem GitHub im Squash-Commit auf main
 *  jeden Commit-BETREFF schreibt; Body-Zeilen bleiben dort unverändert. Gruppe 1 = Zeile ohne Präfix,
 *  Gruppe 2 = Wert. `key` wird wörtlich eingesetzt (escaped). */
export function zeilenRe(key) {
  return new RegExp(`^(?:\\* )?(${escapeRegex(key)}:[ \\t]*(.*))$`, "gm");
}

function lastLine(text, key) {
  const all = [...String(text).replace(/\r/g, "").matchAll(zeilenRe(key))];
  return all.length > 0 ? all[all.length - 1][2].trim() : null;
}

/** Normalisiert einen Wert für den Vergleich: trim, Kleinbuchstaben, Umlaute und ß in ASCII, Leerraum wird `-`. */
export function normalisiereWert(wert) {
  return String(wert)
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, "-");
}

/** Normalisiert einen Brillennamen (#1331); dünne Hülle um normalisiereWert. */
export const normalisiereLens = (name) => normalisiereWert(name);

/** Wert eines Felds der Review-Zeile, tolerant (#1331): reicht bis zum nächsten ` key=`, damit auch
 *  Leerzeichen nach Kommas gehen. `null`, wenn das Feld fehlt. */
function feldWert(reviewWert, key) {
  const m = new RegExp(`(?:^|\\s)${key}=(.*?)(?=\\s+[a-z]+=|$)`).exec(reviewWert);
  return m ? m[1] : null;
}

/** Brillen der Review-Zeile; jeder Name wird normalisiert (Groß-/Kleinschreibung, Umlaute). */
function lensenAus(reviewWert) {
  return (feldWert(reviewWert, "lenses") ?? "")
    .split(",")
    .map(normalisiereLens)
    .filter(Boolean);
}

/** Runde-1-Blocker je Brille (#1123): `name:n,…` → `[{lens, n}]`; `null`, wenn das Feld fehlt (alte Zeilen).
 *  Eine kaputte Zahl wird NaN, bewertet erst bewerteNachweis. */
function blockerAus(reviewWert) {
  const wert = feldWert(reviewWert, "blocker");
  if (wert === null) return null;
  return wert
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => {
      const i = e.lastIndexOf(":");
      const zahl = i < 0 ? "" : e.slice(i + 1).trim();
      return { lens: normalisiereLens(i < 0 ? e : e.slice(0, i)), n: /^\d+$/.test(zahl) ? Number(zahl) : Number.NaN };
    });
}

/** Optionales Feld `zusatzpass=<anzahl>:<grund>` (#1561, #1693): Pässe über das Cap hinaus (einer ohne Rückfrage, weitere nur mit Freigabe der Maintainerin).
 *  `null`, wenn das Feld fehlt; `{ungueltig}`, wenn Anzahl (ganze Zahl ≥ 1) oder Grund fehlen; sonst `{anzahl, grund}`. */
function zusatzpassAus(reviewWert) {
  const wert = feldWert(reviewWert, "zusatzpass");
  if (wert === null) return null;
  const m = /^(\d+):(.*)$/.exec(wert.trim());
  const anzahl = m ? Number(m[1]) : 0;
  const grund = m ? m[2].trim() : "";
  return anzahl >= 1 && grund !== "" ? { anzahl, grund } : { ungueltig: wert };
}

/** Parst die letzte Plan- und die letzte Review-Zeile (Schlüssel aus `zeilen`, am Zeilenanfang, nicht
 *  eingerückt) aus beliebigem Message-Text. `zeilen` ist Pflicht (Ergebnis von `commitZeilen`). Pure. Felder, die fehlen oder kaputt sind, bleiben
 *  null bzw. NaN; bewertet wird erst in bewerteNachweis. */
export function parseNachweis(text, zeilen) {
  if (!zeilen || typeof zeilen.plan !== "string" || typeof zeilen.review !== "string" || typeof zeilen.planer !== "string" || typeof zeilen.abnahme !== "string") {
    throw new Error("parseNachweis braucht die Commit-Zeilen (commitZeilen(praefix, planer)), keinen Standardwert");
  }
  const planWert = lastLine(text, zeilen.plan);
  let plan = null;
  if (planWert !== null) {
    const ohne = /^ohne\s*[—–-]+\s*(\S.*)$/.exec(planWert);
    if (planWert === zeilen.planer) plan = { art: "planer" };
    else if (ohne) plan = { art: "ohne", grund: ohne[1].trim() };
    else plan = { art: "ungueltig", zeile: planWert };
  }
  const reviewWert = lastLine(text, zeilen.review);
  let review = null;
  if (reviewWert !== null) {
    const felder = {};
    for (const tok of reviewWert.split(/\s+/)) {
      const m = /^([a-z]+)=(.*)$/.exec(tok);
      if (m) felder[m[1]] = m[2];
    }
    review = {
      zeile: reviewWert,
      head: HEX_HEAD.test((felder.head ?? "").toLowerCase()) ? felder.head.toLowerCase() : null,
      runden: /^\d+$/.test(felder.runden ?? "") ? Number(felder.runden) : Number.NaN,
      lenses: lensenAus(reviewWert),
      blocker: blockerAus(reviewWert),
      zusatzpass: zusatzpassAus(reviewWert),
      verdikt: felder.verdikt ?? null,
    };
  }
  return { plan, review, abnahme: abnahmeAus(lastLine(text, zeilen.abnahme)) };
}

/** Urteilswerte der Holdout-Abnahme je Kriterium (ADR 0022 F13). */
export const URTEILSWERTE = Object.freeze(["erfuellt", "nicht-erfuellt", "nicht-pruefbar"]);

/** `K1:erfuellt,K2:nicht-erfuellt` → `{urteil: [{k, wert}]}`; sonst `{fehler}` mit dem ersten Grund (leer, ungültiges K wie K0/Kx, unbekannter Wert, doppeltes K). */
function parseUrteil(wert) {
  if (typeof wert !== "string" || wert.trim() === "") return { fehler: "Urteil ist leer" };
  const urteil = [];
  for (const teil of wert.split(",")) {
    const m = /^\s*(K[1-9]\d*)\s*:\s*(\S+)\s*$/.exec(teil);
    if (!m) {
      const [name, ...rest] = teil.split(":");
      const k = name.trim();
      return { fehler: rest.length > 0 && !/^K[1-9]\d*$/.test(k) ? `Kriterium „${k}“ ungültig` : `Eintrag „${teil.trim()}“ ungültig (erwartet K<n>:<wert>)` };
    }
    const w = normalisiereWert(m[2]);
    if (!URTEILSWERTE.includes(w)) return { fehler: `unbekannter Wert „${m[2]}“ bei ${m[1]}` };
    if (urteil.some((u) => u.k === m[1])) return { fehler: `${m[1]} doppelt` };
    urteil.push({ k: m[1], wert: w });
  }
  return { urteil };
}

/** `[{k, wert}]` oder `null` bei jedem Fehler von parseUrteil. */
const urteilAus = (wert) => parseUrteil(wert).urteil ?? null;

const urteilText = (urteil) => urteil.map((u) => `${u.k}:${u.wert}`).join(",");

/** Erster Grund, warum eine Abnahme-Zeile (außer entfaellt mit Grund) ungültig ist; `null`, wenn head, durchgaenge und Urteil passen. */
function abnahmeFehler(wert, head, durch, u) {
  if (/^entf(?:ae|ä)llt/.test(wert)) return "entfaellt braucht einen Grund (entfaellt — <Grund>)";
  if (!HEX_HEAD.test(head)) return "head fehlt oder ist kein Hex";
  if (!/^\d+$/.test(durch) || Number(durch) < 1) return "durchgaenge fehlt oder ist kleiner als 1";
  return u.fehler ?? null;
}

/** Wert der Abnahme-Zeile: `{art:"urteil", head, durchgaenge, urteil}` | `{art:"entfaellt", grund}` | `{art:"ungueltig", zeile, grund}` | `null` (keine Zeile). */
function abnahmeAus(wert) {
  if (wert === null) return null;
  const entf = /^entf(?:ae|ä)llt\s*[—–-]+\s*(\S.*)$/.exec(wert);
  if (entf) return { art: "entfaellt", grund: entf[1].trim() };
  const head = (feldWert(wert, "head")?.trim() ?? "").toLowerCase();
  const durch = feldWert(wert, "durchgaenge")?.trim() ?? "";
  const u = parseUrteil(feldWert(wert, "urteil"));
  const grund = abnahmeFehler(wert, head, durch, u);
  if (grund !== null) return { art: "ungueltig", zeile: wert, grund };
  return { art: "urteil", head, durchgaenge: Number(durch), urteil: u.urteil };
}

/** Die einzige Quelle der Abnahme-Zeile (ohne Schlüssel-Präfix der Message): `<Präfix>Abnahme: head=… durchgaenge=… urteil=…` bzw.
 *  `<Präfix>Abnahme: entfaellt — <Grund>`. Wirft bei ungültiger Eingabe (head, durchgaenge ≥ 1, Urteilswerte, Grund einzeilig und nicht leer). Pur. */
export function formatAbnahme(zeilen, abnahme) {
  const key = `${zeilen.abnahme}:`;
  if (abnahme?.art === "entfaellt") {
    const grund = String(abnahme.grund ?? "").trim();
    if (grund === "" || /[\r\n]/.test(grund)) throw new Error("Abnahme: entfaellt braucht einen einzeiligen Grund");
    return `${key} entfaellt — ${grund}`;
  }
  const urteil = abnahme?.urteil;
  const ok = abnahme?.art === "urteil" && HEX_HEAD.test(abnahme.head ?? "") && Number.isInteger(abnahme.durchgaenge) && abnahme.durchgaenge >= 1;
  if (!ok || !Array.isArray(urteil) || urteilAus(urteilText(urteil)) === null) throw new Error("Abnahme: head (7-40 Hex), durchgaenge (≥ 1) und gültiges Urteil nötig");
  return `${key} head=${abnahme.head} durchgaenge=${abnahme.durchgaenge} urteil=${urteilText(urteil)}`;
}

/** Name des Kommentar-Markers der Abnahme (aus dem Präfix, kleingeschrieben); der Hand-off-Marker hängt `-handoff` an. */
export function abnahmeMarker(zeilen) {
  return `${zeilen.praefix.toLowerCase()}abnahme`;
}

/** Marker-Kommentarzeile `<!-- <marker> durchgang=<d> head=<sha> urteil=K1:… -->`; wirft bei ungültiger Eingabe wie formatAbnahme. Pur. */
export function formatAbnahmeMarker(zeilen, { durchgang, head, urteil }) {
  formatAbnahme(zeilen, { art: "urteil", head, durchgaenge: durchgang, urteil });
  return `<!-- ${abnahmeMarker(zeilen)} durchgang=${durchgang} head=${head} urteil=${urteilText(urteil)} -->`;
}

/** Liest den Marker aus einem Kommentartext: `{durchgang, head, urteil}` oder `null`. Der Hand-off-Marker zählt nie. Pur. */
export function parseAbnahmeMarker(zeilen, text) {
  const re = new RegExp(`<!--\\s*${escapeRegex(abnahmeMarker(zeilen))}\\s+durchgang=(\\d+)\\s+head=(${HEX})\\s+urteil=(\\S+)\\s*-->`);
  const m = re.exec(String(text ?? ""));
  const urteil = m ? urteilAus(m[3]) : null;
  if (!m || urteil === null || Number(m[1]) < 1) return null;
  return { durchgang: Number(m[1]), head: m[2], urteil };
}

/** Die gültigen Abnahme-Marker der Kommentare vertrauter Autoren (`owner` plus vertraute Bots), in der Reihenfolge der API; Marker Fremder
 *  und der Hand-off-Marker fehlen. Die eine Stelle für „Durchgang zählen“ (abnahme.mjs) und „jüngste Spur lesen“ (Wächter). Pur. */
export function vertrauteAbnahmeMarker(kommentare, owner, zeilen) {
  return (Array.isArray(kommentare) ? kommentare : [])
    .filter((c) => istVertraut(c?.user, owner))
    .map((c) => parseAbnahmeMarker(zeilen, c?.body))
    .filter((m) => m !== null);
}
