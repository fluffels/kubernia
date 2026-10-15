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
  bekannteGhsa: (a: { kommentare: string[]; wiedervorlagen: { id: string }[]; offeneTitel: string[] }) => Set<string>;
};

const G1 = "GHSA-aaaa-bbbb-cccc";
const befund = (o: Partial<B> = {}): B => ({ ghsa: G1, paket: "braces", schwere: "high", prod: false, fixVerfuegbar: false, ...o });

describe("ordneEin", () => {
  test("critical + prod: Alarm mit Titel und Prüfauftrag", () => {
    const [a] = A.ordneEin({ befunde: [befund({ schwere: "critical", prod: true })], bekannt: [] });
    expect(a.art).toBe("alarm");
    expect(a.titel).toBe(`🔒 Security: ${G1} in braces`);
    expect(a.body).toContain("im Spielkontext ausnutzbar?");
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
