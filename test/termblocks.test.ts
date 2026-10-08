import { describe, it, expect } from "vitest";
import { splitTermBlocks } from "../src/hud/termblocks";
import { table } from "../src/sim/util";
import { freshSim } from "./factories/sim";

const kinds = (s: string) => splitTermBlocks(s).map(b => b.kind);
const rejoin = (s: string) => splitTermBlocks(s).map(b => b.text).join("\n");

describe("splitTermBlocks: Tabellen erkennen", () => {
  it("eine kubectl-Tabelle ist genau ein Tabellenblock", () => {
    const out = "NAME   READY   STATUS\nweb    1/1     Running\ndb     1/1     Running";
    expect(splitTermBlocks(out)).toEqual([{ kind: "table", text: out }]);
  });

  it.each([
    "NAME   CPU(cores)   MEMORY(bytes)",
    "NAME   CPU%   MEMORY%",
    "NAME   TYPE   PORT(S)   AGE",
    "NAME   READY   UP-TO-DATE   AVAILABLE",
    "NAME   STATUS   NOMINATED NODE   READINESS GATES",
    "CONTAINER ID   IMAGE   COMMAND",
  ])("Kopf %s wird erkannt", head => {
    expect(kinds(head + "\nx   y   z")).toEqual(["table"]);
  });

  it("describe-Events: Kopf mit Strich-Zeile ist Tabelle, 'Events:' davor bleibt Text", () => {
    const out = "Events:\n  Type    Reason   Age\n  ----    ------   ---\n  Normal  Pulled   3s";
    const b = splitTermBlocks(out);
    expect(b.map(x => x.kind)).toEqual(["text", "table"]);
    expect(b[0].text).toBe("Events:");
  });

  it("zwei Tabellen mit Leerzeile dazwischen: table, text, table", () => {
    const out = "NAME   READY\na   1/1\n\nNAME   TYPE\nb   ClusterIP";
    expect(kinds(out)).toEqual(["table", "text", "table"]);
    expect(rejoin(out)).toBe(out);
  });

  it.each(["💡 Tipp: mehr mit -o wide", "▸ nächster Schritt", "  ℹ Hinweis", "⚠ Achtung"])(
    "Hinweiszeile %s direkt nach der Tabelle ist Text",
    hint => {
      const out = "NAME   READY\na   1/1\n" + hint;
      const b = splitTermBlocks(out);
      expect(b.map(x => x.kind)).toEqual(["table", "text"]);
      expect(b[1].text).toBe(hint);
    },
  );
});

describe("splitTermBlocks: Negativ- und Grenzfälle", () => {
  it("leerer String ergibt einen leeren Textblock ohne Verlust", () => {
    expect(rejoin("")).toBe("");
    expect(kinds("")).not.toContain("table");
  });

  it("langer deutscher Fließtext ist nur Text", () => {
    const out = "Das Deployment wurde angelegt, die Pods starten jetzt nach und nach auf den Nodes.\nZweite Zeile  mit  Doppelleerzeichen.";
    expect(kinds(out)).toEqual(["text"]);
  });

  it.each(["NAME", "OK", "NAME   ", "WARNING: etwas ist passiert", "ℹ️  deploy übersprungen  weil schon da"])(
    "%s ist kein Kopf",
    line => {
      expect(kinds(line + "\nfoo   bar")).not.toContain("table");
    },
  );

  it("Strich-Zeile ohne Kopf davor ist Text", () => {
    expect(kinds("irgendwas hier\n----   ----")).toEqual(["text"]);
  });

  it("Kopf ohne zweite Spalte (Strich-Zeile mit nur einem Lauf) ist keine Events-Tabelle", () => {
    expect(kinds("Type\n----")).toEqual(["text"]);
  });

  it("Invariante: Join der Blöcke ergibt die Eingabe", () => {
    const proben = [
      "", "\n", "a\n\nb", "NAME   X\n1   2\n\n\nNAME   Y\n3   4\n",
      "Events:\n  Type   Reason\n  ----   ------\n  a   b\n💡 x", "Text\nNAME   X\n1   2\nText",
    ];
    for (const p of proben) expect(rejoin(p)).toBe(p);
  });
});

describe("Vertrag mit der echten Sim-Ausgabe", () => {
  it("table() aus sim/util wird als Tabelle erkannt", () => {
    const out = table(["NAME", "CPU(cores)"], [["n1", "10m"], ["n2", "20m"]]);
    expect(splitTermBlocks(out)).toEqual([{ kind: "table", text: out }]);
  });

  it.each(["kubectl get nodes -o wide", "kubectl get pods -A -o wide", "docker ps -a"])(
    "%s beginnt mit einem Tabellenblock",
    cmd => {
      const r = freshSim().exec(cmd);
      expect(splitTermBlocks(r.output ?? "")[0].kind).toBe("table");
    },
  );

  it("help liefert keinen Tabellenblock", () => {
    const r = freshSim().exec("help");
    expect(kinds(r.output ?? "")).not.toContain("table");
  });
});
