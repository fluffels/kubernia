// Prüfungen und Lock-Auszug des Export-Werkzeugs (ADR 0022 F10, Teil 7a, #1923). Einmalig: das Werkzeug samt dieser Bibliothek entfällt mit K9 (#1882).
// Alles pur: Eingaben sind Maps `Pfad -> Text` und geparste Configs, Ausgaben Befund-Listen und Zählungen; geschrieben wird hier nichts.
//
// Bekannte Muster (Grenzen, fail-open): Importe erkennt `importeAus` auf dem Text ohne Kommentare (ein dynamischer Pfad bleibt unsichtbar); ein in der Quelle schon
// unauflösbarer Importtext und ein Paketname, den kubernia nicht kennt, sind nur in `*.test.ts` Fixture-Rauschen (gezählt), sonst ein Befund. Skriptbezüge sind Treffer
// von `scripts/<name>.mjs|cjs|js` ohne Platzhalter; lokale Pfade die Treffer von `pfadBefunde`, durchgelassene Zeilen zählt der Bericht je Muster (eine Zeile kann
// mehrere Muster treffen); kubernia-Literale die Begriffe der Config (`begriffeAus`), die kein Projektliteral der Factory sind und deren Regex in beiden Configs
// verschieden ist, als ganze Wörter (Buchstaben und Ziffern grenzen ab, `_` nicht), je Fundstelle einmal, Projektliterale zuerst. Der Kern-Wächter zählt die rohen
// Regex-Treffer derselben Begriffe (Owner, Repo, Präfixe, Label und Agent ohne Wortgrenze, ein Teilwort trifft dort); das Werkzeug ist enger, damit ein Teilwort wie `kuberniaartig` keinen Export verhindert.
import { builtinModules } from "node:module";
import { escapeRegex } from "./ticket-namen.mjs";
import { posix } from "node:path";
import { begriffeAus, PROJEKT_BLOCK_ENDE, PROJEKT_BLOCK_START } from "./besitz-lib.mjs";
import { importeAus, relativeImporte, schutzlistenMuster, trifftLeitplanke, zielDatei } from "./besitz-extraktion.mjs";
import { isCheckable } from "./check-basis.mjs";
import { collectHeadingSlugs, linkStellen, linkZiel, parseNpmRunMentions } from "./docs-gen/markdown.mjs";
import { pfadBefunde } from "./internalrefs-lib.mjs";

const CODE_DATEI = /\.(?:mjs|cjs|js|ts)$/;
const BUILTINS = new Set(builtinModules);
const PAKET_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const ABHAENGIGKEITS_ARTEN = ["dependencies", "devDependencies", "optionalDependencies"];

/** Sortierte Schlüsselliste ohne Doppelte. */
const namen = (pkg) => [...new Set(ABHAENGIGKEITS_ARTEN.flatMap((art) => Object.keys(pkg?.[art] ?? {})))];

/** Auflösung `name` von `von` aus nach Node-Art: erst `<von>/node_modules/<name>`, dann hinauf bis zur Wurzel; `null` ohne Treffer. */
function aufloesen(packages, von, name) {
  let basis = von;
  for (;;) {
    const kandidat = basis === "" ? `node_modules/${name}` : `${basis}/node_modules/${name}`;
    if (Object.hasOwn(packages, kandidat)) return kandidat;
    if (basis === "") return null;
    const i = basis.lastIndexOf("node_modules/");
    basis = i <= 0 ? "" : basis.slice(0, i - 1);
  }
}

/**
 * Schreibt den Commit-Zeilen-Präfix (`KQ-`) in `text` auf den der Factory-Config um, aber nur vor einem Großbuchstaben (`KQ-Review:`, `KQ-Diffsize-Override`).
 * Teilwörter (`XKQ-A`), Zahlen (`KQ-123`), Kleinschreibung (Branch- und Worktree-Präfix) und der nackte Präfix bleiben stehen. Rückgabe `{ text, anzahl }`.
 */
export function schreibePraefixUm(text, von, nach) {
  const re = new RegExp(`(?<![\\w-])${escapeRegex(von)}(?=[A-ZÄÖÜ])`, "g");
  let anzahl = 0;
  const neu = text.replace(re, () => {
    anzahl++;
    return nach;
  });
  return { text: neu, anzahl };
}

