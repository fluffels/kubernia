// Projektwert-Stellen (ADR 0022 F3f, factory#162 L32): Marker-Blöcke und Frontmatter-Zeilen, deren Wert aus der Projekt-Config kommt:
// Stellen finden, leeren, rendern, mit der Config abgleichen und die Platzhalter-Regel prüfen. Rein, ohne Dateizugriff.
// Ausgelagert aus `besitz-lib.mjs`, das `leereProjektwerte` für den Einheiten-Hash braucht (eine Richtung: besitz-lib importiert dieses Modul, nie umgekehrt).
// Importe: nur `projekt-config-lib.mjs` (`PROJEKT_CONFIG`) und `projekt-config-bloecke.mjs` (`NULLBARER_SKILL`). Der Lauf über die Prüf-Fläche steht in `projektwert-lauf.mjs`.
import { PROJEKT_CONFIG } from "./projekt-config-lib.mjs";
import { NULLBARER_SKILL } from "./projekt-config-bloecke.mjs";

export const PROJEKTWERT_START = "<!-- factory:projektwerte:start -->";
export const PROJEKTWERT_ENDE = "<!-- factory:projektwerte:end -->";
export const PROJEKTWERT_KENNUNG = "factory:projektwert";
const PROJEKTWERT_ZEILE = /^# factory:projektwert (\S+)$/;
const PROJEKTWERT_FOLGE = /^(\s*)([A-Za-z_][\w-]*):/;
/** Gruppen der Block-Tabelle und der Platzhalter (Werte sind Texte). */
export const TABELLEN_GRUPPEN = ["praefixe", "agenten", "labels", "skills"];
/** Gruppen, die ein Zeilen-Marker nutzen darf: die Tabellen-Gruppen und `codeql` (Liste der Sprachen, factory#119). */
export const PROJEKTWERT_GRUPPEN = [...TABELLEN_GRUPPEN, "codeql"];
/** Muster für `<gruppe.schluessel>`-Platzhalter der Projektwert-Gruppen; frische Instanz (Flag `g`, eigener `lastIndex`) je Aufruf. */
export function platzhalterMuster() {
  return new RegExp(`<(${TABELLEN_GRUPPEN.join("|")})\\.(\\w+)>`, "g");
}
const YAML_BLANK = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const CONFIG_PFAD = PROJEKT_CONFIG;

/** Ende des führenden Frontmatters (Zeilenindex), `-1` ohne Frontmatter; eine YAML-Datei ist als Ganzes Marker-Fläche (der Marker steht in Spalte 0). */
function frontmatterEnde(zeilen, pfad) {
  if (/\.ya?ml$/.test(pfad)) return zeilen.length;
  return zeilen[0].trimEnd() === "---" ? zeilen.findIndex((z, i) => i > 0 && z.trimEnd() === "---") : -1;
}

/** Prüft Zeile `i` auf einen Zeilen-Marker: `null` (keiner), `{ fehler }` (Meldung ohne Ort) oder `{ stelle }`. */
function zeilenMarker(zeilen, i, fmEnde) {
  const m = PROJEKTWERT_ZEILE.exec(zeilen[i].trimEnd());
  if (m === null) {
    return zeilen[i].trim().startsWith("# " + PROJEKTWERT_KENNUNG) ? { fehler: "kaputter Projektwert-Zeilen-Marker (erwartet `# factory:projektwert <schlüssel>` allein auf der Zeile, ohne Einrückung)" } : null;
  }
  const folge = i + 1 < zeilen.length ? PROJEKTWERT_FOLGE.exec(zeilen[i + 1]) : null;
  if (!PROJEKTWERT_GRUPPEN.includes(m[1].split(".")[0])) return { fehler: `unbekannte Projektwert-Gruppe in '${m[1]}' (erlaubt: ${PROJEKTWERT_GRUPPEN.join(", ")})` };
  if (i >= fmEnde) return { fehler: "Projektwert-Zeilen-Marker steht außerhalb des führenden Frontmatters" };
  if (folge === null) return { fehler: "auf den Projektwert-Zeilen-Marker muss im Frontmatter eine Zeile `schlüssel:` folgen" };
  return { stelle: { marker: i, folge: i + 1, schluessel: m[1], einrueckung: folge[1], name: folge[2] } };
}

