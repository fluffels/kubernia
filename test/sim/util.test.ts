/* Reine Sim-Helfer (sim/util.ts) – seit #499 sind die früheren `_editDistance`/`_suggest`/
 * `_flagValue`/`_multiFlag`-Methoden pure Funktionen (kein Cluster-Zustand). Diese Tests
 * sichern ihr Verhalten inkl. Grenz-/Negativfälle direkt an der öffentlichen Funktion ab,
 * statt sie nur indirekt über die Befehlsfamilien mitzuprüfen. */
import { describe, test, expect } from "vitest";
import { editDistance, suggest, flagValue, multiFlag } from "../../src/sim/util";

describe("editDistance – Levenshtein", () => {
  test("gleiche Strings: Distanz 0", () => {
    expect(editDistance("kubectl", "kubectl")).toBe(0);
  });
  test("eine Ersetzung / ein Einschub / leerer String", () => {
    expect(editDistance("kubectl", "kubektl")).toBe(1); // ein Buchstabe ersetzt (c→k)
    expect(editDistance("helm", "hlm")).toBe(1);        // ein fehlender Buchstabe
    expect(editDistance("", "abc")).toBe(3);            // leer → 3 Einfügungen
  });
});

describe("suggest – Meintest-du-Vorschlag", () => {
  const cmds = ["docker", "kubectl", "helm", "terraform", "git"];
  test("naher Tippfehler wird korrigiert", () => {
    expect(suggest("kubctl", cmds)).toBe("kubectl");
    expect(suggest("dockr", cmds)).toBe("docker");
  });
  test("exakter Treffer gibt NICHT sich selbst zurück (Distanz 0 → null)", () => {
    expect(suggest("git", cmds)).toBeNull();
  });
  test("zu weit weg → null (kurze Wörter strenger: limit 1)", () => {
    expect(suggest("xyz", cmds)).toBeNull();
  });
  test("längere Wörter erlauben Distanz bis 2", () => {
    expect(suggest("terrafrm", cmds)).toBe("terraform"); // 1 fehlend
  });
});

describe("flagValue – Wert hinter einer Flag", () => {
  test("getrennte Form '-n wert'", () => {
    expect(flagValue(["kubectl", "get", "pods", "-n", "kube-system"], "-n")).toBe("kube-system");
  });
  test("Gleichheits-Form '-n=wert'", () => {
    expect(flagValue(["kubectl", "get", "pods", "-n=kube-system"], "-n")).toBe("kube-system");
  });
  test("Flag fehlt → null", () => {
    expect(flagValue(["kubectl", "get", "pods"], "-n")).toBeNull();
  });
  test("Flag am Ende ohne Wert → null", () => {
    expect(flagValue(["kubectl", "get", "-n"], "-n")).toBeNull();
  });
});

describe("multiFlag – wiederholbare & kommagetrennte Flags", () => {
  test("kommagetrennt", () => {
    expect(multiFlag("kubectl create role r --verb=get,list", "verb")).toEqual(["get", "list"]);
  });
  test("wiederholt UND kommagetrennt zusammengeführt", () => {
    expect(multiFlag("--verb=get,list --verb=watch", "verb")).toEqual(["get", "list", "watch"]);
  });
  test("getrennte Form '--verb watch'", () => {
    expect(multiFlag("kubectl create role r --verb create", "verb")).toEqual(["create"]);
  });
  test("Flag fehlt → leeres Array", () => {
    expect(multiFlag("kubectl create role r --resource=pods", "verb")).toEqual([]);
  });
});
