/* Aufruf-Fehler der über `flagsLesen` migrierten Skripte (#1789, #1790): jedes Skript wird als Prozess gestartet, mit
 * unbekanntem Flag, mit einem Flag ohne Wert und mit einem doppelten Einzel-Flag. Geprüft werden Exit-Code und der
 * stderr-Rahmen (Präfix, Meldung, Aufrufzeile). PATH enthält nur den Ordner von node: ohne gh, git und Netz. */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";

interface Zeile {
  skript: string;
  exit: number;
  /** Erste Zeile von stderr: Rahmen samt Meldung. */
  erste: (meldung: string) => string;
  /** Rest von stderr (Aufrufzeile); leer, wenn der Rahmen einzeilig ist. */
  aufruf: RegExp;
  faelle: { unbekannt: string[]; ohneWert: string[]; doppelt: string[] };
  meldungen: { unbekannt: string; ohneWert: string; doppelt: string };
}

const BEIDE = ["--von", "2026-01-01", "--bis", "2026-02-01"];
const STD = { unbekannt: "Unbekanntes Argument: --bogus" };

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
];

/** Prozessumgebung ohne gh und git: PATH (jede Schreibweise) nur mit dem Ordner von node. */
function umgebung(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (k.toUpperCase() !== "PATH") env[k] = v;
  env.PATH = dirname(process.execPath);
  return env;
}

function starte(skript: string, argv: string[]): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [`scripts/${skript}.mjs`, ...argv], { encoding: "utf8", env: umgebung(), timeout: 60_000 });
  return { status: r.status, stderr: r.stderr };
}

const FAELLE = ZEILEN.flatMap((z) => (["unbekannt", "ohneWert", "doppelt"] as const).map((fall) => [z.skript, fall, z] as const));

describe("Aufruf-Fehler der migrierten Skripte", () => {
  test.concurrent.each(FAELLE)("%s: %s", { timeout: 60_000 }, (_skript, fall, z) => {
    const r = starte(z.skript, z.faelle[fall]);
    expect(r.status).toBe(z.exit);
    const zeilen = r.stderr.split("\n");
    expect(zeilen[0]).toBe(z.erste(z.meldungen[fall]));
    expect(r.stderr).toMatch(z.aufruf);
  });

  const ZUSATZ: [string, string[], number, string][] = [
    ["token-baseline", ["--json"], 2, "Aufruf: node scripts/token-baseline.mjs --session <id> [--issue <nr>] [--pr <nr>] [--from <ISO>] [--langfuse] [--json]"],
    ["factory-sync", ["--trocken"], 2, "factory-sync: --quelle <pfad> fehlt"],
    ["factory-kennzahlen", ["--bis", "2026-01-01"], 1, "--von und --bis brauchen je ein gültiges ISO-Datum."],
    ["claims-pruefen", ["x"], 2, "✖ claims-pruefen: unbekanntes Argument: x"],
    ["langfuse-nachliefern", ["--bogus", "--ausloeser", "x"], 2, "Unbekanntes Argument: --bogus"],
    ["pr-warten", ["abc"], 3, "PR-Nummer erwartet, nicht abc"],
    ["pr-warten", ["12", "13"], 3, "Unbekanntes Argument: 13"],
    ["lauf-ergebnis", ["--start-agent"], 1, "--start-agent erwartet einen Agent-Typ"],
    ["kontext-treiber", ["--ticket"], 2, "--ticket erwartet eine Ticketnummer, nicht nichts"],
    ["kontext-treiber", ["--delta", "vielleicht"], 2, "--delta erwartet ja|nein, nicht vielleicht"],
  ];
  test.concurrent.each(ZUSATZ)("%s %j: weitere Aufruf-Fehler (Pflicht-Flag, Positionsargument, Reihenfolge, Datumsprüfung)", { timeout: 60_000 }, (skript, argv, exit, erste) => {
    const r = starte(skript, argv);
    expect(r.status).toBe(exit);
    expect(r.stderr.split("\n")[0]).toBe(erste);
  });

  const WIEDERHOLBAR: [string, string[], number, RegExp][] = [
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
});