/** Stellen eines LF-Textes: `{ bloecke: [{ start, ende }], zeilen: [{ marker, folge, schluessel, einrueckung, name }] }` (Zeilenindizes ab 0).
 *  Ein Markdown-Marker zählt nur allein auf seiner Zeile, ein Zeilen-Marker nur im führenden Frontmatter direkt vor einer `key:`-Zeile.
 *  Wirft mit allen Funden (`pfad:zeile: ...`) bei Start ohne Ende, Ende ohne Start, verschachteltem Start und kaputtem Zeilen-Marker. */
export function projektwertStellen(text, pfad = "<text>") {
  const zeilen = text.split("\n");
  const fmEnde = frontmatterEnde(zeilen, pfad);
  const fehler = [];
  const bloecke = [];
  const stellen = [];
  let offen = -1;
  const melde = (i, msg) => fehler.push(`${pfad}:${i + 1}: ${msg}`);
  for (let i = 0; i < zeilen.length; i++) {
    const t = zeilen[i].trim();
    if (t === PROJEKTWERT_START) {
      if (offen >= 0) melde(i, `Projektwert-Block beginnt, obwohl der Block ab Zeile ${offen + 1} noch offen ist`);
      else offen = i;
    } else if (t === PROJEKTWERT_ENDE) {
      if (offen < 0) melde(i, "Projektwert-Block endet ohne Start");
      else {
        bloecke.push({ start: offen, ende: i });
        offen = -1;
      }
    } else {
      const r = zeilenMarker(zeilen, i, fmEnde);
      if (r?.fehler !== undefined) melde(i, r.fehler);
      else if (r !== null) stellen.push(r.stelle);
    }
  }
  if (offen >= 0) melde(offen, "Projektwert-Block hat kein Ende");
  if (fehler.length > 0) throw new Error(fehler.join("\n"));
  return { bloecke, zeilen: stellen };
}

/** Text mit geleerten Projektwerten (Block-Rumpf entfernt, Wert der Frontmatter-Zeile entfernt). Wirft wie `projektwertStellen`. */
export function leereProjektwerte(text, pfad = "<text>") {
  if (!text.includes(PROJEKTWERT_KENNUNG)) return text;
  const st = projektwertStellen(text, pfad);
  const zeilen = text.split("\n");
  for (const z of st.zeilen) zeilen[z.folge] = `${z.einrueckung}${z.name}:`;
  for (const b of [...st.bloecke].reverse()) zeilen.splice(b.start + 1, b.ende - b.start - 1);
  return zeilen.join("\n");
}

/** Der eine Projektwert, der `null` sein darf (kein Abschluss-Skill, factory#139); in der Tabelle steht `—`. */
const NULLBARER_PROJEKTWERT = `skills.${NULLBARER_SKILL}`;

