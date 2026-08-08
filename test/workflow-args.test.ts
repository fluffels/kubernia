/**
 * Fitness-Function für die args-Auswertung des Ticket-Workflows (#1027).
 *
 * WARUM DIESE TESTFORM: Die Parse-Logik lebt in .claude/workflows/kubernia-ticket.js
 * und lässt sich NICHT importieren — das Skript ruft auf Top-Level
 * `await ticketAbarbeiten()` gegen Globals, die nur die Workflow-Laufzeit stellt
 * (dieselbe Feststellung wie im Kopf von test/review-context.test.ts). Die
 * literaturseitig richtige Lösung — pure Logik in ein importierbares Modul
 * auslagern (Humble Object) — ist hier technisch versperrt: die Workflow-Laufzeit
 * lehnt Importe hart ab ("import() is not available in workflow scripts",
 * empirisch geprüft beim Anlegen dieses Tests).
 *
 * Darum wird der echte Funktionsblock zwischen zwei Markern ausgeschnitten und
 * per node:vm AUSGEFÜHRT. Das prüft echtes Verhalten des ausgelieferten Codes
 * statt seiner Textform — genau die Tautologie, die der #1034-Review an einer
 * reinen Regex-Prüfung entlarvt hat. Der Ausschnitt wird per indexOf gebildet
 * (CRLF-immun, siehe #1026).
 *
 * Diese Wahl ist GEMESSEN, nicht gemutmaßt: beide Varianten wurden gebaut und
 * gegen drei Mutationen des Parsers gestellt (Grenzwert 0 wird gültig / der
 * Resume-Pfad verliert die Antworten / das JSON-Entpacken greift nicht mehr).
 * Ergebnis 3:0 — diese Fassung wurde jedes Mal rot, die reine Textprüfung
 * jedes Mal fälschlich grün: sie belegt nur, dass bestimmte Zeichenketten
 * dastehen, nicht dass "965" wirklich als 965 ankommt.
 *
 * ⚠ GRENZE DIESES TESTS (ehrlich, Präzedenz test/model-routing.test.ts):
 * Er belegt, dass UNSERE Funktion Strings/JSON versteht — nicht, dass die
 * Workflow-Laufzeit weiterhin Strings schickt. Dass sie es tut, wurde für #1027
 * empirisch gemessen (auch ein übergebenes Objekt kommt als JSON-String an);
 * ändert die Laufzeit das, bleibt dieser Test grün und die Realität wandert weg.
 */
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

const WORKFLOW = new URL("../.claude/workflows/kubernia-ticket.js", import.meta.url)
const MARKER_ANFANG = "// ── args-Auswertung (#1027) — Anfang"
const MARKER_ENDE = "// ── args-Auswertung (#1027) — Ende"

const quelle = readFileSync(WORKFLOW, "utf8")

/** Schneidet den echten Funktionsblock aus dem Workflow-Skript. */
function funktionsBlock(): string {
  const start = quelle.indexOf(MARKER_ANFANG)
  const ende = quelle.indexOf(MARKER_ENDE)
  if (start === -1 || ende === -1 || ende <= start) {
    throw new Error(
      `Marker "${MARKER_ANFANG}" / "${MARKER_ENDE}" nicht (mehr) in ` +
        `.claude/workflows/kubernia-ticket.js gefunden. Wurde argsLesen() umbenannt oder ` +
        `verschoben? Dann die Marker mitziehen — dieser Test schneidet den Block daran aus.`,
    )
  }
  return quelle.slice(start, ende)
}

type ArgsErgebnis = { nummer?: number; klaerungAntworten?: unknown[]; fehler?: string }

const block = funktionsBlock()
// Der Cast nimmt das implizite any von runInNewContext weg (recommendedTypeChecked).
const argsLesen = runInNewContext(`${block}\nargsLesen`) as (roh: unknown) => ArgsErgebnis

describe("Workflow-args: Extraktion", () => {
  it("schneidet einen echten, nicht-leeren Teil der Datei aus", () => {
    expect(block.length).toBeGreaterThan(100)
    expect(block.length).toBeLessThan(quelle.length)
    expect(block).toContain("function argsLesen")
  })
})

describe("Workflow-args: gültige Ticketnummern", () => {
  // "965" als String ist DER Regressionsfall aus #1027: die Workflow-Laufzeit
  // reicht args als String durch, die alte Zeile prüfte nur auf number.
  it.each([
    ["Zahl", 965, 965],
    ["String", "965", 965],
    ["String mit Whitespace", "  965  ", 965],
    ["String mit Raute", "#965", 965],
    ["Objekt mit Zahl", { nummer: 965 }, 965],
    ["Objekt mit String", { nummer: "965" }, 965],
    ["JSON-String (so kommt ein Objekt real an)", '{"nummer": 965}', 965],
    ["JSON-String mit String-Nummer", '{"nummer": "965"}', 965],
  ])("%s -> 965", (_name, eingabe, erwartet) => {
    const ergebnis = argsLesen(eingabe)
    expect(ergebnis.fehler).toBeUndefined()
    expect(ergebnis.nummer).toBe(erwartet)
  })
})

describe("Workflow-args: keine Vorgabe = normale Board-Auswahl", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["leerer String", ""],
    ["nur Whitespace", "   "],
  ])("%s -> weder Nummer noch Fehler", (_name, eingabe) => {
    const ergebnis = argsLesen(eingabe)
    expect(ergebnis.nummer).toBeUndefined()
    expect(ergebnis.fehler).toBeUndefined()
  })
})

