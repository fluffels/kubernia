// Kein Shebang: Lib. Lokaler, nur lesender Server des Cockpits (ADR 0029): bindet ausschließlich 127.0.0.1, nimmt nur GET und HEAD an,
// weist einen fremden Host-Header ab (DNS-Rebinding), sendet nie CORS-Header und liefert keine Seite mit Client-Skript.
// Bekannte Grenze: ein lokaler Prozess derselben Nutzerin erreicht den Server ohne Anmeldung (docs/sicherheit-agenten.md).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { erzeugeAbruf } from "./quelle.mjs";
import { renderSeite } from "./seite.mjs";

const CSS = readFileSync(new URL("./cockpit.css", import.meta.url));
const SICHERHEIT = {
  "Content-Security-Policy": "default-src 'none'; style-src 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
};

/** Startet den Server auf 127.0.0.1; `port` 0 wählt einen freien. Ergebnis `{ server, port, schliessen }`. */
export function starteServer({ port = 0, quellen, projekt = "", timeoutMs, jetzt = Date.now, ctxFuer }) {
  const sammleAlle = erzeugeAbruf({ quellen, timeoutMs, jetzt, ctxFuer });
  let erlaubt = new Set();
  const antworten = (res, status, typ, body, extra = {}) => {
    res.writeHead(status, { ...SICHERHEIT, "Content-Type": typ, ...extra });
    res.end(body);
  };
  const server = createServer(async (req, res) => {
    const kopf = req.method === "HEAD";
    if (!erlaubt.has(String(req.headers.host ?? "").toLowerCase())) return antworten(res, 403, "text/plain; charset=utf-8", kopf ? undefined : "Host nicht erlaubt\n");
    if (req.method !== "GET" && !kopf) return antworten(res, 405, "text/plain; charset=utf-8", "Nur GET und HEAD\n", { Allow: "GET, HEAD" });
    const pfad = (req.url ?? "/").split("?")[0];
    if (pfad === "/cockpit.css") return antworten(res, 200, "text/css; charset=utf-8", kopf ? undefined : CSS);
    if (pfad !== "/") return antworten(res, 404, "text/plain; charset=utf-8", kopf ? undefined : "Nicht gefunden\n");
    try {
      const html = kopf ? undefined : renderSeite({ panels: await sammleAlle(), jetzt: jetzt(), projekt });
      antworten(res, 200, "text/html; charset=utf-8", html);
    } catch {
      antworten(res, 500, "text/plain; charset=utf-8", kopf ? undefined : "Fehler beim Rendern\n");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const echt = server.address().port;
      erlaubt = new Set([`127.0.0.1:${echt}`, `localhost:${echt}`]);
      resolve({ server, port: echt, schliessen: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) });
    });
  });
}
