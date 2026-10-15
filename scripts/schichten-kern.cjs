// Schicht-Kern: Prüfung und Ableitung zum Schicht-Modell (ADR 0022 F7).
//
// Das Schicht-Modell (`SCHICHT_MODELL`, Schicht-IDs, Wurzeln, erlaubte Richtungen) gehört dem Projekt und liegt in
// dessen Schicht-Definition. Diese Datei kennt keine Projektdaten: sie prüft ein übergebenes Modell und leitet daraus
// Muster, Globs, Klassifikation und die Regeln von `check:arch` ab. Sie importiert nichts, und kein Kern-Modul lädt die
// Schichtdaten per statischem Import (Wächter in test/harness/kern-reinheit.test.ts); der Kern bekommt das Modell
// als Argument oder lädt es über den konfigurierten Pfad.
//
// Bewusst .cjs (kein .mjs): der dependency-cruiser-Config ist CommonJS und `require`t das hier direkt; ESM-Skripte
// ziehen es über `createRequire`.

/** Pfad-Muster einer Schicht aus ihren Wurzel-Namen (Datei- bzw. Verzeichnis-Segmente unter der Quellwurzel).
 *  Deckt je Wurzel die Einzeldatei UND den Modul-Ordner ab; `nurDatei` (Einstieg/Assets) nur die Einzeldatei. */
function musterAus(quellwurzel, wurzeln, nurDatei) {
  return `^${quellwurzel}(${wurzeln.join("|")})${nurDatei ? "\\.ts$" : "(\\.ts$|/)"}`;
}

const ID = /^[a-z][a-z0-9]*$/;
/** Schlichte Verzeichnisnamen: Regex-Metazeichen würden die abgeleiteten Muster verfälschen. */
const QUELLWURZEL_FORM = /^([a-z0-9][a-z0-9_-]*\/)+$/;

/** Wirft bei einem unbrauchbaren Modell (alle Probleme in einer Meldung). */
function pruefeModell(modell) {
  const probleme = [];
  if (typeof modell?.quellwurzel !== "string" || !QUELLWURZEL_FORM.test(modell.quellwurzel))
    probleme.push(`quellwurzel ${JSON.stringify(modell?.quellwurzel)} ungültig (Verzeichnis mit Slash am Ende, z.B. "src/")`);
  const schichten = Array.isArray(modell?.schichten) ? modell.schichten : [];
  const extern = Array.isArray(modell?.extern) ? modell.extern : [];
  if (schichten.length === 0) probleme.push("keine Schichten");
  const alle = [...schichten, ...extern];
  const ids = new Set();
  for (const s of alle) {
    if (typeof s.id !== "string" || !ID.test(s.id) || s.id === "end") probleme.push(`ungültige oder reservierte ID "${String(s.id)}"`);
    else if (ids.has(s.id)) probleme.push(`doppelte ID "${s.id}"`);
    ids.add(s.id);
    if (typeof s.label !== "string" || s.label === "" || /["<>\r\n]/.test(s.label)) probleme.push(`ungültiges Label bei "${String(s.id)}"`);
    if (s.technik !== undefined && /["<>\r\n]/.test(s.technik)) probleme.push(`ungültige Technik bei "${String(s.id)}"`);
  }
  const auffang = schichten.filter((s) => s.muster === null).length;
  if (schichten.length > 0 && auffang !== 1) probleme.push(`genau eine Auffang-Schicht (muster: null) nötig, gefunden: ${auffang}`);
  const wurzelBesitzer = new Map();
  for (const s of schichten) {
    if (!Array.isArray(s.wurzeln) || s.wurzeln.some((w) => typeof w !== "string")) {
      probleme.push(`"${s.id}": wurzeln ist kein Array aus Strings`);
      continue;
    }
    for (const w of s.wurzeln) {
      // Nur schlichte Namen: Regex-Metazeichen würden das abgeleitete Muster verfälschen, eine leere Wurzel träfe alles.
      if (!/^[a-z0-9][a-z0-9-]*$/.test(w)) probleme.push(`"${s.id}": ungültige Wurzel ${JSON.stringify(w)} (leer oder mit Sonderzeichen)`);
      else if (wurzelBesitzer.has(w) && wurzelBesitzer.get(w) !== s.id) probleme.push(`Wurzel "${w}" steht in zwei Schichten ("${wurzelBesitzer.get(w)}" und "${s.id}")`);
      else wurzelBesitzer.set(w, s.id);
    }
  }
  for (const s of schichten) {
    if (!Array.isArray(s.darf)) probleme.push(`"${s.id}": darf ist keine Liste`);
    else for (const z of s.darf) if (!ids.has(z)) probleme.push(`"${s.id}" darf unbekanntes Ziel "${z}" importieren`);
  }
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
 *  `test/harness/coverage-config.test.ts` bindet beide Formen aneinander: für jede echte Quelldatei greift genau ein
 *  Glob, und er stimmt mit `layerOf` (der RegExp-Wahrheit) überein.
 *
 *  Der Auffang-Glob ist bewusst ZWEIGETEILT (`{!(nd)/**,!(ndTs)}`), nicht `<wurzel>!(nd)/**`: picomatch rendert
 *  `!(…)` als PRÄFIX-Lookahead, der nicht an die Segmentgrenze verankert ist; `uieval.ts` fiele wegen `ui` still
 *  aus dem Auffang-Bucket. Der Datei-Zweig `!(ndTs)` negiert stattdessen die vollständigen Datei-Token (`ui.ts`),
 *  der Verzeichnis-Zweig `!(nd)/**` deckt Unterordner ab. Rest-Grenze: ein künftiger Auffang-Ordner mit
 *  reserviertem Präfix träfe denselben Effekt; er fällt aber nicht still durch, sondern lässt die Bindung an echte
 *  Dateien in `test/harness/coverage-config.test.ts` rot laufen. Setzt `.ts`-Quellen voraus. */
function coverageGlobsAus(modell) {
  const nonDomain = wurzelnAusserAuffangAus(modell);
  const nd = nonDomain.join("|");
  const ndTs = nonDomain.map((n) => `${n}.ts`).join("|");
  const q = modell.quellwurzel;
  const auffang = modell.schichten.find((s) => s.muster === null);
  const globVon = (s) => `${q}{${s.wurzeln.join(",")}}${s.nurDatei ? ".ts" : "{.ts,/**}"}`;
  return {
    ...Object.fromEntries(modell.schichten.filter((s) => s.wurzeln.length > 0).map((s) => [s.id, globVon(s)])),
    [auffang.id]: `${q}{!(${nd})/**,!(${ndTs})}`,
  };
}

const D_TS = "\\.d\\.ts$";

/** Pfad-Muster einer Schicht als dependency-cruiser-Bedingung; die Auffang-Schicht ist „Quellwurzel ohne alle anderen". */
function bedingung(modell, ziel, alsQuelle) {
  const andere = modell.schichten.filter((s) => s.muster && s.id !== ziel.id).map((s) => s.muster);
  if (ziel.muster) return alsQuelle ? { path: ziel.muster, pathNot: D_TS } : { path: ziel.muster };
  return { path: `^${modell.quellwurzel}`, pathNot: [...andere, ...(alsQuelle ? [D_TS] : [])].join("|") };
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

module.exports = { musterAus, pruefeModell, layerOfAus, wurzelnAusserAuffangAus, coverageGlobsAus, verbotsRegeln };
