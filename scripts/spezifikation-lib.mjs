// Lib ohne Direktaufruf-Guard; Aufrufer: die Ticket-Auswahl (naechstes-ticket.mjs), der Anlege-/Reparaturweg (spezifikation.mjs), die Abnahme (abnahme.mjs, check-abnahme-nachweis.mjs).
/**
 * Spezifikations-Gate (ADR 0022 F12): Der Eingang ist eine Spezifikation. Ein Ticket braucht den Ziel-Abschnitt und den Kriterien-Abschnitt (Liste)
 * mit mindestens einem Negativfall-Kriterium. Alles pur, einziger Import ist `fenceMaske` (Code-Fences nach CommonMark), ohne Projektliterale.
 * Sprache (#1711): Abschnittsnamen, Schlüsselwörter und deren Muster kommen als `sprache` (= `sprache.spezifikation` der Projekt-Config, `spracheAus`)
 * in jeden Einstieg; die Rahmentexte der Meldungen bleiben deutsch (Kern-Texte, ADR 0022 §8), die Wörter werden eingesetzt. Fehlt `sprache` oder ein
 * Schlüssel, wirft der Einstieg (kein stiller Deutsch-Standardwert).
 * Ausnahmen (Sammel-, Status-, Epic-Tickets) entscheidet der Aufrufer über das Prädikat `ausgenommen`; Bestand (Nummer unter `hartAb`)
 * wird nur berichtet, Neues ist hart.
 * Blocker-Zeile (#1860): ein Abhängigkeitssatz (geschlossene Liste `abhaengigkeit`, `#` steht für die Ticketnummer, z.B. „folgt nach #“) nennt eine Nummer,
 * die auch als Zeile `<blocker> #<nr>` im Body stehen muss, sonst lässt die Auswahl das Ticket frei (`blockerNummern`, SSOT für Lesen und Schreiben).
 * Grenze: nur diese Sätze; jede andere Formulierung einer Abhängigkeit erkennt das Gate nicht. Code-Fences und Inline-Code zählen nicht.
 * Ticketzuschnitt (#1808): ein Allquantor-Kriterium auf einen Heuristik-Wächter (`allquantor`: Allquantor, Relativsatz, Lesewort im selben Satz)
 * ist unbegrenzt und mit Mustern nie vollständig; es braucht die Begrenzung (`begrenzung`). Grenze: nur dieses kleine Satzmuster
 * (Allquantor, Relativsatz, Lesewort ohne Satzende dazwischen); andere Formulierungen desselben Anspruchs erkennt das Gate nicht.
 */

import { fenceMaske } from "./docs-gen/markdown.mjs";

const LISTENPUNKT = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

const istText = (v) => typeof v === "string" && v.trim() !== "";
const istObjekt = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pur: Mängel eines Muster-Eintrags `{ wort, muster }` (das Muster muss als Regex mit Flag i kompilieren). */
function musterMaengel(w, k) {
  if (!istObjekt(w) || !istText(w.wort) || !istText(w.muster)) return [`sprache.spezifikation.${k} muss ein Objekt mit nicht-leerem wort und muster sein`];
  try {
    new RegExp(w.muster, "i");
  } catch {
    return [`sprache.spezifikation.${k}.muster ist keine gültige Regex`];
  }
  return [];
}

/**
 * Pur: die Mängel von `sprache.spezifikation` (Meldungen auf den Schlüsselpfaden `sprache.spezifikation.<k>`; leer = gültig). SSOT der Pflichtschlüssel:
 * `wortschatz` wirft bei jedem Mangel, die Projekt-Config-Prüfung (`pruefeSprache`) meldet dieselben Texte.
 */
export function spracheMaengel(sp) {
  if (!istObjekt(sp)) return ["sprache.spezifikation muss ein Objekt sein"];
  const maengel = [];
  for (const k of ["ziel", "nachMerge"]) {
    if (!istText(sp[k])) maengel.push(`sprache.spezifikation.${k} muss ein nicht-leerer String sein`);
  }
  if (!Array.isArray(sp.akzeptanzkriterien) || sp.akzeptanzkriterien.length === 0 || !sp.akzeptanzkriterien.every(istText)) {
    maengel.push("sprache.spezifikation.akzeptanzkriterien muss eine nicht-leere Liste nicht-leerer Strings sein");
  }
  if (!istText(sp.blocker)) maengel.push("sprache.spezifikation.blocker muss ein nicht-leerer String sein");
  if (!Array.isArray(sp.abhaengigkeit) || sp.abhaengigkeit.length === 0 || !sp.abhaengigkeit.every((s) => istText(s) && s.split("#").length === 2)) {
    maengel.push("sprache.spezifikation.abhaengigkeit muss eine nicht-leere Liste von Sätzen mit genau einem „#“ als Platz der Ticketnummer sein");
  }
  for (const k of ["negativfall", "begrenzung", "allquantor"]) maengel.push(...musterMaengel(sp[k], k));
  return maengel;
}

