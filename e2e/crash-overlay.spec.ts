import { test, expect } from "@playwright/test";
import { requireOfflineBuild, bootGame } from "./support";

// Fitness-Function fürs zentrale Fehler-Overlay (#504). Gegen den echten OFFLINE-
// Build, ohne Test-Hintertür: wir feuern einen synthetischen Laufzeitfehler über
// die ganz normalen Browser-Events (window "error" / "unhandledrejection") – exakt
// die Kanäle, die der globale Handler in main.ts abhört – und prüfen, dass statt
// eines stillen schwarzen Canvas das lesbare Fallback-Overlay mit „Neu laden"-
// Knopf erscheint. Kein window.kqGame/kqDev nötig (im Offline-Build gestrippt).
test.beforeAll(requireOfflineBuild);

test("ein unbehandelter Fehler zeigt das Fallback-Overlay statt schwarzem Canvas", async ({ page }) => {
  await bootGame(page);

  const overlay = page.locator("#kq-crash-overlay");
  await expect(overlay).toHaveCount(0); // sauberer Boot: kein Overlay

  // Synthetischen Laufzeitfehler über den echten window-"error"-Kanal auslösen.
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("Synthetischer Testfehler"), message: "Synthetischer Testfehler" }));
  });

  await expect(overlay).toBeVisible();
  await expect(page.getByText("Kubernia ist auf ein Problem gestoßen")).toBeVisible();
  await expect(page.getByText("Synthetischer Testfehler").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /neu laden/i })).toBeVisible();
});

test("das Overlay erscheint auch bei einer unbehandelten Promise-Rejection", async ({ page }) => {
  await bootGame(page);

  await page.evaluate(() => {
    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.reject(new Error("Rejektion")).catch(() => undefined) as unknown as Promise<never>,
      reason: new Error("Async-Boom"),
    }));
  });

  await expect(page.locator("#kq-crash-overlay")).toBeVisible();
  await expect(page.getByText("Async-Boom").first()).toBeVisible();
});
