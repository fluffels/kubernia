// Kein Shebang: wird von den check-*.mjs-Wächtern UND ihren Tests importiert (ein `#!` bricht den
// Test-Import, analog zu check-diffsize.mjs).
/**
 * Slice-Override per Commit-Zeile (#1269, #1309) — das gemeinsame Modul der Gate-Skripte.
 *
 * Vier Wächter lassen einen Slice mit Pflicht-Begründung durch (Diffsize-, Diffcov-, Lockfile- und Review-Override, Schlüssel aus
 * `commitZeilen`, Präfix aus der Projekt-Config): eine Zeile `<KEY>: #<nr> <warum>` am Zeilenanfang einer
 * Commit-Message im Slice (`<basis>..HEAD`, als Betreff oder Body-Zeile). Parser, Slice-Lesen und die Ausgabe-Texte liegen hier genau
 * einmal, damit lokal, im PR und auf main dasselbe gilt und kein Wächter eine eigene Variante pflegt.
 *
 * Importiert bewusst nichts aus den check-Skripten (keine Zyklen); ein Wächter-Skript importiert dieses
 * Modul. Pfad steht in `.github/protected-paths.json` (Gate).
 */
import { AGENT_MUSTER, COMMIT_PRAEFIX_MUSTER, ladeProjektConfig } from "./projekt-config-lib.mjs";

/** Die Commit-Zeilen-Schlüssel eines Projekts (#1741, ADR 0022 F3): alle aus dem Präfix der Projekt-Config, kein Standardwert.
 *  `praefix` muss COMMIT_PRAEFIX_MUSTER erfüllen, `planer` AGENT_MUSTER, sonst wirft die Funktion. Pur. */
export function commitZeilen(praefix, planer) {
  if (typeof praefix !== "string" || !COMMIT_PRAEFIX_MUSTER.test(praefix)) {
    throw new Error(`Commit-Zeilen-Präfix ungültig: ${JSON.stringify(praefix)} (praefixe.commitZeile in der Projekt-Config, Muster ${COMMIT_PRAEFIX_MUSTER})`);
  }
  if (typeof planer !== "string" || !AGENT_MUSTER.test(planer)) {
    throw new Error(`Planer-Name ungültig: ${JSON.stringify(planer)} (agenten.planer in der Projekt-Config)`);
  }
  return {
    praefix,
    planer,
    plan: `${praefix}Plan`,
    review: `${praefix}Review`,
    abnahme: `${praefix}Abnahme`,
    reviewOverride: `${praefix}Review-Override`,
    diffsizeOverride: `${praefix}Diffsize-Override`,
    diffcovOverride: `${praefix}Diffcov-Override`,
    lockfileOverride: `${praefix}Lockfile-Override`,
  };
}

/** Commit-Zeilen aus einer geprüften Projekt-Config. Pur. */
export function commitZeilenAus(config) {
  return commitZeilen(config?.praefixe?.commitZeile, config?.agenten?.planer);
}

/** Lädt die Projekt-Config (Standard: die echte) und leitet die Commit-Zeilen ab; wirft mit der Meldung des Laders (Pfad, Schlüssel, `Fix:`). */
export function ladeCommitZeilen({ rootDir, pfad } = {}) {
  return commitZeilenAus(ladeProjektConfig({ rootDir, pfad }));
}

const escapeRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex für eine Zeile `<key>: <wert>` am Zeilenanfang. Eine Definition für Override und Nachweis (#1383):
 *  toleriert wird genau das Präfix `* ` (Stern + ein Leerzeichen), mit dem GitHub im Squash-Commit auf main
 *  jeden Commit-BETREFF schreibt; Body-Zeilen bleiben dort unverändert. Gruppe 1 = Zeile ohne Präfix,
 *  Gruppe 2 = Wert. `key` wird wörtlich eingesetzt (escaped). */
function zeilenRe(key) {
  return new RegExp(`^(?:\\* )?(${escapeRe(key)}:[ \\t]*(.*))$`, "gm");
}

/** Sucht Zeilen `<key>: <wert>` am ZEILENANFANG (nicht eingerückt, nicht in Prosa) in
 *  beliebigem Message-Text, als Betreff oder als Body-Zeile. Bewusst kein git-Trailer-Parser: im
 *  Squash-Commit steht die Zeile mitten im Text; Body-Zeilen unverändert, ein Betreff als
 *  `* <betreff>` (#1383). Genau dieses Präfix (Stern + ein Leerzeichen) wird toleriert; Einrückung,
 *  andere Aufzählungszeichen und Prosa zählen nicht. Gültig ist ein Wert nur
 *  mit Ticketnummer UND Begründung (`#<nr> <warum>`, Pflicht-Begründung), sonst landet die
 *  Zeile (ohne Präfix) in `invalid`. Pure. */
export function parseOverrideTrailers(text, key) {
  const valid = [];
  const invalid = [];
  for (const m of String(text).replace(/\r/g, "").matchAll(zeilenRe(key))) {
    const value = m[2].trim();
    const ok = /^#(\d+)\s+\S/.exec(value);
    if (ok) valid.push({ nr: Number(ok[1]), reason: value });
    else invalid.push(m[1].trim());
  }
  return { valid, invalid };
}

/** Zeilen, die `<key>:` enthalten, aber von `zeilenRe` NICHT erkannt werden (eingerückt, mit `- `-Präfix, mitten im Fließtext):
 *  das Format ist knapp daneben und die Zeile wird still ignoriert (#1349). Liefert die getrimmten Zeilen. Pure. */
export function versetzteOverrideZeilen(text, key) {
  const erkannt = (zeile) => new RegExp(zeilenRe(key).source).test(zeile);
  return String(text)
    .replace(/\r/g, "")
    .split("\n")
    .filter((z) => z.includes(`${key}:`) && !erkannt(z))
    .map((z) => z.trim());
}

/** Widerruf (#1693): `<key>: #<nr> entfällt` (genau das Wort) hebt den Override auf; die jüngste Zeile entscheidet, danach
 *  misst das Gate normal gegen sein Budget (keine Lockerung). So bleibt die Historie unangetastet. */
const WIDERRUF = /^#\d+\s+entfällt$/;

/** Override für `key` aus den Commit-Messages des Slices (`<basis>..HEAD`, dieselbe Basis
 *  wie der Diff, damit kein fremder main-Commit einen Trailer einschleppt). Die NEUESTE
 *  gültige Zeile zählt: `--reverse` liest chronologisch (ältester zuerst), und im Squash-Body
 *  auf main stehen die Branch-Messages ebenfalls chronologisch; in beiden Kontexten ist darum
 *  die letzte gültige Zeile die neueste. Scheitert git, gibt es keinen Override (fail-closed:
 *  ein Slice über Budget bleibt dann rot). */
export function sliceOverride(runGit, base, key) {
  let messages;
  try {
    messages = runGit(["log", "--reverse", "--format=%B", `${base}..HEAD`]);
  } catch {
    messages = "";
  }
  const { valid, invalid } = parseOverrideTrailers(messages, key);
  const juengste = valid.length > 0 ? valid[valid.length - 1].reason : null;
  return { reason: juengste !== null && !WIDERRUF.test(juengste) ? juengste : null, invalid, versetzt: versetzteOverrideZeilen(messages, key) };
}

/** Meldet ungültige Override-Zeilen (ohne `#<nr> <warum>`): ignoriert, nur ein Hinweis. */
export function meldeUngueltigeOverrides(invalid, { dim = (s) => s, log = console.log } = {}) {
  for (const line of invalid ?? []) {
    log(dim(`• ungültige Override-Zeile ignoriert (braucht "#<nr> <warum>"): ${line}`));
  }
}

/** Hinweis im ROTEN Zweig: eine Zeile mit `<key>:` steht im Slice, zählt aber nicht, weil sie nicht am Zeilenanfang steht. */
export function versetzteOverrideHinweis(key, zeilen) {
  return (zeilen ?? []).map(
    (z) => `• Zeile mit ${key}: gefunden, aber nicht am Zeilenanfang (wird ignoriert; erwartet: "${key}: #<nr> <warum>" als eigene Zeile, nicht eingerückt): ${z}`,
  );
}

/** Der Hinweis zu einer stale Override-Zeile: der Slice braucht sie nicht. Weg: ein leerer Commit auf dem
 *  Feature-Branch mit der Zeile `<key>: #<nr> entfällt` (Widerruf, die jüngste Zeile gilt), kein Umschreiben der Historie. */
export function staleOverrideHinweis(key, warum) {
  return (
    `✖ ${key} steht im Slice, aber ${warum} — der Override ist stale.\n` +
    `  Widerrufen: leerer Commit auf dem Feature-Branch mit der Zeile "${key}: #<nr> entfällt" (die jüngste Zeile gilt; ` +
    `danach misst das Gate normal gegen sein Budget).`
  );
}

function lastLine(text, key) {
  const all = [...String(text).replace(/\r/g, "").matchAll(zeilenRe(key))];
  return all.length > 0 ? all[all.length - 1][2].trim() : null;
}

/** Normalisiert einen Brillennamen (#1331): Kleinbuchstaben, Umlaute und ß in ASCII, Leerraum wird `-`. */
export function normalisiereLens(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, "-");
}

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
      head: /^[0-9a-f]{7,40}$/i.test(felder.head ?? "") ? felder.head.toLowerCase() : null,
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

