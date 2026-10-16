/* Spezifikations-Gate, Schreibseite (#1698): anlegen nur geprüft, reparieren nur vertraute Tickets ohne Inhaltsverlust.
 * Alles über injizierte io: kein gh, kein Dateizugriff. Red-Green: die Prüfung vor `erzeuge`/`bearbeite` entfernen -> rot. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/spezifikation.mjs";

type Issue = { state?: string; body?: string | null; user?: { login: string; type?: string } | null; labels?: ({ name: string } | string)[]; pull_request?: object };
type Io = {
  owner: string;
  leseDatei: (p: string) => string;
  erzeuge: (a: { titel: string; body: string; labels: string[] }) => { number: number; html_url?: string };
  einsortiere: (a: { nr: number; nach: number | null; notfall: string | null }) => void;
  ladeIssue: (nr: number) => Issue;
  bearbeite: (nr: number, body: string) => void;
};
const S = raw as unknown as { fuehreAus: (argv: string[], io: Io) => { code: number; out: string; err: string }; parseArgs: (argv: string[]) => { fehler?: string; werte?: Record<string, unknown>; positional?: string[] } };

const GUT = "## Ziel\nZ\n\n## Akzeptanzkriterien\n- Es geht.\n- Negativfall: ohne Spezifikation wird nichts angelegt.\n";
const OHNE_NEGATIV = "## Ziel\nZ\n\n## Akzeptanzkriterien\n- Es geht.\n";
const ALT = "Das ist der alte Text.\nZweite Zeile des alten Texts.";

function umgebung(dateien: Record<string, string>, extra: Partial<Io> = {}) {
  const aufrufe = { erzeuge: [] as unknown[], einsortiere: [] as unknown[], bearbeite: [] as unknown[] };
  const io: Io = {
    owner: "fluffels",
    leseDatei: (p) => {
      if (!(p in dateien)) throw new Error("ENOENT");
      return dateien[p];
    },
    erzeuge: (a) => {
      aufrufe.erzeuge.push(a);
      return { number: 900, html_url: "https://x/900" };
    },
    einsortiere: (a) => void aufrufe.einsortiere.push(a),
    ladeIssue: () => ({ state: "open", body: ALT, user: { login: "fluffels", type: "User" }, labels: [] }),
    bearbeite: (nr, body) => void aufrufe.bearbeite.push({ nr, body }),
    ...extra,
  };
  return { io, aufrufe };
}

const ANLEGEN = ["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "area:harness", "--nach", "12"];

describe("parseArgs", () => {
  test("Flags, mehrfaches --label und positionale Nummer", () => {
    const p = S.parseArgs(["reparieren", "5", "--label", "a", "--label", "b"].slice(1));
    expect(p.werte).toMatchObject({ label: ["a", "b"] });
    expect(p.positional).toEqual(["5"]);
  });
  test("Flag ohne Wert ist ein Fehler", () => {
    expect(S.parseArgs(["--titel"]).fehler).toContain("--titel");
    expect(S.parseArgs(["--titel", "--label", "x"]).fehler).toContain("--titel");
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
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "area:harness"], io).code).toBe(2);
    expect(S.fuehreAus([...ANLEGEN, "--notfall", "rot-main"], io).code).toBe(2);
    expect(S.fuehreAus(["anlegen", "--body-datei", "b.md", "--label", "area:harness", "--nach", "12"], io).code).toBe(2);
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "area:harness", "--notfall", "unbekannt"], io).code).toBe(2);
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "area:harness", "--nach", "abc"], io).code).toBe(2);
    expect(aufrufe.erzeuge).toEqual([]);
  });
  test("leerer Titel (nur Leerzeichen) und leeres Label `area:` sind Aufrufdefekte: Exit 2, nichts angelegt", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT });
    expect(S.fuehreAus(["anlegen", "--titel", "   ", "--body-datei", "b.md", "--label", "area:harness", "--nach", "12"], io).code).toBe(2);
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "area:", "--nach", "12"], io).code).toBe(2);
    expect(aufrufe.erzeuge).toEqual([]);
  });
  test("`--nach #12` und `--nach 12` sind dieselbe Nummer: einsortiert wird mit 12 (nie NaN), der Nachhol-Befehl nennt 12", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT });
    expect(S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "area:harness", "--nach", "#12"], io).code).toBe(0);
    expect(aufrufe.einsortiere).toEqual([{ nr: 900, nach: 12, notfall: null }]);
    const { io: kaputt } = umgebung({ "b.md": GUT }, {
      einsortiere: () => {
        throw new Error("x");
      },
    });
    const r = S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "area:harness", "--nach", "#12"], kaputt);
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
    expect(aufrufe.erzeuge).toEqual([{ titel: "T", body: GUT, labels: ["area:harness", "prio"] }]);
    expect(JSON.stringify(aufrufe.erzeuge)).not.toContain("assignee");
    expect(aufrufe.einsortiere).toEqual([{ nr: 900, nach: 12, notfall: null }]);
  });
  test("--notfall: einsortiert wird als Notfall", () => {
    const { io, aufrufe } = umgebung({ "b.md": GUT });
    const r = S.fuehreAus(["anlegen", "--titel", "T", "--body-datei", "b.md", "--label", "area:harness", "--notfall", "rot-main"], io);
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
    const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue: () => ({ state: "open", body: ALT, user: { login: "fluffels", type: "User" }, labels: [{ name: "forum" }] }) });
    expect(S.fuehreAus(REP, io).code).toBe(3);
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("Label forum als String (nicht als Objekt) ist ebenfalls Fremdeingang: Exit 3, nie geschrieben", () => {
    const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue: () => ({ state: "open", body: ALT, user: { login: "fluffels", type: "User" }, labels: ["forum"] }) });
    expect(S.fuehreAus(REP, io).code).toBe(3);
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("Ticket mit Assignee wird nicht umgeschrieben: Exit 2", () => {
    const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue: () => ({ state: "open", body: ALT, user: { login: "fluffels", type: "User" }, assignees: [{ login: "fluffels" }] }) });
    expect(S.fuehreAus(REP, io).code).toBe(2);
    expect(aufrufe.bearbeite).toEqual([]);
  });
  test("Inhaltsverlust-Ausgabe: höchstens 10 Zeilen, lange Zeilen gekürzt, die Zahl im Kopf bleibt die volle", () => {
    const alt = Array.from({ length: 12 }, (_, i) => `Zeile${i + 1}${i === 0 ? "x".repeat(200) : ""}`).join("\n");
    const { io } = umgebung({ "b.md": GUT }, { ladeIssue: () => ({ state: "open", body: alt, user: { login: "fluffels", type: "User" } }) });
    const r = S.fuehreAus(REP, io);
    expect(r.code).toBe(1);
    expect(r.err).toContain("12 Zeile(n)");
    expect(r.err).toContain("Zeile10");
    expect(r.err).not.toContain("Zeile11");
    expect(r.err).not.toContain("x".repeat(121));
    expect(r.err).toContain("…");
  });
  test("Spezifikation schon vollständig: Exit 0 „nichts zu tun“, ohne Schreibaufruf", () => {
    const { io, aufrufe } = umgebung({ "b.md": NEU }, { ladeIssue: () => ({ state: "open", body: GUT, user: { login: "fluffels", type: "User" } }) });
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
    const basis = { body: ALT, user: { login: "fluffels", type: "User" } };
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
