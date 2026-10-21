// Lib ohne Direktaufruf-Guard; Aufrufer: die Ticket-Auswahl (naechstes-ticket.mjs) und der Anlege-/Reparaturweg (spezifikation.mjs).
/**
 * Spezifikations-Gate (ADR 0022 F12): Der Eingang ist eine Spezifikation. Ein Ticket braucht `## Ziel` und `## Akzeptanzkriterien` (Liste)
 * mit mindestens einem Negativfall (ein Kriterium mit dem Wort „Negativfall“). Alles pur, ohne Importe und ohne Projektliterale.
 * Ausnahmen (Sammel-, Status-, Epic-Tickets) entscheidet der Aufrufer über das Prädikat `ausgenommen`; Bestand (Nummer unter `hartAb`)
 * wird nur berichtet, Neues ist hart.
 * Ticketzuschnitt (#1808): ein Allquantor-Kriterium auf einen Heuristik-Wächter („jede/alle … die … liest/verwendet/gelesen“ im selben Satz)
 * ist unbegrenzt und mit Mustern nie vollständig; es braucht die Begrenzung „bekannte Muster:“. Grenze: nur dieses kleine Satzmuster
 * (Allquantor, Relativsatz, Lesewort ohne Satzende dazwischen); andere Formulierungen desselben Anspruchs erkennt das Gate nicht.
 */

const MANGEL = {
  zielFehlt: "`## Ziel` fehlt",
  zielLeer: "`## Ziel` ist leer",
  akFehlt: "`## Akzeptanzkriterien` fehlt",
  akOhneListe: "`## Akzeptanzkriterien` ohne Listenpunkt",
  keinNegativ: "kein Negativfall in den Akzeptanzkriterien (ein Kriterium mit dem Wort „Negativfall“)",
  alleNachMerge: "alle Akzeptanzkriterien beginnen mit „Nach dem Merge:“: die Abnahme hätte nichts zu prüfen (mindestens ein Kriterium muss vor dem Merge prüfbar sein)",
};

/** Präfix eines Kriteriums, das erst nach dem Merge erfüllbar ist; die Abnahme prüft es nicht, der Umsetzer liefert den Beleg als PR-Kommentar. */
export const NACH_MERGE_PRAEFIX = "Nach dem Merge:";

const ALLQUANTOR_LESEN = /\b(?:jede[rsnm]?|alle[nrsm]?)\b[^.!?]*\b(?:die|der|das|den)\b[^.!?]*\b(?:liest|lesen|gelesen|verwendet|verwenden)\b/i;
const BEGRENZUNG = /bekannte\s+Muster\s*:/i;
const maengelAllquantor =(k) => `${k}: Allquantor („jede/alle … die … liest“) auf einen Heuristik-Wächter ist unbegrenzt: die Begrenzung als geschlossene Liste nennen („bekannte Muster: …“)`;

const LISTENPUNKT = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const NEGATIVFALL = /negativ-?f(?:a|ä)ll/i;
/** Überschrift der Kriterien; „Teil-Akzeptanzkriterien“ ist die Überschrift gebündelter Befund-Issues. */
const AK_NAME = "(?:Teil-)?Akzeptanzkriterien";

/** Zeilen je Abschnitt (Überschrift Ebene 2 mit exakt `name`); Code-Fences zählen nicht, `###` gehört zum Abschnitt. `null` = Abschnitt fehlt. */
function abschnitt(body, name) {
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
      drin = new RegExp(`^##\\s+${name}\\s*$`, "i").test(zeile);
      gefunden = gefunden || drin;
      continue;
    }
    if (drin) zeilen.push(zeile);
  }
  return gefunden ? zeilen : null;
}

/** Mängel einer Spezifikation als Textliste (leer = vollständig). Pur. */
export function spezifikationsMaengel(body) {
  const maengel = [];
  const ziel = abschnitt(body, "Ziel");
  if (ziel === null) maengel.push(MANGEL.zielFehlt);
  else if (ziel.every((z) => z.trim() === "")) maengel.push(MANGEL.zielLeer);
  const ak = abschnitt(body, AK_NAME);
  if (ak === null) {
    maengel.push(MANGEL.akFehlt);
  } else {
    if (!ak.some((z) => LISTENPUNKT.test(z))) maengel.push(MANGEL.akOhneListe);
    if (!ak.some((z) => NEGATIVFALL.test(z))) maengel.push(MANGEL.keinNegativ);
    const liste = kriterien(body);
    if (liste.length > 0 && liste.every((c) => c.nachMerge)) maengel.push(MANGEL.alleNachMerge);
    for (const c of liste) if (ALLQUANTOR_LESEN.test(c.text.replace(/\s+/g, " ")) && !BEGRENZUNG.test(c.text)) maengel.push(maengelAllquantor(c.k));
  }
  return maengel;
}

const einzug = (z) => z.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
const ohneMarker = (z) => z.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s*/, "");

/**
 * Die Akzeptanzkriterien als `[{k:"K1", text}, …]` (Abschnitt wie im Spezifikations-Gate). Ein Kriterium ist ein Listenpunkt der obersten Ebene
 * (kleinster Einzug); tiefer eingerückte Listenpunkte und Folgezeilen (direkt anschließend oder nach einer Leerzeile eingerückt) gehören zu ihm, eine
 * nicht eingerückte Prosazeile nach einer Leerzeile und eine `###`-Überschrift beenden es. Die Nummer ist die Position im Abschnitt, nicht die
 * Ziffer des Autors. `nachMerge` ist wahr, wenn der Text mit `NACH_MERGE_PRAEFIX` beginnt. Fehlender Abschnitt oder keine Liste: `[]`. Pur.
 */
export function kriterien(body) {
  const zeilen = abschnitt(body, AK_NAME);
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
  return ergebnis.map((teile, i) => ({ k: `K${i + 1}`, text: teile.join("\n"), nachMerge: teile[0].startsWith(NACH_MERGE_PRAEFIX) }));
}

/** Epic- und Phasen-Titel (eigenes Format, vom Gate ausgenommen): beginnt mit „Epic“ oder „Phase“, optional hinter 📦. Pur. */
export function istEpicTitel(titel) {
  return /^\s*(?:📦\s*)?(?:epic|phase)\b/i.test(String(titel ?? ""));
}

/**
 * Einstufung eines Tickets `{ nummer, titel, body }`: `ausgenommen` (Prädikat `ausgenommen`), `ok`, `bestand` (Nummer unter `hartAb`,
 * nur berichten) oder `hart` (überspringen); bei `bestand`/`hart` die Mängel in `fehlt`. Pur.
 */
export function pruefeEingang(ticket, { ausgenommen = () => false, hartAb = 0 } = {}) {
  if (ausgenommen(ticket)) return { art: "ausgenommen" };
  const fehlt = spezifikationsMaengel(ticket.body);
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