/** Wird die Markdown-Datei vom Doku-Drift-Wächter gelesen? Nicht unter `node_modules`, unter `.claude/` nur `agents`, `skills`, `workflows` (die versionierten Ordner). */
const KOMMANDO_GELESEN = (pfad) => pfad.endsWith(".md") && !pfad.split("/").includes("node_modules") && (!pfad.startsWith(".claude/") || /^\.claude\/(?:agents|skills|workflows)\//.test(pfad));

/**
 * Kommando-Prüfung (Teil 7b-8, #1936): jede Nennung `npm run <x>` und `npm test` in den Markdown-Dateien des Exports muss ein Skript der Vorlage-package.json
 * (`skripte`, Menge der Namen) sein, sonst ist sie ein Befund (die Quelle trägt Projekt-Kommandos, die im Factory-Repo nicht existieren). Rückgabe `{ befunde }`.
 */
export function pruefeKommandos(texte, skripte) {
  const befunde = [];
  for (const [pfad, text] of texte) {
    if (!KOMMANDO_GELESEN(pfad)) continue;
    for (const name of [...parseNpmRunMentions(text)].sort()) {
      if (!skripte.has(name)) befunde.push(`${pfad}: Kommando \`npm run ${name}\` steht nicht in der package.json des Exports`);
    }
  }
  return { befunde };
}

/**
 * Schreibt Agenten-Namen in `text` um (Teil 7b-8, #1936): `paare` sind `[von, nach]`, ein Paar mit gleichen Werten entfällt. Nur ganze Wörter
 * (davor und dahinter weder Buchstabe, Ziffer, `_` noch `-`, so bleiben `x-<von>` und `<von>-x` stehen), in einem Durchgang, damit ein neuer Name nie
 * ein zweites Mal trifft. Rückgabe `{ text, anzahl }`. Grenze: der Rollenname des Ticket-Skills ist kein Paar (er ist zugleich der Spielname).
 */
export function schreibeRollenUm(text, paare) {
  const aktiv = new Map(paare.filter(([von, nach]) => von !== nach && von !== ""));
  if (aktiv.size === 0) return { text, anzahl: 0 };
  const re = new RegExp(`(?<![\\w-])(?:${[...aktiv.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join("|")})(?![\\w-])`, "g");
  let anzahl = 0;
  const neuerText = text.replace(re, (treffer) => {
    anzahl++;
    return aktiv.get(treffer);
  });
  return { text: neuerText, anzahl };
}

/**
 * Streicht die Projekt-Blöcke einer Factory-Seite (Teil 7b-8, #1936): jede Zeile von der Marker-Zeile `PROJEKT_BLOCK_START` bis `PROJEKT_BLOCK_ENDE` (beide eingeschlossen,
 * beide allein auf ihrer Zeile) entfällt, mehrere Blöcke sind erlaubt. Bleibt dort eine doppelte Leerzeile, entfällt eine. Rückgabe `{ text, bloecke, befunde }`:
 * Zahl der gestrichenen Blöcke; Befunde bei Start ohne Ende, Ende ohne Start, verschachteltem Start und einem Marker, der nicht allein auf seiner Zeile steht
 * (der Text bleibt dann unverändert nutzbar, der Aufrufer bricht den Export ab).
 */
export function streicheProjektBloecke(text) {
  const befunde = [];
  const zeilen = text.split("\n");
  const aus = [];
  let offen = -1;
  let bloecke = 0;
  let nachBlock = false;
  zeilen.forEach((zeile, i) => {
    const marke = zeile.trim();
    if (marke === PROJEKT_BLOCK_START) {
      if (offen >= 0) befunde.push(`Projekt-Block in Zeile ${i + 1} beginnt vor dem Ende des Blocks aus Zeile ${offen + 1}`);
      else offen = i;
    } else if (marke === PROJEKT_BLOCK_ENDE) {
      if (offen < 0) befunde.push(`Projekt-Block-Ende in Zeile ${i + 1} ohne Start`);
      else {
        offen = -1;
        bloecke++;
        nachBlock = aus.length > 0 && aus[aus.length - 1].trim() === "";
      }
    } else if (zeile.includes(PROJEKT_BLOCK_START) || zeile.includes(PROJEKT_BLOCK_ENDE)) {
      befunde.push(`Projekt-Block-Marker in Zeile ${i + 1} steht nicht allein auf seiner Zeile`);
    } else if (offen < 0) {
      if (nachBlock && marke === "") return;
      nachBlock = false;
      aus.push(zeile);
    }
  });
  if (offen >= 0) befunde.push(`Projekt-Block ab Zeile ${offen + 1} ohne Ende`);
  return { text: aus.join("\n"), bloecke, befunde };
}

/**
 * Entlinkt eine Factory-Seite (Teil 7b-7, #1935): ein Link auf ein Ziel, das im Export fehlt (`gibt(pfad)` verneint; Datei oder Ordner), wird zu seinem Text
 * (`[t](x)` zu `t`, `![alt](x)` zu `alt`); ein Anker, den die Überschriften des Ziels (`ueberschriften(pfad)`, `null` für kein Markdown) nicht kennen,
 * wird gestrichen und der Link bleibt, ein toter Anker auf die eigene Seite macht den Link zum Text. Code-Bereiche, externe Links und lebende Links bleiben.
 * Rückgabe `{ text, links, anker, ziele }`: Zahl entlinkter Links, Zahl gestrichener Anker und Ziel zu Anzahl der entlinkten Links.
 */
export function entlinke(text, seitePfad, { gibt, ueberschriften }) {
  const eigene = new Set(collectHeadingSlugs(text));
  const ziele = new Map();
  let links = 0;
  let anker = 0;
  let neu = text;
  for (const s of linkStellen(text).reverse()) {
    const ziel = s.path === "" ? seitePfad : linkZiel(seitePfad, s.path);
    let ersatz = null;
    if (s.path !== "" && !gibt(ziel)) {
      links++;
      ziele.set(ziel, (ziele.get(ziel) ?? 0) + 1);
      ersatz = s.text;
    } else if (s.anchor !== "") {
      const heads = s.path === "" ? eigene : ueberschriften(ziel);
      if (heads && !heads.has(s.anchor)) {
        anker++;
        if (s.path === "") ersatz = s.text;
        else {
          const orig = text.slice(s.start, s.ende);
          const i = orig.indexOf("](");
          ersatz = orig.slice(0, i) + orig.slice(i).replace(s.target, () => s.path);
        }
      }
    }
    if (ersatz !== null) neu = neu.slice(0, s.start) + ersatz + neu.slice(s.ende);
  }
  return { text: neu, links, anker, ziele: new Map([...ziele].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) };
}

/**
 * Lock-Auszug (Auftrag: `package-lock.json` des Factory-Repos als Auszug aus dem Lock von kubernia). Die Wurzel kommt aus `pkg` (der Vorlage),
 * die Hülle ist alles, was von den Wurzel-Abhängigkeiten über `dependencies`, `optionalDependencies` und `peerDependencies` erreichbar ist; die
 * Reihenfolge der Quelle und alle Flags bleiben. Rückgabe `{ lock, befunde }`: ein fehlendes Pflichtziel (Wurzel-Abhängigkeit oder `dependencies`
 * eines Eintrags) ist ein Befund, ein fehlendes optionales oder Peer-Ziel wird übersprungen.
 */
export function lockAuszug(lock, pkg) {
  const befunde = [];
  const packages = lock?.packages;
  if (packages === null || typeof packages !== "object") return { lock: null, befunde: ["Lock: keine packages"] };
  const erreicht = new Set([""]);
  const offen = [];
  const besuche = (von, name, pflicht, herkunft) => {
    const ziel = aufloesen(packages, von, name);
    if (ziel === null) {
      if (pflicht) befunde.push(`Lock: '${name}' (${herkunft}) hat keinen Eintrag`);
      return;
    }
    if (!erreicht.has(ziel)) {
      erreicht.add(ziel);
      offen.push(ziel);
    }
  };
  for (const art of ABHAENGIGKEITS_ARTEN) for (const name of Object.keys(pkg?.[art] ?? {})) besuche("", name, art !== "optionalDependencies", "Wurzel");
  while (offen.length > 0) {
    const pfad = offen.pop();
    const eintrag = packages[pfad];
    for (const name of Object.keys(eintrag.dependencies ?? {})) besuche(pfad, name, true, pfad);
    for (const name of Object.keys(eintrag.optionalDependencies ?? {})) besuche(pfad, name, false, pfad);
    for (const name of Object.keys(eintrag.peerDependencies ?? {})) besuche(pfad, name, false, pfad);
  }
  const wurzel = { name: pkg.name, version: pkg.version };
  for (const art of ABHAENGIGKEITS_ARTEN) if (pkg[art] !== undefined) wurzel[art] = pkg[art];
  if (pkg.engines !== undefined) wurzel.engines = pkg.engines;
  const neu = {};
  for (const [pfad, eintrag] of Object.entries(packages)) {
    if (pfad === "") neu[""] = wurzel;
    else if (erreicht.has(pfad)) neu[pfad] = eintrag;
  }
  if (!Object.hasOwn(neu, "")) neu[""] = wurzel;
  return { lock: { name: pkg.name, version: pkg.version, lockfileVersion: lock.lockfileVersion, requires: lock.requires, packages: neu }, befunde };
}

/** Paketname eines Importspezifizierers (`vitest/config` -> `vitest`, `@a/b/c` -> `@a/b`); `null` bei einem Pfad, `node:`-Import, Builtin oder Text, der kein Paketname ist. */
export function paketName(spec) {
  if (/^[./]/.test(spec) || spec.startsWith("node:")) return null;
  const teile = spec.split("/");
  const name = spec.startsWith("@") ? teile.slice(0, 2).join("/") : teile[0];
  if (BUILTINS.has(name)) return null;
  return PAKET_NAME.test(name) ? name : `?${spec}`;
}

/** Text ohne Block- und Zeilenkommentare (ein Durchlauf von links nach rechts, damit ein `/*` im Zeilenkommentar keinen Scheinblock öffnet): ein Import, der nur als Beispiel in einem Kommentar steht, ist keiner. Grenzen: ein `//` direkt nach `:`, Anführungszeichen, Backtick oder Backslash gilt nicht als Kommentar (URL im String); es gibt keinen String-Kontext (ein Blockanfang in einem String kann bis zum nächsten Blockende Text verschlucken). */
const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/.*$/gm, (treffer, davor) => (treffer.startsWith("/*") ? "" : davor));