/** `K1:erfuellt,K2:nicht-erfuellt` → `[{k, wert}]`; `null` bei leerem Wert, ungültigem K (K0, Kx), doppeltem K oder unbekanntem Wert. */
function urteilAus(wert) {
  if (typeof wert !== "string" || wert.trim() === "") return null;
  const urteil = [];
  for (const teil of wert.split(",")) {
    const m = /^\s*(K[1-9]\d*)\s*:\s*(\S+)\s*$/.exec(teil);
    const w = m ? normalisiereLens(m[2]) : "";
    if (!m || !URTEILSWERTE.includes(w) || urteil.some((u) => u.k === m[1])) return null;
    urteil.push({ k: m[1], wert: w });
  }
  return urteil;
}

const urteilText = (urteil) => urteil.map((u) => `${u.k}:${u.wert}`).join(",");

/** Wert der Abnahme-Zeile: `{art:"urteil", head, durchgaenge, urteil}` | `{art:"entfaellt", grund}` | `{art:"ungueltig", zeile}` | `null` (keine Zeile). */
function abnahmeAus(wert) {
  if (wert === null) return null;
  const entf = /^entf(?:ae|ä)llt\s*[—–-]+\s*(\S.*)$/.exec(wert);
  if (entf) return { art: "entfaellt", grund: entf[1].trim() };
  const head = (feldWert(wert, "head")?.trim() ?? "").toLowerCase();
  const durch = feldWert(wert, "durchgaenge")?.trim() ?? "";
  const urteil = urteilAus(feldWert(wert, "urteil"));
  if (!/^[0-9a-f]{7,40}$/.test(head) || !/^\d+$/.test(durch) || Number(durch) < 1 || urteil === null) return { art: "ungueltig", zeile: wert };
  return { art: "urteil", head, durchgaenge: Number(durch), urteil };
}

const HEX_HEAD = /^[0-9a-f]{7,40}$/;

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
  const re = new RegExp(`<!--\\s*${escapeRe(abnahmeMarker(zeilen))}\\s+durchgang=(\\d+)\\s+head=([0-9a-f]{7,40})\\s+urteil=(\\S+)\\s*-->`);
  const m = re.exec(String(text ?? ""));
  const urteil = m ? urteilAus(m[3]) : null;
  if (!m || urteil === null || Number(m[1]) < 1) return null;
  return { durchgang: Number(m[1]), head: m[2], urteil };
}
