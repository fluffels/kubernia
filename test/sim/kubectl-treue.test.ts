/* Domänen-Fitness (#1440): Die Treue-Matrix (docs/sim-treue/kubectl.json) deckt jeden registrierten
 * kubectl-Unterbefehl und jede unterstützte Ressourcenart ab. Ein neuer Befehl oder eine neue Art ohne
 * Matrix-Zeile ist rot. Probing: `sim.exec` je Alias; „unterstützt“ heißt, die Ausgabe passt nicht auf
 * den „nicht simuliert“-Text des Befehls (fail-closed: ändert sich der Text, schlägt die Sanity-Probe an). */
import { test, expect, describe } from "vitest";
import { readFileSync } from "node:fs";
import { freshSim } from "./helpers";
import { KUBECTL_SUBCOMMANDS } from "../../src/sim/kubectl";
import { GET_RESOURCE_SCOPES } from "../../src/sim/kubectl/inspect";
import { MAPPED_KINDS } from "../../src/sim/manifest/registry";
import { simGrenzen } from "../../src/hud/helptext";

const STATUS = ["gleich", "vereinfacht", "abweichend"];
const ZEILEN_SCHLUESSEL = ["befehl", "ziel", "flag", "verhalten", "ausgabe", "tickets", "grenzen", "doku"];
const DOKU_HOSTS = ["kubernetes.io", "prometheus-operator.dev", "prometheus.io", "grafana.github.io", "argo-cd.readthedocs.io"];

interface Zeile {
  befehl: string; ziel?: string; flag?: string; verhalten: string; ausgabe: string;
  tickets?: number[]; grenzen?: string[]; doku?: string;
}
interface Matrix { befehle: Record<string, { doku: string; dokuZiele?: string[] }>; zeilen: Zeile[] }

const matrix = JSON.parse(readFileSync("docs/sim-treue/kubectl.json", "utf8")) as Matrix;
const rows = matrix.zeilen;
const ofBefehl = (b: string) => rows.filter(r => r.befehl === b);
const zieleOf = (b: string) => ofBefehl(b).filter(r => r.ziel !== undefined).map(r => r.ziel!);
const sorted = (xs: Iterable<string>) => [...xs].sort();

