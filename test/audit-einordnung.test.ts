import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/audit-einordnung.mjs";

type B = { ghsa: string; paket: string; schwere: string; prod: boolean; fixVerfuegbar: boolean; fixVersion?: string };
type Aktion = { art: string; befund: B; titel?: string; body?: string; text?: string };
const A = raw as unknown as {
  ordneEin: (a: { befunde: B[]; bekannt: Iterable<string> }) => Aktion[];
  befundeAusNpmAudit: (j: unknown) => B[];
  befundeAusAlerts: (a: unknown) => B[];
  markiereProd: (voll: B[], prod: B[]) => B[];
  vertrauteBodies: (kommentare: { body?: string | null; user?: { login?: string; type?: string } | null }[], owner: string) => string[];
  bekannteGhsa: (a: { kommentare: string[]; wiedervorlagen: { id: string }[]; offeneTitel: string[] }) => Set<string>;
};

const G1 = "GHSA-aaaa-bbbb-cccc";
const befund = (o: Partial<B> = {}): B => ({ ghsa: G1, paket: "braces", schwere: "high", prod: false, fixVerfuegbar: false, ...o });

describe("ordneEin", () => {
  test("critical + prod: Alarm mit Titel und Prüfauftrag", () => {
    const [a] = A.ordneEin({ befunde: [befund({ schwere: "critical", prod: true })], bekannt: [] });
    expect(a.art).toBe("alarm");
    expect(a.titel).toBe(`🔒 Security: ${G1} in braces`);
    expect(a.body).toContain("im Einsatz dieses Projekts ausnutzbar?");
  });

  test("critical + dev: nur Zeile, nie Alarm", () => {
    const [a] = A.ordneEin({ befunde: [befund({ schwere: "critical", prod: false })], bekannt: [] });
    expect(a.art).toBe("zeile");
    expect(a.text).toContain("(critical, dev)");
  });

  test("high + prod: nur Zeile", () => {
    const [a] = A.ordneEin({ befunde: [befund({ schwere: "high", prod: true })], bekannt: [] });
    expect(a.art).toBe("zeile");
    expect(a.text).toContain("(high, prod)");
  });

  test("Zeile ohne Fix schlägt Wiedervorlage vor, mit Fix das Update", () => {
    const [ohne] = A.ordneEin({ befunde: [befund()], bekannt: [] });
    expect(ohne.text).toContain("Fix: nein");
    expect(ohne.text).toContain(`Wiedervorlage audit-${G1.toLowerCase()}`);
    const [mit] = A.ordneEin({ befunde: [befund({ fixVerfuegbar: true, fixVersion: "3.0.4" })], bekannt: [] });
    expect(mit.text).toContain("Fix: ja v3.0.4");
    expect(mit.text).toContain("npm update");
  });

  test("bekannter Befund (beliebige Schreibweise) bringt nichts", () => {
    expect(A.ordneEin({ befunde: [befund({ schwere: "critical", prod: true })], bekannt: [G1.toLowerCase()] })).toEqual([]);
    expect(A.ordneEin({ befunde: [befund()], bekannt: new Set([G1.toUpperCase()]) })).toEqual([]);
  });

  test("dieselbe GHSA aus npm und Dependabot ist ein Befund, prod gewinnt", () => {
    const r = A.ordneEin({ befunde: [befund({ schwere: "critical" }), befund({ schwere: "critical", prod: true })], bekannt: [] });
    expect(r).toHaveLength(1);
    expect(r[0].art).toBe("alarm");
  });

  test("dieselbe GHSA: der Fix aus der zweiten Quelle wird übernommen", () => {
    const [z] = A.ordneEin({ befunde: [befund({ fixVerfuegbar: false }), befund({ fixVerfuegbar: true, fixVersion: "3.0.4" })], bekannt: [] });
    expect(z.text).toContain("Fix: ja v3.0.4");
  });

  test("keine Befunde: leer", () => {
    expect(A.ordneEin({ befunde: [], bekannt: [] })).toEqual([]);
  });
});

describe("befundeAusNpmAudit", () => {
  const audit = {
    vulnerabilities: {
      braces: { severity: "high", via: [{ source: 1, name: "braces", severity: "high", url: `https://github.com/advisories/${G1}` }], fixAvailable: false },
      micromatch: { severity: "high", via: ["braces"], fixAvailable: { name: "x", version: "2.0.0" } },
      foo: { severity: "moderate", via: [{ name: "foo", severity: "moderate", url: "https://github.com/advisories/GHSA-dddd-eeee-ffff" }], fixAvailable: { name: "foo", version: "1.2.3" } },
    },
  };

  test("liest je Advisory einen Befund, String-Ketten zählen nicht", () => {
    const b = A.befundeAusNpmAudit(audit);
    expect(b.map((x) => x.ghsa)).toEqual([G1.toLowerCase(), "ghsa-dddd-eeee-ffff"]);
    expect(b[0]).toMatchObject({ paket: "braces", schwere: "high", prod: false, fixVerfuegbar: false });
    expect(b[1]).toMatchObject({ fixVerfuegbar: true, fixVersion: "1.2.3" });
  });

  test("kaputte Ausgabe wirft", () => {
    expect(() => A.befundeAusNpmAudit(null)).toThrow();
    expect(() => A.befundeAusNpmAudit([])).toThrow();
    expect(() => A.befundeAusNpmAudit({ error: { code: "ENOLOCK" } })).toThrow();
  });

  test("markiereProd übernimmt prod aus dem Audit ohne Dev", () => {
    const voll = A.befundeAusNpmAudit(audit);
    const prod = voll.filter((b) => b.paket === "foo");
    expect(A.markiereProd(voll, prod).map((b) => b.prod)).toEqual([false, true]);
  });
});