/** Testdateien: nur dort kann ein Importtext Fixture sein (ein Import in einem String oder Template); in jeder anderen Code-Datei ist ein nicht auflösbarer Import ein Befund. */
export const FIXTURE_TOLERIERT = /\.test\.ts$/;

/**
 * Relative Importe aller Code-Dateien: Befund, wenn der Import im Export nicht auflöst. Ist er auch in der Quelle nicht auflösbar, ist er in einer Testdatei
 * Fixture-Text und wird gezählt, in jeder anderen Code-Datei (Skript, Lib, Konfiguration, Test-Hilfe) ein Befund.
 */
export function pruefeRelativeImporte(dateien, quellPfade) {
  const exportPfade = new Set(dateien.keys());
  const befunde = [];
  let unaufloesbar = 0;
  for (const [pfad, text] of dateien) {
    if (!CODE_DATEI.test(pfad)) continue;
    for (const spec of relativeImporte(ohneKommentare(text))) {
      if (zielDatei(pfad, spec, exportPfade) !== null) continue;
      const q = zielDatei(pfad, spec, quellPfade);
      if (q === null && FIXTURE_TOLERIERT.test(pfad)) unaufloesbar++;
      else if (q === null) befunde.push(`${pfad}: relativer Import '${spec}' löst weder im Export noch in der Quelle auf`);
      else befunde.push(`${pfad}: relativer Import '${spec}' löst im Export nicht auf (in der Quelle: ${q})`);
    }
  }
  return { befunde, unaufloesbar };
}

