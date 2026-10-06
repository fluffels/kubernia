// Kein Shebang: wird von den check-*.mjs-Wächtern UND ihren Tests importiert (ein `#!` bricht den
// Test-Import, analog zu check-diffsize.mjs).
/**
 * Slice-Override per Commit-Zeile (#1269, #1309) — das gemeinsame Modul der Gate-Skripte.
 *
 * Drei Wächter lassen einen Slice mit Pflicht-Begründung durch (`KQ-Diffsize-Override`,
 * `KQ-Diffcov-Override`, `KQ-Review-Override`): eine Zeile `<KEY>: #<nr> <warum>` am Zeilenanfang einer
 * Commit-Message im Slice (`<basis>..HEAD`). Parser, Slice-Lesen und die Ausgabe-Texte liegen hier genau
 * einmal, damit lokal, im PR und auf main dasselbe gilt und kein Wächter eine eigene Variante pflegt.
 *
 * Importiert bewusst nichts aus den check-Skripten (keine Zyklen); ein Wächter-Skript importiert dieses
 * Modul. Pfad steht in `.github/protected-paths.json` (Gate).
 */

/** Sucht Zeilen `<key>: <wert>` am ZEILENANFANG (nicht eingerückt, nicht in Prosa) in
 *  beliebigem Message-Text. Bewusst kein git-Trailer-Parser: im Squash-Body steht die
 *  Zeile mitten im Text, gefolgt von weiteren `* commit`-Absätzen. Gültig ist ein Wert nur
 *  mit Ticketnummer UND Begründung (`#<nr> <warum>`, Pflicht-Begründung), sonst landet die
 *  Zeile in `invalid`. `key` ist eine feste Konstante ohne Regex-Sonderzeichen. Pure. */
export function parseOverrideTrailers(text, key) {
  const valid = [];
  const invalid = [];
  const re = new RegExp(`^${key}:[ \\t]*(.*)$`, "gm");
  for (const m of String(text).replace(/\r/g, "").matchAll(re)) {
    const value = m[1].trim();
    const ok = /^#(\d+)\s+\S/.exec(value);
    if (ok) valid.push({ nr: Number(ok[1]), reason: value });
    else invalid.push(m[0].trim());
  }
  return { valid, invalid };
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
  return { reason: valid.length > 0 ? valid[valid.length - 1].reason : null, invalid };
}

/** Meldet ungültige Override-Zeilen (ohne `#<nr> <warum>`): ignoriert, nur ein Hinweis. */
export function meldeUngueltigeOverrides(invalid, { dim = (s) => s, log = console.log } = {}) {
  for (const line of invalid ?? []) {
    log(dim(`• ungültige Override-Zeile ignoriert (braucht "#<nr> <warum>"): ${line}`));
  }
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
