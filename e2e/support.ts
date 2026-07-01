import { expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Geteilte Helfer für die Interaktions-Smokes (#480). Wie der Boot-Smoke (#391)
// laufen sie gegen den gebauten OFFLINE-Build (eine self-contained
// dist-offline/index.html, per file:// geladen) – also exakt den Doppelklick-
// Pfad einer Spielerin, ohne Dev-Server. Der Offline-Build ist der echte,
// spielbare Build; die Dev-Affordanzen (window.kqGame/kqDev) sind darin bewusst
// rausgestrippt, darum treiben die Smokes das Spiel wie ein Mensch: über Tastatur
// und DOM, ohne Test-Hintertür.
export const offlineHtml = fileURLToPath(new URL("../dist-offline/index.html", import.meta.url));

/** Gate für die beforeAll: ohne gebauten Offline-Build kann nichts laufen. */
export function requireOfflineBuild(): void {
  if (!existsSync(offlineHtml)) {
    throw new Error(
      `Offline-Build fehlt: ${offlineHtml}\n` +
        `Vor dem Smoke-Test bauen:  npm run build:offline  (oder gleich  npm run smoke).\n` +
        `In der CI erledigt das der Build-Schritt davor.`,
    );
  }
}

/** Lädt den Offline-Build und wartet, bis das Spiel gebootet hat (Boot-Flag +
 *  Phaser-Canvas). Jeder Test bekommt einen frischen Browser-Kontext, also einen
 *  leeren Spielstand – darum startet das Spiel deterministisch mit dem Intro. */
export async function bootGame(page: Page): Promise<void> {
  await page.goto(pathToFileURL(offlineHtml).href);
  await expect(page.locator("body")).toHaveAttribute("data-kq-booted", "1", { timeout: 15_000 });
  await expect(page.locator("#game-container canvas")).toBeVisible();
}

/** Blättert einen offenen Lese-Dialog per E bis zum Ende durch (schließt ihn).
 *  Poll-basiert statt an einer festen Zeilenzahl, damit es robust bleibt, wenn
 *  ein Dialog eine Zeile mehr/weniger bekommt. */
export async function advanceDialogueUntilHidden(page: Page): Promise<void> {
  const dlg = page.locator("#dialogue");
  for (let i = 0; i < 20 && (await dlg.isVisible()); i++) {
    await page.keyboard.press("e");
    await page.waitForTimeout(150);
  }
  await expect(dlg).toBeHidden();
}

/** Schließt die einmalige Begrüßung (Intro-Dialog), die beim ersten Start ~600 ms
 *  nach dem Boot erscheint. Tolerant: erscheint sie wider Erwarten nicht, geht es
 *  ohne Fehler weiter. Wichtig: der Intro-Dialog blockiert Tastenkürzel (T/J/B),
 *  darum vor allen anderen Interaktionen sauber wegblättern (nicht nur ausblenden –
 *  das ließe den Dialog-Zustand aktiv und würde spätere E-Eingaben verschlucken). */
export async function dismissIntro(page: Page): Promise<void> {
  const dlg = page.locator("#dialogue");
  try {
    await expect(dlg).toBeVisible({ timeout: 5_000 });
  } catch {
    return; // kein Intro (z.B. Bestandsstand) – nichts zu tun
  }
  await advanceDialogueUntilHidden(page);
}
