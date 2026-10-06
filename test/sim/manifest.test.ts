import { describe, it, expect } from "vitest";
import { effectsFromManifest, fileEffects, type ManifestFailure } from "../../src/sim/manifest/registry";
import { mapDeployment } from "../../src/sim/manifest/apps";
import { Leaf, ManifestError } from "../../src/sim/manifest/fields";
import type { ApplyEffect } from "../../src/sim";

const DEP = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: web
          image: nginx:1.27
`;

function ok(text: string): ApplyEffect[] {
  const r = effectsFromManifest(text, "m.yaml");
  if (!Array.isArray(r)) throw new Error("Fehlschlag: " + r.error);
  return r;
}
function bad(text: string): ManifestFailure {
  const r = effectsFromManifest(text, "m.yaml");
  if (Array.isArray(r)) throw new Error("kein Fehlschlag: " + JSON.stringify(r));
  return r;
}

describe("Mapper: Deployment", () => {
  it("minimales Deployment, replicas-Default 1", () => {
    expect(ok(DEP.replace("  replicas: 3\n", ""))).toStrictEqual([{ deployment: { name: "web", image: "nginx:1.27", replicas: 1 } }]);
  });

  it("alle modellierten Felder", () => {
    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: voll
spec:
  replicas: 2
  template:
    spec:
      serviceAccountName: wachdienst
      nodeName: worker-1
      securityContext:
        runAsNonRoot: true
        readOnlyRootFilesystem: false
      volumes:
        - name: tmp
          emptyDir: {}
      initContainers:
        - name: init
          image: busybox
      containers:
        - name: c
          image: img:1
          ports:
            - containerPort: 8080
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            privileged: false
          resources:
            limits:
              ephemeral-storage: 1Gi
`;
    expect(ok(yaml)).toStrictEqual([{ deployment: {
      name: "voll", image: "img:1", replicas: 2, serviceAccountName: "wachdienst", containerPort: 8080, node: "worker-1",
      ephemeralLimit: 1024, emptyDir: {}, initContainer: {},
      securityContext: { runAsNonRoot: true, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, privileged: false },
    } }]);
  });

  it("Volume ohne emptyDir erzeugt kein emptyDir", () => {
    const yaml = DEP.replace("      containers:", "      volumes:\n        - name: v\n          configMap:\n            name: c\n      containers:");
    expect(ok(yaml)[0].deployment?.emptyDir).toBeUndefined();
  });

  const errors: [string, string, RegExp][] = [
    ["Name fehlt", DEP.replace("  name: web\n", "  labels: {}\n"), /metadata\.name: Pflichtfeld fehlt/],
    ["Name nicht DNS-1123", DEP.replace("name: web", "name: Web_1"), /is invalid/],
    ["Image fehlt", DEP.replace("          image: nginx:1.27\n", ""), /containers\[0\]\.image: Pflichtfeld fehlt/],
    ["keine Container", DEP.replace(/ {6}containers:[\s\S]*/, "      containers: []\n"), /containers: Pflichtfeld fehlt/],
    ["replicas Text", DEP.replace("replicas: 3", "replicas: viele"), /spec\.replicas: erwartet eine ganze Zahl, gefunden Text/],
    ["replicas negativ", DEP.replace("replicas: 3", "replicas: -1"), /spec\.replicas: erwartet eine ganze Zahl ≥ 0/],
    ["replicas Dezimal", DEP.replace("replicas: 3", "replicas: 1.5"), /ganze Zahl ≥ 0, gefunden 1\.5/],
    ["spec ist Liste", DEP.replace(/spec:\n {2}replicas[\s\S]*/, "spec:\n  - a\n"), /spec: erwartet ein Mapping, gefunden eine Liste/],
    ["Image ist Zahl", DEP.replace("image: nginx:1.27", "image: 5"), /image: erwartet Text, gefunden eine Zahl/],
    ["securityContext falscher Typ", DEP.replace("      containers:", "      securityContext:\n        runAsNonRoot: ja\n      containers:"), /runAsNonRoot: erwartet true oder false/],
    ["ephemeral-storage ungültig", DEP.replace("          image: nginx:1.27\n", "          image: x\n          resources:\n            limits:\n              ephemeral-storage: viel\n"), /ephemeral-storage: ungültige Mengenangabe/],
    ["containers ist Mapping", DEP.replace(/ {6}containers:[\s\S]*/, "      containers:\n        name: x\n"), /containers: erwartet eine Liste, gefunden ein Mapping/],
  ];
  it.each(errors)("Fehler: %s", (_n, yaml, re) => {
    const f = bad(yaml);
    expect(f.error).toMatch(re);
    expect(f.hint).toBeTruthy();
  });

  it("Feldfehler im Rahmen von kubectl", () => {
    expect(bad(DEP.replace("replicas: 3", "replicas: viele")).error)
      .toMatch(/^error: error validating "m\.yaml": error validating data: /);
  });

  it("Fehler direkt am Mapper ist ein ManifestError", () => {
    expect(() => mapDeployment(new Leaf({}, ""))).toThrow(ManifestError);
  });
});

