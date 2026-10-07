import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview, type PreviewServer } from "vite";
import { awaitWorldAndIntro } from "./support";

// Boot-Smoke des HOST-Builds (dist/, #1408, ADR 0018): der Offline-Smoke lädt die self-contained Datei
// und sieht die Content-Chunks nie. Hier läuft der echte Multi-File-Build über einen HTTP-Server (Vites
// `preview`): bootet das Spiel, und liefert der Server die Content-Chunks unter assets/content/ aus?
// Ein kaputtes manualChunks (fehlender Chunk, falsche Auswertungsreihenfolge, 404) fiele sonst erst live auf.
const distIndex = fileURLToPath(new URL("../dist/index.html", import.meta.url));
let server: PreviewServer | undefined;
let baseUrl = "";

test.beforeAll(async () => {
  if (!existsSync(distIndex)) {
    throw new Error(
      `Host-Build fehlt: ${distIndex}\n` + `Vor dem Smoke-Test bauen:  npm run build  (oder gleich  npm run smoke).`,
    );
  }
  server = await preview({ preview: { port: 0, host: "127.0.0.1", strictPort: false, open: false } });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite-Preview lieferte keine URL");
  baseUrl = url;
});

test.afterAll(async () => {
  await server?.close();
});

test("Host-Build bootet über HTTP, Content-Chunks werden ausgeliefert", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const contentResponses: number[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (res) => {
    if (res.url().includes("/assets/content/")) contentResponses.push(res.status());
  });

  await page.goto(baseUrl);

  await expect(page.locator("body")).toHaveAttribute("data-kq-booted", "1", { timeout: 15_000 });
  await expect(page.locator("#game-container canvas")).toBeVisible();
  await expect(page.getByText("Kubernia startet so nicht")).toHaveCount(0);

  // Mindestens ein Content-Chunk kam an, und keiner mit Fehlerstatus.
  expect(contentResponses.length, "kein Request nach assets/content/ (Content-Chunks nicht geladen?)").toBeGreaterThan(0);
  expect(contentResponses.filter((s) => s !== 200), "Content-Chunk nicht mit 200 ausgeliefert").toEqual([]);

  // Zustandsbasiert statt fester Zeit (#1411): Welt aufgebaut und Intro erschienen, dann erst die Fehler prüfen.
  await awaitWorldAndIntro(page);
  expect(pageErrors, `Unbehandelte Laufzeit-Fehler beim Boot:\n${pageErrors.join("\n")}`).toEqual([]);
  expect(consoleErrors, `Konsolen-Fehler beim Boot:\n${consoleErrors.join("\n")}`).toEqual([]);
});