/** „Nicht simuliert“-Text je Befehl (testlokal; die Sanity-Probe unten hält ihn aktuell). */
const NICHT_SIMULIERT: Record<string, RegExp> = {
  ...Object.fromEntries(["get", "describe", "delete", "top", "set", "rollout", "auth"].map(b => [b, /Nicht simuliert:|doesn't have a resource type|unknown command/])),
  // create/label haben tiefere „nicht simuliert“-Meldungen (Unterart des Secrets, anderes Label), die den Befehl selbst nicht ausschließen.
  create: /Nicht simuliert: 'kubectl create (?!secret )|doesn't have a resource type/,
  label: /Nicht simuliert: 'kubectl label/,
};

/** Unterstützt der Simulator `kubectl <befehl> <wort> …`? */
function supported(befehl: string, wort: string): boolean {
  const out = freshSim().exec(`kubectl ${befehl} ${wort} treue-probe`).output ?? "";
  return !NICHT_SIMULIERT[befehl].test(out);
}

describe("Matrix-Schema", () => {
  test("jede Zeile: genau eins von ziel/flag, bekannte Schlüssel, gültige Status", () => {
    for (const r of rows) {
      const name = `${r.befehl} ${r.ziel ?? r.flag}`;
      expect((r.ziel === undefined) !== (r.flag === undefined), `${name}: genau eins von ziel/flag`).toBe(true);
      expect(Object.keys(r).filter(k => !ZEILEN_SCHLUESSEL.includes(k)), `${name}: unbekannte Schlüssel`).toEqual([]);
      expect(STATUS, `${name}: verhalten`).toContain(r.verhalten);
      expect(STATUS, `${name}: ausgabe`).toContain(r.ausgabe);
    }
  });

  test("(befehl, ziel|flag) ist eindeutig", () => {
    const keys = rows.map(r => `${r.befehl}|${r.ziel !== undefined ? "ziel" : "flag"}|${r.ziel ?? r.flag}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  test("abweichend verlangt Tickets (ganze Zahlen), vereinfacht verlangt bekannte Grenzen", () => {
    const ids = simGrenzen("kubectl").map(g => g.id);
    const probleme: string[] = [];
    for (const r of rows) {
      const name = `${r.befehl} ${r.ziel ?? r.flag}`;
      const zellen = [r.verhalten, r.ausgabe];
      if (zellen.includes("abweichend") && !(r.tickets?.length && r.tickets.every(Number.isInteger))) probleme.push(`${name}: abweichend ohne Ticket`);
      if (zellen.includes("vereinfacht") && !r.grenzen?.length) probleme.push(`${name}: vereinfacht ohne Grenze`);
      for (const g of r.grenzen ?? []) if (!ids.includes(g)) probleme.push(`${name}: unbekannte Grenze ${g}`);
    }
    expect(probleme).toEqual([]);
  });

  test("jede Grenze in help kubectl wird von mindestens einer Zeile benutzt", () => {
    const benutzt = new Set(rows.flatMap(r => r.grenzen ?? []));
    expect(simGrenzen("kubectl").map(g => g.id).filter(id => !benutzt.has(id))).toEqual([]);
  });

  test("Doku-Links sind https auf erlaubten Hosts", () => {
    const links = [...rows.map(r => r.doku), ...Object.values(matrix.befehle).map(b => b.doku)].filter(Boolean) as string[];
    for (const l of links) {
      const u = new URL(l);
      expect(u.protocol, l).toBe("https:");
      expect(DOKU_HOSTS.some(h => u.hostname === h || u.hostname.endsWith("." + h)), l).toBe(true);
    }
  });
});

describe("Vollständigkeit gegen die registrierten Befehle", () => {
  test("Matrix-Befehle = registrierte Unterbefehle, in beide Richtungen", () => {
    expect(sorted(new Set(rows.map(r => r.befehl)))).toEqual(sorted(KUBECTL_SUBCOMMANDS));
    expect(sorted(Object.keys(matrix.befehle))).toEqual(sorted(KUBECTL_SUBCOMMANDS));
  });

  test("Sanity: der „nicht simuliert“-Text jedes geprobten Befehls trifft noch (fail-closed)", () => {
    for (const b of Object.keys(NICHT_SIMULIERT)) expect(supported(b, "zzz-nichtda"), b).toBe(false);
  });

  test("get: je Aliasgruppe genau eine ziel-Zeile aus der Gruppe, keine ziel-Zeile ohne Gruppe", () => {
    const ziele = zieleOf("get");
    for (const g of GET_RESOURCE_SCOPES) {
      expect(ziele.filter(z => g.aliases.includes(z)), `Gruppe ${g.aliases[0]}`).toHaveLength(1);
    }
    expect(ziele.filter(z => !GET_RESOURCE_SCOPES.some(g => g.aliases.includes(z)))).toEqual([]);
  });

  test.each(["describe", "create", "delete", "top"])("%s: unterstützte Arten (Probing über alle get-Aliase) = ziel-Zeilen", b => {
    const arten = GET_RESOURCE_SCOPES.filter(g => g.aliases.some(a => supported(b, a))).map(g => g.aliases[0]);
    expect(sorted(zieleOf(b))).toEqual(sorted(arten));
  });

  test.each(["set", "rollout", "auth", "label"])("%s: unterstützte Unterverben (Doku-Liste + Zeilen) = ziel-Zeilen", b => {
    const kandidaten = new Set([...(matrix.befehle[b].dokuZiele ?? []), ...zieleOf(b)]);
    const unterstuetzt = [...kandidaten].filter(v => supported(b, v));
    expect(sorted(zieleOf(b))).toEqual(sorted(unterstuetzt));
  });

  test("apply: jede per Mapper unterstützte kind hat eine Zeile", () => {
    expect(sorted(MAPPED_KINDS).filter(k => !zieleOf("apply").includes(k))).toEqual([]);
  });

  test("scale, expose, logs: mindestens eine Zeile (nur Präsenz auf Befehlsebene)", () => {
    for (const b of ["scale", "expose", "logs"]) expect(ofBefehl(b).length, b).toBeGreaterThan(0);
  });
});
