import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/wiedervorlage.mjs";
import { FREMD } from "./support/fremd-config";

type E = { id: string; faellig: string; titel: string; text: string; label?: string; alerts?: unknown };
type T = { number: number; state: string; body: string; closedAt?: string };
type Aktion = { art: string; eintrag: E; nummer?: number };
const W = raw as unknown as {
  pruefeEintraege: (l: unknown) => string[];
  faellige: (a: { eintraege: E[]; heute: string }) => E[];
  planeAktionen: (a: { faellige: E[]; tickets: T[] }) => Aktion[];
  ticketText: (e: E) => { titel: string; body: string };
  markerFuer: (id: string) => string;
  istDatum: (s: unknown) => boolean;
  TITEL_PRAEFIX: string;
  lauf: (a: { eintraege: E[]; heute: string; tickets: T[]; trocken?: boolean; anlegen: (e: E) => number; sortiereEin: (n: number) => boolean; log?: (m: string) => void }) => number;
};

const e = (id: string, faellig = "2026-11-13", extra: Partial<E> = {}): E => ({ id, faellig, titel: `Titel ${id}`, text: "Text", ...extra });

describe("pruefeEintraege", () => {
  test("gültige Liste und leere Liste sind fehlerfrei", () => {
    expect(W.pruefeEintraege([e("a"), e("b-2", "2027-02-28", { label: "area:spiel" })])).toEqual([]);
    expect(W.pruefeEintraege([])).toEqual([]);
  });
  test("kaputte Einträge: fehlendes Feld, leeres Feld, falsches Label, kein Objekt, keine Liste", () => {
    expect(W.pruefeEintraege([{ id: "a", faellig: "2026-11-13", titel: "t" }]).join()).toContain("„text“");
    expect(W.pruefeEintraege([e("a", "2026-11-13", { titel: "  " })]).join()).toContain("„titel“");
    expect(W.pruefeEintraege([e("a", "2026-11-13", { label: "" })]).join()).toContain("„label“");
    expect(W.pruefeEintraege([null]).join()).toContain("kein Objekt");
    expect(W.pruefeEintraege({})).toHaveLength(1);
  });
  test("alerts: gültige Nummernliste ok; leer, kein Array, Nicht-Ganzzahl, 0, negativ sind rot", () => {
    expect(W.pruefeEintraege([e("codescanning-x", "2026-11-13", { alerts: [5, 7] })])).toEqual([]);
    for (const a of [[], "5", [1.5], [0], [-3], ["5"], [5, null], 5]) {
      expect(W.pruefeEintraege([e("codescanning-x", "2026-11-13", { alerts: a })]).join(), JSON.stringify(a)).toContain("„alerts“");
    }
  });
  test("alerts nur an `codescanning-*`: andere id ist rot, `codescanning-…` mit alerts ok, ohne alerts jede id ok", () => {
    const f = W.pruefeEintraege([e("dependabot-x", "2026-11-13", { alerts: [5] })]).join();
    expect(f).toContain("„alerts“");
    expect(f).toContain("codescanning-<slug>");
    expect(W.pruefeEintraege([e("codescanning-x", "2026-11-13", { alerts: [5] })])).toEqual([]);
    expect(W.pruefeEintraege([e("dependabot-x")])).toEqual([]);
  });
  test("ungültige Daten: Monat 13, 30. Februar, falsches Format", () => {
    for (const d of ["2026-13-01", "2026-02-30", "13.11.2026", "2026-1-1"]) {
      expect(W.pruefeEintraege([e("a", d)]).join(), d).toContain("kein gültiges Datum");
    }
    expect(W.istDatum("2028-02-29")).toBe(true);
    expect(W.istDatum(20261113)).toBe(false);
  });
  test("doppelte id und ungültige Zeichen in der id", () => {
    expect(W.pruefeEintraege([e("a"), e("a")]).join()).toContain("doppelt");
    expect(W.pruefeEintraege([e("Gross_1")]).join()).toContain("[a-z0-9-]");
  });
});

describe("faellige: Grenze am Fälligkeitstag", () => {
  const liste = [e("gestern", "2026-10-15"), e("heute", "2026-10-16"), e("morgen", "2026-10-17")];
  test("gestern und heute sind fällig, morgen nicht", () => {
    expect(W.faellige({ eintraege: liste, heute: "2026-10-16" }).map((x) => x.id)).toEqual(["gestern", "heute"]);
  });
  test("nichts fällig vor dem frühesten Datum", () => {
    expect(W.faellige({ eintraege: liste, heute: "2026-10-14" })).toEqual([]);
  });
});

