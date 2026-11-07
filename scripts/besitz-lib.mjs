// Besitz-Manifest-Leser und Bearbeitungs-Primitive (ADR 0022 F9): Einheiten des Besitz-Manifests `.factory/besitz.json`
// (ganze Datei, Markdown-Block zwischen Markern, JSON-Schlüssel der obersten Ebene) lesen, prüfen, hashen und setzen.
// Hash und Wächter rechnen auf dem Text mit geleerten Projektwerten (`leereProjektwerte` aus `projektwert-lib.mjs`, ADR 0022 F3f). Importe: `node:crypto`, `projekt-config-lib`, `projektwert-lib`, `modul-wahl-lib`, `sync-abgleich-lib` und `ticket-namen`; Extraktionsliste und Test-Hülle stehen in `besitz-extraktion.mjs`. Sync-Werkzeug, Drift-Gate und Kern-Wächter teilen diese eine Auslegung.
import { createHash } from "node:crypto";
import { altEnvPraefix } from "./projekt-config-lib.mjs";
import { leereProjektwerte } from "./projektwert-lib.mjs";
import { modulFehler } from "./modul-wahl-lib.mjs";
import { artFehler } from "./sync-abgleich-lib.mjs";
import { escapeRegex } from "./regex-lib.mjs";

/** Ring-Importregel (ADR 0029): Ring des Importeurs -> Ringe, deren Besitz er lokal importieren darf. Ein weiterer Ring ist eine Zeile. */
export const RING_IMPORTE = {
  kern: ["kern"],
  "kern-nach-entkopplung": ["kern", "kern-nach-entkopplung"],
  oberflaeche: ["kern", "kern-nach-entkopplung", "oberflaeche"],
};

/** Alle Ringe: die Schlüssel der Importregel (eine Quelle). */
export const RINGE = Object.keys(RING_IMPORTE);

/** Ringe, die der Factory gehören und nie in ein Projekt verteilt werden (Deny-List: ein unbekannter Ring wird geprüft und verteilt). */
export const NUR_FACTORY = ["oberflaeche"];

/** Wird die Einheit in Projekte verteilt (Sync) und dort auf Drift geprüft? */
export const wirdVerteilt = (e) => !NUR_FACTORY.includes(e.ring);

/** Ist die Einheit eine ganze Datei (kein Block, kein JSON-Schlüssel)? */
export const istGanzeDatei = (e) => e.block === undefined && e.schluessel === undefined;

export const markerStart = (id) => `<!-- factory-besitz:start ${id} -->`;
export const markerEnde = (id) => `<!-- factory-besitz:ende ${id} -->`;
/** Fehlertext-Zusatz: die erwarteten Marker-Zeilen eines Blocks. */
export const markerHinweis = (id) => `Erwartet je eine Zeile ${markerStart(id)} und ${markerEnde(id)}`;

/** Pfad des Besitz-Manifests (eine Quelle; kein Skript außerhalb dieser Lib schreibt das Literal). */
export const MANIFEST_PFAD = ".factory/besitz.json";

/** Spanne `[a, b]` des Blocks `block` (Start der Start-Marker, Start der Ende-Marker) oder `null`, wenn ein Marker fehlt oder das Ende vor dem Start steht. */
export function blockSpanne(text, block) {
  const a = text.indexOf(markerStart(block));
  const b = text.indexOf(markerEnde(block));
  return a < 0 || b < a ? null : [a, b];
}

/** Der Projekt-Block in AGENTS.md: ab dieser Marker-Zeile steht Projektinhalt, den die Verteilung nie anfasst. */
export const PROJEKT_BLOCK_START = "<!-- factory-projekt:start -->";
/** Ende des Projekt-Blocks (Gegenstück zu `PROJEKT_BLOCK_START`). */
export const PROJEKT_BLOCK_ENDE = "<!-- factory-projekt:ende -->";

/** Zeilenenden auf LF (Hash und Vergleich sind CRLF-neutral). */
export const normalisiereEol = (text) => text.replace(/\r\n/g, "\n");

/** Zeilenende-Stil eines Textes: CRLF, sobald eines vorkommt, sonst LF. */
export const eolVon = (text) => (text.includes("\r\n") ? "\r\n" : "\n");

export function einheitId(e) {
  if (e.block !== undefined) return `${e.pfad}#${e.block}`;
  if (e.schluessel !== undefined) return `${e.pfad}#/${e.schluessel}`;
  return e.pfad;
}