/** Wert zum Schlüssel (`gruppe.name`) aus der Config; wirft bei fehlendem oder nicht-textlichem Wert und bei Zeichen, die den Block brechen. */
export function projektwertWert(config, schluessel) {
  const wert = schluessel.split(".").reduce((o, k) => (o !== null && typeof o === "object" ? o[k] : undefined), config);
  if (wert === null && schluessel === NULLBARER_PROJEKTWERT) return null;
  const liste = Array.isArray(wert) && wert.length > 0 && wert.every((w) => typeof w === "string" && w !== "");
  if (!liste && (typeof wert !== "string" || wert === "")) {
    throw new Error(`Projektwert '${schluessel}' fehlt oder ist kein nichtleerer Text (oder keine nicht leere Liste von Texten) in ${CONFIG_PFAD}\nFix: Schlüssel in ${CONFIG_PFAD} ergänzen oder den Marker korrigieren`);
  }
  if ((liste ? wert : [wert]).some((w) => /[`|\r\n]/.test(w))) {
    throw new Error(`Projektwert '${schluessel}' enthält Backtick, '|' oder Zeilenumbruch und lässt sich nicht einsetzen\nFix: Wert in ${CONFIG_PFAD} ändern`);
  }
  return wert;
}

const tabellenWert = (w) => (w === null ? "—" : `\`${w}\``);

function blockZeilen(config) {
  const kopf = `Projektwerte aus \`${CONFIG_PFAD}\` (generiert von \`node scripts/projektwerte.mjs --write\`, nicht von Hand ändern).`;
  const out = [PROJEKTWERT_START, kopf, "", "| Schlüssel | Wert |", "| --- | --- |"];
  for (const g of TABELLEN_GRUPPEN) {
    if (config?.[g] === null || typeof config?.[g] !== "object") {
      throw new Error(`Projektwert-Gruppe '${g}' fehlt in ${CONFIG_PFAD}\nFix: Gruppe in ${CONFIG_PFAD} ergänzen`);
    }
    for (const k of Object.keys(config[g])) out.push(`| \`${g}.${k}\` | ${tabellenWert(projektwertWert(config, `${g}.${k}`))} |`);
  }
  out.push(PROJEKTWERT_ENDE);
  return out;
}

const YAML_WORT = /^(true|false|null|yes|no|on|off|y|n|~|[0-9].*)$/i;
const yamlSkalar = (w) => (YAML_BLANK.test(w) && !YAML_WORT.test(w) ? w : JSON.stringify(w));
const yamlWert = (w) => (Array.isArray(w) ? `[${w.map(yamlSkalar).join(", ")}]` : yamlSkalar(w));
const zeilenSoll = (z, config) => `${z.einrueckung}${z.name}: ${yamlWert(projektwertWert(config, z.schluessel))}`;
const mitOrt = (pfad, zeile, fn) => {
  try {
    return fn();
  } catch (err) {
    throw new Error(`${pfad}:${zeile + 1}: ${err.message}`, { cause: err });
  }
};
const holeConfig = (config) => (typeof config === "function" ? config() : config);

/** Rendert alle Projektwert-Stellen aus der Config (Wert oder Funktion, die erst bei einer Stelle gerufen wird). Text ohne Stellen bleibt gleich. */
export function rendereProjektwerte(text, config, pfad = "<text>") {
  if (!text.includes(PROJEKTWERT_KENNUNG)) return text;
  const st = projektwertStellen(text, pfad);
  if (st.bloecke.length + st.zeilen.length === 0) return text;
  const cfg = holeConfig(config);
  const ersetze = [
    ...st.zeilen.map((z) => ({ von: z.folge, bis: z.folge + 1, neu: [mitOrt(pfad, z.folge, () => zeilenSoll(z, cfg))] })),
    ...st.bloecke.map((b) => ({ von: b.start, bis: b.ende + 1, neu: mitOrt(pfad, b.start, () => blockZeilen(cfg)) })),
  ].sort((a, b) => b.von - a.von);
  const zeilen = text.split("\n");
  for (const r of ersetze) zeilen.splice(r.von, r.bis - r.von, ...r.neu);
  return zeilen.join("\n");
}

/** Abweichungen der Projektwert-Stellen von der Config (`pfad:zeile: ...`, leer = in Ordnung). Wirft bei kaputtem Marker oder fehlendem Wert. */
export function projektwertAbweichungen(pfad, text, config) {
  if (!text.includes(PROJEKTWERT_KENNUNG)) return [];
  const st = projektwertStellen(text, pfad);
  if (st.bloecke.length + st.zeilen.length === 0) return [];
  const cfg = holeConfig(config);
  const zeilen = text.split("\n");
  const out = [];
  for (const z of st.zeilen) {
    const soll = mitOrt(pfad, z.folge, () => zeilenSoll(z, cfg));
    if (zeilen[z.folge].trimEnd() !== soll) out.push(`${pfad}:${z.folge + 1}: Projektwert '${z.schluessel}' weicht von ${CONFIG_PFAD} ab (erwartet \`${soll}\`)`);
  }
  for (const b of st.bloecke) {
    const soll = mitOrt(pfad, b.start, () => blockZeilen(cfg));
    const ist = zeilen.slice(b.start, b.ende + 1).map((l) => l.trimEnd());
    if (ist.join("\n") !== soll.join("\n")) out.push(`${pfad}:${b.start + 1}: Projektwert-Block weicht von ${CONFIG_PFAD} ab`);
  }
  return out;
}

/**
 * Befunde der Platzhalter-Regel (leer = in Ordnung): ein Platzhalter `<gruppe.schlüssel>` in `text` braucht genau einen Projektwert-Block
 * in derselben Datei, und sein Schlüssel löst in `config` auf. Pur; die Muster steuert `platzhalterMuster`.
 */
export function platzhalterBefunde(pfad, text, config) {
  const treffer = [...text.matchAll(platzhalterMuster())];
  if (treffer.length === 0) return [];
  const out = [];
  const bloecke = projektwertStellen(text, pfad).bloecke.length;
  if (bloecke !== 1) out.push(`${pfad}: ${treffer.length} Platzhalter, aber ${bloecke} Projektwert-Blöcke (genau einer verlangt)`);
  for (const schluessel of new Set(treffer.map((m) => `${m[1]}.${m[2]}`))) {
    try {
      projektwertWert(config, schluessel);
    } catch {
      out.push(`${pfad}: Platzhalter <${schluessel}> löst in der Config nicht auf`);
    }
  }
  return out;
}
