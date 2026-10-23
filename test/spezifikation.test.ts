/* Spezifikations-Gate, Schreibseite (#1698): anlegen nur geprüft, reparieren nur vertraute Tickets ohne Inhaltsverlust.
 * Alles über injizierte io: kein gh, kein Dateizugriff. Red-Green: die Prüfung vor `erzeuge`/`bearbeite` entfernen -> rot. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/spezifikation.mjs";
import { echteSprache } from "./support/echte-sprache";
import { FREMD, projektConfig, FREMD_OWNER } from "./support/fremd-config";

const OWNER = FREMD_OWNER; // Login des Maintainer-Accounts, nur Testdaten
const HARNESS = FREMD.labels.harness;
const AREA = `${FREMD.labels.harness.split(":")[0]}:demo`; // Bereichs-Label der Fremd-Config: Präfix von labels.harness, die Wahl des Bereichs ist Testdatum

type Issue = { state?: string; body?: string | null; user?: { login: string; type?: string } | null; labels?: ({ name: string } | string)[]; pull_request?: object };
type Io = {
  owner: string;
  config: unknown;
  leseDatei: (p: string) => string;
  erzeuge: (a: { titel: string; body: string; labels: string[] }) => { number: number; html_url?: string };
  pruefeAnker: (a: { nach: number; labels: string[] }) => string | null;
  einsortiere: (a: { nr: number; nach: number | null; notfall: string | null }) => void;
  ladeIssue: (nr: number) => Issue;
  bearbeite: (nr: number, body: string) => void;
};
const S = raw as unknown as { fuehreAus: (argv: string[], io: Io) => { code: number; out: string; err: string }; aufrufPruefen: (argv: string[]) => { fehler?: string; befehl?: string; werte?: Record<string, unknown>; positional?: string[] } };

const GUT = "## Ziel\nZ\n\n## Akzeptanzkriterien\n- Es geht.\n- Negativfall: ohne Spezifikation wird nichts angelegt.\n";
const OHNE_NEGATIV = "## Ziel\nZ\n\n## Akzeptanzkriterien\n- Es geht.\n";
const ALT = "Das ist der alte Text.\nZweite Zeile des alten Texts.";

function umgebung(dateien: Record<string, string>, extra: Partial<Io> = {}) {
  const aufrufe = { erzeuge: [] as unknown[], einsortiere: [] as unknown[], bearbeite: [] as unknown[] };
  const io: Io = {
    config: { labels: { forum: FREMD.labels.forum, harness: FREMD.labels.harness }, sprache: echteSprache() },
    owner: OWNER,
    leseDatei: (p) => {
      if (!(p in dateien)) throw new Error("ENOENT");
      return dateien[p];
    },
    erzeuge: (a) => {
      aufrufe.erzeuge.push(a);
      return { number: 900, html_url: "https://x/900" };
    },
    pruefeAnker: () => null,
    einsortiere: (a) => void aufrufe.einsortiere.push(a),
    ladeIssue: () => ({ state: "open", body: ALT, user: { login: OWNER, type: "User" }, labels: [] }),
    bearbeite: (nr, body) => void aufrufe.bearbeite.push({ nr, body }),
    ...extra,
  };
  return { io, aufrufe };
}

const ANLEGEN = ["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", AREA, "--nach", "12"];

describe("aufrufPruefen", () => {
  test("Flags, mehrfaches --label und positionale Nummer je Unterbefehl", () => {
    const a = S.aufrufPruefen(["anlegen", "--titel", "T", "--label", "a", "--label", "b"]);
    expect(a).toMatchObject({ befehl: "anlegen", werte: { titel: "T", label: ["a", "b"] }, positional: [] });
    expect(S.aufrufPruefen(["reparieren", "5", "--body-datei", "b.md"])).toMatchObject({ befehl: "reparieren", positional: ["5"], werte: { label: [] } });
    expect(S.aufrufPruefen(["pruefen", "--body-datei=b.md"]).werte).toMatchObject({ "body-datei": "b.md" });
  });
  test("Flag ohne Wert ist ein Fehler", () => {
    expect(S.aufrufPruefen(["anlegen", "--titel"]).fehler).toBe("--titel braucht einen Wert");
    expect(S.aufrufPruefen(["anlegen", "--titel", "--label", "x"]).fehler).toBe("--titel braucht einen Wert");
  });
  test.each([
    [["pruefen", "--body-datei", "b.md", "--bogus", "x"], "Unbekanntes Argument: --bogus"],
    [["pruefen", "--titel", "T", "--body-datei", "b.md"], "Unbekanntes Argument: --titel"], // Flag eines anderen Unterbefehls
    [[...ANLEGEN, "--titel", "U"], "--titel ist doppelt angegeben"],
    [["pruefen", "x", "--body-datei", "b.md"], "Unbekanntes Argument: x"],
    [["anlegen", "x"], "Unbekanntes Argument: x"],
    [["reparieren", "5", "6", "--body-datei", "b.md"], "Unbekanntes Argument: 6"],
    [["reparieren", "5", "--label", "a"], "Unbekanntes Argument: --label"],
    [["gibtsnicht", "--bogus"], "unbekannter Befehl „gibtsnicht“"],
    [[], "unbekannter Befehl (keiner)"],
    [["toString"], "unbekannter Befehl „toString“"], // Prototyp-Schlüssel ist kein Befehl
    [["constructor", "7"], "unbekannter Befehl „constructor“"],
  ])("ungültiger Aufruf %j: Fehler %s", (argv, text) => {
    expect(S.aufrufPruefen(argv).fehler).toBe(text);
  });
});

describe("Aufruf-Fehler vor jedem I/O", () => {
  test.each([
    ["pruefen", "--body-datei", "b.md", "--bogus", "x"],
    ["pruefen", "--titel", "T", "--body-datei", "b.md"],
    [...ANLEGEN, "--titel", "U"],
    ["pruefen", "x", "--body-datei", "b.md"],
    ["reparieren", "5", "6", "--body-datei", "b.md"],
  ])("%j: Exit 2, Aufruf, nichts gelesen, angelegt oder geschrieben", (...argv) => {
    const { io, aufrufe } = umgebung({ "b.md": GUT });
    let gelesen = 0;
    io.leseDatei = () => {
      gelesen++;
      return GUT;
    };
    const r = S.fuehreAus(argv, io);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^✖ spezifikation: .+\nAufruf:/);
    expect(gelesen).toBe(0);
    expect(aufrufe).toEqual({ erzeuge: [], einsortiere: [], bearbeite: [] });
  });
});

describe("pruefen", () => {
  test("vollständig: Exit 0", () => {
    expect(S.fuehreAus(["pruefen", "--body-datei", "b.md"], umgebung({ "b.md": GUT }).io).code).toBe(0);
  });
  test("unvollständig: Exit 1 mit Mangel auf stderr", () => {
    const r = S.fuehreAus(["pruefen", "--body-datei", "b.md"], umgebung({ "b.md": OHNE_NEGATIV }).io);
    expect(r.code).toBe(1);
    expect(r.err).toContain("kein Negativfall");
  });
  test("Datei fehlt oder ist leer: Exit 2", () => {
    expect(S.fuehreAus(["pruefen", "--body-datei", "x.md"], umgebung({}).io).code).toBe(2);
    expect(S.fuehreAus(["pruefen", "--body-datei", "b.md"], umgebung({ "b.md": "  \n" }).io).code).toBe(2);
    expect(S.fuehreAus(["pruefen"], umgebung({}).io).code).toBe(2);
  });
});

describe("anlegen", () => {
  test("ohne `## Ziel`: Exit 1, nichts angelegt, nichts einsortiert", () => {
    const { io, aufrufe } = umgebung({ "b.md": "## Akzeptanzkriterien\n- Negativfall: x\n" });
    const r = S.fuehreAus(ANLEGEN, io);
    expect(r.code).toBe(1);
    expect(r.err).toContain("`## Ziel` fehlt");
    expect(aufrufe.erzeuge).toEqual([]);
    expect(aufrufe.einsortiere).toEqual([]);
  });
  test("ohne Negativfall: Exit 1, nichts angelegt", () => {
    const { io, aufrufe } = umgebung({ "b.md": OHNE_NEGATIV });
    const r = S.fuehreAus(ANLEGEN, io);
    expect(r.code).toBe(1);
    expect(r.err).toContain("kein Negativfall");
    expect(aufrufe.erzeuge).toEqual([]);
  });
  test("ohne area-Label, ohne Ziel der Einordnung oder mit beiden: Exit 2, nichts angelegt", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT });
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "bug", "--nach", "12"], io).code).toBe(2);
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", AREA], io).code).toBe(2);
    expect(S.fuehreAus([...ANLEGEN, "--notfall", "rot-main"], io).code).toBe(2);
    expect(S.fuehreAus(["anlegen", "--body-datei", "b.md", "--label", AREA, "--nach", "12"], io).code).toBe(2);
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", AREA, "--notfall", "unbekannt"], io).code).toBe(2);
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", AREA, "--nach", "abc"], io).code).toBe(2);
    expect(aufrufe.erzeuge).toEqual([]);
  });
  test("leerer Titel (nur Leerzeichen) und leeres Label `area:` sind Aufrufdefekte: Exit 2, nichts angelegt", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT });
    expect(S.fuehreAus(["anlegen", "--titel", "   ", "--body-datei", "b.md", "--label", AREA, "--nach", "12"], io).code).toBe(2);
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "area:", "--nach", "12"], io).code).toBe(2);
    expect(aufrufe.erzeuge).toEqual([]);
  });
  test("Bereichs-Label: Präfix = labels.harness bis zum ersten Doppelpunkt (fremd `bereich:`, echt `area:`)", () => {
    const fremd = FREMD.labels.harness.split(":")[0] + ":";
    const echt = projektConfig().labels.harness.split(":")[0] + ":";
    expect(fremd).not.toBe(echt);
    const a = umgebung({ "b.md": GUT });
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", `${fremd}demo`, "--nach", "12"], a.io).code).toBe(0);
    const b = umgebung({ "b.md": GUT });
    const r = S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", `${echt}demo`, "--nach", "12"], b.io);
    expect(r.code).toBe(2);
    expect(r.err).toContain(`${fremd}<x>`);
    expect(b.aufrufe.erzeuge).toEqual([]);
  });
  test("Bereichs-Label der echten Config: `area:demo` ist gültig", () => {
    const echt = projektConfig();
    const { io } = umgebung({ "b.md": GUT }, { config: { labels: echt.labels, sprache: echteSprache() } });
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "area:demo", "--nach", "12"], io).code).toBe(0);
  });
  test("harness-Label ohne Doppelpunkt: jedes nicht leere Label genügt", () => {
    const { io } = umgebung({ "b.md": GUT }, { config: { labels: { forum: "f", harness: "harness" }, sprache: echteSprache() } });
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "irgendwas", "--nach", "12"], io).code).toBe(0);
  });
  test("`--nach #12` und `--nach 12` sind dieselbe Nummer: einsortiert wird mit 12 (nie NaN), der Nachhol-Befehl nennt 12", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT });
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", AREA, "--nach", "#12"], io).code).toBe(0);
    expect(aufrufe.einsortiere).toEqual([{ nr: 900, nach: 12, notfall: null }]);
    const { io: kaputt } = umgebung({ "b.md": GUT }, {
      einsortiere: () => {
        throw new Error("x");
      },
    });
    const r = S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", AREA, "--nach", "#12"], kaputt);
    expect(r.err).toContain("--after 12 900");
    expect(r.err).not.toContain("#12 900");
  });
  test("Datei fehlt: Exit 2", () => {
    expect(S.fuehreAus(ANLEGEN, umgebung({}).io).code).toBe(2);
  });
  test("ok: legt ohne Assignee an, reicht Labels und Body durch, sortiert hinter --nach ein", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT });
    const r = S.fuehreAus([...ANLEGEN, "--label", "prio"], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain("angelegt #900");
    expect(aufrufe.erzeuge).toEqual([{ titel: "T", body: GUT, labels: [AREA, "prio"] }]);
    expect(JSON.stringify(aufrufe.erzeuge)).not.toContain("assignee");
    expect(aufrufe.einsortiere).toEqual([{ nr: 900, nach: 12, notfall: null }]);
  });
  test("--notfall: einsortiert wird als Notfall", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT });
    const r = S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", AREA, "--notfall", "rot-main"], io);
    expect(r.code).toBe(0);
    expect(aufrufe.einsortiere).toEqual([{ nr: 900, nach: null, notfall: "rot-main" }]);
  });
  test("nur das Einsortieren scheitert: Exit 2 mit Nummer und Nachhol-Befehl", () => {
    const { io } = umgebung({ "b.md": GUT }, {
      einsortiere: () => {
        throw new Error("Rate-Limit");
      },
    });
    const r = S.fuehreAus(ANLEGEN, io);
    expect(r.code).toBe(2);
    expect(r.err).toContain("#900");
    expect(r.err).toContain("node scripts/board-place.mjs --after 12 900");
    expect(r.err).toContain("Rate-Limit");
  });
  test("Anker auf dem falschen Board: Exit 2, nichts angelegt, Meldung mit Ursache und Ausweg", () => {
    const geprueft: unknown[] = [];
    const { io, aufrufe } = umgebung({ "b.md": GUT }, {
      pruefeAnker: (a) => {
        geprueft.push(a);
        return "Anker #12 steht auf dem Produkt-Board; einen Anker vom Factory-Board wählen";
      },
    });
    const r = S.fuehreAus(ANLEGEN, io);
    expect(r.code).toBe(2);
    expect(r.err).toContain("nichts angelegt");
    expect(r.err).toContain("Anker #12 steht auf dem Produkt-Board; einen Anker vom Factory-Board wählen");
    expect(geprueft).toEqual([{ nach: 12, labels: [AREA] }]);
    expect(aufrufe.erzeuge).toEqual([]);
    expect(aufrufe.einsortiere).toEqual([]);
  });
  test("Ankerprüfung scheitert (gh): Exit 2, nichts angelegt; --notfall prüft keinen Anker", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT }, {
      pruefeAnker: () => {
        throw new Error("503");
      },
    });
    const r = S.fuehreAus(ANLEGEN, io);
    expect(r.code).toBe(2);
    expect(r.err).toContain("503");
    expect(aufrufe.erzeuge).toEqual([]);
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", AREA, "--notfall", "rot-main"], io).code).toBe(0);
  });
  test("Anlegen scheitert: Exit 2, kein Einsortieren", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT }, {
      erzeuge: () => {
        throw new Error("403");
      },
    });
    expect(S.fuehreAus(ANLEGEN, io).code).toBe(2);
    expect(aufrufe.einsortiere).toEqual([]);
  });
});

describe("reparieren", () => {
  const REP = ["reparieren", "7", "--body-datei", "b.md"];
  const NEU = `## Ziel\nZ\n\n## Akzeptanzkriterien\n- ${ALT.split("\n")[0]}\n- ${ALT.split("\n")[1]}\n- Negativfall: ein fremdes Ticket wird nie umgeschrieben.\n`;
  test("ok: schreibt den neuen Body, Exit 0", () => {
    const { io, aufrufe } = umgebung({ "b.md": NEU });
    const r = S.fuehreAus(REP, io);
    expect(r.code).toBe(0);
    expect(r.out).toContain("repariert #7");
    expect(aufrufe.bearbeite).toEqual([{ nr: 7, body: NEU }]);
  });
  test("fremder Autor: Exit 3, nie geschrieben", () => {
    const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue: () => ({ state: "open", body: ALT, user: { login: "fremd", type: "User" }, labels: [] }) });
    expect(S.fuehreAus(REP, io).code).toBe(3);
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("Label forum (auch von vertrautem Autor): Exit 3, nie geschrieben", () => {
    const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue: () => ({ state: "open", body: ALT, user: { login: OWNER, type: "User" }, labels: [{ name: FREMD.labels.forum }] }) });
    expect(S.fuehreAus(REP, io).code).toBe(3);
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("Label forum als String (nicht als Objekt) ist ebenfalls Fremdeingang: Exit 3, nie geschrieben", () => {
    const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue: () => ({ state: "open", body: ALT, user: { login: OWNER, type: "User" }, labels: [FREMD.labels.forum] }) });
    expect(S.fuehreAus(REP, io).code).toBe(3);
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("Fremdeingang vor Assignee: fremdes Ticket mit Assignee meldet Exit 3, nicht 2", () => {
    const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue: () => ({ state: "open", body: ALT, user: { login: "fremd", type: "User" }, assignees: [{ login: OWNER }] }) });
    const r = S.fuehreAus(REP, io);
    expect(r.code).toBe(3);
    expect(r.err).toContain("Fremdeingang");
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("Ticket mit Assignee wird nicht umgeschrieben: Exit 2", () => {
    const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue: () => ({ state: "open", body: ALT, user: { login: OWNER, type: "User" }, assignees: [{ login: OWNER }] }) });
    expect(S.fuehreAus(REP, io).code).toBe(2);
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("Inhaltsverlust-Ausgabe: höchstens 10 Zeilen, lange Zeilen gekürzt, die Zahl im Kopf bleibt die volle", () => {
    const alt = Array.from({ length: 12 }, (_, i) => `Zeile${i + 1}${i === 0 ? "x".repeat(200) : ""}`).join("\n");
    const { io, aufrufe } = umgebung({ "b.md": GUT }, { ladeIssue: () => ({ state: "open", body: alt, user: { login: OWNER, type: "User" } }) });
    const r = S.fuehreAus(REP, io);
    expect(r.code).toBe(1);
    expect(aufrufe.bearbeite).toEqual([]);
    expect(r.err).toContain(`Zeile1${"x".repeat(114)}…`);
    expect(r.err).not.toContain("x".repeat(115));
    expect(r.err).toContain("12 Zeile(n)");
    expect(r.err).toContain("Zeile10");
    expect(r.err).not.toContain("Zeile11");
    expect(r.err).not.toContain("x".repeat(121));
    expect(r.err).toContain("…");
  });
  test("Spezifikation schon vollständig: Exit 0 „nichts zu tun“, ohne Schreibaufruf", () => {
    const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue: () => ({ state: "open", body: GUT, user: { login: OWNER, type: "User" } }) });
    const r = S.fuehreAus(REP, io);
    expect(r.code).toBe(0);
    expect(r.out).toContain("nichts zu tun");
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("neuer Body unvollständig: Exit 1, nichts geschrieben", () => {
    const { io, aufrufe } = umgebung({ "b.md": `${OHNE_NEGATIV}${ALT}` });
    const r = S.fuehreAus(REP, io);
    expect(r.code).toBe(1);
    expect(r.err).toContain("kein Negativfall");
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("Inhaltsverlust: Exit 1, verlorene Zeile genannt, nichts geschrieben", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT });
    const r = S.fuehreAus(REP, io);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Inhaltsverlust");
    expect(r.err).toContain("Zweite Zeile des alten Texts.");
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("geschlossen, PR oder nicht ladbar: Exit 2", () => {
    const basis = { body: ALT, user: { login: OWNER, type: "User" } };
    for (const ladeIssue of [() => ({ ...basis, state: "closed" }), () => ({ ...basis, state: "open", pull_request: {} }), () => {
      throw new Error("404");
    }]) {
      const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue });
      expect(S.fuehreAus(REP, io).code).toBe(2);
      expect(aufrufe.bearbeite).toEqual([]);
    }
  });
  test("ungültige Nummer, fehlende oder leere Datei: Exit 2", () => {
    expect(S.fuehreAus(["reparieren", "abc", "--body-datei", "b.md"], umgebung({ "b.md": NEU }).io).code).toBe(2);
    expect(S.fuehreAus(["reparieren", "--body-datei", "b.md"], umgebung({ "b.md": NEU }).io).code).toBe(2);
    expect(S.fuehreAus(REP, umgebung({}).io).code).toBe(2);
    expect(S.fuehreAus(REP, umgebung({ "b.md": "" }).io).code).toBe(2);
  });
  test("Schreibfehler: Exit 2", () => {
    const { io } = umgebung({ "b.md": NEU }, {
      bearbeite: () => {
        throw new Error("422");
      },
    });
    expect(S.fuehreAus(REP, io).code).toBe(2);
  });
});

describe("fuehreAus", () => {
  test("unbekannter oder fehlender Befehl: Exit 2 mit Aufruf", () => {
    const { io } = umgebung({});
    expect(S.fuehreAus(["gibtsnicht"], io)).toMatchObject({ code: 2 });
    expect(S.fuehreAus([], io).err).toContain("Aufruf:");
  });
});

describe("ankerPruefung: erst nur das Ziel-Board, das andere nur bei Bedarf (#1762 L20c)", () => {
  const CFG = { labels: { harness: HARNESS } };
  const P = (raw as unknown as { ankerPruefung: (a: { nach: number; labels: string[] }, lade: (rolle: string) => { number: number }[], config?: unknown) => string | null }).ankerPruefung;
  const boards: Record<string, { number: number }[]> = { produkt: [{ number: 1 }], factory: [{ number: 2 }] };
  const zaehle = (nach: number, labels: string[]) => {
    const geladen: string[] = [];
    const r = P({ nach, labels }, (rolle) => (geladen.push(rolle), boards[rolle]), CFG);
    return { r, geladen };
  };

  test("Anker auf dem Ziel-Board: null, nur ein Laden", () => {
    expect(zaehle(2, [HARNESS])).toEqual({ r: null, geladen: ["factory"] });
    expect(zaehle(1, ["area:spiel"])).toEqual({ r: null, geladen: ["produkt"] });
  });
  test("Anker fehlt auf dem Ziel-Board: das andere wird nachgeladen, Meldung wie bisher", () => {
    const { r, geladen } = zaehle(1, [HARNESS]);
    expect(geladen).toEqual(["factory", "produkt"]);
    expect(r).toMatch(/Anker #1 steht nur auf dem Produkt-Board.*Factory-Board.*einen Anker vom passenden Board wählen/);
  });
  test("Anker auf keinem Board: null nach zwei Ladevorgängen", () => {
    expect(zaehle(99, [HARNESS])).toEqual({ r: null, geladen: ["factory", "produkt"] });
  });
});

describe("Sprache als Projektwert (#1711)", () => {
  const ohneSprache = { config: { labels: { forum: FREMD.labels.forum, harness: FREMD.labels.harness } } };
  test("Negativfall: ohne sprache bricht jeder Unterbefehl mit klarer Meldung ab (Exit 1, nichts angelegt oder geschrieben, kein Stacktrace)", () => {
    const befehle = [["pruefen", "--body-datei", "b.md"], ANLEGEN, ["reparieren", "5", "--body-datei", "b.md"]];
    for (const argv of befehle) {
      const { io, aufrufe } = umgebung({ "b.md": GUT }, ohneSprache);
      const r = S.fuehreAus(argv, io);
      expect(r.code, argv[0]).toBe(1);
      expect(r.err).toMatch(/^✖ spezifikation: sprache[\s\S]*Fix:/);
      expect(r.err).not.toMatch(/\bat \S+ \(|Error:/);
      expect(aufrufe.erzeuge).toEqual([]);
      expect(aufrufe.bearbeite).toEqual([]);
    }
  });
  test("ein Aufruf-Fehler (Exit 2) kommt vor der Sprachprüfung", () => {
    const { io } = umgebung({}, ohneSprache);
    expect(S.fuehreAus(["pruefen", "--bogus", "x"], io).code).toBe(2);
  });
  test("englische Sprache aus der Config: der englische Body ist vollständig, der deutsche nicht", () => {
    const en = { ziel: "Goal", akzeptanzkriterien: ["Acceptance criteria"], nachMerge: "After merge:", negativfall: { wort: "Negative case", muster: "negative case" }, begrenzung: { wort: "known patterns:", muster: "known patterns:" }, allquantor: { wort: "all … that … read", muster: "all [^.!?]*that [^.!?]*read" }, blocker: "blocked by", abhaengigkeit: ["follows #"] };
    const { io } = umgebung({ "en.md": "## Goal\nG\n\n## Acceptance criteria\n- Negative case: x\n", "de.md": GUT }, { config: { labels: { forum: FREMD.labels.forum, harness: FREMD.labels.harness }, sprache: { spezifikation: en } } });
    expect(S.fuehreAus(["pruefen", "--body-datei", "en.md"], io).code).toBe(0);
    const de = S.fuehreAus(["pruefen", "--body-datei", "de.md"], io);
    expect(de.code).toBe(1);
    expect(de.err).toContain("`## Goal` fehlt");
  });
});

describe("anlegen --blocker (#1860)", () => {
  const MIT = (...bl: string[]) => [...ANLEGEN, ...bl.flatMap((b) => ["--blocker", b])];
  test("aufrufPruefen: --blocker mehrfach, als Zahlen; ohne Flag eine leere Liste", () => {
    expect(S.aufrufPruefen(MIT("12", "#13")).werte).toMatchObject({ blocker: [12, 13] });
    expect(S.aufrufPruefen(ANLEGEN).werte).toMatchObject({ blocker: [] });
  });
  test("Negativfall: keine Zahl, Null oder Dezimalzahl: Exit 2 vor jedem I/O, nichts gelesen", () => {
    for (const bad of ["abc", "0", "1.5", "-3", ""]) {
      let gelesen = 0;
      const { io, aufrufe } = umgebung({ "b.md": GUT }, { leseDatei: () => { gelesen++; return GUT; } });
      const r = S.fuehreAus(MIT(bad), io);
      expect(r.code, bad).toBe(2);
      expect(r.err).toContain("--blocker");
      expect(gelesen).toBe(0);
      expect(aufrufe.erzeuge).toEqual([]);
    }
  });
  test("--blocker hängt die Zeile an den Body und deckt damit den Abhängigkeitssatz", () => {
    const body = `${GUT}\nDas Ticket folgt nach #12.\n`;
    const { io, aufrufe } = umgebung({ "b.md": body });
    expect(S.fuehreAus(ANLEGEN, io).code).toBe(1);
    expect(aufrufe.erzeuge).toEqual([]);
    const r = S.fuehreAus(MIT("12", "13"), io);
    expect(r.code).toBe(0);
    const neu = (aufrufe.erzeuge[0] as { body: string }).body;
    expect(neu).toMatch(/^blockiert durch #12, #13$/m);
    expect(neu.startsWith(body)).toBe(true);
  });
  test("eine schon vorhandene Zeile wird nicht doppelt angehängt, eine fehlende Nummer ergänzt", () => {
    const { io, aufrufe } = umgebung({ "b.md": `${GUT}\nblockiert durch #12\n` });
    S.fuehreAus(MIT("12"), io);
    expect((aufrufe.erzeuge[0] as { body: string }).body.match(/blockiert durch/g)).toHaveLength(1);
    S.fuehreAus(MIT("12", "14"), io);
    expect((aufrufe.erzeuge[1] as { body: string }).body).toMatch(/^blockiert durch #14$/m);
  });
});

describe("gescheitert: scheiternde Reparatur wird eine Zeile im Sammelticket (#1860)", () => {
  type Sammel = { ziel: number | null; kommentare: { user: { login: string; type?: string } | null; body: string }[] };
  type GIo = Io & { sammelKontext: () => Sammel; postZeilen: (nr: number, text: string) => void; heute: () => string };
  const ARGS = ["gescheitert", "7", "--mangel", "Negativfall fehlt"];
  const ZEILE = "- [ ] 2026-10-22 Reparatur gescheitert: #7 (Negativfall fehlt). Fix: Body über den Reparaturweg nachziehen";
  function gumgebung(sammel: Partial<Sammel> = {}, extra: Partial<GIo> = {}) {
    const posts: { nr: number; text: string }[] = [];
    const { io } = umgebung({});
    const gio: GIo = {
      ...io,
      sammelKontext: () => ({ ziel: 1860, kommentare: [], ...sammel }),
      postZeilen: (nr, text) => void posts.push({ nr, text }),
      heute: () => "2026-10-22",
      ...extra,
    };
    return { io: gio as unknown as Io, posts };
  }
  const fn = raw as unknown as { gescheitertZeile: (a: { nr: number; mangel: string; heute: string }) => string; gescheitertBekannt: (nr: number, kommentare: Sammel["kommentare"], owner: string) => boolean };

  test("aufrufPruefen: Nummer und --mangel sind Pflicht", () => {
    expect(S.aufrufPruefen(ARGS)).toMatchObject({ befehl: "gescheitert", positional: ["7"], werte: { mangel: "Negativfall fehlt" } });
    for (const bad of [["gescheitert", "--mangel", "x"], ["gescheitert", "0", "--mangel", "x"], ["gescheitert", "7"], ["gescheitert", "7", "--mangel", "  "], ["gescheitert", "7", "8", "--mangel", "x"]]) {
      expect(S.aufrufPruefen(bad).fehler, bad.join(" ")).toBeTruthy();
    }
  });
  test("postet die Zeile mit Datum, Nummer und Mangel ins Sammelticket, Exit 0", () => {
    const { io, posts } = gumgebung();
    const r = S.fuehreAus(ARGS, io);
    expect(r.code, r.err).toBe(0);
    expect(posts).toEqual([{ nr: 1860, text: ZEILE }]);
    expect(r.out).toContain("#1860");
  });
  test("Mangel über mehrere Zeilen wird einzeilig", () => {
    const { io, posts } = gumgebung();
    S.fuehreAus(["gescheitert", "7", "--mangel", "a\n  b"], io);
    expect(posts[0]?.text).toContain("(a b)");
    expect(posts[0]?.text.split("\n")).toHaveLength(1);
  });
  test("schon offene Zeile eines vertrauten Autors: Exit 0, nichts gepostet", () => {
    const { io, posts } = gumgebung({ kommentare: [{ user: { login: OWNER, type: "User" }, body: `x\n${ZEILE}\n` }] });
    const r = S.fuehreAus(ARGS, io);
    expect(r.code).toBe(0);
    expect(posts).toEqual([]);
    expect(r.out).toMatch(/schon/);
  });
  test("Negativfall: Zeile eines Fremden, erledigte Zeile oder andere Nummer verhindern den Post nicht", () => {
    const fremd = { user: { login: "fremder", type: "User" }, body: ZEILE };
    const erledigt = { user: { login: OWNER, type: "User" }, body: ZEILE.replace("[ ]", "[x]") };
    const anderes = { user: { login: OWNER, type: "User" }, body: ZEILE.replace("#7 (", "#77 (") };
    for (const k of [fremd, erledigt, anderes]) {
      const { io, posts } = gumgebung({ kommentare: [k] });
      expect(S.fuehreAus(ARGS, io).code).toBe(0);
      expect(posts).toHaveLength(1);
    }
  });
  test("kein ungeclaimtes Sammelticket: Exit 1 mit Fix, nichts gepostet", () => {
    const { io, posts } = gumgebung({ ziel: null });
    const r = S.fuehreAus(ARGS, io);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Fix: node scripts/sammelticket-anlegen.mjs harness");
    expect(posts).toEqual([]);
  });
  test("Negativfall: Aufruf-Fehler enden mit Exit 2 vor jedem I/O", () => {
    let io0 = 0;
    const zaehle = () => { io0++; throw new Error("kein I/O erlaubt"); };
    const { io } = gumgebung({}, { sammelKontext: zaehle, postZeilen: zaehle });
    for (const bad of [["gescheitert", "x", "--mangel", "m"], ["gescheitert", "7"], ["gescheitert", "7", "--mangel", ""]]) {
      expect(S.fuehreAus(bad, io).code, bad.join(" ")).toBe(2);
    }
    expect(io0).toBe(0);
  });
  test("Ladefehler und Postfehler: Exit 2 mit Ursache", () => {
    const wirf = (m: string) => () => { throw new Error(m); };
    const a = S.fuehreAus(ARGS, gumgebung({}, { sammelKontext: wirf("kaputt-laden") }).io);
    expect(a.code).toBe(2);
    expect(a.err).toContain("kaputt-laden");
    const b = S.fuehreAus(ARGS, gumgebung({}, { postZeilen: wirf("kaputt-post") }).io);
    expect(b.code).toBe(2);
    expect(b.err).toContain("kaputt-post");
  });
  test("pure Bausteine", () => {
    expect(fn.gescheitertZeile({ nr: 7, mangel: "Negativfall fehlt", heute: "2026-10-22" })).toBe(ZEILE);
    expect(fn.gescheitertBekannt(7, [{ user: { login: OWNER, type: "User" }, body: ZEILE }], OWNER)).toBe(true);
    expect(fn.gescheitertBekannt(7, [], OWNER)).toBe(false);
  });
});