/** Gegenstück zu `einheitId`: `pfad`, `pfad#block` oder `pfad#/schluessel` -> Einheit (`{ pfad }`, `{ pfad, block }`, `{ pfad, schluessel }`). */
export function einheitAusId(id) {
  const i = id.indexOf("#");
  if (i < 0) return { pfad: id };
  const rest = id.slice(i + 1);
  return rest.startsWith("/") ? { pfad: id.slice(0, i), schluessel: rest.slice(1) } : { pfad: id.slice(0, i), block: rest };
}

/** Zeichenspannen `[a, b]` der Einheiten von `pfad` in `text`: ganze Datei `[0, Länge]`, Block per `blockSpanne` (erstes Marker-Vorkommen; kaputte Marker: keine Spanne), JSON-Schlüssel keine (kein Doku-Text). */
export function besitzSpannen(einheiten, pfad, text) {
  const spannen = [];
  for (const e of einheiten.filter((x) => x.pfad === pfad)) {
    if (istGanzeDatei(e)) spannen.push([0, text.length]);
    else if (e.block !== undefined) {
      const s = blockSpanne(text, e.block);
      if (s) spannen.push(s);
    }
  }
  return spannen;
}

/** Besitz-Manifest aus dem Dateitext (`null` = Datei fehlt): `{ manifest }` oder `{ fehler: "fehlt"|"json"|"eintraege", text }` mit der einheitlichen Meldung; die Fehlerpolitik bleibt beim Aufrufer. */
export function manifestAusText(text) {
  if (text === null) return { fehler: "fehlt", text: `${MANIFEST_PFAD} fehlt` };
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return { fehler: "json", text: `${MANIFEST_PFAD} ist kein gültiges JSON` };
  }
  if (!Array.isArray(manifest?.eintraege)) return { fehler: "eintraege", text: `${MANIFEST_PFAD} hat keine Liste 'eintraege'` };
  return { manifest };
}

/** Ist die Einheit eine ganze Workflow-Datei (`.github/workflows/<name>.yml|yaml`)? */
export const istWorkflowEinheit = (e) => istGanzeDatei(e) && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(e.pfad);

const zaehleVorkommen = (text, s) => text.split(s).length - 1;

/** Text der Einheit oder `null`, wenn Block/Schlüssel nicht auflösbar ist. */
export function einheitText(e, text) {
  if (e.block !== undefined) {
    const spanne = blockSpanne(text, e.block);
    return spanne ? text.slice(spanne[0], spanne[1] + markerEnde(e.block).length) : null;
  }
  if (e.schluessel !== undefined) {
    try {
      const j = JSON.parse(text);
      return e.schluessel in j ? JSON.stringify(j[e.schluessel]) : null;
    } catch {
      return null;
    }
  }
  return text;
}