/**
 * Paket-Importe: Befund, wenn ein Paket, das kubernia kennt, nicht in der Vorlage steht; Befund auch für eine Vorlagen-Abhängigkeit, die kubernia nicht
 * hat oder mit anderer Range führt. Unbekannte Namen sind in Testdateien Fixture-Text (gezählt), sonst ein Befund; Builtins zählen nicht; die unbekannten Namen kommen sortiert zurück.
 */
export function pruefePaketImporte(dateien, kubPkg, vorlagePkg) {
  const kub = new Set(namen(kubPkg));
  const vorlage = new Set(namen(vorlagePkg));
  const befunde = [];
  const unbekannt = new Set();
  for (const [pfad, text] of dateien) {
    if (!CODE_DATEI.test(pfad)) continue;
    for (const spec of importeAus(ohneKommentare(text))) {
      const name = paketName(spec);
      if (name === null || vorlage.has(name)) continue;
      if (kub.has(name)) befunde.push(`${pfad}: Paket '${name}' steht nicht in der package.json-Vorlage`);
      else if (FIXTURE_TOLERIERT.test(pfad)) unbekannt.add(name);
      else befunde.push(`${pfad}: Paket '${name}' steht weder in der package.json-Vorlage noch in kubernia`);
    }
  }
  const range = (pkg, name) => ABHAENGIGKEITS_ARTEN.map((art) => pkg?.[art]?.[name]).find((r) => r !== undefined);
  for (const name of vorlage) {
    if (!kub.has(name)) befunde.push(`package.json-Vorlage: '${name}' steht in kubernia nicht (kein Lock-Eintrag ableitbar)`);
    else if (range(kubPkg, name) !== range(vorlagePkg, name)) befunde.push(`package.json-Vorlage: '${name}' hat die Range ${range(vorlagePkg, name)}, kubernia ${range(kubPkg, name)}`);
  }
  return { befunde, unbekannt: [...unbekannt].sort() };
}

