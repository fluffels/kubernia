// Schicht-Kern: Prüfung und Ableitung zum Schicht-Modell (ADR 0022 F7).
//
// Das Schicht-Modell trägt `quellwurzel` (String) ODER `quellwurzeln` (Liste, nie beides) und optional `endungen`
// (mit Punkt, Standard `[".ts"]`); Muster, Globs und Regeln werden über alle Wurzeln und Endungen abgeleitet.
//
// Das Schicht-Modell (`SCHICHT_MODELL`, Schicht-IDs, Wurzeln, erlaubte Richtungen) gehört dem Projekt und liegt in
// dessen Schicht-Definition. Diese Datei kennt keine Projektdaten: sie prüft ein übergebenes Modell und leitet daraus
// Muster, Globs, Klassifikation und die Regeln von `check:arch` ab. Sie importiert nichts, und kein Kern-Modul lädt die
// Schichtdaten per statischem Import (Wächter in test/harness/kern-reinheit.test.ts); der Kern bekommt das Modell
// als Argument oder lädt es über den konfigurierten Pfad.
//
// Bewusst .cjs (kein .mjs): der dependency-cruiser-Config ist CommonJS und `require`t das hier direkt; ESM-Skripte
// ziehen es über `createRequire`.

/** Standard-Endung der Quelldateien eines Schicht-Modells ohne `endungen`. */
const STANDARD_ENDUNG = ".ts";

/** Quellwurzeln des Modells: `quellwurzeln` (Liste) oder die eine `quellwurzel`. */
function quellwurzelnAus(modell) {
  return modell.quellwurzeln ?? [modell.quellwurzel];
}

/** Endungen der Quelldateien des Modells (mit Punkt); Standard `[".ts"]`. */
function endungenAus(modell) {
  return modell.endungen ?? [STANDARD_ENDUNG];
}

/** Ein Teil wörtlich, mehrere als Regex-Alternative `(a|b)`. */
function alt(teile) {
  return teile.length === 1 ? teile[0] : `(${teile.join("|")})`;
}

/** Endung mit Punkt (auch mehrteilig wie `.d.ts`), schlichte Zeichen. */
const ENDUNG_FORM = /^(\.[A-Za-z0-9_-]+)+$/;

/** Regex-Endstücke der Endungen (`.java` wird zu `\.java$`). Der Kern importiert nichts (CJS ohne Importe, kein
 *  `escapeRegex`): `ENDUNG_FORM` lässt nur Buchstaben, Ziffern, `_`, `-` und Punkte zu, darum ist nur der Punkt zu maskieren. */
function endeAus(endungen) {
  const ungueltig = endungen.find((e) => typeof e !== "string" || !ENDUNG_FORM.test(e));
  if (ungueltig !== undefined) throw new Error(`Endung ${JSON.stringify(ungueltig)} ungültig (Endung mit Punkt, z.B. ".java")`);
  return endungen.map((e) => `${e.replaceAll(".", "\\.")}$`);
}

/** Endstück des Musters: bei `nurDatei` die Endungs-Alternative, sonst `(Endung$|/)`. */
function endstueck(ende, nurDatei) {
  return nurDatei ? alt(ende) : `(${[...ende, "/"].join("|")})`;
}

/** Pfad-Muster einer Schicht aus ihren Wurzel-Namen (Datei- bzw. Verzeichnis-Segmente unter der Quellwurzel).
 *  Deckt je Wurzel die Einzeldatei UND den Modul-Ordner ab; `nurDatei` (Einstieg/Assets) nur die Einzeldatei.
 *  `quellwurzeln`: ein String (eine Wurzel) oder eine Liste; `endungen`: Endungen mit Punkt (Standard `.ts`).
 *  Grenze: `endungen` wirken auf die Datei-Token (Einzeldatei je Wurzel, in RegExp und Coverage-Glob); unter einem
 *  Schicht-Ordner (`/` bzw. `/**`) zählt jede Datei, gleich welcher Endung (das Muster `(Endung$|/)` ist für TS eingefroren). */
function musterAus(quellwurzeln, wurzeln, nurDatei, endungen = [STANDARD_ENDUNG]) {
  const ende = endeAus(endungen);
  return `^${alt([quellwurzeln].flat())}(${wurzeln.join("|")})${endstueck(ende, nurDatei)}`;
}

const ID = /^[a-z][a-z0-9]*$/;
/** Schlichte Verzeichnisnamen: Regex-Metazeichen würden die abgeleiteten Muster verfälschen. */
const QUELLWURZEL_FORM = /^([a-z0-9][a-z0-9_-]*\/)+$/;
/** Schlichter Wurzel-Name einer Schicht (Datei- oder Ordnername unter der Quellwurzel, mit Großbuchstaben, z.B. Java-Klassen). */
const WURZEL_NAME_FORM = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const WURZEL_HINWEIS = "(Verzeichnis mit Slash am Ende, z.B. \"src/\")";