/** Ein Manifest-Pfad bleibt im Projekt: relativ, Schrägstrich-Form, keine leeren oder `..`-Segmente. */
export function pfadSicher(pfad) {
  if (typeof pfad !== "string" || pfad === "" || pfad.startsWith("/") || pfad.includes("\\") || /^[A-Za-z]:/.test(pfad)) return false;
  return pfad.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/** Fehler des optionalen Felds `pflichtChecks` einer Einheit (leer = gültig oder nicht gesetzt): nur an ganzen Workflow-Dateien, eine nicht leere Liste nicht leerer Texte (die Job-Namen, die ein Bezieher als Required Check braucht, factory#117). */
export function pflichtChecksFehler(e) {
  if (e.pflichtChecks === undefined) return [];
  if (!istWorkflowEinheit(e)) return ["pflichtChecks nur an einer ganzen Workflow-Datei (.github/workflows/<name>.yml)"];
  const l = e.pflichtChecks;
  if (!Array.isArray(l) || l.length === 0 || l.some((n) => typeof n !== "string" || n.trim() === "")) return ["pflichtChecks muss eine nicht leere Liste nicht leerer Texte sein"];
  return [];
}

/** Manifest-Versionen, die dieses Werkzeug kennt (eine Quelle für Prüfung und Sync-Hinweis). */
export const MANIFEST_VERSIONEN = [1, 2, 3];
/** Ist `meldung` der Fehlertext von `pruefeManifest` zu einer unbekannten Version? */
export const versionUnbekannt = (meldung) => meldung.startsWith("version ") && meldung.includes(" unbekannt");

/** Manifest-Fehler (leer = gültig). `lies` liefert den Dateitext oder `null`. */
export function pruefeManifest(m, lies) {
  const out = [];
  // Die Prüfung von `modul` bleibt roh (`!== undefined`): sie validiert, ob der Wert ein Name ist (`modulFehler`), Wahl und Aufteilung nutzen `istModulEinheit`.
  if (!MANIFEST_VERSIONEN.includes(m.version)) out.push(`version ${String(m.version)} unbekannt (erwartet 1, 2 oder 3)`);
  else {
    if (m.version === 1 && m.eintraege.some((e) => e.art !== undefined)) out.push("art braucht version 2 (ein altes Sync-Werkzeug kennt art nicht und bräche sonst nicht ab)");
    if (m.version < 3 && m.eintraege.some((e) => e.modul !== undefined)) out.push("modul braucht version 3 (ein altes Sync-Werkzeug kennt modul nicht und verteilte sonst jedes Modul)");
  }
  const ids = new Set();
  const ganze = new Set();
  const teile = new Set();
  for (const e of m.eintraege) {
    const id = einheitId(e);
    if (!pfadSicher(e.pfad)) {
      out.push(`${id}: Pfad unsicher (absolut, '..', Backslash oder leeres Segment)`);
      continue;
    }
    if (ids.has(id)) out.push(`${id}: doppelte Einheit`);
    ids.add(id);
    if (!RINGE.includes(e.ring)) out.push(`${id}: unbekannter Ring '${e.ring}'`);
    if (e.quelle.trim() === "") out.push(`${id}: quelle fehlt`);
    if (e.block !== undefined && e.schluessel !== undefined) out.push(`${id}: block und schluessel zugleich`);
    out.push(...[...pflichtChecksFehler(e), ...artFehler(e), ...modulFehler(e)].map((f) => `${id}: ${f}`));
    if (istGanzeDatei(e)) ganze.add(e.pfad);
    else teile.add(e.pfad);
    const text = lies(e.pfad);
    if (text === null) {
      out.push(`${id}: Pfad existiert nicht`);
      continue;
    }
    if (e.block !== undefined) {
      const na = zaehleVorkommen(text, markerStart(e.block));
      const nb = zaehleVorkommen(text, markerEnde(e.block));
      if (na !== 1 || nb !== 1) out.push(`${id}: Marker müssen je genau einmal stehen (start ${na}, ende ${nb})`);
      else if (einheitText(e, text) === null) out.push(`${id}: Ende-Marker steht vor dem Start-Marker`);
    } else if (e.schluessel !== undefined && einheitText(e, text) === null) {
      out.push(`${id}: JSON-Schlüssel fehlt oder Datei ist kein gültiges JSON`);
    }
  }
  for (const p of ganze) if (teile.has(p)) out.push(`${p}: Datei ganz und als Teil-Einheit gelistet`);
  return out;
}

// ── Berechtigungs- und Sandbox-Ergänzung (#1874, #1888, ADR 0022 Fortschreibungen 1874 und 1888) ─────────────
// Die einzigen Einheiten mit Projekt-Ergänzung (Tabelle `ERGAENZBARE`): Hash und Sync rechnen auf dem Kern-Anteil (der Wert ohne die Einträge der Ergänzung),
// die Ergänzung steht je Liste als Ende der Liste. `permissions` hat die Listen allow, ask und deny (Einträge sind Strings), `sandbox` die Listen
// `network.allowedDomains` (Strings) und `credentials.envVars` (Objekte, Vergleich über `name`); eine Ergänzung sperrt oder öffnet nur, was die Befunde zulassen. Bekannte Muster der Aufhebe-Prüfung (`ergaenzungsBefunde`): ein allow-Eintrag A hebt eine
// Regel R aus deny oder ask auf, wenn A === R; wenn R eine Server-Regel `mcp__<server>` ohne Tool-Teil ist und A mit `R + "__"` beginnt;
// wenn R auf `*` endet und A mit R ohne `*` beginnt; wenn A auf `*` endet und R mit A ohne `*` beginnt (allow `mcp__*` deckt jede Regel mit dem Präfix). Grenze: andere Platzhalterformen werden nicht erkannt. Legitim bleibt die Kombination
// „allow Server-Regel, ask oder deny einzelnes Tool“.

/** Die Listen der Sandbox-Ergänzung: Schlüssel in der Ergänzung, Pfad im Wert und der Name, über den Einträge verglichen werden. */
export const SANDBOX_LISTEN = {
  allowedDomains: { pfad: ["network", "allowedDomains"], name: (x) => x },
  envVars: { pfad: ["credentials", "envVars"], name: (x) => x?.name },
};
const SANDBOX_NAMEN = Object.keys(SANDBOX_LISTEN);

/** Die Regel-Listen der Ergänzung (die Namen von Claude Code). */
export const ERGAENZUNG_LISTEN = ["allow", "ask", "deny"];

/** Eine leere Ergänzung (frisch je Aufruf): die Listen von `permissions` und der Zweig `sandbox`. */
export const leereErgaenzung = () => ({ allow: [], ask: [], deny: [], sandbox: { allowedDomains: [], envVars: [] } });

const istObjekt = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const sandboxListe = (sb, l) => {
  const [a, b] = SANDBOX_LISTEN[l].pfad;
  const v = sb?.[a]?.[b];
  return Array.isArray(v) ? v : [];
};

/** Pur: der Kern-Anteil von `sandbox`: je Liste ohne die Einträge der Ergänzung (Vergleich über den Namen); eine leere Liste und ein dadurch leerer Zweig entfallen. Ein Nicht-Objekt bleibt unverändert. */
export function kernAnteilSandbox(sb, erg) {
  if (!istObjekt(sb)) return sb;
  const aus = { ...sb };
  for (const l of SANDBOX_NAMEN) {
    const [a, b] = SANDBOX_LISTEN[l].pfad;
    if (!Array.isArray(sb[a]?.[b])) continue;
    const mit = new Set((erg?.[l] ?? []).map(SANDBOX_LISTEN[l].name));
    const rest = sb[a][b].filter((x) => !mit.has(SANDBOX_LISTEN[l].name(x)));
    const zweig = { ...aus[a] };
    if (rest.length === 0) delete zweig[b];
    else zweig[b] = rest;
    if (Object.keys(zweig).length === 0) delete aus[a];
    else aus[a] = zweig;
  }
  return aus;
}

/** Pur: Kern-Anteil von `sandbox` plus Ergänzung, je Liste hinten angehängt; fehlende Zweige werden angelegt. */
export function mitErgaenzungSandbox(kern, erg) {
  const aus = { ...kern };
  for (const l of SANDBOX_NAMEN) {
    const neu = erg?.[l] ?? [];
    if (neu.length === 0) continue;
    const [a, b] = SANDBOX_LISTEN[l].pfad;
    aus[a] = { ...aus[a], [b]: [...sandboxListe(kern, l), ...neu] };
  }
  return aus;
}

/** Pur: Befunde der Sandbox-Ergänzung gegen den zusammengesetzten Wert `sb` (leer = in Ordnung): Eintrag fehlt, steht nicht am Listenende oder doppelt (auch ein Kern-Eintrag gleichen Namens: eine Ergänzung darf ihn nicht überschreiben),
 *  eine Domain besteht nur aus Platzhaltern (öffnet jede Domain), ein envVars-Eintrag der Ergänzung sperrt nicht (`mode` ist nicht `deny`). */
export function sandboxErgaenzungsBefunde(sb, erg) {
  const out = [];
  for (const l of SANDBOX_NAMEN) {
    const neu = erg?.[l] ?? [];
    if (neu.length === 0) continue;
    const { pfad, name } = SANDBOX_LISTEN[l];
    const wo = `sandbox.${pfad.join(".")}`;
    const ist = sandboxListe(sb, l).map(name);
    const neuNamen = neu.map(name);
    const fehlend = neuNamen.filter((n) => !ist.includes(n));
    for (const n of fehlend) out.push(`${wo}: Ergänzung „${n}“ fehlt`);
    for (const n of neuNamen) {
      if (ist.filter((y) => y === n).length > 1) out.push(`${wo}: „${n}“ steht doppelt (Kern-Anteil und Ergänzung); eine Ergänzung darf einen Kern-Eintrag nicht überschreiben`);
    }
    if (fehlend.length === 0 && neuNamen.some((n, i) => ist[ist.length - neuNamen.length + i] !== n)) out.push(`${wo}: die Ergänzung muss als Ende der Liste stehen, in der Reihenfolge der Config`);
  }
  for (const d of erg?.allowedDomains ?? []) {
    if (/^[*.]+$/.test(d)) out.push(`sandbox.network.allowedDomains: Ergänzung „${d}“ erlaubt jede Domain`);
  }
  for (const v of erg?.envVars ?? []) {
    if (v?.mode !== "deny") out.push(`sandbox.credentials.envVars: Ergänzung „${v?.name}“ muss mode deny haben (eine Ergänzung sperrt nur)`);
  }
  return out;
}

/** Pur: der Kern-Anteil von `permissions`: je Liste ohne die Einträge der Ergänzung (mengenbasiert); eine leere Liste entfällt immer
 *  (leer gilt wie fehlend, sonst unterschiede sich Quelle und Ziel nur durch `ask: []`). Ein Nicht-Objekt bleibt unverändert. */
export function kernAnteil(perm, erg) {
  if (perm === null || typeof perm !== "object" || Array.isArray(perm)) return perm;
  const aus = { ...perm };
  for (const l of ERGAENZUNG_LISTEN) {
    if (!Array.isArray(perm[l])) continue;
    const mit = new Set(erg?.[l] ?? []);
    const rest = perm[l].filter((x) => !mit.has(x));
    if (rest.length === 0) delete aus[l];
    else aus[l] = rest;
  }
  return aus;
}

/** Pur: Kern-Anteil plus Ergänzung, je Liste hinten angehängt; eine fehlende Liste wird angelegt. */
export function mitErgaenzung(kern, erg) {
  const aus = { ...kern };
  for (const l of ERGAENZUNG_LISTEN) {
    const neu = erg?.[l] ?? [];
    if (neu.length > 0) aus[l] = [...(kern[l] ?? []), ...neu];
  }
  return aus;
}

/** Pur: hebt der allow-Eintrag `a` die deny- oder ask-Regel `r` auf (Muster im Kopfkommentar dieses Abschnitts)? */
function hebtAuf(a, r) {
  if (a === r) return true;
  if (r.startsWith("mcp__") && !r.slice(5).includes("__") && a.startsWith(`${r}__`)) return true;
  if (r.endsWith("*") && a.startsWith(r.slice(0, -1))) return true;
  return a.endsWith("*") && r.startsWith(a.slice(0, -1));
}

/**
 * Pur: Befunde der Ergänzung gegen den zusammengesetzten Wert `perm` (leer = in Ordnung): ein Eintrag fehlt in seiner Liste, die Ergänzung steht
 * nicht als Ende der Liste, ein Eintrag steht doppelt (auch im Kern-Anteil), oder ein allow der Ergänzung hebt ein deny oder ask auf.
 */
export function ergaenzungsBefunde(perm, erg) {
  const out = [];
  for (const l of ERGAENZUNG_LISTEN) {
    const neu = erg?.[l] ?? [];
    if (neu.length === 0) continue;
    const ist = Array.isArray(perm?.[l]) ? perm[l] : [];
    const fehlend = neu.filter((x) => !ist.includes(x));
    for (const x of fehlend) out.push(`permissions.${l}: Ergänzung „${x}“ fehlt`);
    for (const x of neu) if (ist.filter((y) => y === x).length > 1) out.push(`permissions.${l}: „${x}“ steht doppelt (Kern-Anteil und Ergänzung)`);
    if (fehlend.length === 0 && neu.some((x, i) => ist[ist.length - neu.length + i] !== x)) out.push(`permissions.${l}: die Ergänzung muss als Ende der Liste stehen, in der Reihenfolge der Config`);
  }
  const sperren = [...(perm?.deny ?? []), ...(perm?.ask ?? [])];
  for (const a of erg?.allow ?? []) {
    const r = sperren.find((s) => hebtAuf(a, s));
    if (r !== undefined) out.push(`permissions.allow: Ergänzung „${a}“ hebt die Regel „${r}“ aus deny oder ask auf`);
  }
  return out;
}

/**
 * Die Einheiten, die ein Projekt über seine Config ergänzen darf (geschlossene Tabelle, eine Zeile je Einheit): `id` ist die Einheit-Id, `block` der Config-Block mit der
 * Ergänzung, `anzahl(erg)` die Zahl ihrer Einträge (`erg` ist die gesamte Ergänzung des Projekts), `kernAnteil(wert, erg)`, `mitErgaenzung(kern, erg)` und
 * `befunde(wert, erg)` die puren Primitive. Eine weitere ergänzbare Einheit ist eine Zeile.
 */
export const ERGAENZBARE = [
  {
    id: ".claude/settings.json#/permissions",
    block: "berechtigungen",
    anzahl: (erg) => ERGAENZUNG_LISTEN.reduce((n, l) => n + (erg?.[l]?.length ?? 0), 0),
    kernAnteil: (wert, erg) => kernAnteil(wert, erg),
    mitErgaenzung: (kern, erg) => mitErgaenzung(kern, erg),
    befunde: (wert, erg) => ergaenzungsBefunde(wert, erg),
  },
  {
    id: ".claude/settings.json#/sandbox",
    block: "sandbox",
    anzahl: (erg) => SANDBOX_NAMEN.reduce((n, l) => n + (erg?.sandbox?.[l]?.length ?? 0), 0),
    kernAnteil: (wert, erg) => kernAnteilSandbox(wert, erg?.sandbox),
    mitErgaenzung: (kern, erg) => mitErgaenzungSandbox(kern, erg?.sandbox),
    befunde: (wert, erg) => sandboxErgaenzungsBefunde(wert, erg?.sandbox),
  },
];

/** Die Tabellenzeile der Einheit `e` oder `undefined` (nicht ergänzbar). */
const ergaenzbarVon = (e) => ERGAENZBARE.find((x) => x.id === einheitId(e));

/** Die Tabellenzeile der ergänzbaren Einheit `e`; eine unbekannte Einheit wirft (kein stiller Rückfall auf eine andere). */
const zeileVon = (e) => {
  const z = ergaenzbarVon(e);
  if (z === undefined) throw new Error(`${einheitId(e)}: nicht ergänzbar (Tabelle ERGAENZBARE)`);
  return z;
};

/** Ist die Einheit eine ergänzbare? */
export const istErgaenzbar = (e) => ergaenzbarVon(e) !== undefined;

/** Name des Config-Blocks (`block` der Tabelle) der ergänzbaren Einheit `e`; `undefined`, wenn sie nicht ergänzbar ist. */
export const ergaenzungsBlockVon = (e) => ergaenzbarVon(e)?.block;

/** Zahl der Einträge der Ergänzung für die Einheit `e` (alle ihre Listen). */
export const ergaenzungsAnzahlVon = (e, erg) => zeileVon(e).anzahl(erg);

/** Pur: Kern-Anteil der ergänzbaren Einheit `e` aus ihrem Wert (`erg` ist die Ergänzung des Projekts). */
export const kernAnteilVon = (e, wert, erg) => zeileVon(e).kernAnteil(wert, erg);

/** Pur: Kern-Anteil der Einheit `e` plus Ergänzung. */
export const mitErgaenzungVon = (e, kern, erg) => zeileVon(e).mitErgaenzung(kern, erg);

/** Pur: Befunde der Ergänzung der Einheit `e` gegen ihren zusammengesetzten Wert. */
export const ergaenzungsBefundeVon = (e, wert, erg) => zeileVon(e).befunde(wert, erg);

/** Einheitentext, LF-normalisiert und (außer bei JSON-Schlüsseln) mit geleerten Projektwerten; `null`, wenn die Einheit nicht
 *  auflösbar ist oder ein Projektwert-Marker kaputt ist. Grundlage für Hash und Literal-Zählung. Die ergänzbare Einheit rechnet
 *  auf dem Kern-Anteil gegen `erg` (die Ergänzung des Projekts, Standard leer). */
export function normalisierterEinheitText(e, text, erg = leereErgaenzung()) {
  const t = einheitText(e, text);
  if (t === null) return t;
  if (istErgaenzbar(e)) return JSON.stringify(kernAnteilVon(e, JSON.parse(t), erg));
  if (e.schluessel !== undefined) return t;
  try {
    return leereProjektwerte(normalisiereEol(t), e.pfad);
  } catch {
    return null;
  }
}

/** `sha256:<hex>` über den normalisierten Einheitentext, `null` wenn die Einheit nicht auflösbar ist. */
export function einheitHash(e, text, erg = leereErgaenzung()) {
  const t = normalisierterEinheitText(e, text, erg);
  if (t === null) return null;
  return `sha256:${createHash("sha256").update(normalisiereEol(t)).digest("hex")}`;
}

/** `sha256:<hex>` über einen Text, LF-normalisiert. */
export function textHash(text) {
  return `sha256:${createHash("sha256").update(normalisiereEol(text)).digest("hex")}`;
}

// ── JSON-Schlüssel der obersten Ebene als Textbereich ─────────────────────────

const WS = /\s/;

function ueberspringeWs(t, i) {
  while (i < t.length && WS.test(t[i])) i++;
  return i;
}

function stringEnde(t, i) {
  // t[i] ist das öffnende Anführungszeichen; Rückgabe: Index nach dem schließenden.
  i++;
  while (i < t.length) {
    if (t[i] === "\\") i += 2;
    else if (t[i] === '"') return i + 1;
    else i++;
  }
  throw new Error("JSON: Zeichenkette nicht abgeschlossen");
}

function wertEnde(t, i) {
  const c = t[i];
  if (c === '"') return stringEnde(t, i);
  if (c === "{" || c === "[") {
    let tiefe = 0;
    while (i < t.length) {
      const z = t[i];
      if (z === '"') {
        i = stringEnde(t, i);
        continue;
      }
      if (z === "{" || z === "[") tiefe++;
      else if (z === "}" || z === "]") tiefe--;
      i++;
      if (tiefe === 0) return i;
    }
    throw new Error("JSON: Klammer nicht abgeschlossen");
  }
  while (i < t.length && !/[\s,}\]]/.test(t[i])) i++;
  return i;
}