/** Maskiert jedes Zeichen außer Buchstaben und Ziffern als `\u{…}` (gültig im Unicode-Modus; die Lib bleibt importfrei). */
const maskiere = (s) => s.replace(/[^\p{L}\p{N}]/gu, (c) => `\\u{${c.codePointAt(0).toString(16)}}`);
/** Text als Regex-Quelle: Zeichen maskiert, Leerraum beliebig lang (auch Zeilenumbruch). */
const textMuster = (s) => s.trim().split(/\s+/).map(maskiere).join("\\s+");
/** Wortgrenze für Unicode-Text (`\b` kennt kein ä): davor/danach kein Buchstabe oder keine Ziffer. */
const VOR = "(?<![\\p{L}\\p{N}])";
const NACH = "(?![\\p{L}\\p{N}])";

/** Prüft den Wörterbuch-Block (`spracheMaengel`) und baut daraus Regexe und Meldungen; wirft ohne (vollständigen) Block. Pur. */
function wortschatz(sprache) {
  const maengel = spracheMaengel(sprache);
  if (maengel.length > 0) {
    throw new Error(`sprache fehlt oder ist unvollständig (${maengel.join("; ")}); das Spezifikations-Gate hat keinen stillen Deutsch-Standardwert\nFix: den Schlüssel sprache.spezifikation in .factory/projekt.json eintragen`);
  }
  const s = sprache;
  const muster = (k) => ({ wort: s[k].wort, re: new RegExp(s[k].muster, "i") });
  const negativ = muster("negativfall");
  const begrenzung = muster("begrenzung");
  const allquantor = muster("allquantor");
  const ak = s.akzeptanzkriterien[0];
  const abhaengigkeit = s.abhaengigkeit.map((satz) => {
    const [vor, nach] = satz.split("#");
    const ende = nach.trim() === "" ? "" : `\\s*${textMuster(nach)}${NACH}`;
    return new RegExp(`${VOR}${textMuster(vor)}\\s*#(\\d+)${ende}`, "giu");
  });
  return {
    blocker: s.blocker,
    blockerRe: () => new RegExp(`${VOR}${textMuster(s.blocker)}${NACH}([^(\\n]*)`, "giu"),
    abhaengigkeit,
    ziel: s.ziel,
    akNamen: s.akzeptanzkriterien,
    nachMerge: s.nachMerge,
    negativ: negativ.re,
    begrenzung: begrenzung.re,
    allquantor: allquantor.re,
    meldung: {
      zielFehlt: `\`## ${s.ziel}\` fehlt`,
      zielLeer: `\`## ${s.ziel}\` ist leer`,
      akFehlt: `\`## ${ak}\` fehlt`,
      akOhneListe: `\`## ${ak}\` ohne Listenpunkt`,
      keinNegativ: `kein ${negativ.wort} in den ${ak} (ein Kriterium mit dem Wort „${negativ.wort}“)`,
      alleNachMerge: `alle ${ak} beginnen mit „${s.nachMerge}“: die Abnahme hätte nichts zu prüfen (mindestens ein Kriterium muss vor dem Merge prüfbar sein)`,
      abhaengigkeit: (satz, nr) => `Abhängigkeitssatz „${satz}“ ohne Zeile „${s.blocker} #${nr}“`,
      allquantor: (k) => `${k}: Allquantor („${allquantor.wort}“) auf einen Heuristik-Wächter ist unbegrenzt: die Begrenzung als geschlossene Liste nennen („${begrenzung.wort} …“)`,
    },
  };
}

/** Zeilen des Bodys ohne Code-Fences (CommonMark über `fenceMaske`, die Fence-Zeilen eingeschlossen). */
function ohneFences(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const maske = fenceMaske(lines);
  return lines.filter((_, i) => !maske[i]);
}