describe("planeAktionen: Dedupe über den Marker, alle Zustände", () => {
  const a = e("a");
  test("ohne Ticket: anlegen", () => {
    expect(W.planeAktionen({ faellige: [a], tickets: [{ number: 1, state: "open", body: "irgendwas" }] })).toEqual([{ art: "anlegen", eintrag: a }]);
  });
  test("offenes Ticket mit Marker: nichts", () => {
    expect(W.planeAktionen({ faellige: [a], tickets: [{ number: 5, state: "open", body: `${W.markerFuer("a")}\nText` }] })).toEqual([]);
  });
  test("geschlossenes Ticket bei stehendem Eintrag: Warnung statt Dublette", () => {
    expect(W.planeAktionen({ faellige: [a], tickets: [{ number: 5, state: "closed", body: W.markerFuer("a") }] })).toEqual([{ art: "warnen", eintrag: a, nummer: 5 }]);
    expect(W.planeAktionen({ faellige: [a], tickets: [{ number: 5, state: "CLOSED", body: W.markerFuer("a") }] })[0]?.art).toBe("warnen");
  });
  test("offen UND geschlossen mit Marker: nichts (das offene zählt)", () => {
    const tickets = [{ number: 4, state: "closed", body: W.markerFuer("a") }, { number: 5, state: "open", body: W.markerFuer("a") }];
    expect(W.planeAktionen({ faellige: [a], tickets })).toEqual([]);
  });
  test("der Marker einer anderen id (Präfix) zählt nicht", () => {
    const tickets = [{ number: 5, state: "open", body: W.markerFuer("a-lang") }];
    expect(W.planeAktionen({ faellige: [a], tickets })).toEqual([{ art: "anlegen", eintrag: a }]);
  });
  describe("verschobene Wiedervorlage: geschlossen vor dem neuen Fälligkeitstag", () => {
    const zu = (closedAt: string | undefined) => [{ number: 5, state: "closed", body: W.markerFuer("a"), ...(closedAt === undefined ? {} : { closedAt }) }];
    test("Schließdatum vor faellig: neues Ticket anlegen", () => {
      expect(W.planeAktionen({ faellige: [a], tickets: zu("2026-11-12T23:59:00Z") })).toEqual([{ art: "anlegen", eintrag: a }]);
    });
    test("Schließdatum am Fälligkeitstag oder danach: warnen", () => {
      expect(W.planeAktionen({ faellige: [a], tickets: zu("2026-11-13T00:00:00Z") })[0]?.art).toBe("warnen");
      expect(W.planeAktionen({ faellige: [a], tickets: zu("2026-12-01T10:00:00Z") })[0]?.art).toBe("warnen");
    });
    test("Schließdatum fehlt oder ist unlesbar: warnen", () => {
      expect(W.planeAktionen({ faellige: [a], tickets: zu(undefined) })[0]?.art).toBe("warnen");
      expect(W.planeAktionen({ faellige: [a], tickets: zu("") })[0]?.art).toBe("warnen");
      expect(W.planeAktionen({ faellige: [a], tickets: zu("gestern") })[0]?.art).toBe("warnen");
    });
    test("offenes Ticket mit altem closedAt-Feld: keine Aktion", () => {
      const tickets = [{ number: 5, state: "open", body: W.markerFuer("a"), closedAt: "2026-01-01T00:00:00Z" }];
      expect(W.planeAktionen({ faellige: [a], tickets })).toEqual([]);
    });
    test("ein Ticket vor und eines nach faellig geschlossen: warnen (das jüngere zählt)", () => {
      const tickets = [...zu("2026-11-01T00:00:00Z"), { number: 6, state: "closed", body: W.markerFuer("a"), closedAt: "2026-11-20T00:00:00Z" }];
      expect(W.planeAktionen({ faellige: [a], tickets })[0]?.art).toBe("warnen");
    });
  });
  test("ticketText trägt Marker im Body und Präfix im Titel", () => {
    const t = W.ticketText(a);
    expect(t.titel).toBe(`${W.TITEL_PRAEFIX} Titel a`);
    expect(t.body.startsWith(W.markerFuer("a"))).toBe(true);
  });
});

