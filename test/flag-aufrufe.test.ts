/* Aufruf-Fehler der über `flagsLesen` migrierten Skripte (#1789, #1790, #1791, #1817): jedes Skript wird als Prozess gestartet, mit
 * unbekanntem Flag, mit einem Flag ohne Wert und mit einem doppelten Einzel-Flag. Geprüft werden Exit-Code und der
 * stderr-Rahmen (Präfix, Meldung, Aufrufzeile). PATH enthält nur den Ordner von node: ohne gh, git und Netz. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { faelleAus, maskiere, nurSchalter, pruefeFall, STD, starte, type Zeile } from "./support/flag-aufruf";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const BEIDE = ["--von", "2026-01-01", "--bis", "2026-02-01"];
const BOARD_USAGE = "Aufruf: board-place.mjs [--dry-run] ([--notfall <art>] --top <nr>... | --after <ankernr> <nr>... | --position <N> <nr> | --missing | --umzug)";
const SAMMEL_USAGE = "Aufruf: sammelticket-anlegen.mjs harness [--vorgaenger <nr>] [--dry-run] | langfuse [--top] [--dry-run]";
const SPEZ_AUFRUF = [
  "Aufruf:",
  "  node scripts/spezifikation.mjs pruefen --body-datei <pfad>",
  '  node scripts/spezifikation.mjs anlegen --titel "<t>" --body-datei <pfad> --label area:<x> [--label <l> …] (--nach <nr> | --notfall <art>) [--blocker <nr> …]',
  "  node scripts/spezifikation.mjs reparieren <nr> --body-datei <pfad>",
  '  node scripts/spezifikation.mjs gescheitert <nr> --mangel "<text>"',
].join("\n");
const ABNAHME_AUFRUF = [
  "Aufruf:",
  "  node scripts/abnahme.mjs kriterien <nr>",
  "  node scripts/abnahme.mjs auswerten <nr> --pr <pr> --bericht <datei> --worktree <pfad> --head <sha>",
].join("\n");

const ZEILEN: Zeile[] = [
  {
    skript: "claims-pruefen",
    exit: 2,
    erste: (m) => `✖ claims-pruefen: ${m}`,
    aufruf: /^Aufruf: claims-pruefen \[--json\] \[--stunden <n>\]$/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--stunden"], doppelt: ["--json", "--json"] },
    meldungen: { unbekannt: "unbekanntes Argument: --bogus", ohneWert: "--stunden braucht eine positive Zahl (bekam: nichts)", doppelt: "--json ist doppelt angegeben" },
  },
  {
    skript: "factory-kennzahlen",
    exit: 1,
    erste: (m) => m,
    aufruf: /^Aufruf: node scripts\/factory-kennzahlen\.mjs --von <ISO> --bis <ISO>/m,
    faelle: { unbekannt: [...BEIDE, "--bogus"], ohneWert: ["--von"], doppelt: [...BEIDE, "--von", "2026-01-02"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--von und --bis brauchen je ein gültiges ISO-Datum.", doppelt: "--von ist doppelt angegeben" },
  },
  {
    skript: "factory-sync",
    exit: 2,
    erste: (m) => `factory-sync: ${m}`,
    aufruf: /^Aufruf: node scripts\/factory-sync\.mjs --quelle <pfad>/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--quelle"], doppelt: ["--quelle", "a", "--quelle", "b"] },
    meldungen: { unbekannt: "unbekannte Option '--bogus'", ohneWert: "--quelle braucht einen Pfad", doppelt: "--quelle ist doppelt angegeben" },
  },
  {
    skript: "fremdtext",
    exit: 2,
    erste: (m) => `✖ fremdtext: ${m}`,
    aufruf: /\n$/,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--issue"], doppelt: ["--issue", "1", "--issue", "2"] },
    meldungen: { unbekannt: "Aufruf: node scripts/fremdtext.mjs --issue <nr> | --pr <nr>", ohneWert: "Aufruf: node scripts/fremdtext.mjs --issue <nr> | --pr <nr>", doppelt: "Aufruf: node scripts/fremdtext.mjs --issue <nr> | --pr <nr>" },
  },
  {
    skript: "langfuse-nachliefern",
    exit: 2,
    erste: (m) => m,
    aufruf: /^Aufruf: node scripts\/langfuse-nachliefern\.mjs \[--session <id>\]/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--seit"], doppelt: ["--trocken", "--trocken"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--seit braucht einen Wert", doppelt: "--trocken ist doppelt angegeben" },
  },
  {
    skript: "token-baseline",
    exit: 2,
    erste: (m) => m,
    aufruf: /^Aufruf: node scripts\/token-baseline\.mjs --session <id>/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--session"], doppelt: ["--issue", "1", "--issue", "2"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--session braucht einen Wert", doppelt: "--issue ist doppelt angegeben" },
  },
  {
    skript: "abnahme",
    exit: 2,
    erste: (m) => `✖ abnahme: ${m}`,
    aufruf: /^ {2}node scripts\/abnahme\.mjs auswerten/m,
    faelle: { unbekannt: ["auswerten", "--bogus"], ohneWert: ["auswerten", "7", "--pr"], doppelt: ["auswerten", "7", "--pr", "1", "--pr", "2"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--pr braucht einen Wert", doppelt: "--pr ist doppelt angegeben" },
  },
  {
    skript: "spezifikation",
    exit: 2,
    erste: (m) => `✖ spezifikation: ${m}`,
    aufruf: /^ {2}node scripts\/spezifikation\.mjs pruefen/m,
    faelle: { unbekannt: ["pruefen", "--bogus"], ohneWert: ["pruefen", "--body-datei"], doppelt: ["pruefen", "--body-datei", "a", "--body-datei", "b"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--body-datei braucht einen Wert", doppelt: "--body-datei ist doppelt angegeben" },
  },
  {
    skript: "board-place",
    exit: 2,
    erste: (m) => m,
    aufruf: /^Aufruf: board-place\.mjs /m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--notfall"], doppelt: ["--dry-run", "--dry-run", "--top", "1"] },
    meldungen: { unbekannt: BOARD_USAGE, ohneWert: BOARD_USAGE, doppelt: BOARD_USAGE },
  },
  {
    skript: "sammelticket-anlegen",
    exit: 2,
    erste: (m) => m,
    aufruf: /^Aufruf: sammelticket-anlegen\.mjs /m,
    faelle: { unbekannt: ["harness", "--bogus"], ohneWert: ["harness", "--vorgaenger"], doppelt: ["harness", "--dry-run", "--dry-run"] },
    meldungen: { unbekannt: SAMMEL_USAGE, ohneWert: SAMMEL_USAGE, doppelt: SAMMEL_USAGE },
  },
  {
    skript: "hauptchat-zerlegung",
    exit: 2,
    erste: (m) => m,
    aufruf: /^Aufruf: node scripts\/hauptchat-zerlegung\.mjs --von <ISO> --bis <ISO>/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--von"], doppelt: ["--json", "--json"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--von braucht einen Wert", doppelt: "--json ist doppelt angegeben" },
  },
  {
    skript: "kontext-treiber",
    exit: 2,
    erste: (m) => m,
    aufruf: /^Aufruf: node scripts\/kontext-treiber\.mjs --von <ISO>/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--agent"], doppelt: ["--agent", "a", "--agent", "b"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--agent braucht einen Wert", doppelt: "--agent ist doppelt angegeben" },
  },
  {
    skript: "langfuse-abgleich",
    exit: 2,
    erste: (m) => m,
    aufruf: /^Aufruf: node scripts\/langfuse-abgleich\.mjs --pruefen/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--seit"], doppelt: ["--session", "a", "--session", "b"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--seit braucht einen Wert", doppelt: "--session ist doppelt angegeben" },
  },
  {
    skript: "lauf-ergebnis",
    exit: 1,
    erste: (m) => m,
    aufruf: /^Aufruf: node scripts\/lauf-ergebnis\.mjs --von <ISO> --bis <ISO>/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--von"], doppelt: ["--json", "--json"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--von braucht einen Wert", doppelt: "--json ist doppelt angegeben" },
  },
  {
    skript: "subagent-laufzeit",
    exit: 2,
    erste: (m) => m,
    aufruf: /^Aufruf: node scripts\/subagent-laufzeit\.mjs --von <ISO>/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--schnitt"], doppelt: ["--agent", "a", "--agent", "b"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--schnitt braucht einen Wert", doppelt: "--agent ist doppelt angegeben" },
  },
  {
    skript: "pr-warten",
    exit: 3,
    erste: (m) => m,
    aufruf: /^Aufruf: node scripts\/pr-warten\.mjs <pr>/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--intervall"], doppelt: ["--intervall", "5", "--intervall", "6"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--intervall braucht einen Wert", doppelt: "--intervall ist doppelt angegeben" },
  },
  {
    skript: "check-factory-drift",
    exit: 2,
    erste: (m) => `check-factory-drift: ${m}`,
    aufruf: /^Aufruf: node scripts\/check-factory-drift\.mjs \[--wurzel <pfad>\]$/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--wurzel"], doppelt: ["--wurzel", "a", "--wurzel", "b"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--wurzel braucht einen Wert", doppelt: "--wurzel ist doppelt angegeben" },
  },
  {
    skript: "mcp-ausfall",
    exit: 2,
    erste: (m) => `${m}. Aufruf: node scripts/mcp-ausfall.mjs [--sessionstart] [--json] [--seit <ISO|Nh>]`,
    aufruf: /\. Aufruf: node scripts\/mcp-ausfall\.mjs \[--sessionstart\]/,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--seit"], doppelt: ["--json", "--json"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--seit braucht einen Wert", doppelt: "--json ist doppelt angegeben" },
  },
  {
    skript: "naechstes-ticket",
    exit: 2,
    erste: (m) => `✖ naechstes-ticket: ${m}`,
    aufruf: /\n$/,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--bereich"], doppelt: ["--bereich", "produkt", "--bereich", "agentic"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--bereich erwartet agentic oder produkt (bekommen: nichts)", doppelt: "--bereich ist doppelt angegeben" },
  },
  {
    skript: "ticket-lock",
    exit: 2,
    erste: (m) => `✖ ticket-lock: ${m}`,
    aufruf: /^Aufruf: claim <nr> \[--wiederaufnahme\] \| pruefe <nr>/m,
    faelle: { unbekannt: ["claim", "999999", "--bogus"], ohneWert: ["pruefe", "999999", "--nonce"], doppelt: ["pruefe", "999999", "--nonce", "a", "--nonce", "b"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--nonce braucht einen Wert", doppelt: "--nonce ist doppelt angegeben" },
  },
  nurSchalter("wiedervorlage", "--dry-run", "Aufruf: node scripts/wiedervorlage.mjs [--dry-run]"),
  nurSchalter("budget-pacing", "--json", "Aufruf: node scripts/budget-pacing.mjs [--json] [--ohne-probe]"),
  nurSchalter("check-any-suppressions", "--write", "Aufruf: node scripts/check-any-suppressions.mjs [--write]"),
  nurSchalter("cleanup-worktrees", "--fix", "Aufruf: node scripts/cleanup-worktrees.mjs [--branches] [--fix]"),
  nurSchalter("gh-kontingent", "--bericht", "Aufruf: node scripts/gh-kontingent.mjs [--bericht]"),
  nurSchalter("verify-lauf", "--changed", "Aufruf: node scripts/verify-lauf.mjs [--changed]"),
  {
    skript: "langfuse-vorbedingung",
    exit: 2,
    erste: (m) => `${m}. Aufruf: node scripts/langfuse-vorbedingung.mjs [--sessionstart | --json]`,
    aufruf: new RegExp(maskiere(". Aufruf: node scripts/langfuse-vorbedingung.mjs [--sessionstart | --json]")),
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--sessionstart=x"], doppelt: ["--sessionstart", "--sessionstart"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "Unbekanntes Argument: --sessionstart=x", doppelt: "--sessionstart ist doppelt angegeben" },
  },
  {
    skript: "check-internalrefs",
    exit: 2,
    erste: (m) => m,
    aufruf: new RegExp(`^${maskiere("Aufruf: node scripts/check-internalrefs.mjs [--add <begriff> | --add-name <begriff> | --text]")}$`, "m"),
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--add"], doppelt: ["--add", "x", "--add", "y"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--add braucht einen Wert", doppelt: "--add ist doppelt angegeben" },
  },
  {
    skript: "docs-gen",
    exit: 2,
    erste: (m) => `✖ ${m}`,
    aufruf: new RegExp(`^${maskiere("Fix: Aufruf: node scripts/docs-gen.mjs [--write] [--config <pfad>]")}$`, "m"),
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--config"], doppelt: ["--write", "--write"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--config braucht einen Wert", doppelt: "--write ist doppelt angegeben" },
  },
  {
    skript: "projekt-config",
    exit: 2,
    erste: (m) => `✖ ${m}`,
    aufruf: new RegExp(`^${maskiere("Fix: node scripts/projekt-config.mjs [--config <pfad>] <schluessel.pfad>")}$`, "m"),
    faelle: { unbekannt: ["--bogus", "repo"], ohneWert: ["--config"], doppelt: ["--config", "a", "--config", "b", "repo"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--config braucht einen Wert", doppelt: "--config ist doppelt angegeben" },
  },
  {
    skript: "haupt-sync",
    exit: 2,
    erste: (m) => `haupt-sync: ${m}`,
    aufruf: /^Aufruf: node scripts\/haupt-sync\.mjs \[--text\] \[--streng\] \[--danach <skript>\]$/m,
    faelle: { unbekannt: ["--bogus"], ohneWert: ["--danach"], doppelt: ["--text", "--text"] },
    meldungen: { unbekannt: STD.unbekannt, ohneWert: "--danach braucht einen Wert", doppelt: "--text ist doppelt angegeben" },
  },
];

const FAELLE = faelleAus(ZEILEN);

describe("Aufruf-Fehler der migrierten Skripte", () => {
  test.concurrent.each(FAELLE)("%s: %s", { timeout: 60_000 }, (_skript, fall, z) => {
    pruefeFall(z, fall);
  });

  const ZUSATZ: [string, string[], number, string][] = [
    ["token-baseline", ["--json"], 2, "Aufruf: node scripts/token-baseline.mjs --session <id> [--issue <nr>] [--pr <nr>] [--from <ISO>] [--langfuse] [--json] [--config <pfad>]"],
    ["factory-sync", ["--trocken"], 2, "factory-sync: --quelle <pfad> fehlt"],
    ["factory-kennzahlen", ["--bis", "2026-01-01"], 1, "--von und --bis brauchen je ein gültiges ISO-Datum."],
    ["claims-pruefen", ["x"], 2, "✖ claims-pruefen: unbekanntes Argument: x"],
    ["langfuse-nachliefern", ["--bogus", "--ausloeser", "x"], 2, "Unbekanntes Argument: --bogus"],
    ["board-place", ["--top", "5", "--notfall", "rot-main"], 2, BOARD_USAGE], // --notfall nur unmittelbar vor --top
    ["abnahme", ["kriterien", "7", "8"], 2, "✖ abnahme: Unbekanntes Argument: 8"],
    ["spezifikation", ["gibtsnicht", "--bogus"], 2, "✖ spezifikation: unbekannter Befehl „gibtsnicht“"],
    ["hauptchat-zerlegung", ["x"], 2, "Unbekanntes Argument: x"],
    ["kontext-treiber", ["x"], 2, "Unbekanntes Argument: x"],
    ["langfuse-abgleich", ["x"], 2, "Unbekanntes Argument: x"],
    ["lauf-ergebnis", ["x"], 1, "Unbekanntes Argument: x"],
    ["subagent-laufzeit", ["x"], 2, "Unbekanntes Argument: x"],
    ["subagent-laufzeit", ["--ohne"], 2, "--ohne erwartet eine Ticketnummer, nicht nichts"],
    ["pr-warten", ["abc"], 3, "PR-Nummer erwartet, nicht abc"],
    ["pr-warten", ["12", "13"], 3, "Unbekanntes Argument: 13"],
    ["lauf-ergebnis", ["--start-agent"], 1, "--start-agent erwartet einen Agent-Typ"],
    ["kontext-treiber", ["--ticket"], 2, "--ticket erwartet eine Ticketnummer, nicht nichts"],
    ["kontext-treiber", ["--delta", "vielleicht"], 2, "--delta erwartet ja|nein, nicht vielleicht"],
    ["naechstes-ticket", [], 2, "✖ naechstes-ticket: Aufruf ohne Auswahl: --bereich agentic|produkt (oberstes freies Ticket des Bereichs) oder --ticket <nr> (Einzelprüfung)"],
    ["naechstes-ticket", ["--ticket", "1", "--bereich", "produkt"], 2, "✖ naechstes-ticket: --ticket und --bereich schließen sich aus"],
    ["naechstes-ticket", ["--bereich", "spiel", "--ticket", "1"], 2, "✖ naechstes-ticket: --ticket und --bereich schließen sich aus"], // Alias der Repo-Config im Direktaufruf (#1943)
    ["naechstes-ticket", ["--config", "test/fixtures/projekt-fremd.json", "--bereich", "spiel"], 2, "✖ naechstes-ticket: --bereich erwartet agentic oder produkt (bekommen: „spiel“)"], // Config ohne Alias (#1943)
    ["ticket-lock", ["claim", "999999", "--nonce", "x"], 2, "✖ ticket-lock: Unbekanntes Argument: --nonce"],
    ["ticket-lock", ["freigeben", "999999"], 2, "✖ ticket-lock: --nonce fehlt"],
    ["ticket-lock", ["pruefe", "999999", "--nonce", ""], 2, "✖ ticket-lock: --nonce braucht einen Wert"],
    ["ticket-lock", ["lebenszeichen", "999999", "--commit"], 2, "✖ ticket-lock: Unbekanntes Argument: --commit"],
    ["ticket-lock", ["toString", "1"], 2, "✖ ticket-lock: unbekannter Befehl toString"], // Prototyp-Namen sind keine Befehle (Object.hasOwn)
    ["ticket-lock", ["__proto__", "1"], 2, "✖ ticket-lock: unbekannter Befehl __proto__"],
    ["ticket-lock", ["constructor", "1"], 2, "✖ ticket-lock: unbekannter Befehl constructor"],
    ["haupt-sync", ["x"], 2, "haupt-sync: Unbekanntes Argument: x"],
    ["projekt-config", ["repo", "zwei"], 2, "✖ Unbekanntes Argument: zwei"],
    ["projekt-config", [], 2, "✖ Schlüssel fehlt"],
    ["board-takt", ["--bogus"], 2, "board-takt: Unbekanntes Argument: --bogus"],
    ["board-takt", ["--dry-run", "--dry-run"], 2, "board-takt: --dry-run ist doppelt angegeben"],
  ];
  test.concurrent.each(ZUSATZ)("%s %j: weitere Aufruf-Fehler (Pflicht-Flag, Positionsargument, Reihenfolge, Datumsprüfung)", { timeout: 60_000 }, (skript, argv, exit, erste) => {
    const r = starte(skript, argv);
    expect(r.status).toBe(exit);
    expect(r.stderr.split("\n")[0]).toBe(erste);
    expect(r.stdout).toBe("");
  });

  const WIEDERHOLBAR:[string, string[], number, RegExp][] = [
    ["kontext-treiber", ["--ticket", "1", "--ticket", "2", "--ohne", "3", "--ohne", "4"], 2, /^Aufruf: node scripts\/kontext-treiber\.mjs/],
    ["subagent-laufzeit", ["--ticket", "1", "--ticket", "2", "--ohne", "3", "--ohne", "4"], 2, /^Aufruf: node scripts\/subagent-laufzeit\.mjs/],
    ["lauf-ergebnis", ["--ticket", "1", "--ticket", "2", "--ohne", "3", "--ohne", "4"], 1, /^Aufruf: node scripts\/lauf-ergebnis\.mjs/],
    ["hauptchat-zerlegung", ["--brain", "a", "--brain", "b"], 2, /^Aufruf: node scripts\/hauptchat-zerlegung\.mjs/],
    ["langfuse-abgleich", ["--ist", "a", "--ist", "b"], 2, /^Aufruf: node scripts\/langfuse-abgleich\.mjs/],
  ];
  test.concurrent.each(WIEDERHOLBAR)("%s %j: wiederholbare Flags sind kein Aufruf-Fehler", { timeout: 60_000 }, (skript, argv, exit, aufruf) => {
    const r = starte(skript, argv);
    expect(r.status).toBe(exit);
    expect(r.stderr).toMatch(aufruf);
    expect(r.stderr).not.toContain("doppelt");
    expect(r.stderr).not.toContain("Unbekanntes");
  });

  test.concurrent("fremdtext: beide Flags und --issue= ergeben die Aufrufzeile (fail-closed)", { timeout: 60_000 }, () => {
    for (const argv of [["--issue", "1", "--pr", "2"], ["--issue="], ["--issue=1", "--pr=2"]]) {
      const r = starte("fremdtext", argv);
      expect(r.status).toBe(2);
      expect(r.stderr).toBe("✖ fremdtext: Aufruf: node scripts/fremdtext.mjs --issue <nr> | --pr <nr>\n");
    }
  });

  test.concurrent("Aufruf-Fehler hängen nicht vom Arbeitsverzeichnis ab (cwd = Temp-Ordner)", { timeout: 60_000 }, () => {
    const r = starte("spezifikation", ["gibtsnicht"], tmpdir());
    expect(r.status).toBe(2);
    expect(r.stderr.split("\n")[0]).toBe("✖ spezifikation: unbekannter Befehl „gibtsnicht“");
  });

  test.concurrent("Options-Terminator `--` ist überall ein Aufruf-Fehler (zentral in flagsLesen)", { timeout: 60_000 }, () => {
    const faelle: [string, string[], number, string][] = [
      ["spezifikation", ["pruefen", "--"], 2, "✖ spezifikation: Unbekanntes Argument: --"],
      ["abnahme", ["kriterien", "--", "7"], 2, "✖ abnahme: Unbekanntes Argument: --"],
      ["sammelticket-anlegen", ["harness", "--"], 2, SAMMEL_USAGE],
      ["claims-pruefen", ["--"], 2, "✖ claims-pruefen: Unbekanntes Argument: --"],
    ];
    for (const [skript, argv, exit, erste] of faelle) {
      const r = starte(skript, argv);
      expect([skript, r.status]).toEqual([skript, exit]);
      expect([skript, r.stderr.split("\n")[0]]).toEqual([skript, erste]);
    }
  });

  test.concurrent("Direktaufruf: Aufruf-Fehler schreibt genau Meldung und Aufrufzeilen auf stderr, nichts auf stdout (kein I/O davor)", { timeout: 60_000 }, () => {
    for (const [skript, argv, erste, aufruf] of [
      ["spezifikation", ["gibtsnicht"], "✖ spezifikation: unbekannter Befehl „gibtsnicht“", SPEZ_AUFRUF],
      ["abnahme", [], "✖ abnahme: unbekannter Befehl (keiner)", ABNAHME_AUFRUF],
    ] as const) {
      const r = starte(skript, [...argv]);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(`${erste}\n${aufruf}\n`);
    }
  });

  test("Quellscan: echteIo wird nie als Fabrik `echteIo()` aufgerufen, nur als Referenz an direktaufruf", () => {
    for (const skript of ["abnahme", "spezifikation"]) {
      const quelle = readFileSync(join(ROOT, "scripts", `${skript}.mjs`), "utf8");
      expect(quelle).not.toMatch(/echteIo\(\)/);
      expect(quelle).toMatch(/io: \(\) => echteIo\(config\),/); // die Fabrik läuft erst im Rückruf, nach Aufruf- und Config-Prüfung
      expect(quelle).not.toMatch(/process\.std(out|err)\.write/); // Ausgabe nur über direktaufruf
    }
  });
});