/** Zeilen je Abschnitt (Überschrift Ebene 2 mit einem der Namen aus `namen`, als Text verglichen, Groß-/Kleinschreibung egal); Code-Fences zählen nicht, `###` gehört zum Abschnitt. `null` = Abschnitt fehlt. */
function abschnitt(body, namen) {
  const klein = namen.map((n) => n.toLowerCase());
  let drin = false;
  let gefunden = false;
  const zeilen = [];
  for (const zeile of ohneFences(body)) {
    if (/^#{1,2}\s/.test(zeile)) {
      const titel = /^##\s+(.*?)\s*$/.exec(zeile);
      drin = titel !== null && klein.includes(titel[1].toLowerCase());
      gefunden = gefunden || drin;
      continue;
    }
    if (drin) zeilen.push(zeile);
  }
  return gefunden ? zeilen : null;
}

/**
 * Die Nummern hinter der Blocker-Zeile (`sprache.blocker`, z.B. „blockiert durch #12, #13 (nur solange …)“): zeilenweise, bis zu einer öffnenden Klammer
 * oder dem Zeilenende, Groß-/Kleinschreibung egal. SSOT für Lesen (Auswahl) und Schreiben (anlegen, Sammelticket) der Zeile; wirft ohne Sprache. Pur.
 */