describe("Mapper: Service", () => {
  const svc = (spec: string, name = "api") => `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${name}\nspec:\n${spec}`;

  it("Port, targetPort als Zahl und als Name, Port-Name und clusterIP None ignoriert", () => {
    expect(ok(svc("  ports:\n    - name: http\n      port: 80\n      targetPort: 8080\n"))).toStrictEqual([{ service: { name: "api", port: 80, targetPort: 8080 } }]);
    expect(ok(svc("  clusterIP: None\n  ports:\n    - port: 5432\n      targetPort: db\n"))).toStrictEqual([{ service: { name: "api", port: 5432, targetPort: "db" } }]);
  });

  it("Typ nur, wenn gesetzt", () => {
    expect(ok(svc("  type: NodePort\n  ports:\n    - port: 80\n"))[0].service?.type).toBe("NodePort");
    expect(ok(svc("  ports:\n    - port: 80\n"))[0].service).not.toHaveProperty("type");
  });

  it("ExternalName ohne Ports bekommt port \"\"", () => {
    expect(ok(svc("  type: ExternalName\n  externalName: api.bank.example.com\n"))).toStrictEqual([
      { service: { name: "api", type: "ExternalName", externalName: "api.bank.example.com", port: "" } }]);
  });

  const errors: [string, string, RegExp][] = [
    ["ohne Ports", svc("  selector:\n    app: x\n"), /spec\.ports: Pflichtfeld fehlt/],
    ["Port fehlt", svc("  ports:\n    - targetPort: 80\n"), /ports\[0\]\.port: Pflichtfeld fehlt/],
    ["Port als Text", svc('  ports:\n    - port: "80"\n'), /ports\[0\]\.port: erwartet eine ganze Zahl, gefunden Text/],
    ["ExternalName ohne Ziel", svc("  type: ExternalName\n"), /externalName: Pflichtfeld fehlt bei type ExternalName/],
    ["targetPort falscher Typ", svc("  ports:\n    - port: 80\n      targetPort: true\n"), /targetPort: erwartet Text/],
  ];
  it.each(errors)("Fehler: %s", (_n, yaml, re) => {
    expect(bad(yaml).error).toMatch(re);
  });

  it("ungültiger Name", () => {
    expect(bad(svc("  ports:\n    - port: 80\n", "Bad_Name")).error).toMatch(/The Service "Bad_Name" is invalid/);
  });
});

describe("Registry: effectsFromManifest", () => {
  it("leere Datei und reine Kommentare", () => {
    expect(bad("").error).toBe("error: no objects passed to apply");
    expect(bad("# nichts\n---\n").error).toBe("error: no objects passed to apply");
  });

  it("Parse-Fehler nennen Datei und Zeile", () => {
    expect(bad("a: 1\nb:wert\n").error).toBe("error: error parsing m.yaml: yaml: line 2: nach dem Doppelpunkt fehlt ein Leerzeichen");
  });

  it("apiVersion/kind fehlen", () => {
    expect(bad("metadata:\n  name: x\n").error).toBe('error: error validating "m.yaml": error validating data: [apiVersion not set, kind not set]');
    expect(bad("kind: Service\n").error).toMatch(/\[apiVersion not set\]$/);
    expect(bad("apiVersion: v1\n").error).toMatch(/\[kind not set\]$/);
  });

  it("Dokument ist kein Mapping", () => {
    expect(bad("- a\n- b\n").error).toMatch(/kein Mapping/);
    expect(bad("nur Text\n").error).toMatch(/kein Mapping/);
  });

  it("unbekannte Kombination: kein Mapping gefunden", () => {
    const f = bad("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg\n");
    expect(f.error).toBe('error: resource mapping not found for name: "cfg" namespace: "" from "m.yaml": no matches for kind "ConfigMap" in version "v1"');
    expect(bad("apiVersion: apps/v1\nkind: Service\n").error).toMatch(/name: "" namespace/);
    expect(bad("apiVersion: apps/v1\nkind: Service\n").error).toMatch(/no matches for kind "Service" in version "apps\/v1"/);
  });

  it("Dockerfile-Inhalt ist ein Parse-Fehler", () => {
    expect(bad("FROM node:20\nCOPY . .\n").error).toMatch(/^error: error parsing m\.yaml: yaml: line 2:/);
  });

  it("Multi-Dokument: Effekte in Reihenfolge", () => {
    const text = DEP + "---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web\nspec:\n  ports:\n    - port: 80\n";
    const r = ok(text);
    expect(r.map(e => Object.keys(e)[0])).toStrictEqual(["deployment", "service"]);
  });

  it("Multi-Dokument ist alles oder nichts, Fehler nennt das Dokument", () => {
    const text = DEP + "---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web\nspec:\n  selector: {}\n";
    const f = bad(text);
    expect(f.error).toMatch(/\(Dokument 2\)/);
    expect(f.error).toMatch(/spec\.ports/);
  });
});

describe("Registry: fileEffects (Vorrang)", () => {
  it("der hinterlegte Effekt hat Vorrang vor dem Dateiinhalt", () => {
    const legacy: ApplyEffect = { deployment: { name: "alt", image: "i", replicas: 1 } };
    expect(fileEffects(legacy, "kaputt: [", "x.yaml")).toStrictEqual([legacy]);
  });
  it("ohne Effekt wird der Inhalt gelesen", () => {
    expect(fileEffects(undefined, DEP, "x.yaml")).toHaveLength(1);
    expect(Array.isArray(fileEffects(undefined, "a: [", "x.yaml"))).toBe(false);
  });
});
