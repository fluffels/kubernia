/* curl und nslookup lesen ihre Eingabe über den Call-Vertrag (#1510): Flags mit Wert, Optionen,
 * Server-Argument, Default-Port des Schemas. Alles über die öffentliche Sim-API (`exec`). */
import { describe, test, expect } from "vitest";
import { KQSim } from "./helpers";

const NS = "Nicht simuliert";
const szenario = () => new KQSim({
  deployments: [
    { name: "kasse", image: "nginx", replicas: 1 },
    { name: "lager", image: "nginx", replicas: 1 },
    { name: "sicher", image: "nginx", replicas: 1 },
  ],
  services: [
    { name: "kasse", type: "ClusterIP", clusterIP: "10.96.0.20", port: 80 },
    { name: "lager", type: "ClusterIP", clusterIP: "10.96.0.21", port: 8080 },
    { name: "sicher", type: "ClusterIP", clusterIP: "10.96.0.22", port: 443 },
    { name: "bank", type: "ExternalName", clusterIP: "<none>", port: "", externalName: "api.bank.example.com" },
  ],
});
const run = (cmd: string, s: KQSim = szenario()) => ({ s, ...s.exec(cmd) });

describe("curl: Flags mit Wert nehmen ihren Wert nicht als URL", () => {
  test("-o schreibt den Body in eine Datei, die Antwort steht nicht im Terminal", () => {
    const r = run("curl -o seite.txt http://kasse");
    expect(r.error).toBe(false);
    expect(r.output).not.toContain("Ahoi");
    expect(r.output).toContain("% Total");
    expect(r.s.exec("cat seite.txt").output).toContain("Ahoi");
    expect(r.s.exec("cat seite.txt").output).not.toContain("HTTP/1.1");
    expect(r.s.exec("ls").output).toContain("seite.txt");
  });
  test("-s -o: keine Ausgabe, Datei trotzdem da; --output=x und -ox gehen auch", () => {
    const r = run("curl -s -o x kasse");
    expect(r.error).toBe(false);
    expect(r.output ?? "").toBe("");
    expect(r.s.files["x"]).toContain("Ahoi");
    expect(run("curl --output=y kasse").s.files["y"]).toContain("Ahoi");
    expect(run("curl -oz kasse").s.files["z"]).toContain("Ahoi");
  });
  test("-o ./name entfernt das führende ./", () => {
    expect(run("curl -s -o ./a.txt kasse").s.files["a.txt"]).toContain("Ahoi");
  });
  test("-o /dev/null verwirft die Antwort, es entsteht keine Datei", () => {
    const r = run("curl -s -o /dev/null kasse");
    expect(r.error).toBe(false);
    expect(Object.keys(r.s.files)).not.toContain("/dev/null");
    expect(r.output ?? "").toBe("");
  });
  test("-o - ist stdout: normale Antwort", () => {
    const r = run("curl -o - kasse");
    expect(r.output).toContain("HTTP/1.1 200 OK");
    expect(r.output).toContain("Ahoi");
  });
  test("-o mit Unterordner oder leerem Wert ist nicht simuliert, keine Datei", () => {
    for (const c of ["curl -o tmp/x kasse", "curl -o '' kasse"]) {
      const r = run(c);
      expect(r.output, c).toContain(NS);
      expect(r.output, c).toContain("Arbeitsverzeichnis");
      expect(Object.keys(r.s.files), c).toEqual([]);
    }
  });
  test("-o bei Fehler (6) und (7) legt keine Datei an", () => {
    const a = run("curl -o x http://gibtsnicht");
    expect(a.output).toContain("(6)");
    expect(a.s.files["x"]).toBeUndefined();
    const b = run("curl -o x kasse:99");
    expect(b.output).toContain("(7)");
    expect(b.s.files["x"]).toBeUndefined();
  });
  test("-o bei ExternalName schreibt die Datei", () => {
    const r = run("curl -s -o e.txt bank");
    expect(r.error).toBe(false);
    expect(r.s.files["e.txt"]).toContain("api.bank.example.com");
  });
  test("-H, -X, -d, die Kette -sH und --header=… nehmen ihren Wert nicht als URL", () => {
    for (const c of ["curl -H 'a: b' kasse", "curl -X POST -d x=1 kasse", "curl -sH 'a: b' kasse", "curl --header=a:b kasse", "curl kasse -X GET"]) {
      const r = run(c);
      expect(r.error, c).toBe(false);
      expect(r.output, c).toContain("200 OK");
    }
  });
  test("-H am Ende ohne Wert: flag needs an argument", () => {
    const r = run("curl kasse -H");
    expect(r.error).toBe(true);
    expect(r.output).toContain("flag needs an argument");
  });
  test("-i und -sS sind angenommen", () => {
    expect(run("curl -i kasse").output).toContain("200 OK");
    expect(run("curl -sS kasse").output).toContain("200 OK");
  });
  test("-k und -L sind nicht simuliert, -k nennt TLS", () => {
    expect(run("curl -k https://kasse").output).toContain("TLS");
    expect(run("curl -L kasse").output).toContain(NS);
  });
  test("zwei Adressen sind nicht simuliert", () => {
    expect(run("curl kasse lager").output).toContain(NS);
  });
  test("ohne Adresse fragt curl nach ihr", () => {
    const r = run("curl -s");
    expect(r.error).toBe(true);
    expect(r.output).toContain("Welche Adresse");
  });
});

