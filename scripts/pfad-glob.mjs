// Blatt-Modul (factory#130): Pfad-Globs der Projekt-Config (`factoryLinks.ausnahmen`). Eine kleine, geschlossene Syntax statt `path.matchesGlob`
// (das kennt mehr, etwa `[a]` und `{a,b}`; zwei Auslegungen wären ein Drift): repo-relative POSIX-Pfade, `*` (im Segment), `?` (ein Zeichen im Segment)
// und `**` als ganzes Segment (null oder mehr Segmente). Alles andere ist wörtlich; Klammern, `!` am Anfang und `\` sind nicht erlaubt.
import { istRelativPosix } from "./relativ-pfad.mjs";

const VERBOTEN = /[[\]{}\\]/;

/** Mangel eines einzelnen Globs als Text oder `null`. */
function globMangel(muster) {
  if (typeof muster !== "string" || muster === "") return "muss ein nicht-leerer String sein";
  if (VERBOTEN.test(muster) || muster.startsWith("!")) return "darf kein [ ] { } \\ enthalten und nicht mit ! beginnen (erlaubt: * ? **)";
  if (!istRelativPosix(muster)) return "muss ein repo-relativer POSIX-Pfad sein (kein / am Anfang oder Ende, kein Laufwerk, keine Segmente ., .. oder leer)";
  if (muster.split("/").some((s) => s.includes("**") && s !== "**")) return "`**` ist nur als ganzes Segment erlaubt";
  return null;
}

/** Pur: Fehlertexte einer Glob-Liste (`wo` ist der Schlüsselpfad, z.B. `factoryLinks.ausnahmen`); leer = gültig. Doppelte Einträge sind ein Fehler. */
export function globMaengel(liste, wo) {
  if (!Array.isArray(liste)) return [`${wo} muss eine Liste von Pfad-Globs sein`];
  const gesehen = new Set();
  const fehler = [];
  liste.forEach((muster, i) => {
    const mangel = globMangel(muster);
    if (mangel) fehler.push(`${wo}[${i}] ${mangel}`);
    else if (gesehen.has(muster)) fehler.push(`${wo}[${i}] „${muster}“ steht doppelt`);
    else gesehen.add(muster);
  });
  return fehler;
}

const escapeZeichen = (s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/** Pur: der reguläre Ausdruck zu einem gültigen Glob; `*` → `[^/]*`, `?` → `[^/]`, ein `**`-Segment → null oder mehr Segmente. */
export function globRegex(muster) {
  const segmente = muster.split("/");
  let re = "";
  segmente.forEach((s, i) => {
    const letztes = i === segmente.length - 1;
    if (s === "**") {
      re += letztes ? ".*" : "(?:[^/]+/)*";
      return;
    }
    re += [...s].map((z) => (z === "*" ? "[^/]*" : z === "?" ? "[^/]" : escapeZeichen(z))).join("");
    if (!letztes) re += "/";
  });
  return new RegExp(`^${re}$`);
}
