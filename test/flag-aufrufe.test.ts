/* Aufruf-Fehler der über `flagsLesen` migrierten Skripte (#1789): jedes Skript wird als Prozess gestartet, mit
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
    ["token-baseline", ["--json"], 2, "Aufruf: node scripts/token-baseline.mjs --session <id>"],
    ["factory-sync", ["--trocken"], 2, "factory-sync: --quelle <pfad> fehlt"],
    ["factory-kennzahlen", ["--bis", "2026-01-01"], 1, "--von und --bis brauchen je ein gültiges ISO-Datum."],
    ["claims-pruefen", ["x"], 2, "✖ claims-pruefen: unbekanntes Argument: x"],
    ["langfuse-nachliefern", ["--bogus", "--ausloeser", "x"], 2, "Unbekanntes Argument: --bogus"],
  ];
  test.concurrent.each(ZUSATZ)("%s %j: fehlendes Pflicht-Flag, Positionsargument, erster Fehler gewinnt", { timeout: 60_000 }, (skript, argv, exit, erste) => {
    const r = starte(skript, argv);
    expect(r.status).toBe(exit);
    expect(r.stderr.split("\n")[0]).toBe(erste);
  });

  test.concurrent("fremdtext: beide Flags und --issue= ergeben die Aufrufzeile (fail-closed)", { timeout: 60_000 }, () => {
    for (const argv of [["--issue", "1", "--pr", "2"], ["--issue="], ["--issue=1", "--pr=2"]]) {
      const r = starte("fremdtext", argv);
      expect(r.status).toBe(2);
      expect(r.stderr).toBe("✖ fremdtext: Aufruf: node scripts/fremdtext.mjs --issue <nr> | --pr <nr>\n");
    }
  });
});