/** Alle Eigenschaften der obersten Ebene: `{ name, start, ende, keyStart }` (Textbereich des Werts). Wirft bei ungültigem JSON,
 *  Wurzel ohne Objekt und doppeltem Schlüssel. */
function eigenschaften(text) {
  JSON.parse(text); // wirft bei ungültigem JSON
  const start = ueberspringeWs(text, 0);
  if (text[start] !== "{") throw new Error("JSON: Wurzel ist kein Objekt");
  const out = [];
  const gesehen = new Set();
  let i = ueberspringeWs(text, start + 1);
  while (text[i] !== "}") {
    const keyStart = i;
    const keyEnde = stringEnde(text, i);
    const name = JSON.parse(text.slice(keyStart, keyEnde));
    if (gesehen.has(name)) throw new Error(`JSON: doppelter Schlüssel '${name}' auf oberster Ebene`);
    gesehen.add(name);
    i = ueberspringeWs(text, keyEnde);
    i = ueberspringeWs(text, i + 1); // ':'
    const vStart = i;
    const vEnde = wertEnde(text, i);
    out.push({ name, keyStart, start: vStart, ende: vEnde });
    i = ueberspringeWs(text, vEnde);
    if (text[i] === ",") i = ueberspringeWs(text, i + 1);
  }
  return { objStart: start, objEnde: i, eigenschaften: out };
}