/** Mängel einer `quellwurzeln`-Liste: nicht-leer, schlichte Einträge, keine Dublette, keine Wurzel unter einer anderen. */
function quellwurzelnListeMaengel(liste) {
  if (!Array.isArray(liste) || liste.length === 0) return ["quellwurzeln ist keine nicht-leere Liste"];
  const ungueltig = liste.filter((w) => typeof w !== "string" || !QUELLWURZEL_FORM.test(w));
  if (ungueltig.length > 0) return ungueltig.map((w) => `quellwurzeln: Eintrag ${JSON.stringify(w)} ungültig ${WURZEL_HINWEIS}`);
  const probleme = [];
  if (new Set(liste).size !== liste.length) probleme.push("quellwurzeln: doppelter Eintrag");
  for (const a of liste) for (const b of liste) if (a !== b && b.startsWith(a)) probleme.push(`quellwurzeln: "${b}" liegt unter "${a}"`);
  return probleme;
}

/** Mängel der Quellwurzel-Angabe: genau eins von `quellwurzel` (String) und `quellwurzeln` (Liste ohne Verschachtelung). */
function quellwurzelnMaengel(modell) {
  const { quellwurzel, quellwurzeln } = modell ?? {};
  if (quellwurzeln !== undefined && quellwurzel !== undefined) return ["quellwurzel und quellwurzeln zugleich gesetzt (nur eins von beiden)"];
  if (quellwurzeln !== undefined) return quellwurzelnListeMaengel(quellwurzeln);
  if (typeof quellwurzel === "string" && QUELLWURZEL_FORM.test(quellwurzel)) return [];
  return [`quellwurzel ${JSON.stringify(quellwurzel)} ungültig ${WURZEL_HINWEIS}`];
}

/** Mängel der Endungsliste (`endungen` fehlt = Standard): nicht-leer, je Endung mit Punkt, ohne Dublette. */
function endungenMaengel(modell) {
  const liste = modell?.endungen;
  if (liste === undefined) return [];
  if (!Array.isArray(liste) || liste.length === 0) return ["endungen ist keine nicht-leere Liste"];
  const probleme = liste.filter((e) => typeof e !== "string" || !ENDUNG_FORM.test(e)).map((e) => `endungen: ${JSON.stringify(e)} ungültig (Endung mit Punkt, z.B. ".java")`);
  if (probleme.length === 0 && new Set(liste).size !== liste.length) probleme.push("endungen: doppelter Eintrag");
  return probleme;
}

/** Jedes Muster muss mit der Wurzel-Alternative `^(w1|w2|…)` bzw. `^<quellwurzel>` beginnen (sonst klassifiziert es Pfade ausserhalb der Wurzeln). */
function musterPraefixMaengel(modell, schichten) {
  const wurzeln = modell?.quellwurzeln ?? (typeof modell?.quellwurzel === "string" ? [modell.quellwurzel] : undefined);
  if (!Array.isArray(wurzeln) || wurzeln.some((w) => typeof w !== "string")) return [];
  const praefix = `^${alt(wurzeln)}`;
  return schichten
    .filter((s) => s.muster !== null && !(typeof s.muster === "string" && s.muster.startsWith(praefix)))
    .map((s) => `"${String(s.id)}": muster beginnt nicht mit den quellwurzeln (erwartet: ${praefix})`);
}

/** Ist `endungen` gesetzt, muss jedes String-Muster auf die Endungen des Modells enden: bei `nurDatei` auf `alt(ende)`, sonst auf `(…|/)`. */
function musterEndeMaengel(modell, schichten) {
  const endungen = modell?.endungen;
  if (!Array.isArray(endungen) || endungen.length === 0 || endungen.some((e) => typeof e !== "string" || !ENDUNG_FORM.test(e))) return [];
  const ende = endeAus(endungen);
  return schichten
    .filter((s) => typeof s.muster === "string" && !s.muster.endsWith(endstueck(ende, s.nurDatei === true)))
    .map((s) => `"${String(s.id)}": muster endet nicht auf die endungen (erwartet: ${endstueck(ende, s.nurDatei === true)})`);
}

