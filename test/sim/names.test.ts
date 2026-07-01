/* Value Objects für Ressourcen-Namen (#479, DDD; auf ResourceName verallgemeinert #507).
 * Ein Kubernetes-Objektname ist KEIN beliebiger String, sondern folgt der
 * DNS-1123-Regel. Diese Tests sichern die zentrale Regel (`isResourceName`),
 * den prüfenden Smart-Constructor (`resourceName`) und die bewusste, ungeprüfte
 * Brand-Fabrik für intern erzeugte Namen (`asPodName`) ab – inkl. Negativfälle.
 * Dass die Namen-Fabrik `makePodName` (util.ts) tatsächlich nur gültige Namen
 * liefert (die Rechtfertigung für den ungeprüften Brand), wird hier mitgeprüft. */
import { describe, test, expect } from "vitest";
import { isResourceName, resourceName, asPodName, InvalidResourceNameError } from "../../src/sim/names";
import { makePodName } from "../../src/sim/util";

describe("isResourceName – die DNS-1123-Regel an EINER Stelle", () => {
  test("akzeptiert gültige Namen", () => {
    for (const ok of [
      "web",
      "a",
      "web-7d8f9c6b54-x2k9p",   // die generierte Pod-Namen-Form
      "kasse",
      "my-app-1",
      "svc.default",            // DNS-1123-Subdomain: Labels durch Punkte getrennt
      "123",
    ]) {
      expect(isResourceName(ok), ok).toBe(true);
    }
  });

  test("lehnt ungültige Namen ab (Negativfälle)", () => {
    for (const bad of [
      "",                 // leer
      "WebApp",           // Großbuchstaben
      "-web",             // führender Bindestrich
      "web-",             // abschließender Bindestrich
      ".web",             // führender Punkt
      "web_app",          // Unterstrich
      "web app",          // Leerzeichen
      "web!",             // Sonderzeichen
      "a".repeat(254),    // zu lang (>253)
    ]) {
      expect(isResourceName(bad), bad).toBe(false);
    }
  });
});

describe("resourceName – prüfender Smart-Constructor", () => {
  test("gibt bei gültigem Namen den (gebrandeten) Namen unverändert zurück", () => {
    const n = resourceName("web-7d8f9c6b54-x2k9p");
    expect(n).toBe("web-7d8f9c6b54-x2k9p");
  });

  test("wirft InvalidResourceNameError bei ungültigem Namen", () => {
    expect(() => resourceName("WebApp")).toThrow(InvalidResourceNameError);
    expect(() => resourceName("")).toThrow(InvalidResourceNameError);
    // Die Fehlermeldung nennt den beanstandeten Wert (Diagnose).
    expect(() => resourceName("bad_name")).toThrow(/bad_name/);
  });

  test("trägt den beanstandeten Rohwert als `raw` (für die Aggregat-Grenze)", () => {
    try {
      resourceName("Bad_Name");
      throw new Error("hätte werfen müssen");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidResourceNameError);
      expect((e as InvalidResourceNameError).raw).toBe("Bad_Name");
    }
  });
});

describe("asPodName – ungeprüfte Brand-Fabrik für vertrauenswürdige, intern erzeugte Namen", () => {
  test("brandet ohne Prüfung und ändert den Wert nicht", () => {
    // Bewusst KEINE Validierung: der Aufrufer garantiert die Herkunft (Generator).
    expect(asPodName("web-abc12-x9y8z")).toBe("web-abc12-x9y8z");
  });
});

describe("makePodName rechtfertigt den ungeprüften Brand", () => {
  test("erzeugt für einen gültigen Deployment-Namen einen gültigen Ressourcen-Namen", () => {
    for (const dep of ["web", "kasse", "my-app-1"]) {
      const name = makePodName(dep);
      expect(isResourceName(name), name).toBe(true);
      expect(name.startsWith(dep + "-")).toBe(true);
    }
  });
});