describe("Wächter", () => {
  test("die Listenabfrage holt closedAt (sonst bliebe die Regel „verschoben, also anlegen“ tot)", () => {
    const src = readFileSync(new URL("../scripts/wiedervorlage.mjs", import.meta.url), "utf8");
    expect(src).toMatch(/const ladeTickets = .*--json", "number,state,body,closedAt"/);
  });
  test("die echte Datei .github/wiedervorlagen.json ist gültig", () => {
    const liste: unknown = JSON.parse(readFileSync(new URL("../.github/wiedervorlagen.json", import.meta.url), "utf8"));
    expect(W.pruefeEintraege(liste)).toEqual([]);
  });
  test("der Workflow checkt das volle Repo aus (Import-Hülle von board-place.mjs), richtet Node ein und ruft das Skript", () => {
    const yml = readFileSync(new URL("../.github/workflows/wiedervorlage.yml", import.meta.url), "utf8");
    expect(yml).not.toContain("sparse-checkout:");
    expect(yml).toMatch(/actions[/]checkout@v7/);
    expect(yml).toMatch(/actions[/]setup-node@v7/);
    expect(yml).toContain("node scripts/wiedervorlage.mjs");
    expect(yml).toContain("PROJECT_TOKEN");
  });
  test("fälliger Eintrag ohne Ticket: Anlegen scheitert oder Einsortieren scheitert -> Exit 1; Erfolg -> 0", () => {
    const basis = { eintraege: [e("a")], heute: "2026-11-13", tickets: [] as T[], log: () => undefined };
    expect(W.lauf({ ...basis, anlegen: () => 7, sortiereEin: () => true })).toBe(0);
    expect(W.lauf({ ...basis, anlegen: () => { throw new Error("gh kaputt"); }, sortiereEin: () => true })).toBe(1);
    expect(W.lauf({ ...basis, anlegen: () => 7, sortiereEin: () => false })).toBe(1);
  });
  test("Lauf: nicht fällig, offenes und geschlossenes Ticket legen nichts an (Exit 0); dry-run ändert nichts", () => {
    const log: string[] = [];
    const nie = () => { throw new Error("darf nicht aufgerufen werden"); };
    const basis = { log: (m: string) => log.push(m), anlegen: nie, sortiereEin: nie };
    expect(W.lauf({ ...basis, eintraege: [e("a", "2026-11-14")], heute: "2026-11-13", tickets: [] })).toBe(0);
    expect(W.lauf({ ...basis, eintraege: [e("a")], heute: "2026-11-13", tickets: [{ number: 1, state: "open", body: W.markerFuer("a") }] })).toBe(0);
    expect(W.lauf({ ...basis, eintraege: [e("a")], heute: "2026-11-13", tickets: [{ number: 1, state: "closed", body: W.markerFuer("a") }] })).toBe(0);
    expect(log.join("\n")).toContain("Eintrag löschen");
    expect(W.lauf({ ...basis, eintraege: [e("a")], heute: "2026-11-13", tickets: [], trocken: true })).toBe(0);
    expect(log.join("\n")).toContain("[dry-run]");
  });
});

describe("main: --dry-run über Deps (#1837)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const main = (raw as unknown as { main: (argv: string[], deps: Record<string, unknown>) => Promise<number> }).main;
  const aufbau = () => {
    const sortiert: number[] = [];
    const angelegt: [string, string, string][] = [];
    const log: string[] = [];
    const deps = {
      ladeConfig: () => ({ labels: { harness: FREMD.labels.harness } }),
      ladeLibs: () => Promise.resolve({ REPO: "o/r", platziereOben: (nr: number) => sortiert.push(nr) }),
      eintraegeLaden: () => [e("a", "2000-01-01")],
      ticketsLaden: () => [] as T[],
      legen: (eintrag: E, label: string, repo: string) => (angelegt.push([eintrag.id, label, repo]), 7),
      log: (m: string) => log.push(m),
      err: () => undefined,
    };
    return { sortiert, angelegt, log, deps };
  };
  test("mit Flag: [dry-run] im Log, nichts angelegt oder einsortiert", async () => {
    const { sortiert, angelegt, log, deps } = aufbau();
    expect(await main(["--dry-run"], deps)).toBe(0);
    expect(log.join("\n")).toContain("[dry-run]");
    expect(angelegt).toEqual([]);
    expect(sortiert).toEqual([]);
  });
  test("ohne Flag: legt an und sortiert ein, kein [dry-run]", async () => {
    vi.stubEnv("PROJECT_TOKEN", "t");
    const { sortiert, angelegt, log, deps } = aufbau();
    expect(await main([], deps)).toBe(0);
    expect(angelegt).toEqual([["a", FREMD.labels.harness, "o/r"]]);
    expect(sortiert).toEqual([7]);
    expect(log.join("\n")).toContain("Angelegt: #7");
    expect(log.join("\n")).not.toContain("[dry-run]");
  });
});
