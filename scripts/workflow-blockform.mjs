// Blatt-Modul: nur Node-Builtins (hier keine Imports), damit der Wochenlauf des Harness-Doctors ohne `npm ci` auskommt.
/* Blockform-Leser für den Doctor-Punkt `Required-Check-Quellen` (factory#148, Epic factory#133): liest aus einer Workflow-Datei die `name:`-Werte
 * der Jobs und Schritte ohne YAML-Bibliothek und zählt, wie viele Quellen ein Required-Check-Kontext hat (`quellenJeKontext`, `beansprucht`).
 * Ein gleichnamiger Fremd-Job würde den echten Check im Ruleset grün überschreiben (Schatten, quellprojekt#1172).
 *
 * Gelesen wird nur das, was dafür nötig ist: die Wurzel als Mapping in Spalte 0, darin `jobs`; je Job nur `name` und `steps`; je Step nur `name`.
 * Schlüssel plain oder gequotet (einzeilig); `steps` als Block-Sequenz (auch kompakt auf Höhe von `steps`); Steps als `- name: …`, als `-` allein mit Mapping darunter
 * oder mit mehreren Leerzeichen hinter dem Strich. Alle anderen Werte werden über die Einrückung übersprungen (tiefer eingerückt, leer oder reine Kommentare, dazu eine
 * kompakte Sequenz auf Schlüsselhöhe); ihr Inhalt ist egal (Flow, Anker, `run: |`).
 * `name`-Werte: plain ein- oder mehrzeilig (` #` beendet den Wert; Zeilenumbruch wird zum Leerzeichen, eine Leerzeile zu `\n`; der Wert darf erst in der Folgezeile stehen),
 * `'…'` mit `''`, `"…"` mit allen YAML-1.2-Escapes (`\0 \a \b \t \<Tab> \n \v \f \r \e \<Leerzeichen> \" \/ \\ \N \_ \L \P \xXX \uXXXX \UXXXXXXXX`, `\` am Zeilenende),
 * beide Quote-Formen auch mehrzeilig gefaltet, Block-Skalare `|` und `>` mit `-`/`+` und Einrückungs-Indikator; danach `trim()`, leere Werte entfallen.
 * BOM, CRLF und ein `---` am Anfang sind erlaubt. Je Job kommt erst `name`, dann kommen die Step-Namen (wie in der Referenz).
 *
 * Nicht gelesen wird (fail-closed): `blockformNamen` liefert dann `{ fehler: { zeile, konstrukt } }`, nie still weniger Namen. Geschlossene Liste: Flow-Collection als `jobs`, Job,
 * `steps`, Step oder `name`-Wert; Anker `&`, Alias `*`, Tag `!` an diesen Stellen; Merge-Schlüssel `<<` und `?`-Schlüssel in einem gelesenen Mapping; Tab in der Einrückung einer
 * gelesenen Zeile; ein zweites Dokument (`---`/`...` nach dem Anfang); eine Direktive `%`; Flow-/JSON-Form oben (`{` oder `[` in Spalte 0); ein unbekanntes Escape; eine Liste
 * als `jobs` oder Job; Strukturfehler (doppelter Schlüssel, Zeile ohne `schlüssel:` auf gelesener Ebene, falsche Einrückung, unbeendetes Quote, `: ` im plain-Wert). Eine Flow-Klammer,
 * die erst auf Schlüsselhöhe schließt, endet als Strukturfehler. Der Differenztest in test/harness/required-check-shadowing.test.ts hält den Leser gegen die `yaml`-Bibliothek ehrlich.
 */

class NichtLesbar extends Error {
  constructor(zeile, konstrukt) {
    super(konstrukt);
    this.zeile = zeile;
    this.konstrukt = konstrukt;
  }
}
const nl = (index, konstrukt) => new NichtLesbar(index + 1, konstrukt);

