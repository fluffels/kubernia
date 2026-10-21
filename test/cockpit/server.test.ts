/* Server und Seite des Cockpits (#1764): nur 127.0.0.1, GET/HEAD, Host-Prüfung, CSP, kein CORS, alles escaped. */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { request } from "node:http";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawServer from "../../scripts/cockpit/server.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSeite from "../../scripts/cockpit/seite.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawQuelle from "../../scripts/cockpit/quelle.mjs";

interface Ctx { jetzt: () => number }
interface Quelle { id: string; titel: string; ttlMs: number; sammeln: (c: Ctx) => unknown }
interface Laufend { server: { address: () => { address: string } }; port: number; schliessen: () => Promise<void> }
const { starteServer } = rawServer as unknown as { starteServer: (o: { port: number; quellen: Quelle[]; projekt: string }) => Promise<Laufend> };
const { escapeHtml, formatZeit, renderSeite } = rawSeite as unknown as {
  escapeHtml: (s: string) => string;
  formatZeit: (ms: number) => string;
  renderSeite: (o: { panels: unknown[]; jetzt: number; projekt: string }) => string;
};
const { ok, ausfall } = rawQuelle as unknown as { ok: (d: unknown, c: Ctx) => unknown; ausfall: (g: string, c: Ctx) => unknown };

const BOESE = `<script>alert(1)</script>`;
const quellen: Quelle[] = [
  { id: "a", titel: BOESE, ttlMs: 1000, sammeln: (c) => ok({ [`<k>&"'`]: `<b>"x"</b>&'` }, c) },
  { id: "b", titel: "Zwei", ttlMs: 1000, sammeln: (c) => ausfall("<img src=x onerror=1>", c) },
];

interface Antwort { status: number; headers: Record<string, string | string[] | undefined>; body: string }
function frage(port: number, method: string, path = "/", host?: string | null): Promise<Antwort> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (host) headers.Host = host;
    const req = request({ host: "127.0.0.1", port, method, path, headers, setHost: false }, (res) => {
      let body = "";
      res.on("data", (d: Buffer) => (body += d.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

let s: Laufend;
beforeAll(async () => {
  s = await starteServer({ port: 0, quellen, projekt: "/p" });
});
afterAll(async () => {
  await s.schliessen();
});

describe("Server", () => {
  test("bindet nur 127.0.0.1", () => {
    expect(s.server.address().address).toBe("127.0.0.1");
  });

  test.each(["127.0.0.1", "localhost", "LOCALHOST"])("GET mit Host %s: 200, CSP, Refresh, kein Skript, kein CORS", async (h) => {
    const r = await frage(s.port, "GET", "/", `${h}:${s.port}`);
    expect(r.status).toBe(200);
    expect(r.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'self'");
    expect(Object.keys(r.headers).filter((k) => k.startsWith("access-control-"))).toEqual([]);
    expect(r.body).toContain('<meta http-equiv="refresh"');
    expect(r.body).not.toContain("<script");
    expect(r.body).toContain("Stand ");
  });

  test("HEAD: 200 ohne Body, gleiche CSP", async () => {
    const r = await frage(s.port, "HEAD", "/", `127.0.0.1:${s.port}`);
    expect(r.status).toBe(200);
    expect(r.body).toBe("");
    expect(r.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'self'");
  });

  test.each(["POST", "PUT", "DELETE", "OPTIONS"])("%s ergibt 405 mit Allow und ohne CORS", async (m) => {
    const r = await frage(s.port, m, "/", `127.0.0.1:${s.port}`);
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe("GET, HEAD");
    expect(Object.keys(r.headers).filter((k) => k.startsWith("access-control-"))).toEqual([]);
  });

  test.each([["evil.example"], ["evil.example:PORT"], ["127.0.0.1:1"]])("fremder Host %s wird abgewiesen", async (h) => {
    const r = await frage(s.port, "GET", "/", h.replace("PORT", String(s.port)));
    expect(r.status).toBe(403);
    expect(r.body).not.toContain("Harness-Cockpit");
  });

  test("fehlender Host wird abgewiesen (Node selbst: 400)", async () => {
    const r = await frage(s.port, "GET", "/", null);
    expect([400, 403]).toContain(r.status);
    expect(r.body).not.toContain("Harness-Cockpit");
  });

  test("Host-Prüfung geht vor der Methodenprüfung", async () => {
    expect((await frage(s.port, "POST", "/", "evil.example")).status).toBe(403);
  });

  test("/cockpit.css ist text/css, unbekannter Pfad 404", async () => {
    const css = await frage(s.port, "GET", "/cockpit.css", `127.0.0.1:${s.port}`);
    expect(css.status).toBe(200);
    expect(String(css.headers["content-type"])).toContain("text/css");
    expect((await frage(s.port, "GET", "/x", `127.0.0.1:${s.port}`)).status).toBe(404);
  });

  test("Query-String ändert den Pfad nicht", async () => {
    const r = await frage(s.port, "GET", "/?x=1", `127.0.0.1:${s.port}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain("Harness-Cockpit");
  });

  test("Fehler beim Abruf ergibt 500 ohne Seiteninhalt", async () => {
    const start = starteServer as unknown as (o: { port: number; quellen: Quelle[]; projekt: string; ctxFuer: () => never }) => Promise<Laufend>;
    const kaputt = await start({ port: 0, quellen, projekt: "/p", ctxFuer: () => { throw new Error("kaputt"); } });
    try {
      const r = await frage(kaputt.port, "GET", "/", `127.0.0.1:${kaputt.port}`);
      expect(r.status).toBe(500);
      expect(r.body).toBe("Fehler beim Rendern\n");
      expect(r.body).not.toContain("<script");
    } finally {
      await kaputt.schliessen();
    }
  });

  test("Titel, Grund, Schlüssel und Werte erscheinen escaped", async () => {
    const r = await frage(s.port, "GET", "/", `127.0.0.1:${s.port}`);
    expect(r.body).not.toContain("<script>");
    expect(r.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(r.body).not.toContain("<img");
    expect(r.body).toContain("Ausfall: &lt;img src=x onerror=1&gt;, zuletzt ok nie");
    expect(r.body).toContain("<dt>&lt;k&gt;&amp;&quot;&#39;</dt>");
    expect(r.body).toContain("<dd>&lt;b&gt;&quot;x&quot;&lt;/b&gt;&amp;&#39;</dd>");
    expect(r.body).not.toContain("<b>");
  });
});

describe("Seite", () => {
  test("escapeHtml maskiert alle fünf Zeichen", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  test("formatZeit in lokaler Zeit", () => {
    expect(formatZeit(new Date(2026, 9, 21, 14, 3, 5).getTime())).toBe("2026-10-21 14:03:05");
  });

  test("nicht primitiver Wert wird als JSON escaped angezeigt", () => {
    const panels = [{ id: "x", titel: "T", zuletztOk: null, ergebnis: ok({ liste: ["<a>"] }, { jetzt: () => 1 }) }];
    expect(renderSeite({ panels, jetzt: 1, projekt: "p" })).toContain("<dd>[&quot;&lt;a&gt;&quot;]</dd>");
  });
});