/** Textbereich `{ start, ende }` des Werts von `schluessel` oder `null`, wenn er fehlt. */
export function jsonSchluesselSpanne(text, schluessel) {
  const p = eigenschaften(text).eigenschaften.find((x) => x.name === schluessel);
  return p ? { start: p.start, ende: p.ende } : null;
}

/** Ersetzt den Werttext von `schluessel` wörtlich durch `wertText`; fehlt der Schlüssel, wird er als letzte Eigenschaft
 *  eingefügt (Einrückung der ersten Eigenschaft, Zeilenende des Textes). Alles andere bleibt byte-gleich. */
export function setzeJsonSchluessel(text, schluessel, wertText) {
  const info = eigenschaften(text);
  const vorhanden = info.eigenschaften.find((x) => x.name === schluessel);
  if (vorhanden) return text.slice(0, vorhanden.start) + wertText + text.slice(vorhanden.ende);
  const eol = eolVon(text);
  const zeile = `${JSON.stringify(schluessel)}: ${wertText}`;
  if (info.eigenschaften.length === 0) return `${text.slice(0, info.objStart)}{${eol}  ${zeile}${eol}${text.slice(info.objEnde)}`;
  const erste = info.eigenschaften[0];
  const letzte = info.eigenschaften[info.eigenschaften.length - 1];
  const dazwischen = text.slice(info.objStart + 1, erste.keyStart);
  const nl = dazwischen.lastIndexOf("\n");
  const trenner = nl < 0 ? " " : `${eol}${dazwischen.slice(nl + 1)}`;
  return `${text.slice(0, letzte.ende)},${trenner}${zeile}${text.slice(letzte.ende)}`;
}

