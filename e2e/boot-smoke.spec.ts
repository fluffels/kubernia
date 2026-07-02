import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Boot-Smoke-Test des gebauten Offline-Builds (#391).
//
// Warum gegen den OFFLINE-Build (eine self-contained dist-offline/index.html)?
// Das ist exakt das „per Doppelklick offline spielbar"-Feature: alle Assets sind
// inline, kein Server nötig – darum laden wir die Datei direkt per file://. So
// testet der Smoke-Test denselben Pfad, den eine Spielerin beim Doppelklick geht.
const offlineHtml = fileURLToPath(new URL("../dist-offline/index.html", import.meta.url));

test.beforeAll(() => {
  if (!existsSync(offlineHtml)) {
    throw new Error(
      `Offline-Build fehlt: ${offlineHtml}\n` +
        `Vor dem Smoke-Test bauen:  npm run build:offline  (oder gleich  npm run smoke).\n` +
        `In der CI erledigt das der Build-Schritt davor.`,
    );
  }
});

test("Offline-Build bootet headless ohne Konsolen-/Laufzeit-Fehler", async ({ page }) => {
  // Alles sammeln, was auf einen kaputten Boot hindeutet – Listener VOR dem Laden
  // registrieren, damit auch früh gefeuerte Fehler erfasst werden.
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(pathToFileURL(offlineHtml).href);

  // Der Boot-Flag wird am Ende von boot() in JEDEM Build gesetzt (main.ts):
  // document.body.dataset.kqBooted = "1". Sein Erscheinen heißt: boot() lief ohne
  // zu werfen. (window.kqGame gibt es nur im Dev-Build – im Offline-Build ist es
  // rausgestrippt, darum bewusst NICHT als Boot-Signal genutzt.)
  await expect(page.locator("body")).toHaveAttribute("data-kq-booted", "1", { timeout: 15_000 });

  // Phaser muss eine Canvas in den Spielcontainer gehängt haben.
  await expect(page.locator("#game-container canvas")).toBeVisible();

  // Das index.html-Sicherheitsnetz (der „startet so nicht"-Fallback nach 1,5 s)
  // darf NICHT erschienen sein – es erscheint nur, wenn kqBooted ausbleibt.
  await expect(page.getByText("Kubernia startet so nicht")).toHaveCount(0);

  // Kurz weiterlaufen lassen, damit auch ASYNCHRONE Fehler auflaufen, die nach
  // dem Boot-Flag kommen (BootScene lädt/sliced Assets, Szenen-create, Content).
  await page.waitForTimeout(2_000);

  expect(pageErrors, `Unbehandelte Laufzeit-Fehler beim Boot:\n${pageErrors.join("\n")}`).toEqual([]);
  expect(consoleErrors, `Konsolen-Fehler beim Boot:\n${consoleErrors.join("\n")}`).toEqual([]);
});