describe("befundeAusAlerts", () => {
  const alert = (eco: string, scope: string) => ({
    security_advisory: { ghsa_id: G1, severity: "critical" },
    dependency: { scope, package: { ecosystem: eco, name: "p" } },
    security_vulnerability: { first_patched_version: null },
  });

  test("npm runtime ist prod, npm development nicht", () => {
    expect(A.befundeAusAlerts([alert("npm", "runtime")])[0].prod).toBe(true);
    expect(A.befundeAusAlerts([alert("npm", "development")])[0].prod).toBe(false);
  });

  test("Ökosystem actions ist nie prod", () => {
    expect(A.befundeAusAlerts([alert("actions", "runtime")])[0].prod).toBe(false);
  });

  test("Fix aus first_patched_version; Alert ohne GHSA entfällt; Nicht-Liste wirft", () => {
    const mit = { ...alert("npm", "runtime"), security_vulnerability: { first_patched_version: { identifier: "2.0.0" } } };
    expect(A.befundeAusAlerts([mit])[0]).toMatchObject({ fixVerfuegbar: true, fixVersion: "2.0.0" });
    expect(A.befundeAusAlerts([{ security_advisory: {} }])).toEqual([]);
    expect(() => A.befundeAusAlerts({})).toThrow();
  });
});

describe("bekannteGhsa", () => {
  test("offene Audit-Zeile, Wiedervorlage und Security-Ticket zählen; erledigte Zeile und fremde Zeilen nicht", () => {
    const menge = A.bekannteGhsa({
      kommentare: ["- [ ] Audit: GHSA-1111-2222-3333 p (high, dev), Fix: nein.\nSonst nichts", "- [x] Audit: GHSA-4444-5555-6666 q (high, dev)", "- [ ] andere Zeile GHSA-7777-8888-9999"],
      wiedervorlagen: [{ id: "audit-ghsa-aaaa-bbbb-cccc" }, { id: "langfuse-takt-schwelle" }],
      offeneTitel: ["🔒 Security: GHSA-dddd-eeee-ffff in x", "Anderes GHSA-0000-0000-0000"],
    });
    expect([...menge].sort()).toEqual(["ghsa-1111-2222-3333", "ghsa-aaaa-bbbb-cccc", "ghsa-dddd-eeee-ffff"]);
  });
});

describe("vertrauteBodies (#1663)", () => {
  const owner = "fluffels";
  const k = (login: string | null, body: string, type = "User") => ({ body, user: login === null ? null : { login, type } });
  test("Owner und github-actions[bot] zählen, Fremde, Fake-Bots und fehlende User nicht", () => {
    const bodies = A.vertrauteBodies(
      [k("fluffels", "a"), k("github-actions[bot]", "b", "Bot"), k("angreifer", "c"), k("github-actions[bot]", "d", "User"), k(null, "e")],
      owner,
    );
    expect(bodies).toEqual(["a", "b"]);
  });
  test("eine Audit-Zeile eines Fremden unterdrückt den Alarm nicht", () => {
    const fremd = [k("angreifer", "- [ ] Audit: " + G1 + " braces (critical, prod)")];
    const bekannt = A.bekannteGhsa({ kommentare: A.vertrauteBodies(fremd, owner), wiedervorlagen: [], offeneTitel: [] });
    const [a] = A.ordneEin({ befunde: [befund({ schwere: "critical", prod: true })], bekannt });
    expect(a.art).toBe("alarm");
    const eigen = A.bekannteGhsa({ kommentare: A.vertrauteBodies([k("fluffels", fremd[0].body)], owner), wiedervorlagen: [], offeneTitel: [] });
    expect(A.ordneEin({ befunde: [befund({ schwere: "critical", prod: true })], bekannt: eigen })).toEqual([]);
  });
  test("leere und kaputte Eingaben werfen nicht", () => {
    expect(A.vertrauteBodies([], owner)).toEqual([]);
    expect(A.vertrauteBodies([k("fluffels", null as unknown as string)], owner)).toEqual([""]);
  });
});