const SKRIPT_BEZUG = /\bscripts\/[\w./-]+?\.(?:mjs|cjs|js)\b/g;

/** Skriptbezüge in `package.json`, `.claude/settings.json` und den Workflows: jeder genannte Skriptpfad muss im Export liegen. */
export function pruefeSkriptBezuege(dateien) {
  const befunde = [];
  for (const [pfad, text] of dateien) {
    if (pfad !== "package.json" && pfad !== ".claude/settings.json" && !/^\.github\/workflows\/[^/]+\.ya?ml$/.test(pfad)) continue;
    for (const bezug of new Set(text.match(SKRIPT_BEZUG) ?? [])) {
      if (!dateien.has(bezug)) befunde.push(`${pfad}: nennt ${bezug}, das nicht im Export liegt`);
    }
  }
  return { befunde };
}

// Kandidaten der Pfadregel laut Auftrag; Laufwerks- und Ordnerteil getrennt gebaut, damit der Quelltext selbst keinen lokalen Pfad ergibt.
const LAUFWERK = "[A-Za-z]:[\\\\/]+";
export const KANDIDATEN = [new RegExp(`${LAUFWERK}(?:dev|Users)(?![\\w])`), new RegExp("(?<![\\w.:/])/[a-z]/dev/"), new RegExp("(?<![\\w.:/\\\\])/Users/")];

/** Lokale Pfade: Befund ist jeder Treffer von `pfadBefunde` (mit den Repo-Namen aus `repoNamen`); Kandidatenzeilen ohne Befund (Platzhalter, Fixture-Wurzeln) werden gezählt. */
export function pruefeLokalePfade(dateien, repoNamen) {
  const dateiListe = [...dateien.keys()].filter((p) => isCheckable(p));
  const lies = (p) => dateien.get(p);
  const treffer = new Map();
  for (const repo of repoNamen) {
    for (const h of pfadBefunde(dateiListe, lies, { repo })) treffer.set(`${h.file}:${h.line}:${h.term}`, h);
  }
  const befunde = [...treffer.values()].map((h) => `${h.file}:${h.line}: lokaler Pfad (${h.term}): ${h.excerpt}`);
  const mitBefund = new Set([...treffer.values()].map((h) => `${h.file}:${h.line}`));
  let durchgelassen = 0;
  const jeMuster = KANDIDATEN.map(() => 0);
  for (const pfad of dateiListe) {
    lies(pfad).split(/\r?\n/).forEach((zeile, i) => {
      const trifft = KANDIDATEN.map((re) => re.test(zeile));
      if (!trifft.includes(true) || mitBefund.has(`${pfad}:${i + 1}`)) return;
      durchgelassen++;
      trifft.forEach((t, k) => {
        if (t) jeMuster[k]++;
      });
    });
  }
  return { befunde, durchgelassen, jeMuster };
}

