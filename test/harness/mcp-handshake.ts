/* Helfer für die Wächter-Tests der MCP-Server (#1422): startet einen stdio-Server, spricht
 * `initialize` + `tools/list` (und optional einen `tools/call`) und beendet ihn.
 * Liefert Namen samt `annotations`. Kein Test, nur Hilfscode (kein `*.test.ts`). */
import { spawn } from "node:child_process";

export type McpTool = { name: string; annotations?: { readOnlyHint?: boolean } };
export type McpAbfrage = { tools: McpTool[]; aufruf?: unknown };

/**
 * Startet `node <args>` im `cwd`, wartet höchstens `budgetMs` auf die Antworten (tools/list, optional ein tools/call).
 * `aufruf.ergebnis` ist das `result` des Calls (z.B. `structuredContent`). Löst erst nach dem Prozessende auf
 * (Windows: der laufende Server hält sein cwd offen, EBUSY beim Aufräumen).
 */
export function mcpAbfrage(args: string[], cwd: string, budgetMs: number, aufruf?: { name: string; arguments?: object }): Promise<McpAbfrage> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`tools/list-Handshake nach ${budgetMs / 1000} s ohne Antwort`));
    }, budgetMs);
    let buf = "";
    let tools: McpTool[] = [];
    const fertig = (ergebnis?: unknown) => {
      clearTimeout(timer);
      child.once("exit", () => resolve({ tools, aufruf: ergebnis }));
      child.kill();
    };
    const senden = (o: object) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      for (const zeile of buf.split("\n").slice(0, -1)) {
        try {
          const o = JSON.parse(zeile) as { id?: number; result?: { tools?: McpTool[] } };
          if (o.id === 1) {
            senden({ method: "notifications/initialized" });
            senden({ id: 2, method: "tools/list", params: {} });
          }
          if (o.id === 2) {
            tools = o.result?.tools ?? [];
            if (aufruf) senden({ id: 3, method: "tools/call", params: aufruf });
            else fertig();
          }
          if (o.id === 3) fertig(o.result);
        } catch {
          /* unvollständige Zeile */
        }
      }
      buf = buf.slice(buf.lastIndexOf("\n") + 1);
    });
    child.on("error", reject);
    senden({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "wachter", version: "1" } } });
  });
}

/** Nur die Tool-Liste (initialize + tools/list). */
export async function mcpToolListe(args: string[], cwd: string, budgetMs: number): Promise<McpTool[]> {
  return (await mcpAbfrage(args, cwd, budgetMs)).tools;
}