const LEER = /^[ \t]*$/;
const KOMMENTAR = /^[ \t]*#/;
const einr = (zeile) => /^ */.exec(zeile)[0].length;
const istStrich = (text) => /^-([ \t]|$)/.test(text);

/** Anfangszeichen, an denen ein Wert oder Schlüssel nicht gelesen wird, mit dem Namen des Konstrukts. */
const INDIKATOR = Object.freeze({ "{": "Flow-Collection", "[": "Flow-Collection", "&": "Anker", "*": "Alias", "!": "Tag", "%": "Direktive", "@": "reservierter Indikator", "`": "reservierter Indikator", "}": "Flow-Collection", "]": "Flow-Collection", ",": "Flow-Collection" });

/** Die nächste Inhaltszeile ab `c.i` (Leerzeilen und Kommentare übersprungen), ohne `c.i` zu bewegen; `null` am Ende. */
function lesen(c) {
  for (let k = c.i; k < c.z.length; k++) {
    const s = c.z[k];
    if (LEER.test(s) || KOMMENTAR.test(s)) continue;
    const e = einr(s);
    const text = s.slice(e);
    if (text[0] === "\t") throw nl(k, "Tab in der Einrückung");
    if (e === 0 && /^(---|\.\.\.)([ \t]|$)/.test(text)) throw nl(k, "zweites Dokument");
    return { k, einr: e, text };
  }
  return null;
}

const ESCAPES = Object.freeze({ 0: "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\u0085", _: "\u00a0", L: "\u2028", P: "\u2029" });
const HEX_LAENGE = Object.freeze({ x: 2, u: 4, U: 8 });

/** Ein Escape ab `s[i]` (das Zeichen hinter dem Backslash): `{ text, laenge }` (`laenge` = Zeichen hinter dem Backslash). */
function escape(s, i, index) {
  const zeichen = s[i];
  if (Object.hasOwn(ESCAPES, zeichen)) return { text: ESCAPES[zeichen], laenge: 1 };
  const n = HEX_LAENGE[zeichen];
  const hex = n === undefined ? "" : s.slice(i + 1, i + 1 + n);
  if (n === undefined || hex.length !== n || !/^[0-9a-fA-F]+$/.test(hex) || parseInt(hex, 16) > 0x10ffff) throw nl(index, "unbekanntes Escape");
  return { text: String.fromCodePoint(parseInt(hex, 16)), laenge: 1 + n };
}

/** Liest ein Quote-Stück ab Anfang von `s` (hinter dem öffnenden Quote): `out` entschlüsselt, `fest` = Länge ohne nachlaufenden Leerraum, `zu` = Quote geschlossen, `rest` = Text dahinter, `esc` = Zeile endet mit `\`. */
function quoteStueck(s, doppelt, index) {
  let out = "";
  let fest = 0;
  for (let i = 0; i < s.length; i++) {
    const z = s[i];
    if (doppelt && z === "\\") {
      if (i === s.length - 1) return { out, fest: out.length, zu: false, esc: true };
      const r = escape(s, i + 1, index);
      out += r.text;
      i += r.laenge;
      fest = out.length;
    } else if (z === (doppelt ? '"' : "'")) {
      if (doppelt || s[i + 1] !== "'") return { out, fest: out.length, zu: true, rest: s.slice(i + 1) };
      out += "'";
      i++;
      fest = out.length;
    } else {
      out += z;
      if (z !== " " && z !== "\t") fest = out.length;
    }
  }
  return { out, fest, zu: false, esc: false };
}