/**
 * Die Begriffe, die der Export nicht tragen soll: die der kubernia-Config ohne die geteilten (kein Projektliteral der Factory und in beiden Configs
 * dieselbe Regex, z. B. Owner, Label, Board-ID, Skill), dazu die Projektliterale der Factory-Config (Spielwerte, `kubernia`, `KQ`).
 */
export function kuberniaBegriffe(kubConfig, factoryConfig) {
  const kub = begriffeAus(kubConfig);
  const fac = begriffeAus(factoryConfig);
  const literale = Object.keys(factoryConfig.projektliterale ?? {});
  const out = {};
  for (const name of literale) out[name] = fac[name];
  for (const [name, re] of Object.entries(kub)) {
    if (literale.includes(name)) continue;
    const f = fac[name];
    const geteilt = f !== undefined && f.source === re.source && f.flags === re.flags;
    if (!geteilt) out[name] = re;
  }
  return out;
}

/**
 * kubernia-Literale als ganze Wörter (ein Teilwort wie `kuberniaartig` trifft nicht): Befund je Datei und Begriff (mit Anzahl). Eine Fundstelle zählt einmal: ein Treffer, der einen
 * schon belegten Bereich überlappt, entfällt; der erste Begriff gewinnt (die Reihenfolge der Begriffe ist die Rangfolge: `kuberniaBegriffe` nennt die Projektliterale zuerst). `ausgenommen(pfad)` liefert `null` (prüfen), `"zaehlen"` (Rest je Datei im Bericht)
 * oder `"frei"` (nicht geprüft).
 */
export function pruefeLiterale(dateien, begriffe, ausgenommen) {
  const befunde = [];
  const rest = new Map();
  for (const [pfad, text] of dateien) {
    const modus = ausgenommen(pfad);
    if (modus === "frei") continue;
    const belegt = [];
    const je = new Map();
    for (const [name, re] of Object.entries(begriffe)) {
      for (const m of text.matchAll(re)) {
        const von = m.index;
        const bis = von + m[0].length;
        if (m[0] === "" || !ganzesWort(text, von, bis, m[0]) || belegt.some(([a, b]) => von < b && a < bis)) continue;
        belegt.push([von, bis]);
        je.set(name, (je.get(name) ?? 0) + 1);
      }
    }
    for (const [name, n] of je) {
      if (modus === "zaehlen") rest.set(pfad, (rest.get(pfad) ?? 0) + n);
      else befunde.push(`${pfad}: kubernia-Literal '${name}' (${n}x)`);
    }
  }
  return { befunde, rest };
}

const WORTZEICHEN = /[\p{L}\p{N}]/u;
/** Steht der Treffer `text[von, bis)` als ganzes Wort? Wortzeichen sind Buchstaben und Ziffern (ein `_` trennt: `KQ_NAME` bleibt ein Treffer des Env-Begriffs). Eine Seite prüft nur, wenn der Treffer dort mit einem Wortzeichen endet (ein Präfix wie `KQ-` grenzt rechts von selbst ab). */
function ganzesWort(text, von, bis, treffer) {
  if (WORTZEICHEN.test(treffer[0]) && von > 0 && WORTZEICHEN.test(text[von - 1])) return false;
  return !(WORTZEICHEN.test(treffer.at(-1)) && bis < text.length && WORTZEICHEN.test(text[bis]));
}

/** Ordner einer Vorlage im Quellbaum. */
export const VORLAGEN_ORDNER = ".factory/produkt/vorlagen";