/** Mängel an IDs, Labels und Techniken; liefert die Mängel und die Menge der vergebenen IDs. */
function idMaengel(alle) {
  const probleme = [];
  const ids = new Set();
  for (const s of alle) {
    if (typeof s.id !== "string" || !ID.test(s.id) || s.id === "end") probleme.push(`ungültige oder reservierte ID "${String(s.id)}"`);
    else if (ids.has(s.id)) probleme.push(`doppelte ID "${s.id}"`);
    ids.add(s.id);
    if (typeof s.label !== "string" || s.label === "" || /["<>\r\n]/.test(s.label)) probleme.push(`ungültiges Label bei "${String(s.id)}"`);
    if (s.technik !== undefined && /["<>\r\n]/.test(s.technik)) probleme.push(`ungültige Technik bei "${String(s.id)}"`);
  }
  return { probleme, ids };
}

/** Mängel an den Wurzel-Namen der Schichten: Form und Eindeutigkeit über alle Schichten. */
function wurzelMaengel(schichten) {
  const probleme = [];
  const wurzelBesitzer = new Map();
  for (const s of schichten) {
    if (!Array.isArray(s.wurzeln) || s.wurzeln.some((w) => typeof w !== "string")) {
      probleme.push(`"${s.id}": wurzeln ist kein Array aus Strings`);
      continue;
    }
    for (const w of s.wurzeln) {
      // Nur schlichte Namen: Regex-Metazeichen würden das abgeleitete Muster verfälschen, eine leere Wurzel träfe alles.
      // Eindeutigkeit ohne Groß-/Kleinschreibung: Dateisysteme und Glob-Abgleich (picomatch) unterscheiden sie nicht überall.
      const schluessel = w.toLowerCase();
      if (!WURZEL_NAME_FORM.test(w)) probleme.push(`"${s.id}": ungültige Wurzel ${JSON.stringify(w)} (leer oder mit Sonderzeichen)`);
      else if (wurzelBesitzer.has(schluessel) && wurzelBesitzer.get(schluessel) !== s.id) probleme.push(`Wurzel "${w}" steht in zwei Schichten ("${wurzelBesitzer.get(schluessel)}" und "${s.id}")`);
      else wurzelBesitzer.set(schluessel, s.id);
    }
  }
  return probleme;
}

/** Mängel an den erlaubten Richtungen (`darf`): eine Liste bekannter Ziele. */
function darfMaengel(schichten, ids) {
  const probleme = [];
  for (const s of schichten) {
    if (!Array.isArray(s.darf)) probleme.push(`"${s.id}": darf ist keine Liste`);
    else for (const z of s.darf) if (!ids.has(z)) probleme.push(`"${s.id}" darf unbekanntes Ziel "${z}" importieren`);
  }
  return probleme;
}

/** Wirft bei einem unbrauchbaren Modell (alle Probleme in einer Meldung). */
function pruefeModell(modell) {
  const probleme = [...quellwurzelnMaengel(modell), ...endungenMaengel(modell)];
  const schichten = Array.isArray(modell?.schichten) ? modell.schichten : [];
  const extern = Array.isArray(modell?.extern) ? modell.extern : [];
  if (schichten.length === 0) probleme.push("keine Schichten");
  const { probleme: idProbleme, ids } = idMaengel([...schichten, ...extern]);
  probleme.push(...idProbleme, ...musterPraefixMaengel(modell, schichten), ...musterEndeMaengel(modell, schichten));
  const auffang = schichten.filter((s) => s.muster === null).length;
  if (schichten.length > 0 && auffang !== 1) probleme.push(`genau eine Auffang-Schicht (muster: null) nötig, gefunden: ${auffang}`);
  probleme.push(...wurzelMaengel(schichten), ...darfMaengel(schichten, ids));
  if (probleme.length) throw new Error(`SCHICHT_MODELL ungültig: ${probleme.join("; ")}`);
}

/** Klassifiziert eine repo-relative Datei (POSIX-Pfad) in ihre Schicht — dieselben Grenzen, die der
 *  dependency-cruiser erzwingt. Die Muster sind disjunkt; was keins trifft, gehört der Auffang-Schicht.
 *  Liefert die Funktion `Datei → Schicht-ID`; prüft das Modell zuerst (fail-closed). */
function layerOfAus(modell) {
  pruefeModell(modell);
  const auffang = modell.schichten.find((s) => s.muster === null);
  return (file) => {
    for (const s of modell.schichten) if (s.muster && new RegExp(s.muster).test(file)) return s.id;
    return auffang.id;
  };
}

/** Die Wurzel-Namen (Datei- bzw. Verzeichnis-Segmente) der Schichten mit Wurzeln, aus dem Modell abgeleitet:
 *  erst die Schichten mit Modul-Ordnern (Modell-Reihenfolge), dann die reinen Datei-Wurzeln. EINE Quelle für
 *  den Auffang-Glob: Auffang = „alles unter der Quellwurzel, dessen erstes Segment NICHT hier steht". */
function wurzelnAusserAuffangAus(modell) {
  pruefeModell(modell);
  const mitWurzeln = modell.schichten.filter((s) => s.wurzeln.length > 0);
  return [...mitWurzeln.filter((s) => !s.nurDatei), ...mitWurzeln.filter((s) => s.nurDatei)].flatMap((s) => s.wurzeln);
}

/** Glob-Form derselben Schicht-Grenzen — für Vitests Coverage-`thresholds`, deren Schlüssel Globs (picomatch),
 *  keine RegExps sind. GENAU EIN Glob je Schicht, damit Vitest die Schwelle über das ganze Schicht-Aggregat prüft.
 *  Ein Projekt mit Vitest-Coverage bindet beide Formen per Test aneinander: für jede echte Quelldatei greift genau ein
 *  Glob, und er stimmt mit `layerOf` (der RegExp-Wahrheit) überein.
 *
 *  Der Auffang-Glob ist bewusst ZWEIGETEILT (`{!(nd)/**,!(ndTs)}`), nicht `<wurzel>!(nd)/**`: picomatch rendert
 *  `!(…)` als PRÄFIX-Lookahead, der nicht an die Segmentgrenze verankert ist; `uieval.ts` fiele wegen `ui` still
 *  aus dem Auffang-Bucket. Der Datei-Zweig `!(ndTs)` negiert stattdessen die vollständigen Datei-Token (`ui.ts`),
 *  der Verzeichnis-Zweig `!(nd)/**` deckt Unterordner ab. Rest-Grenze: ein künftiger Auffang-Ordner mit
 *  reserviertem Präfix träfe denselben Effekt; er fällt aber nicht still durch, sondern lässt die Bindung an echte
 *  Dateien rot laufen. Mehrere Quellwurzeln und Endungen werden zu Brace-Mengen (`{a/,b/}`, `{.java,.kt}`); mit einer
 *  Wurzel und der Standard-Endung bleibt die Ausgabe unverändert. */
function coverageGlobsAus(modell) {
  const nonDomain = wurzelnAusserAuffangAus(modell);
  const endungen = endungenAus(modell);
  const menge = (teile) => (teile.length === 1 ? teile[0] : `{${teile.join(",")}}`);
  const nd = nonDomain.join("|");
  const ndTs = nonDomain.flatMap((n) => endungen.map((e) => `${n}${e}`)).join("|");
  const q = menge(quellwurzelnAus(modell));
  const auffang = modell.schichten.find((s) => s.muster === null);
  const globVon = (s) => `${q}{${s.wurzeln.join(",")}}${s.nurDatei ? menge(endungen) : `{${[...endungen, "/**"].join(",")}}`}`;
  return {
    ...Object.fromEntries(modell.schichten.filter((s) => s.wurzeln.length > 0).map((s) => [s.id, globVon(s)])),
    [auffang.id]: `${q}{!(${nd})/**,!(${ndTs})}`,
  };
}

const D_TS = "\\.d\\.ts$";

/** Pfad-Muster einer Schicht als dependency-cruiser-Bedingung; die Auffang-Schicht ist „Quellwurzel ohne alle anderen". */
function bedingung(modell, ziel, alsQuelle) {
  // `.d.ts`-Quellen sind nur in Modellen mit `.ts` Typdeklarationen.
  const ohneDts = alsQuelle && endungenAus(modell).includes(STANDARD_ENDUNG);
  const andere = modell.schichten.filter((s) => s.muster && s.id !== ziel.id).map((s) => s.muster);
  if (ziel.muster) return ohneDts ? { path: ziel.muster, pathNot: D_TS } : { path: ziel.muster };
  return { path: `^${alt(quellwurzelnAus(modell))}`, pathNot: [...andere, ...(ohneDts ? [D_TS] : [])].join("|") };
}

/** Verbotsregeln für dependency-cruiser: je Paar (Schicht → Schicht/Extern), das nicht in `darf` steht, eine Regel
 *  `schicht-<von>-nicht-<nach>`. `.d.ts`-Quellen lösen nie eine Regel aus (reine Typdeklarationen). Prüft das
 *  Modell zuerst: ein kaputtes Modell wirft, statt Regeln mit Lücken zu liefern (fail-closed). */
function verbotsRegeln(modell) {
  pruefeModell(modell);
  const regeln = [];
  const ziele = [...modell.schichten, ...modell.extern];
  for (const von of modell.schichten) {
    for (const nach of ziele) {
      if (nach.id === von.id || von.darf.includes(nach.id)) continue;
      regeln.push({
        name: `schicht-${von.id}-nicht-${nach.id}`,
        comment: `${von.label} darf ${nach.label} nicht importieren (erlaubte Richtungen: \`darf\` im SCHICHT_MODELL der Schicht-Definition).`,
        severity: "error",
        from: bedingung(modell, von, true),
        to: bedingung(modell, nach, false),
      });
    }
  }
  return regeln;
}

module.exports = { musterAus, quellwurzelnAus, pruefeModell, layerOfAus, wurzelnAusserAuffangAus, coverageGlobsAus, verbotsRegeln };