describe("main: --dry-run über Deps (#1837)", () => {
  type Libs = Record<string, unknown>;
  const main = (raw as unknown as { main: (argv: string[], deps: Record<string, unknown>) => Promise<number> }).main;
  const auditJson = { vulnerabilities: { braces: { severity: "high", via: [{ url: `https://github.com/advisories/${G1}`, name: "braces", severity: "high" }] } } };
  const aufbau = () => {
    const gepostet: [number, string][] = [];
    const log: string[] = [];
    const libs: Libs = {
      OWNER: "o",
      REPO: "o/r",
      ladeSammelKontext: () => ({ rohe: [], offene: [{ number: 5 }], kommentare: [] }),
      offeneTitel: () => [],
      platziereOben: () => undefined,
      postZeilen: (nr: number, text: string) => gepostet.push([nr, text]),
      waehleSammelticket: (offene: { number: number }[]) => offene[0],
    };
    const deps = { ladeLibs: () => Promise.resolve(libs), npmAuditLaden: () => auditJson, alertsLaden: () => [], log: (m: string) => log.push(m), err: () => undefined };
    return { gepostet, log, deps };
  };
  test("mit Flag: [dry-run]-Zeile im Log, nichts gepostet", async () => {
    const { gepostet, log, deps } = aufbau();
    expect(await main(["--dry-run"], deps)).toBe(0);
    expect(log.join("\n")).toContain("[dry-run]");
    expect(gepostet).toEqual([]);
  });
  test("ohne Flag: Zeile ins Sammelticket gepostet, kein [dry-run]", async () => {
    const { gepostet, log, deps } = aufbau();
    expect(await main([], deps)).toBe(0);
    expect(gepostet).toHaveLength(1);
    expect(gepostet[0][0]).toBe(5);
    expect(log.join("\n")).not.toContain("[dry-run]");
  });
});

describe("main: Ziel-Repo der Alarm-Tickets", () => {
  const main = (raw as unknown as { main: (argv: string[], deps: Record<string, unknown>) => Promise<number> }).main;
  const kritisch = { vulnerabilities: { braces: { severity: "critical", via: [{ url: `https://github.com/advisories/${G1}`, name: "braces", severity: "critical" }] } } };
  test("ZIEL ≠ eigenes Repo: der Alarm entsteht im Ziel-Repo mit Ziel-Token und wird dort einsortiert", async () => {
    const aufrufe: { args: string[]; opt: unknown }[] = [];
    const platziert: unknown[][] = [];
    const gh = { text: (args: string[], opt: unknown) => (aufrufe.push({ args, opt }), "https://github.com/o/ziel/issues/77\n"), json: () => ({}) };
    const libs = {
      OWNER: "o",
      REPO: "o/r",
      ZIEL: "o/ziel",
      zielToken: () => "zt",
      ladeSammelKontext: () => ({ rohe: [], offene: [{ number: 5 }], kommentare: [] }),
      offeneTitel: () => [],
      platziereOben: (...a: unknown[]) => platziert.push(a),
      postZeilen: () => undefined,
      waehleSammelticket: (o: { number: number }[]) => o[0],
    };
    const deps = { ladeLibs: () => Promise.resolve(libs), npmAuditLaden: () => kritisch, alertsLaden: () => [], gh, log: () => {}, err: () => {} };
    expect(await main([], deps)).toBe(0);
    const anlegen = aufrufe.find((a) => a.args[1] === "create");
    expect(anlegen?.args[anlegen.args.indexOf("--repo") + 1]).toBe("o/ziel");
    expect(anlegen?.opt).toEqual({ token: "zt" });
    expect(platziert).toEqual([["77", "security", process.env.PROJECT_TOKEN, "o/ziel"]]);
  });
});

describe("main: Vertrauen gegen den Owner des Ziel-Repos", () => {
  const main = (raw as unknown as { main: (argv: string[], deps: Record<string, unknown>) => Promise<number> }).main;
  test("eine Audit-Zeile des Ziel-Owners im Sammelticket-Kommentar macht die GHSA bekannt: kein neuer Alarm", async () => {
    const kritisch = { vulnerabilities: { braces: { severity: "critical", via: [{ url: `https://github.com/advisories/${G1}`, name: "braces", severity: "critical" }] } } };
    const aufrufe: string[][] = [];
    const gh = { text: (args: string[]) => (aufrufe.push(args), "https://github.com/z/ziel/issues/77\n"), json: () => ({}) };
    const libs = {
      OWNER: "o",
      REPO: "o/r",
      ZIEL: "z/ziel",
      ladeSammelKontext: () => ({ rohe: [], offene: [{ number: 5 }], kommentare: [{ user: { login: "z", type: "User" }, body: `- [ ] Audit: ${G1} braces (critical, prod)` }], owner: "z" }),
      offeneTitel: () => [],
      platziereOben: () => undefined,
      postZeilen: () => undefined,
      waehleSammelticket: (o: { number: number }[]) => o[0],
    };
    const deps = { ladeLibs: () => Promise.resolve(libs), npmAuditLaden: () => kritisch, alertsLaden: () => [], gh, log: () => {}, err: () => {} };
    expect(await main([], deps)).toBe(0);
    expect(aufrufe.filter((a) => a[1] === "create")).toEqual([]);
  });
});
