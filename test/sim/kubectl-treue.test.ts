/* Domänen-Fitness (#1440): Die kubectl-Tiefe der Treue-Matrix (docs/sim-treue/kubectl.json): jede unterstützte
 * Ressourcenart bzw. jedes Unterverb hat eine Zeile. Schema und Unterbefehls-Vollständigkeit prüft der generische
 * Wächter test/sim/sim-treue.test.ts. Eine neue Art ohne Matrix-Zeile ist rot. Probing: `sim.exec` je Alias;
 * „unterstützt“ heißt, die Ausgabe passt nicht auf den „nicht simuliert“-Text des Befehls (fail-closed: ändert sich der Text, schlägt die Sanity-Probe an). */
import { test, expect, describe } from "vitest";
import { freshSim } from "./helpers";
import { GET_RESOURCE_SCOPES } from "../../src/sim/kubectl/inspect";
import { MAPPED_KINDS } from "../../src/sim/manifest/registry";
import { NODE_VERSION } from "../../src/sim/nodes";
import { ladeMatrix } from "../support/sim-treue";

const matrix = ladeMatrix("kubectl");
const rows = matrix.zeilen;

describe("Versionsbasis (#1483)", () => {
  test("clusterVersion der kubectl-Matrix ist gesetzt und die simulierte NODE_VERSION: Serververhalten (Warnungen, Deprecations) folgt ihr", () => {
    expect(matrix.clusterVersion).toBe(NODE_VERSION);
  });
});
const ofBefehl = (b: string) => rows.filter(r => r.befehl === b);
const zieleOf = (b: string) => ofBefehl(b).filter(r => r.ziel !== undefined).map(r => r.ziel!);
const sorted = (xs: Iterable<string>) => [...xs].sort();

/** „Nicht simuliert“-Text je Befehl (testlokal; die Sanity-Probe unten hält ihn aktuell). */
const NICHT_SIMULIERT: Record<string, RegExp> = {
  ...Object.fromEntries(["get", "describe", "delete", "top"].map(b => [b, /Nicht simuliert:|doesn't have a resource type|unknown command/])),
  // Bei set/rollout/auth ist das erste Wort eine Aktion, keine Art: ein unbekannter Ressourcentyp in den Zielen („treue-probe“) heißt „Aktion unterstützt“.
  ...Object.fromEntries(["set", "rollout", "auth"].map(b => [b, /Nicht simuliert:|unknown command/])),
  // create/label haben tiefere „nicht simuliert“-Meldungen (Unterart des Secrets, anderes Label), die den Befehl selbst nicht ausschließen.
  create: /Nicht simuliert: 'kubectl create (?!secret )|doesn't have a resource type/,
  label: /Nicht simuliert: 'kubectl label/,
};

/** Unterstützt der Simulator `kubectl <befehl> <wort> …`? */
function supported(befehl: string, wort: string): boolean {
  const out = freshSim().exec(`kubectl ${befehl} ${wort} treue-probe`).output ?? "";
  return !NICHT_SIMULIERT[befehl].test(out);
}

describe("Vollständigkeit gegen die registrierten Befehle", () => {
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