const NACH_WERT = /^([ \t]+#.*|[ \t]*)$/;

/** Gequoteter Wert ab dem öffnenden Quote in `frag` (Zeile `k`); folgende Zeilen werden gefaltet. `c.i` steht hinter `k`. */
function gequotet(c, frag, k, einrSchluessel) {
  const doppelt = frag[0] === '"';
  let wert = "";
  let r = quoteStueck(frag.slice(1), doppelt, k);
  while (!r.zu) {
    wert += r.esc ? r.out : r.out.slice(0, r.fest);
    let leer = 0;
    while (c.i < c.z.length && LEER.test(c.z[c.i])) {
      c.i++;
      leer++;
    }
    if (c.i >= c.z.length) throw nl(k, "unbeendetes Quote");
    if (einr(c.z[c.i]) <= einrSchluessel) throw nl(c.i, "falsche Einrückung");
    if (r.esc && leer > 0) throw nl(c.i, "unbekanntes Escape");
    if (!r.esc) wert += leer > 0 ? "\n".repeat(leer) : " ";
    r = quoteStueck(c.z[c.i].trimStart(), doppelt, c.i);
    c.i++;
  }
  if (!NACH_WERT.test(r.rest)) throw nl(k, "Text nach dem gequoteten Wert");
  return wert + r.out;
}

/** Ein plain-Stück: schneidet den Kommentar (` #`) ab und lehnt `: ` ab (das wäre ein Mapping). */
function plainStueck(text, index) {
  const i = text.search(/[ \t]#/);
  const t = (i === -1 ? text : text.slice(0, i)).trimEnd();
  if (/:([ \t]|$)/.test(t)) throw nl(index, "`: ` im plain-Wert");
  return { t, kommentar: i !== -1 };
}

/** Plain-Skalar ab `frag` (Zeile `k`), mehrzeilig gefaltet, solange die Folgezeilen tiefer als der Schlüssel eingerückt sind. */
function plain(c, frag, k, einrSchluessel) {
  let { t, kommentar } = plainStueck(frag, k);
  while (!kommentar) {
    let j = c.i;
    let leer = 0;
    while (j < c.z.length && LEER.test(c.z[j])) {
      j++;
      leer++;
    }
    if (j >= c.z.length || KOMMENTAR.test(c.z[j]) || einr(c.z[j]) <= einrSchluessel) break;
    const naechste = plainStueck(c.z[j].trimStart(), j);
    t += (leer > 0 ? "\n".repeat(leer) : " ") + naechste.t;
    kommentar = naechste.kommentar;
    c.i = j + 1;
  }
  return t;
}

/** Faltet die Zeilen eines gefalteten Block-Skalars (`>`): Umbruch zwischen normalen Zeilen wird Leerzeichen, Leerzeilen bleiben `\n`, eingerückte Zeilen behalten ihre Umbrüche. */
function falten(zeilen) {
  let out = "";
  let vorher = null;
  let leer = 0;
  for (const text of zeilen) {
    if (text === "") {
      leer++;
      continue;
    }
    const eingerueckt = /^[ \t]/.test(text);
    if (vorher === null) out = "\n".repeat(leer) + text;
    else out += (!vorher.eingerueckt && !eingerueckt ? (leer > 0 ? "\n".repeat(leer) : " ") : "\n".repeat(leer + 1)) + text;
    vorher = { eingerueckt };
    leer = 0;
  }
  return out;
}

/** Block-Skalar `|` oder `>` (Kopfzeile `kopf` in Zeile `k`) samt Inhaltszeilen; `c.i` steht danach hinter dem Inhalt. */
function blockSkalar(c, kopf, k, einrSchluessel) {
  const m = /^([|>])(?:([1-9])([+-])?|([+-])([1-9])?)?(?:[ \t]+#.*|[ \t]*)$/.exec(kopf);
  if (m === null) throw nl(k, "Block-Skalar mit unlesbarem Kopf");
  const indikator = m[2] ?? m[5];
  let j = c.i;
  while (j < c.z.length && /^ *$/.test(c.z[j])) j++;
  const tiefe = indikator ? einrSchluessel + Number(indikator) : j < c.z.length ? einr(c.z[j]) : 0;
  const zeilen = [];
  if (tiefe > einrSchluessel) {
    for (j = c.i; j < c.z.length; j++) {
      const s = c.z[j];
      if (!LEER.test(s) && einr(s) < tiefe) break;
      zeilen.push(s.length > tiefe ? s.slice(tiefe) : "");
    }
    c.i = j;
  }
  return m[1] === "|" ? zeilen.join("\n") : falten(zeilen);
}

/** Der Wert eines Skalars ab dem Fragment `frag` (Zeile `k`); Flow, Anker, Alias und Tag sind nicht lesbar. */
function skalar(c, frag, k, einrSchluessel) {
  const e = frag[0];
  if (Object.hasOwn(INDIKATOR, e)) throw nl(k, `${INDIKATOR[e]} als name-Wert`);
  if (/^[-?:]([ \t]|$)/.test(frag)) throw nl(k, "Strukturfehler im name-Wert");
  if (e === "|" || e === ">") return blockSkalar(c, frag, k, einrSchluessel);
  if (e === '"' || e === "'") return gequotet(c, frag, k, einrSchluessel);
  return plain(c, frag, k, einrSchluessel);
}

/** Der `name`-Wert eines gelesenen Schlüssels (`z` = Schlüsselzeile, `rest` = Text hinter dem Doppelpunkt); getrimmt, leer bleibt `""`. */
function nameWert(c, z, rest) {
  let frag = rest;
  let k = z.k;
  if (frag === "") {
    const n = lesen(c);
    if (n === null || n.einr <= z.einr) return "";
    c.i = n.k + 1;
    frag = n.text;
    k = n.k;
    if (/^[|>]/.test(frag)) throw nl(k, "Block-Skalar auf der Folgezeile");
  }
  return skalar(c, frag, k, z.einr).trim();
}

/** Lehnt Zeilenanfänge ab, die kein lesbarer Schlüssel sind (Flow, Anker, Alias, Tag, ?-Schlüssel, Sequenz). */
function schluesselAnfang(z) {
  const t = z.text;
  if (t[0] === "{" || t[0] === "[") throw nl(z.k, z.einr === 0 ? "Flow-/JSON-Form oben" : "Flow-Collection");
  if (Object.hasOwn(INDIKATOR, t[0])) throw nl(z.k, INDIKATOR[t[0]]);
  if (/^\?([ \t]|$)/.test(t)) throw nl(z.k, "?-Schlüssel");
  if (istStrich(t)) throw nl(z.k, "Sequenz statt Mapping");
}

/** Der Schlüssel einer Zeile z und der Text dahinter: { key, nach }. */
function schluesselTeil(z) {
  const t = z.text;
  if (t[0] === '"' || t[0] === "'") {
    const r = quoteStueck(t.slice(1), t[0] === '"', z.k);
    const m = r.zu ? /^[ \t]*:(?:[ \t](.*))?$/.exec(r.rest) : null;
    if (m === null) throw nl(z.k, r.zu ? "Zeile ohne Schlüssel" : "unbeendetes Quote im Schlüssel");
    return { key: r.out, nach: m[1] ?? "" };
  }
  const i = t.search(/:([ \t]|$)/);
  const key = i === -1 ? "" : t.slice(0, i).trimEnd();
  if (key === "" || /[ \t]#/.test(key)) throw nl(z.k, "Zeile ohne Schlüssel");
  if (key === "<<") throw nl(z.k, "Merge-Schlüssel");
  return { key, nach: t.slice(i + 1) };
}

/** Zerlegt eine Schlüsselzeile z in { key, rest } (rest = Text hinter dem Doppelpunkt, Kommentar entfernt). */
function schluessel(z) {
  schluesselAnfang(z);
  const { key, nach } = schluesselTeil(z);
  const rest = nach.trim();
  return { key, rest: rest.startsWith("#") ? "" : rest };
}

/** Überspringt den Wert eines nicht gelesenen Schlüssels bei Einrückung `m`; `restLeer`: der Wert beginnt erst darunter (dann ist auch eine kompakte Sequenz auf Schlüsselhöhe sein Wert). */
function ueberspringen(c, m, restLeer) {
  while (c.i < c.z.length) {
    const s = c.z[c.i];
    if (!LEER.test(s) && !KOMMENTAR.test(s)) {
      const e = einr(s);
      if (e <= m && !(restLeer && e === m && istStrich(s.slice(e)))) return;
    }
    c.i++;
  }
}

/** Liest ein Mapping bei Einrückung `m`; `behandle(key, z, rest)` liest gewünschte Werte selbst (true) oder lässt sie überspringen (false). */
function mapping(c, m, behandle) {
  const gesehen = new Set();
  for (;;) {
    const z = lesen(c);
    if (z === null || z.einr < m) return;
    if (z.einr > m) throw nl(z.k, "falsche Einrückung");
    const { key, rest } = schluessel(z);
    if (gesehen.has(key)) throw nl(z.k, "doppelter Schlüssel");
    gesehen.add(key);
    c.i = z.k + 1;
    if (!behandle(key, z, rest)) ueberspringen(c, m, rest === "");
  }
}

/** Die erste Zeile des Blocks unter dem Schlüssel `z` (tiefer eingerückt, oder eine Sequenz auf Schlüsselhöhe); `null` = leer. Ein Wert hinter dem Doppelpunkt ist hier nicht lesbar. */
function blockUnter(c, z, rest, was) {
  if (rest !== "") throw nl(z.k, `${INDIKATOR[rest[0]] ?? "Skalar"} als ${was}`);
  const n = lesen(c);
  if (n !== null && (n.einr > z.einr || (n.einr === z.einr && istStrich(n.text)))) return n;
  return null;
}

/** Ein Step-Eintrag `e` (Zeile mit `-`): der Strich wird durch ein Leerzeichen ersetzt und das Mapping in dessen Spalte gelesen. */
function step(c, e, namen) {
  const nach = e.text.slice(1);
  if (nach[0] === "\t") throw nl(e.k, "Tab in der Einrückung");
  const inhalt = nach.trimStart();
  const lesenName = (key, z, rest) => {
    if (key !== "name") return false;
    namen.push(nameWert(c, z, rest));
    return true;
  };
  if (inhalt === "" || inhalt.startsWith("#")) {
    c.i = e.k + 1;
    const n = lesen(c);
    if (n !== null && n.einr > e.einr) mapping(c, n.einr, lesenName);
    return;
  }
  if (Object.hasOwn(INDIKATOR, inhalt[0])) throw nl(e.k, `${INDIKATOR[inhalt[0]]} als Step`);
  if (istStrich(inhalt)) throw nl(e.k, "verschachtelte Sequenz als Step");
  c.z[e.k] = " ".repeat(e.einr + 1 + nach.length - inhalt.length) + inhalt;
  c.i = e.k;
  mapping(c, einr(c.z[e.k]), lesenName);
}

/** Der Wert von `steps`: eine Block-Sequenz; die Step-Namen landen in `namen`. */
function stepsBlock(c, z, rest, namen) {
  const n = blockUnter(c, z, rest, "steps");
  if (n === null) return;
  if (!istStrich(n.text)) throw nl(n.k, "steps ist keine Block-Sequenz");
  for (;;) {
    const e = lesen(c);
    if (e === null || e.einr < n.einr || (e.einr === n.einr && !istStrich(e.text))) return;
    if (e.einr > n.einr) throw nl(e.k, "falsche Einrückung");
    step(c, e, namen);
  }
}

/** Ein Job: erst `name`, dann die Step-Namen. */
function job(c, z, rest, namen) {
  const n = blockUnter(c, z, rest, "Job");
  if (n === null) return;
  if (istStrich(n.text)) throw nl(n.k, "Liste als Job");
  let jobName = "";
  const schritte = [];
  mapping(c, n.einr, (key, kz, krest) => {
    if (key === "name") jobName = nameWert(c, kz, krest);
    else if (key === "steps") stepsBlock(c, kz, krest, schritte);
    else return false;
    return true;
  });
  namen.push(jobName, ...schritte);
}

/** Der Wert von `jobs`: ein Mapping von Jobs. */
function jobsBlock(c, z, rest, namen) {
  const n = blockUnter(c, z, rest, "jobs");
  if (n === null) return;
  if (istStrich(n.text)) throw nl(n.k, "Liste als jobs");
  mapping(c, n.einr, (key, jz, jrest) => {
    job(c, jz, jrest, namen);
    return true;
  });
}

/** Überspringt den Anfang (Leerzeilen, Kommentare) und einen ersten `---`; ein `---` mit Inhalt ist nicht lesbar. */
function dokumentStart(c) {
  const z = c.z.findIndex((s) => !LEER.test(s) && !KOMMENTAR.test(s));
  if (z === -1 || !/^---/.test(c.z[z])) return;
  if (!/^---([ \t]+#.*|[ \t]*)$/.test(c.z[z])) throw nl(z, "Dokumentstart mit Inhalt");
  c.i = z + 1;
}

/**
 * Liest die `name:`-Werte aller Jobs und Schritte einer Workflow-Datei (der Workflow-Name auf oberster Ebene zählt nicht).
 * Liefert `{ namen: string[] }` oder `{ fehler: { zeile, konstrukt } }` (`zeile` 1-basiert), wenn die Datei in einer Form geschrieben ist, die dieser Leser nicht liest.
 */
export function blockformNamen(text) {
  const roh = String(text);
  const c = { z: (roh.charCodeAt(0) === 0xfeff ? roh.slice(1) : roh).split(/\r\n|\n|\r/), i: 0 };
  const alle = [];
  try {
    dokumentStart(c);
    mapping(c, 0, (key, z, rest) => {
      if (key !== "jobs") return false;
      jobsBlock(c, z, rest, alle);
      return true;
    });
  } catch (e) {
    if (e instanceof NichtLesbar) return { fehler: { zeile: e.zeile, konstrukt: e.konstrukt } };
    throw e;
  }
  return { namen: alle.filter((n) => n !== "") };
}

/** GitHub liest beide Endungen: auch ein `fake.yaml` darf nicht entgehen. */
export function istWorkflowDatei(datei) {
  return /\.ya?ml$/.test(datei);
}

/** Beansprucht der Name den Kontext? Wörtlich: der Name beginnt mit dem Kontext. Dynamisch (`${{`): das wörtliche Präfix davor ist ein Anfang des Kontexts (fail-closed). */
export function beansprucht(wert, kontext) {
  const i = wert.indexOf("${{");
  return i === -1 ? wert.startsWith(kontext) : kontext.startsWith(wert.slice(0, i));
}

/**
 * Fundstellen je Kontext über `workflows` (`[{ pfad, text }]`): `treffer` = Map Kontext → `datei: name` je Quelle, `nichtLesbar` = `[{ pfad, zeile, konstrukt }]` der Dateien,
 * die der Blockform-Leser nicht liest (ihre Namen zählen nicht mit).
 */
export function quellenJeKontext(workflows, kontexte) {
  const treffer = new Map(kontexte.map((k) => [k, []]));
  const nichtLesbar = [];
  for (const { pfad, text } of workflows) {
    const r = blockformNamen(text);
    if (r.fehler) {
      nichtLesbar.push({ pfad, ...r.fehler });
      continue;
    }
    for (const wert of r.namen) for (const k of kontexte) if (beansprucht(wert, k)) treffer.get(k).push(`${pfad}: ${wert}`);
  }
  return { treffer, nichtLesbar };
}

/** Kontexte, die nicht genau eine Quelle haben, mit ihren Fundstellen (Textzeilen). */
export function verstoesse(workflows, kontexte) {
  return [...quellenJeKontext(workflows, kontexte).treffer]
    .filter(([, orte]) => orte.length !== 1)
    .map(([k, orte]) => `„${k}“: ${orte.length} Quellen${orte.length ? ` (${orte.join("; ")})` : ""}`);
}