export function blockerNummern(body, sprache) {
  const w = wortschatz(sprache);
  const nummern = new Set();
  for (const zeile of ohneFences(body)) {
    for (const m of zeile.matchAll(w.blockerRe())) {
      for (const n of m[1].matchAll(/#(\d+)/g)) nummern.add(Number(n[1]));
    }
  }
  return [...nummern];
}

/**
 * Die Blocker-Zeile als Text: `<blocker> #a, #b`, mit `zusatz` hinter einem Leerzeichen (z.B. „(nur solange #a offen ist)“). Gegenstück zu `blockerNummern`
 * (SSOT für das Schreiben); wirft bei leerer Nummernliste und bei leerem Wort `sprache.blocker`. Pur.
 */
export function blockerZeile(nummern, sprache, zusatz = "") {
  if (!Array.isArray(nummern) || nummern.length === 0) throw new Error("blockerZeile braucht mindestens eine Ticketnummer");
  const wort = sprache?.blocker;
  if (typeof wort !== "string" || wort.trim() === "") throw new Error("sprache.blocker fehlt oder ist leer: die Blocker-Zeile braucht das Wort der Projekt-Config");
  return `${wort} ${nummern.map((n) => `#${n}`).join(", ")}${zusatz === "" ? "" : ` ${zusatz}`}`;
}

/** Text ohne Code-Fences und ohne Inline-Code (dort steht Beispieltext, keine Abhängigkeit). */
function ohneCode(body) {
  return ohneFences(body)
    .map((zeile) => zeile.replace(/`[^`\n]*`/g, ""))
    .join("\n");
}

/** Mängel „Abhängigkeitssatz ohne passende Blocker-Zeile“, je Nummer einer. Pur. */
function abhaengigkeitsMaengel(body, w, sprache) {
  const text = ohneCode(body);
  const gedeckt = new Set(blockerNummern(body, sprache));
  const gemeldet = new Set();
  const maengel = [];
  for (const re of w.abhaengigkeit) {
    for (const m of text.matchAll(re)) {
      const nr = Number(m[1]);
      if (gedeckt.has(nr) || gemeldet.has(nr)) continue;
      gemeldet.add(nr);
      maengel.push(w.meldung.abhaengigkeit(m[0].replace(/\s+/g, " "), nr));
    }
  }
  return maengel;
}

/** Mängel einer Spezifikation als Textliste (leer = vollständig). Pur. */
export function spezifikationsMaengel(body, sprache) {
  const w = wortschatz(sprache);
  const maengel = [];
  const ziel = abschnitt(body, [w.ziel]);
  if (ziel === null) maengel.push(w.meldung.zielFehlt);
  else if (ziel.every((z) => z.trim() === "")) maengel.push(w.meldung.zielLeer);
  const ak = abschnitt(body, w.akNamen);
  if (ak === null) {
    maengel.push(w.meldung.akFehlt);
  } else {
    if (!ak.some((z) => LISTENPUNKT.test(z))) maengel.push(w.meldung.akOhneListe);
    if (!ak.some((z) => w.negativ.test(z))) maengel.push(w.meldung.keinNegativ);
    const liste = kriterien(body, sprache);
    if (liste.length > 0 && liste.every((c) => c.nachMerge)) maengel.push(w.meldung.alleNachMerge);
    for (const c of liste) if (w.allquantor.test(c.text.replace(/\s+/g, " ")) && !w.begrenzung.test(c.text)) maengel.push(w.meldung.allquantor(c.k));
  }
  maengel.push(...abhaengigkeitsMaengel(body, w, sprache));
  return maengel;
}

const einzug = (z) => z.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
const ohneMarker = (z) => z.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s*/, "");

/**
 * Die Akzeptanzkriterien als `[{k:"K1", text}, …]` (Abschnitt wie im Spezifikations-Gate). Ein Kriterium ist ein Listenpunkt der obersten Ebene
 * (kleinster Einzug); tiefer eingerückte Listenpunkte und Folgezeilen (direkt anschließend oder nach einer Leerzeile eingerückt) gehören zu ihm, eine
 * nicht eingerückte Prosazeile nach einer Leerzeile und eine `###`-Überschrift beenden es. Die Nummer ist die Position im Abschnitt, nicht die
 * Ziffer des Autors. `nachMerge` ist wahr, wenn der Text mit `sprache.nachMerge` beginnt. Fehlender Abschnitt oder keine Liste: `[]`. Pur.
 */
export function kriterien(body, sprache) {
  const w = wortschatz(sprache);
  const zeilen = abschnitt(body, w.akNamen);
  const punkte = (zeilen ?? []).filter((z) => LISTENPUNKT.test(z));
  if (punkte.length === 0) return [];
  const oben = Math.min(...punkte.map(einzug));
  const ergebnis = [];
  let aktuell = null;
  let leer = false;
  for (const zeile of zeilen) {
    if (zeile.trim() === "") {
      leer = true;
      continue;
    }
    const listenzeile = LISTENPUNKT.test(zeile);
    if (listenzeile && einzug(zeile) === oben) {
      aktuell = [ohneMarker(zeile)];
      ergebnis.push(aktuell);
    } else if (aktuell && !/^\s*#{3,}\s/.test(zeile) && (listenzeile || !leer || einzug(zeile) > oben)) {
      aktuell.push(listenzeile ? ohneMarker(zeile) : zeile.trim());
    } else {
      aktuell = null;
    }
    leer = false;
  }
  return ergebnis.map((teile, i) => ({ k: `K${i + 1}`, text: teile.join("\n"), nachMerge: teile[0].startsWith(w.nachMerge) }));
}

/** Epic- und Phasen-Titel (eigenes Format, vom Gate ausgenommen): beginnt mit „Epic“ oder „Phase“, optional hinter 📦. Pur. */
export function istEpicTitel(titel) {
  return /^\s*(?:📦\s*)?(?:epic|phase)\b/i.test(String(titel ?? ""));
}

/**
 * Einstufung eines Tickets `{ nummer, titel, body }`: `ausgenommen` (Prädikat `ausgenommen`), `ok`, `bestand` (Nummer unter `hartAb`,
 * nur berichten) oder `hart` (überspringen); bei `bestand`/`hart` die Mängel in `fehlt`. Pur.
 */
export function pruefeEingang(ticket, { ausgenommen = () => false, hartAb = 0, sprache } = {}) {
  wortschatz(sprache);
  if (ausgenommen(ticket)) return { art: "ausgenommen" };
  const fehlt = spezifikationsMaengel(ticket.body, sprache);
  if (fehlt.length === 0) return { art: "ok" };
  return { art: ticket.nummer < hartAb ? "bestand" : "hart", fehlt };
}

const norm = (z) =>
  z
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .replace(/:$/, "")
    .trim();

/**
 * Inhaltsverlust beim Reparieren: jede nicht leere Inhaltszeile des alten Bodys muss im neuen vorkommen. Normalisiert wird
 * (trimmen, Überschriften-Raute, Listenzeichen, Checkbox, Doppelpunkt am Ende); Fence-Zeilen, Trennlinien und Überschriften Ebene 1-2 des alten
 * Bodys zählen nicht, `###` und tiefer schon; Überschriften des neuen Bodys sind Treffer.
 * Liefert die verlorenen Zeilen (getrimmt, Original). `null`/`undefined` als alter Body: nichts zu verlieren. Pur.
 */
export function verloreneZeilen(alt, neu) {
  const zeilen = (t) => String(t ?? "").split(/\r?\n/);
  const da = new Set(zeilen(neu).map(norm).filter(Boolean));
  return zeilen(alt)
    .map((z) => z.trim())
    .filter((z) => z !== "" && !/^(?:```|~~~)/.test(z) && !/^#{1,2}\s/.test(z) && !/^(?:[-*_=]+|(?:[-*_]\s*){3,})$/.test(z))
    .filter((z) => !da.has(norm(z)));
}