describe("curl: Default-Port des Schemas", () => {
  test("https:// ohne Port fragt Port 443 gegen den Service-Port", () => {
    const r = run("curl https://kasse");
    expect(r.error).toBe(true);
    expect(r.output).toContain("(7)");
    expect(r.output).toContain("port 443");
    expect(r.output).toContain("Port 80");
    expect(r.output).toContain("http://");
  });
  test("https:// gegen einen Service auf 443 antwortet", () => {
    expect(run("curl https://sicher").output).toContain("200 OK");
  });
  test("ohne Port und Schema gilt 80: Service auf 8080 ist refused, kasse:8080 antwortet", () => {
    const a = run("curl lager");
    expect(a.output).toContain("(7)");
    expect(a.output).toContain("port 80");
    expect(run("curl lager:8080").output).toContain("200 OK");
    expect(run("curl http://lager").output).toContain("(7)");
  });
  test("https:// mit falschem explizitem Port: (7) mit diesem Port, ohne den https-Tipp", () => {
    const r = run("curl https://kasse:8443");
    expect(r.output).toContain("port 8443");
    expect(r.output).not.toContain("https:// fragt");
  });
  test("--silent ist der Alias von -s (auch bei -o)", () => {
    expect(run("curl --silent -o x kasse").output ?? "").toBe("");
  });
  test("ein expliziter Port in einer https-URL gewinnt", () => {
    expect(run("curl https://lager:8080").output).toContain("200 OK");
  });
});

describe("nslookup: Optionen und Server", () => {
  test("-type=A, -q=a, -querytype=A, -TYPE=A und Option hinter dem Namen lösen auf", () => {
    for (const c of ["nslookup -type=A kasse", "nslookup -q=a kasse", "nslookup -querytype=A kasse", "nslookup -TYPE=A kasse", "nslookup kasse -type=A"]) {
      const r = run(c);
      expect(r.error, c).toBe(false);
      expect(r.output, c).toContain("10.96.0.20");
    }
  });
  test("der Optionsname ist case-insensitiv, der Wert nicht verfälscht", () => {
    const r = run("nslookup -TYPE=FOO kasse");
    expect(r.output).toContain("unknown query type: FOO");
  });
  test("bekannte andere Eintragsarten sind nicht simuliert", () => {
    for (const t of ["SRV", "mx", "AAAA"]) {
      const r = run("nslookup -type=" + t + " kasse");
      expect(r.output, t).toContain(NS);
      expect(r.output, t).toContain("A-Einträge");
    }
  });
  test("unbekannte Art: echter Text", () => {
    const r = run("nslookup -type=FOO kasse");
    expect(r.error).toBe(true);
    expect(r.output).toContain("unknown query type: FOO");
  });
  test("andere Optionen sind nicht simuliert und nennen -type", () => {
    const r = run("nslookup -debug kasse");
    expect(r.output).toContain(NS);
    expect(r.output).toContain("-type");
  });
  test("Server 10.96.0.10 ist erlaubt, jeder andere nicht simuliert", () => {
    const ok = run("nslookup kasse 10.96.0.10");
    expect(ok.error).toBe(false);
    expect(ok.output).toContain("10.96.0.20");
    const fremd = run("nslookup kasse 8.8.8.8");
    expect(fremd.output).toContain(NS);
    expect(fremd.output).toContain("8.8.8.8");
  });
  test("ein drittes Argument ist nicht simuliert", () => {
    expect(run("nslookup kasse 10.96.0.10 extra").output).toContain(NS);
  });
  test("nur eine Option ohne Namen fragt nach dem Namen", () => {
    const r = run("nslookup -type=A");
    expect(r.error).toBe(true);
    expect(r.output).toContain("Welchen Namen");
  });
});
