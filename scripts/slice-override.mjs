// Kein Shebang: wird von den check-*.mjs-Wächtern UND ihren Tests importiert (ein `#!` bricht den
// Test-Import, analog zu check-diffsize.mjs).
/**
 * Slice-Override per Commit-Zeile (#1269, #1309) — das gemeinsame Modul der Gate-Skripte.
 *
 * Fünf Wächter lassen einen Slice mit Pflicht-Begründung durch (Diffsize-, Diffcov-, Lockfile-, Review- und Abnahme-Override, Schlüssel aus
 * `commitZeilen`, Präfix aus der Projekt-Config): eine Zeile `<KEY>: #<nr> <warum>` am Zeilenanfang einer
 * Commit-Message im Slice (`<basis>..HEAD`, als Betreff oder Body-Zeile). Parser, Slice-Lesen und die Ausgabe-Texte liegen hier genau
 * einmal, damit lokal, im PR und auf main dasselbe gilt und kein Wächter eine eigene Variante pflegt.
 *
 * Importiert bewusst nichts aus den check-Skripten (keine Zyklen); ein Wächter-Skript importiert dieses
 * Modul. Pfad steht in `.github/protected-paths.json` (Gate).
 */
import { AGENT_MUSTER, COMMIT_PRAEFIX_MUSTER, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { zeilenRe } from "./nachweis-lib.mjs";

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
    abnahmeOverride: `${praefix}Abnahme-Override`,
    diffsizeOverride: `${praefix}Diffsize-Override`,
    diffcovOverride: `${praefix}Diffcov-Override`,
    lockfileOverride: `${praefix}Lockfile-Override`,
    syncDringlich: `${praefix}Sync-Dringlich`,
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

/** CLI-Variante für die Gate-Skripte: ein Ladefehler endet mit der Meldung des Laders (Pfad, Schlüssel, `Fix:`) und Exit 1.
 *  `laden`, `fehler` und `exit` sind injizierbar (Test); nach einem (gemockten) Exit liefert die Funktion `undefined`. */
export function ladeCommitZeilenOderBeende({ laden = ladeCommitZeilen, fehler = console.error, exit = process.exit } = {}) {
  try {
    return laden();
  } catch (e) {
    fehler(`✖ ${e instanceof Error ? e.message : String(e)}`);
    exit(1);
    return undefined;
  }
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
  const { invalid } = parseOverrideTrailers(messages, key);
  return { reason: aktiverOverride(messages, key), invalid, versetzt: versetzteOverrideZeilen(messages, key) };
}

/** Der gültige Override-Grund für `key` in `text` (jüngste gültige Zeile gewinnt), `null` ohne Zeile oder nach einem Widerruf. Pure. */
export function aktiverOverride(text, key) {
  const { valid } = parseOverrideTrailers(text, key);
  const juengste = valid.length > 0 ? valid[valid.length - 1].reason : null;
  return juengste !== null && !WIDERRUF.test(juengste) ? juengste : null;
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

/**
 * Merges in `<headSha>..HEAD`, deren Auflösung vom automatischen Merge abweicht (Konflikt-Auflösung). `git show --remerge-diff` zeigt
 * genau diese Abweichung; die Ausgabe ist bei einem konfliktfreien Merge leer. Wirft bei einem git-Fehler (z.B. git < 2.36), der
 * Aufrufer wertet das als rot (fail-closed).
 */
export function konfliktMergesNach(git, headSha) {
  const merges = git(["rev-list", "--merges", `${headSha}..HEAD`]).split(/\r?\n/).filter((l) => l.trim() !== "");
  return merges.filter((sha) => git(["show", "--remerge-diff", "--format=", sha]).trim() !== "");
}

/** Der volle SHA des Commits `ref`, `null` wenn `ref` kein Commit ist (leere Ausgabe oder git-Fehler von `rev-parse --verify`). */
export function loeseCommit(git, ref) {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Löst `ref` zu einem Commit auf und prüft, ob er im Slice (`<base>..HEAD`) liegt; nur dann kommen die Merges mit Konflikt-Auflösung und
 * die Änderungs-Commits nach ihm dazu. Die eine Stelle für „head im Slice" der Review- und Abnahme-Gates.
 * `{ sha, bekannt, imSlice, konfliktMerges, aenderungsCommits }`; `sha` ist `null`, wenn `ref` kein Commit ist (ein git-Fehler dabei zählt als unbekannt).
 * Andere git-Fehler wirft die Funktion; der Aufrufer wertet das als rot (fail-closed).
 */
export function commitImSlice(git, base, ref) {
  const sha = loeseCommit(git, ref);
  const leer = { sha, bekannt: sha !== null, imSlice: false, konfliktMerges: [], aenderungsCommits: [] };
  if (sha === null) return leer;
  if (!git(["rev-list", `${base}..HEAD`]).split(/\r?\n/).includes(sha)) return leer;
  return { ...leer, imSlice: true, konfliktMerges: konfliktMergesNach(git, sha), aenderungsCommits: aenderungsCommitsNach(git, sha, base) };
}

/**
 * Nicht-Merge-Commits in `<headSha>..HEAD` mit Baumänderung, ohne die Commits der Basis (`^<base>`: eingemergte `main`-Commits zählen nicht):
 * `[{ sha, dateien }]`, älteste zuerst. Leere Commits (Nachweis, Override) fehlen. Wirft bei einem git-Fehler; der Aufrufer wertet das als rot.
 */
export function aenderungsCommitsNach(git, headSha, base) {
  const shas = git(["rev-list", "--reverse", "--no-merges", `${headSha}..HEAD`, `^${base}`]).split(/\r?\n/).filter((l) => l.trim() !== "");
  return shas
    .map((sha) => ({ sha, dateien: git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha]).split(/\r?\n/).filter((l) => l.trim() !== "") }))
    .filter((c) => c.dateien.length > 0);
}