/** Ersetzt den Bereich vom Start- bis einschließlich Ende-Marker durch `blockText`; fehlen die Marker, ist das ein Fehler. */
export function setzeBlock(text, block, blockText) {
  const na = zaehleVorkommen(text, markerStart(block));
  const nb = zaehleVorkommen(text, markerEnde(block));
  if (na !== 1 || nb !== 1) throw new Error(`Block '${block}': Marker müssen im Ziel je genau einmal stehen (start ${na}, ende ${nb}). ${markerHinweis(block)}`);
  const a = text.indexOf(markerStart(block));
  const b = text.indexOf(markerEnde(block));
  if (b < a) throw new Error(`Block '${block}': Ende-Marker steht vor dem Start-Marker`);
  return text.slice(0, a) + blockText + text.slice(b + markerEnde(block).length);
}

// ── Projektliterale aus der Config (ADR 0022 F1, F10) ───────────────────────
// Eine Auslegung für den Kern-Wächter und das Export-Werkzeug: welche Begriffe ein Kern nicht tragen soll.

/** Alternative aus wörtlichen Werten: einmalig, längster zuerst (sonst zählt ein Kurzname im Langnamen mit), regex-escaped.
 * @param {string[]} werte */
const alternative = (werte) =>
  [...new Set(werte)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");

/** Board-ID (#1875): das generische Muster der Projekt-IDs, dazu die Status-Feld-ID jedes Boards der Config als ganze Zahl
 * (`todoOptionId` zählt nicht: der GitHub-Standardwert steht in jedem Projekt).
 * @param {{ boards: { statusFeldId?: string | number }[] }} config */
const boardIdRegex = (config) => {
  const ids = config.boards.flatMap((b) => (b.statusFeldId === undefined ? [] : [String(b.statusFeldId)]));
  const muster = "\\bPVT[A-Z]*_[A-Za-z0-9_-]+";
  return new RegExp(ids.length === 0 ? muster : `${muster}|(?<!\\d)(?:${ids.map(escapeRegex).join("|")})(?!\\d)`, "g");
};

/** Die Projektliterale, die ein Kern nicht tragen soll, aus der Projekt-Config (#1611, #1741): Owner (Repo-Owner und Board-Besitzer),
 * Repo-Name, generisches Board-ID-Muster, Commit-Zeilen-Präfix, Branch- und Worktree-Präfix, Labels (nur Werte mit `:`, ein Wort
 * wie `forum` zählt nie), Agentennamen, Skill-Namen (`skills`, ganze Wörter ohne Bindestrich-Anschluss) und die `projektliterale` der Config (als ganze Wörter, Unicode-Wortgrenzen; ein Wert, der auf `-` oder `_` endet, trifft darum nie: Präfixe decken `Praefix` und `Env` aus `praefixe.commitZeile` ab). Präfix, Branch, Worktree, Label und Agent zählen
 * groß/klein-genau; Branch und Worktree überlappen bewusst (ein Branch-Präfix enthält das Worktree-Präfix).
 * Dazu `Bezieher` (factory#215): der Namensteil jedes Eintrags aus `bezieher` als ganzes Wort (Unicode-Grenzen, groß/klein egal), der Owner fließt in `Owner`; ein Name, der dem Repo-Namen oder einem `projektliterale`-Wert gleicht, ist schon gedeckt und erzeugt keinen zweiten Begriff (Baselines bleiben gleich). Grenze: ein Bezieher-Name, der ein Alltagswort ist, trifft breit.
 * @param {{ repo: string, bezieher?: string[], boards: { besitzer: string, statusFeldId?: string | number }[], praefixe: { commitZeile: string, branch: string, worktree: string },
 *   labels: Record<string, string>, agenten: Record<string, string>, skills?: Record<string, string>, projektliterale?: Record<string, string> }} config
 * @returns {Record<string, RegExp>} */
export function begriffeAus(config) {
  const [owner = "", name = ""] = config.repo.split("/");
  const bezieher = (config.bezieher ?? []).map((r) => r.split("/"));
  const owners = [...new Set([owner, ...config.boards.map((b) => b.besitzer), ...bezieher.map(([o = ""]) => o).filter((o) => o !== "")])];
  const { commitZeile, branch, worktree } = config.praefixe;
  /** @type {Record<string, RegExp>} */
  const out = {
    Owner: new RegExp(owners.map(escapeRegex).join("|"), "gi"),
    Repo: new RegExp(escapeRegex(name), "gi"),
    "Board-ID": boardIdRegex(config),
    Praefix: new RegExp(escapeRegex(commitZeile), "g"),
    Branch: new RegExp(escapeRegex(branch), "g"),
    Worktree: new RegExp(escapeRegex(worktree), "g"),
  };
  // Env (#1824): der Commit-Zeilen-Präfix mit Unterstrich als Umgebungsvariablen-Präfix; die Wortgrenze davor schließt `VITE_<PRAEFIX>_…` und `__<PRAEFIX>_…__` aus.
  const envPraefix = altEnvPraefix(config);
  if (envPraefix !== null) out.Env = new RegExp("\\b" + escapeRegex(envPraefix) + "(?=[A-Z0-9])", "g");
  const labels = Object.values(config.labels).filter((l) => l.includes(":"));
  if (labels.length > 0) out.Label = new RegExp(alternative(labels), "g");
  out.Agent = new RegExp(alternative(Object.values(config.agenten)), "g");
  const skills = Object.values(config.skills ?? {}).filter((s) => typeof s === "string");
  if (skills.length > 0) out.Skill = new RegExp(`(?<![\\w-])(?:${alternative(skills)})(?![\\w-])`, "g");
  // Das `u`-Flag lehnt `\-` außerhalb einer Zeichenklasse ab, darum bleibt der Bindestrich unmaskiert.
  const ganzesWort = (/** @type {string} */ muster) => new RegExp(`(?<![\\p{L}\\p{N}_])${muster}(?![\\p{L}\\p{N}_])`, "giu");
  const wörtlich = (/** @type {string[]} */ werte) => alternative(werte).replaceAll(String.raw`\-`, "-");
  for (const [begriff, literal] of Object.entries(config.projektliterale ?? {})) out[begriff] = ganzesWort(wörtlich([literal]));
  const gedeckt = new Set([name, ...Object.values(config.projektliterale ?? {})].map((w) => w.toLowerCase()));
  const bezieherNamen = bezieher.map(([, n = ""]) => n).filter((n) => n !== "" && !gedeckt.has(n.toLowerCase()));
  if (bezieherNamen.length > 0) out.Bezieher = ganzesWort(`(?:${wörtlich(bezieherNamen)})`);
  return out;
}
