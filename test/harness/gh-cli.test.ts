/* Wrapper-Wächter (#1428 Z32): alle gh-Aufrufe der Skripte laufen über scripts/gh-cli.mjs.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Bewusste Grenzen: erkannt werden nur literale `execFileSync|execFile|spawnSync|spawn("gh"`; nicht `execSync("gh …")`, kein Template-Literal
 * und keine Variable als Kommando. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ghCli from "../../scripts/gh-cli.mjs";

const DIREKT = /\b(?:execFileSync|execFile|spawnSync|spawn)\(\s*["']gh["']/;

/** Dateien (relativ) mit einem direkten gh-Prozessaufruf. Pur. */
function direkteGhAufrufe(dateien: Record<string, string>): string[] {
  return Object.entries(dateien)
    .filter(([name, text]) => name !== "scripts/gh-cli.mjs" && DIREKT.test(text))
    .map(([name]) => name);
}

function scriptDateien(): Record<string, string> {
  const aus: Record<string, string> = {};
  const geh = (rel: string) => {
    for (const e of readdirSync(join(process.cwd(), rel), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) geh(p);
      else if (e.name.endsWith(".mjs")) aus[p] = readFileSync(join(process.cwd(), p), "utf8");
    }
  };
  geh("scripts");
  return aus;
}

describe("gh-Wrapper (#1428 Z32)", () => {
  test("kein Skript ruft gh direkt auf (außer scripts/gh-cli.mjs)", () => {
    expect(direkteGhAufrufe(scriptDateien())).toEqual([]);
  });
  test("Negativ: ein direkter Aufruf wird gefunden, der Wrapper selbst nicht", () => {
    expect(direkteGhAufrufe({ "scripts/x.mjs": `execFileSync("gh", args)`, "scripts/gh-cli.mjs": `execFileSync("gh", a)` })).toEqual(["scripts/x.mjs"]);
    expect(direkteGhAufrufe({ "scripts/y.mjs": `spawnSync( 'gh', ["x"])` })).toEqual(["scripts/y.mjs"]);
    expect(direkteGhAufrufe({ "scripts/z.mjs": `ghText(["x"])` })).toEqual([]);
  });

  // Verhalten statt Quelltext-Grep (#1460 Z7a): `exec` ist injizierbar, ein Spy sieht Kommando und Optionen.
  type Aufruf = { cmd: string; args: string[]; opts: Record<string, unknown> };
  const spy = (rueckgabe: string | null = "ok") => {
    const aufrufe: Aufruf[] = [];
    const exec = (cmd: string, args: string[], opts: Record<string, unknown>) => {
      aufrufe.push({ cmd, args, opts });
      return rueckgabe;
    };
    return { aufrufe, exec };
  };
  const { GH_MAX_BUFFER, ghText: ghTextMit, ghJson: ghJsonMit } = ghCli as unknown as {
    GH_MAX_BUFFER: number;
    ghText: (a: string[], o?: Record<string, unknown>) => string;
    ghJson: (a: string[], o?: Record<string, unknown>) => unknown;
  };

  test("Wrapper: Kommando gh, utf8, Puffer, windowsHide, stdin zu; ohne timeout und Token keine Zusatzoptionen", () => {
    const { aufrufe, exec } = spy();
    expect(ghTextMit(["issue", "list"], { exec })).toBe("ok");
    const [a] = aufrufe;
    expect(a.cmd).toBe("gh");
    expect(a.args).toEqual(["issue", "list"]);
    expect(a.opts).toMatchObject({ encoding: "utf8", maxBuffer: GH_MAX_BUFFER, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    expect("timeout" in a.opts).toBe(false);
    expect("env" in a.opts).toBe(false);
  });

  test("Wrapper: timeout und GH_TOKEN nur, wenn gesetzt; das Token ergänzt die Umgebung", () => {
    const { aufrufe, exec } = spy();
    ghTextMit(["x"], { exec, timeout: 5000, token: "tok" });
    const opts = aufrufe[0].opts as { timeout: number; env: Record<string, string | undefined> };
    expect(opts.timeout).toBe(5000);
    expect(opts.env.GH_TOKEN).toBe("tok");
    expect(opts.env.PATH ?? opts.env.Path).toBeDefined();
  });

  test("Wrapper: stdio inherit liefert null vom Prozess und damit den leeren Text", () => {
    const { aufrufe, exec } = spy(null);
    expect(ghTextMit(["x"], { exec, stdio: "inherit" })).toBe("");
    expect(aufrufe[0].opts.stdio).toBe("inherit");
  });

  test("ghJson parst die Ausgabe; kaputtes JSON und Prozessfehler werden durchgereicht", () => {
    expect(ghJsonMit(["x"], { exec: spy('{"a":[1]}').exec })).toEqual({ a: [1] });
    expect(() => ghJsonMit(["x"], { exec: spy("kein json").exec })).toThrow(SyntaxError);
    const wirft = () => {
      throw new Error("gh: exit 1");
    };
    expect(() => ghTextMit(["x"], { exec: wirft })).toThrow("gh: exit 1");
  });
});