describe("Workflow-args: Resume-Pfad (klaerungAntworten)", () => {
  // Ohne diesen Pfad bräche der neue Abbruch-Zweig den Pre-Flight-Resume (#1012).
  it("erhält die Antworten aus einem JSON-String", () => {
    const ergebnis = argsLesen('{"klaerungAntworten": ["A", "B"]}')
    expect(ergebnis.fehler).toBeUndefined()
    expect(ergebnis.klaerungAntworten).toEqual(["A", "B"])
  })

  it("erhält Nummer UND Antworten gemeinsam", () => {
    const ergebnis = argsLesen('{"nummer": "965", "klaerungAntworten": ["A"]}')
    expect(ergebnis.fehler).toBeUndefined()
    expect(ergebnis.nummer).toBe(965)
    expect(ergebnis.klaerungAntworten).toEqual(["A"])
  })

  it("meldet keinen Fehler, wenn nur Antworten ohne Nummer kommen", () => {
    expect(argsLesen({ klaerungAntworten: ["A"] }).fehler).toBeUndefined()
  })
})

describe("Workflow-args: unbrauchbare Eingabe bricht ab, statt still zurückzufallen", () => {
  // Kernforderung aus #1027: ein stiller Fallback auf ein FREMDES Ticket ist
  // teurer als ein Abbruch (der Bug kostete ~275k Tokens am falschen Ticket).
  it.each([
    ["Buchstaben", "abc"],
    ["Ziffern mit Buchstabe", "96a5"],
    ["Kommazahl", "9.5"],
    ["Null", "0"],
    ["negativ", "-3"],
    ["Hex (Number() ergäbe 16)", "0x10"],
    ["boolean", true],
    ["Objekt mit Müll-Nummer", { nummer: "abc" }],
    ["Objekt mit Nummer 0", { nummer: 0 }],
    ["JSON-String mit Müll-Nummer", '{"nummer": "abc"}'],
    ["kaputtes JSON", "{nummer: 965"],
    // Vertippter Schlüssel: früher ein stiller Rückfall aufs Board-Item —
    // also exakt der Fehlmodus, den #1027 beenden soll.
    ["Objekt mit vertipptem Schlüssel", { nummber: 965 }],
    ["JSON-String mit vertipptem Schlüssel", '{"nummber": 965}'],
    ["leeres Objekt", {}],
    ["klaerungAntworten als String statt Liste", { klaerungAntworten: "A" }],
    ["Array statt Nummer", [965]],
    ["JSON-Array", "[965]"],
    ["Kommazahl als Zahl (nicht String)", 9.5],
    ["jenseits von Number.MAX_SAFE_INTEGER", "99999999999999999999"],
  ])("%s -> Fehler, keine Nummer", (_name, eingabe) => {
    const ergebnis = argsLesen(eingabe)
    expect(ergebnis.fehler).toBeTruthy()
    expect(ergebnis.nummer).toBeUndefined()
  })

  // Belegt, WARUM der Parser eine Regex statt blankem Number() nutzt: Number()
  // würde hier lautlos falsche bzw. Phantom-Nummern erzeugen.
  it("Number() wäre für diese Fälle die falsche Wahl", () => {
    expect(Number("0x10")).toBe(16)
    expect(Number(" ")).toBe(0)
    expect(Number("")).toBe(0)
  })
})

/**
 * Bewusst eine andere Test-Kategorie als die Blöcke oben: die prüfen VERHALTEN
 * (vm-ausgeführte Logik), dieser prüft STRUKTUR/Text — Fitness-Function-Art.
 * Beides steht hier zusammen, weil es dieselbe Regression bewacht; die Grenze
 * ist genau diese Notiz.
 *
 * ⚠ Was diese Prüfungen NICHT können: `ticketAbarbeiten()` ist nicht ausführbar
 * (Top-Level-await gegen Laufzeit-Globals), also belegen sie nur die REIHENFOLGE
 * im Quelltext, nicht die Erreichbarkeit zur Laufzeit. Ein in `if (false)`
 * eingewickelter Abbruch bliebe unbemerkt. Sie fangen den konkreten
 * Rückfall-in-die-alte-Zeile — mehr nicht, und das ehrlich benannt.
 */
describe("Workflow-args: der Orchestrator nutzt den Parser wirklich", () => {
  it("ruft argsLesen(args) auf und hat die alte typeof-number-Zeile nicht mehr", () => {
    expect(quelle).toContain("argsLesen(args)")
    expect(quelle).not.toContain("typeof args === 'number' ? args : args && args.nummer")
  })

  // Gegenstück zur Nummer-Zeile darüber: ohne diesen Riegel könnte der
  // Resume-Pfad unbemerkt auf die alte, nie greifende Form zurückfallen.
  it("speist auch klaerungAntworten aus der Normalisierung", () => {
    expect(quelle).toContain("eingabe.klaerungAntworten")
    expect(quelle).not.toContain("Array.isArray(args.klaerungAntworten)")
  })

  it("steht im Quelltext vor dem ersten Agenten-Aufruf", () => {
    const abbruch = quelle.indexOf("'ungueltige-args'")
    const ersterAgent = quelle.indexOf("const auswahl = await agent(")
    expect(abbruch).toBeGreaterThan(-1)
    expect(ersterAgent).toBeGreaterThan(-1)
    expect(abbruch).toBeLessThan(ersterAgent)
  })
})
