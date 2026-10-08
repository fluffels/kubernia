/* kubectl-Ziele (#1488): der EINE Ziel-Leser (`readTargets`, pur) und `targetOutcome`. Die Befehle (describe, delete, scale,
 * rollout restart, expose, set) mit Mehrfachzielen stehen in kubectl-ziele-befehle.test.ts. */
import { describe, test, expect } from "vitest";
import { readTargets, targetOutcome } from "../../src/sim/kubectl/targets";

const host = { _err: (m: string, tip?: string) => (tip ? m + " | " + tip : m) };
const NO_TYPE = "there is no need to specify a resource type as a separate argument";
const EINZEL = "error: arguments in resource/name form must have a single resource and name";
const MEHR = "error: arguments in resource/name form may not have more than one slash";

/** Kurzform der Ziele: `pods:a,b` je Art (`*` = alle). */
function kurz(args: string[]): string[] | string {
  const r = readTargets(host, args);
  return "error" in r ? r.error : r.targets.map(t => t.kind.plural + ":" + (t.names.join(",") || "*"));
}

describe("readTargets: der Builder von kubectl", () => {
  test.each<[string, string[], string[]]>([
    ["leer", [], []],
    ["nur Art", ["pods"], ["pods:*"]],
    ["Art und Namen", ["pods", "a", "b"], ["pods:a,b"]],
    ["Kurzname und Plural", ["deploy", "web"], ["deployments:web"]],
    ["Slash-Paare einer Art", ["pod/a", "pod/b"], ["pods:a,b"]],
    ["Slash-Paare gemischter Arten", ["pod/a", "svc/b", "pod/c"], ["pods:a,c", "services:b"]],
    ["Komma-Liste ohne Namen", ["pods,svc"], ["pods:*", "services:*"]],
    ["Komma-Liste mit Namen: Kreuzprodukt", ["pods,svc", "web"], ["pods:web", "services:web"]],
    ["Kreuzprodukt mit zwei Namen", ["pods,svc", "a", "b"], ["pods:a,b", "services:a,b"]],
    ["doppelte Arten fallen weg", ["deploy,deployments", "x"], ["deployments:x"]],
    ["leere Einträge der Liste fallen weg", ["pods,,svc"], ["pods:*", "services:*"]],
    ["all ohne Namen", ["all"], ["pods:*", "services:*", "deployments:*", "replicasets:*", "statefulsets:*", "grafanadatasources:*", "grafanadashboards:*"]],
  ])("%s", (_name, args, erwartet) => {
    expect(kurz(args)).toEqual(erwartet);
  });

  test.each<[string, string[], string]>([
    ["all mit Namen", ["all", "web"], "error: you must specify only one resource"],
    ["Art und Slash-Paar", ["pod", "pod/a"], NO_TYPE],
    ["Slash-Paar und Name", ["pod/a", "b"], NO_TYPE],
    ["Name zwischen Slash-Paaren", ["pod/a", "b", "pod/c"], NO_TYPE],
    ["Slash ohne Namen", ["pod/"], EINZEL],
    ["Slash ohne Art", ["/a"], EINZEL],
    ["zwei Slashes", ["a/b/c"], MEHR],
    ["kaputtes Paar mitten in der Liste", ["pod/a", "svc/", "pod/b"], EINZEL],
    ["unbekannte Art", ["frob", "a"], 'the server doesn\'t have a resource type "frob"'],
    ["unbekannte Art in der Liste", ["pods,frob"], 'the server doesn\'t have a resource type "frob"'],
    ["unbekannte Art im Paar", ["frob/a"], 'the server doesn\'t have a resource type "frob"'],
    ["unbekannte Art im Kreuzprodukt", ["pods,frob", "a"], 'the server doesn\'t have a resource type "frob"'],
  ])("Fehler: %s", (_name, args, text) => {
    const r = kurz(args);
    expect(typeof r).toBe("string");
    expect(r).toContain(text);
  });

  test("nur Kommas ergeben keine Art", () => {
    expect(kurz([","])).toEqual([]);
  });
});

describe("targetOutcome: erst Erfolge, dann Fehler", () => {
  test("ohne Fehler reiner Text, mit Fehlern Fehlerausgabe samt Tipp", () => {
    expect(targetOutcome(host, ["a", "b"], [], "tipp")).toBe("a\nb");
    expect(targetOutcome(host, ["a"], ["fehler"], "tipp")).toBe("a\nfehler | tipp");
    expect(targetOutcome(host, [], ["fehler"], "tipp")).toBe("fehler | tipp");
  });
});
