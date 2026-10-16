/* Helfer für die Wächter-Tests der MCP-Server (#1422): startet einen stdio-Server, spricht
 * `initialize` + `tools/list` und beendet ihn. Liefert Namen samt `annotations`.
 * Kein Test, nur Hilfscode (kein `*.test.ts`). */
import { spawn } from "node:child_process";

export type McpTool = { name: string; annotations?: { readOnlyHint?: boolean } };

/**
 * Startet `node <args>` im `cwd`, wartet höchstens `budgetMs` auf die tools/list-Antwort.
 * Löst erst nach dem Prozessende auf (Windows: der laufende Server hält sein cwd offen, EBUSY beim Aufräumen).
 */
export function mcpToolListe(args: string[], cwd: string, budgetMs: number): Promise<McpTool[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`tools/list-Handshake nach ${budgetMs / 1000} s ohne Antwort`));
    }, budgetMs);
    let buf = "";
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
            clearTimeout(timer);
            const tools = o.result?.tools ?? [];
            child.once("exit", () => resolve(tools));
            child.kill();
          }
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
