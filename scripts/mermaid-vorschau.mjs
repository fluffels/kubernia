// Kein Shebang: wird per `node scripts/mermaid-vorschau.mjs` gestartet UND von test/mermaid-vorschau.test.ts importiert.
/**
 * Mermaid-Vorschau für den Playwright-MCP (#1392): der MCP-Browser darf nur localhost laden (`--allowed-origins` in `.mcp.json`),
 * github.com und `file:` sind geblockt. Dieses Skript rendert die ```mermaid-Blöcke einer Markdown-Datei mit mermaid 11 hinter einem
 * localhost-Server, je Block einmal auf hellem und einmal auf dunklem Grund (die Farben wie GitHub), samt der Fehlermeldung, wenn
 * mermaid einen Block nicht parst. Ablauf und Grenzen: docs/agent-harness-faq.md › „Wie prüfe ich ein Mermaid-Diagramm …“.
 *
 *   npm install --prefix <tmp-ordner> mermaid@11          # einmalig, außerhalb des Repos (kein Eintrag in package.json)
 *   node scripts/mermaid-vorschau.mjs <datei.md> --mermaid <tmp-ordner> [--port 4173]
 *
 * Danach `browser_navigate` auf `http://127.0.0.1:<port>/`, Screenshot, Server beenden (Strg+C bzw. Prozess stoppen).
 * Nur Node-Builtins; mermaid selbst kommt aus dem angegebenen Ordner und wird nie mitgeliefert.
 */
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, sep, resolve } from "node:path";
import { mermaidBloecke } from "./docs-gen/markdown.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";

export { mermaidBloecke };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Die Vorschau-Seite: je Block eine helle und eine dunkle Fläche (GitHub-Farben), mermaid als ES-Modul von `/mermaid/`. Pur. */
export function vorschauHtml(bloecke) {
  const flaeche = (art, grund, text, nr, code) =>
    `<section class="${art}"><h2>Block ${nr + 1}, ${text}</h2><pre class="mermaid" data-fehler="Block ${nr + 1} (${text})">${esc(code)}</pre></section>`;
  const body = bloecke.length
    ? bloecke.map((c, i) => flaeche("hell", "#ffffff", "heller Grund", i, c) + flaeche("dunkel", "#0d1117", "dunkler Grund", i, c)).join("\n")
    : "<p>Keine mermaid-Blöcke gefunden.</p>";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Mermaid-Vorschau</title>
<style>body{margin:0;font:14px sans-serif}section{padding:16px}.hell{background:#fff;color:#1f2328}.dunkel{background:#0d1117;color:#e6edf3}pre.mermaid{background:transparent}.fehler{color:#f85149;white-space:pre-wrap}</style></head>
<body>${body}
<script type="module">
import mermaid from "/mermaid/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: false });
for (const el of document.querySelectorAll("pre.mermaid")) {
  try { await mermaid.run({ nodes: [el] }); }
  catch (e) { el.className = "fehler"; el.textContent = el.dataset.fehler + ": " + (e && e.message ? e.message : e); }
}
document.body.dataset.fertig = "ja";
</script></body></html>`;
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Der aufgelöste Pfad, wenn er `basis` selbst oder darunter liegt, sonst `null` (kein Ausbruch per `..`, kein Geschwister mit gleichem Präfix). Pur. */
export function unterhalb(basis, pfad) {
  const b = resolve(basis);
  const z = resolve(pfad);
  return z === b || z.startsWith(b + sep) ? z : null;
}

const TYPEN = { ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html; charset=utf-8" };

/** Löst `/mermaid/<pfad>` auf eine Datei unter `distDir` auf; `null` bei Ausbruch aus dem Ordner (`..`) oder fehlender Datei. Pur bis auf die Dateiprüfung. */
export function mermaidDatei(distDir, urlPfad) {
  let rel;
  try {
    rel = decodeURIComponent(urlPfad.replace(/^\/mermaid\//, "").split("?")[0]);
  } catch {
    return null; // kaputte Prozent-Kodierung: kein Treffer statt ungefangenem URIError im Server
  }
  const ziel = resolve(distDir, normalize(rel));
  // Containment inline vor dem fs-Aufruf (kein Helfer): CodeQL erkennt nur die Prüfung in derselben Funktion als Barriere.
  if (!ziel.startsWith(resolve(distDir) + sep)) return null;
  return existsSync(ziel) && statSync(ziel).isFile() ? ziel : null;
}

const AUFRUF = "Aufruf: node scripts/mermaid-vorschau.mjs <datei.md> --mermaid <ordner-mit-node_modules/mermaid> [--port 4173]";

function main(argv) {
  const { werte, positionale, fehler } = flagsLesen(argv, { mermaid: { type: "string" }, port: { type: "string" } }, { positionale: true, pflicht: ["mermaid"] });
  const port = werte.port === undefined ? 4173 : Number(werte.port);
  const problem = fehler?.text ?? (positionale.length !== 1 ? "genau eine Markdown-Datei erwartet" : !Number.isInteger(port) || port < 1 || port > 65535 ? `--port erwartet eine Portnummer, nicht ${werte.port}` : null);
  if (problem) {
    console.error(`${problem}
${AUFRUF}`);
    process.exit(AUFRUF_EXIT);
  }
  const md = positionale[0];
  const dist = join(werte.mermaid, "node_modules", "mermaid", "dist");
  if (!existsSync(join(dist, "mermaid.esm.min.mjs"))) {
    console.error(`mermaid fehlt unter ${dist}. Einmal: npm install --prefix ${werte.mermaid} mermaid@11`);
    process.exit(2);
  }
  const mdPfad = unterhalb(REPO, md);
  if (!mdPfad) {
    console.error(`Die Markdown-Datei muss im Repo liegen: ${md}`);
    process.exit(2);
  }
  const html = vorschauHtml(mermaidBloecke(readFileSync(mdPfad, "utf8")));
  createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/mermaid/")) {
      const datei = mermaidDatei(dist, url);
      if (!datei || !datei.startsWith(resolve(dist) + sep)) return void res.writeHead(404).end("nicht gefunden");
      res.writeHead(200, { "content-type": TYPEN[extname(datei)] ?? "application/octet-stream" });
      return void res.end(readFileSync(datei));
    }
    res.writeHead(200, { "content-type": TYPEN[".html"] }).end(html);
  }).listen(port, "127.0.0.1", () => console.log(`Mermaid-Vorschau: http://127.0.0.1:${port}/ (${md})`));
}

if (istDirektaufruf(import.meta.url)) main(process.argv.slice(2));
