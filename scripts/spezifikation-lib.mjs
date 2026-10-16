// Lib ohne Direktaufruf-Guard; Aufrufer: die Ticket-Auswahl (naechstes-ticket.mjs) und der Anlege-/Reparaturweg (spezifikation.mjs).
/**
 * Spezifikations-Gate (ADR 0022 F12): Der Eingang ist eine Spezifikation. Ein Ticket braucht `## Ziel` und `## Akzeptanzkriterien` (Liste)
 * mit mindestens einem Negativfall (ein Kriterium mit dem Wort „Negativfall“). Alles pur, ohne Importe und ohne Projektliterale.
 * Ausnahmen (Sammel-, Status-, Epic-Tickets) entscheidet der Aufrufer über das Prädikat `ausgenommen`; Bestand (Nummer unter `hartAb`)
 * wird nur berichtet, Neues ist hart.
 */

const MANGEL = {
  zielFehlt: "`## Ziel` fehlt",
  zielLeer: "`## Ziel` ist leer",
  akFehlt: "`## Akzeptanzkriterien` fehlt",
  akOhneListe: "`## Akzeptanzkriterien` ohne Listenpunkt",
  keinNegativ: "kein Negativfall in den Akzeptanzkriterien (ein Kriterium mit dem Wort „Negativfall“)",
};

const LISTENPUNKT = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const NEGATIVFALL = /negativ-?f(?:a|ä)ll/i;

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
  const ak = abschnitt(body, "(?:Teil-)?Akzeptanzkriterien"); // „Teil-Akzeptanzkriterien“ ist die Überschrift gebündelter Befund-Issues
  if (ak === null) {
    maengel.push(MANGEL.akFehlt);
  } else {
    if (!ak.some((z) => LISTENPUNKT.test(z))) maengel.push(MANGEL.akOhneListe);
    if (!ak.some((z) => NEGATIVFALL.test(z))) maengel.push(MANGEL.keinNegativ);
  }
  return maengel;
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
    .filter((z) => z !== "" && !/^(?:```|~~~)/.test(z) && !/^#{1,2}\s/.test(z) && !/^[-*_=]+$/.test(z))
    .filter((z) => !da.has(norm(z)));
}

