// Lib ohne Direktaufruf-Guard; Aufrufer: die Ticket-Auswahl (naechstes-ticket.mjs), der Anlege-/Reparaturweg (spezifikation.mjs), die Abnahme (abnahme.mjs, check-abnahme-nachweis.mjs).
/**
 * Spezifikations-Gate (ADR 0022 F12): Der Eingang ist eine Spezifikation. Ein Ticket braucht den Ziel-Abschnitt und den Kriterien-Abschnitt (Liste)
 * mit mindestens einem Negativfall-Kriterium. Alles pur, ohne Importe und ohne Projektliterale.
 * Sprache (#1711): Abschnittsnamen, Schlüsselwörter und deren Muster kommen als `sprache` (= `sprache.spezifikation` der Projekt-Config, `spracheAus`)
 * in jeden Einstieg; die Rahmentexte der Meldungen bleiben deutsch (Kern-Texte, ADR 0022 §8), die Wörter werden eingesetzt. Fehlt `sprache` oder ein
 * Schlüssel, wirft der Einstieg (kein stiller Deutsch-Standardwert).
 * Ausnahmen (Sammel-, Status-, Epic-Tickets) entscheidet der Aufrufer über das Prädikat `ausgenommen`; Bestand (Nummer unter `hartAb`)
 * wird nur berichtet, Neues ist hart.
 * Ticketzuschnitt (#1808): ein Allquantor-Kriterium auf einen Heuristik-Wächter (`allquantor`: Allquantor, Relativsatz, Lesewort im selben Satz)
 * ist unbegrenzt und mit Mustern nie vollständig; es braucht die Begrenzung (`begrenzung`). Grenze: nur dieses kleine Satzmuster
 * (Allquantor, Relativsatz, Lesewort ohne Satzende dazwischen); andere Formulierungen desselben Anspruchs erkennt das Gate nicht.
 */

const LISTENPUNKT = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

/** Prüft den Wörterbuch-Block und baut daraus Regexe und Meldungen; wirft ohne (vollständigen) Block. Pur. */
function wortschatz(sprache) {
  const fehlt = (was) => new Error(`sprache fehlt oder ist unvollständig (${was}); das Spezifikations-Gate hat keinen stillen Deutsch-Standardwert\nFix: den Schlüssel sprache.spezifikation in .factory/projekt.json eintragen`);
  const s = sprache;
  if (typeof s !== "object" || s === null) throw fehlt("kein Objekt");
  const text = (v) => typeof v === "string" && v.trim() !== "";
  if (!text(s.ziel) || !text(s.nachMerge)) throw fehlt("ziel, nachMerge");
  if (!Array.isArray(s.akzeptanzkriterien) || s.akzeptanzkriterien.length === 0 || !s.akzeptanzkriterien.every(text)) throw fehlt("akzeptanzkriterien");
  const muster = (k) => {
    const w = s[k];
    if (!text(w?.wort) || !text(w?.muster)) throw fehlt(k);
    return { wort: w.wort, re: new RegExp(w.muster, "i") };
  };
  const negativ = muster("negativfall");
  const begrenzung = muster("begrenzung");
  const allquantor = muster("allquantor");
  const ak = s.akzeptanzkriterien[0];
  return {
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
      allquantor: (k) => `${k}: Allquantor („${allquantor.wort}“) auf einen Heuristik-Wächter ist unbegrenzt: die Begrenzung als geschlossene Liste nennen („${begrenzung.wort} …“)`,
    },
  };
}

/** Zeilen je Abschnitt (Überschrift Ebene 2 mit einem der Namen aus `namen`, als Text verglichen, Groß-/Kleinschreibung egal); Code-Fences zählen nicht, `###` gehört zum Abschnitt. `null` = Abschnitt fehlt. */
function abschnitt(body, namen) {
  const klein = namen.map((n) => n.toLowerCase());
  let drin = false;
  let gefunden = false;
  let fence = false;
  const zeilen = [];
  for (const zeile of String(body ?? "").split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(zeile)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
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