/** Pfad der Vorlage zu einem Zielpfad. */
export const vorlagenPfad = (ziel) => `${VORLAGEN_ORDNER}/${ziel}.vorlage`;

/** Zielpfad einer Vorlagendatei (`null`, wenn der Pfad nicht unter dem Vorlagen-Ordner liegt oder nicht auf `.vorlage` endet). */
export const vorlagenZiel = (pfad) => (pfad.startsWith(`${VORLAGEN_ORDNER}/`) && pfad.endsWith(".vorlage") ? posix.relative(VORLAGEN_ORDNER, pfad).slice(0, -".vorlage".length) : null);

/**
 * Schutzliste im Export (#1929): `.github/protected-paths.json` und `.github/CODEOWNERS` kommen als Vorlagen; das Werkzeug prüft sie gegen die Quelle,
 * damit keine zweite Auslegung entsteht (der Treffer-Abgleich ist `trifftLeitplanke` aus `besitz-extraktion.mjs`).
 * Befunde: (a) ein Muster der Vorlage trifft keinen Exportpfad und steht nicht in `SCHUTZ_OHNE_TREFFER`; (b) ein Muster der Quelle trifft einen
 * Exportpfad, fehlt aber in der Vorlage (Drift-Schutz: ein neuer Schutz in kubernia wandert in die Vorlage); (c) die Muster der CODEOWNERS-Vorlage sind nicht
 * dieselbe Menge wie die der protected-paths-Vorlage (`harness-approval.test.ts` verlangt das im Export genauso).
 * Grenze: ein Muster ohne Treffer, das nicht in der geschlossenen Liste steht, ist immer ein Befund; ein Quell-Muster ohne Treffer darf in der Vorlage fehlen.
 */
export const SCHUTZ_OHNE_TREFFER = ["/CLAUDE.md", "/CLAUDE.local.md", "/scripts/*-mcp.mjs"];

/** Eingabe `{ vorlage, codeowners, quelle, pfade }` (Texte der beiden Vorlagen und der Quell-Liste, Pfade des Exports); Rückgabe: Liste der Befunde. */
export function pruefeSchutzliste({ vorlage, codeowners, quelle, pfade }) {
  const befunde = [];
  const vorlagenMuster = schutzlistenMuster(vorlage);
  const quellMuster = schutzlistenMuster(quelle);
  if (vorlagenMuster === null) befunde.push("protected-paths.json (Vorlage): kein gültiges JSON");
  if (quellMuster === null) befunde.push("protected-paths.json (Quelle): kein gültiges JSON");
  if (vorlagenMuster === null || quellMuster === null) return befunde;
  const treffer = (muster) => pfade.find((p) => trifftLeitplanke(p, [muster]));
  for (const m of vorlagenMuster) {
    if (treffer(m) === undefined && !SCHUTZ_OHNE_TREFFER.includes(m)) befunde.push(`protected-paths.json (Vorlage): Muster '${m}' trifft keinen Exportpfad und steht nicht in der geschlossenen Liste`);
  }
  for (const m of quellMuster) {
    const pfad = treffer(m);
    if (pfad !== undefined && !vorlagenMuster.includes(m)) befunde.push(`protected-paths.json (Vorlage): Muster '${m}' der Quelle trifft '${pfad}', fehlt aber in der Vorlage`);
  }
  const eigentuemer = new Set(codeowners.split(/\r?\n/).map((l) => l.trim().match(/^(\S+)\s+@\S+/)?.[1]).filter((m) => m !== undefined && !m.startsWith("#")));
  const vorlagenSet = new Set(vorlagenMuster);
  const nurOwners = [...eigentuemer].filter((m) => !vorlagenSet.has(m));
  const nurSchutz = [...vorlagenSet].filter((m) => !eigentuemer.has(m));
  if (nurOwners.length > 0 || nurSchutz.length > 0) {
    befunde.push(`CODEOWNERS (Vorlage): Muster weichen von protected-paths.json ab (nur in CODEOWNERS: ${nurOwners.join(", ") || "-"}; nur in protected-paths.json: ${nurSchutz.join(", ") || "-"})`);
  }
  return befunde;
}
