/* @harness-waechter
 * Basis-URL von Langfuse (#1693 L53): ein Resolver für alle Aufrufer, `||`-Semantik (leerer String gilt als nicht gesetzt),
 * ohne Schrägstrich am Ende, Standard localhost:3000. Reines Node-Tooling ohne Declaration-File: Import über `unknown`. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as zugangRoh from "../../scripts/langfuse-zugang.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as apiRoh from "../../scripts/langfuse-api.mjs";

type Env = Record<string, string | undefined>;
const langfuseBasisUrl = (zugangRoh as unknown as { langfuseBasisUrl: (env: Env) => string }).langfuseBasisUrl;
const basisUrlAus = (zugangRoh as unknown as { basisUrlAus: (env: Env, home: string, lies: (p: string) => string) => string | undefined }).basisUrlAus;
const langfuseZugang = (apiRoh as unknown as { langfuseZugang: (env: Env) => { baseUrl: string } }).langfuseZugang;

describe("langfuseBasisUrl", () => {
  test("gesetzte URL gewinnt, abschließende Schrägstriche fallen weg", () => {
    expect(langfuseBasisUrl({ LANGFUSE_BASE_URL: "http://x:4000" })).toBe("http://x:4000");
    expect(langfuseBasisUrl({ LANGFUSE_BASE_URL: "http://x:4000///" })).toBe("http://x:4000");
  });
  test("nicht gesetzt oder leerer String ergibt den Standard (|| statt ??)", () => {
    expect(langfuseBasisUrl({})).toBe("http://localhost:3000");
    expect(langfuseBasisUrl({ LANGFUSE_BASE_URL: "" })).toBe("http://localhost:3000");
    expect(langfuseBasisUrl({ LANGFUSE_BASE_URL: undefined })).toBe("http://localhost:3000");
  });
  test("die Zugangsdaten der Messskripte nutzen denselben Resolver (leere URL ergibt keinen leeren Host)", () => {
    const keys = { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" };
    expect(langfuseZugang({ ...keys, LANGFUSE_BASE_URL: "" }).baseUrl).toBe("http://localhost:3000");
    expect(langfuseZugang({ ...keys, LANGFUSE_BASE_URL: "http://lf/" }).baseUrl).toBe("http://lf");
  });
  test("basisUrlAus: leere Umgebungs-URL fällt auf die Plugin-Optionen zurück", () => {
    const settings = JSON.stringify({ pluginConfigs: { "langfuse@x": { options: { LANGFUSE_BASE_URL: "http://plugin:3001" } } } });
    expect(basisUrlAus({ LANGFUSE_BASE_URL: "" }, "/h", () => settings)).toBe("http://plugin:3001");
  });
});
