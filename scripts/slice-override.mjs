// Kein Shebang: wird von den check-*.mjs-Wächtern UND ihren Tests importiert (ein `#!` bricht den
// Test-Import, analog zu check-diffsize.mjs).
/**
 * Slice-Override per Commit-Zeile (#1269, #1309) — das gemeinsame Modul der Gate-Skripte.
 *
 * Vier Wächter lassen einen Slice mit Pflicht-Begründung durch (`KQ-Diffsize-Override`,
 * `KQ-Diffcov-Override`, `KQ-Lockfile-Override`, `KQ-Review-Override`): eine Zeile `<KEY>: #<nr> <warum>` am Zeilenanfang einer
 * Commit-Message im Slice (`<basis>..HEAD`, als Betreff oder Body-Zeile). Parser, Slice-Lesen und die Ausgabe-Texte liegen hier genau
 * einmal, damit lokal, im PR und auf main dasselbe gilt und kein Wächter eine eigene Variante pflegt.
 *
 * Importiert bewusst nichts aus den check-Skripten (keine Zyklen); ein Wächter-Skript importiert dieses
 * Modul. Pfad steht in `.github/protected-paths.json` (Gate).
 */

/** Regex für eine Zeile `<key>: <wert>` am Zeilenanfang. Eine Definition für Override und Nachweis (#1383):
 *  toleriert wird genau das Präfix `* ` (Stern + ein Leerzeichen), mit dem GitHub im Squash-Commit auf main
 *  jeden Commit-BETREFF schreibt; Body-Zeilen bleiben dort unverändert. Gruppe 1 = Zeile ohne Präfix,
 *  Gruppe 2 = Wert. `key` ist eine feste Konstante ohne Regex-Sonderzeichen. */
function zeilenRe(key) {
  return new RegExp(`^(?:\\* )?(${key}:[ \\t]*(.*))$`, "gm");
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
  return { reason: valid.length > 0 ? valid[valid.length - 1].reason : null, invalid, versetzt: versetzteOverrideZeilen(messages, key) };
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

/** Der Hinweis zu einer stale Override-Zeile: der Slice braucht sie nicht. Eine fremde Zeile im eigenen
 *  Slice (z.B. nach einem Merge von main) darf man durch Umschreiben des EIGENEN Feature-Branches
 *  entfernen, solange der Nachweis-Commit noch nicht gesetzt ist. */
export function staleOverrideHinweis(key, warum) {
  return (
    `✖ ${key} steht im Slice, aber ${warum} — der Override ist stale.\n` +
    `  Den Override-Commit wieder aus dem Branch entfernen (den eigenen Feature-Branch umzuschreiben ist erlaubt, ` +
    `vor dem Nachweis-Commit).`
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

/** Wert eines Felds der `KQ-Review`-Zeile, tolerant (#1331): reicht bis zum nächsten ` key=`, damit auch
 *  Leerzeichen nach Kommas gehen. `null`, wenn das Feld fehlt. */
function feldWert(reviewWert, key) {
  const m = new RegExp(`(?:^|\\s)${key}=(.*?)(?=\\s+[a-z]+=|$)`).exec(reviewWert);
  return m ? m[1] : null;
}

/** Brillen der `KQ-Review`-Zeile; jeder Name wird normalisiert (Groß-/Kleinschreibung, Umlaute). */
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

/** Parst die letzte `KQ-Plan:`- und die letzte `KQ-Review:`-Zeile (am Zeilenanfang, nicht
 *  eingerückt) aus beliebigem Message-Text. Pure. Felder, die fehlen oder kaputt sind, bleiben
 *  null bzw. NaN; bewertet wird erst in bewerteNachweis. */
export function parseNachweis(text) {
  const planWert = lastLine(text, "KQ-Plan");
  let plan = null;
  if (planWert !== null) {
    const ohne = /^ohne\s*[—–-]+\s*(\S.*)$/.exec(planWert);
    if (planWert === "kubernia-planner") plan = { art: "planer" };
    else if (ohne) plan = { art: "ohne", grund: ohne[1].trim() };
    else plan = { art: "ungueltig", zeile: planWert };
  }
  const reviewWert = lastLine(text, "KQ-Review");
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
      verdikt: felder.verdikt ?? null,
    };
  }
  return { plan, review };
}
