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
 *  leeren Spielstand – darum startet das Spiel deterministisch mit dem Intro.
 *  `query` hängt optional einen URL-Suchstring an (z.B. "perf" für das #82-Perf-HUD,
 *  das der FPS-Smoke #524 braucht) – der Offline-Build wertet location.search aus. */
export async function bootGame(page: Page, query = ""): Promise<void> {
  const url = pathToFileURL(offlineHtml).href + (query ? "?" + query : "");
  await page.goto(url);
  await expect(page.locator("body")).toHaveAttribute("data-kq-booted", "1", { timeout: 15_000 });
  await expect(page.locator("#game-container canvas")).toBeVisible();
}

/** Blättert einen offenen Lese-Dialog per R (Reden-Taste) bis zum Ende durch (schließt ihn).
 *  Poll-basiert statt an einer festen Zeilenzahl, damit es robust bleibt, wenn
 *  ein Dialog eine Zeile mehr/weniger bekommt. */
export async function advanceDialogueUntilHidden(page: Page): Promise<void> {
  const dlg = page.locator("#dialogue");
  for (let i = 0; i < 20 && (await dlg.isVisible()); i++) {
    await page.keyboard.press("r");
    await page.waitForTimeout(150);
  }
  await expect(dlg).toBeHidden();
}

/** Der Intro-Zustand, den main.ts als `data-kq-intro` setzt (#1411): `geplant` = das Intro erscheint in Kürze (Erststart),
 *  `keins` = Bestandsstand. Wartet auf das Attribut, statt eine Zeit zu raten. */
async function introZustand(page: Page): Promise<"geplant" | "keins"> {
  const body = page.locator("body");
  await expect(body).toHaveAttribute("data-kq-intro", /^(geplant|keins)$/, { timeout: 15_000 });
  return (await body.getAttribute("data-kq-intro")) as "geplant" | "keins";
}

/** Schließt die einmalige Begrüßung (Intro-Dialog), die beim ersten Start ~600 ms
 *  nach dem Boot erscheint. Zustandsbasiert (#1411): `data-kq-intro` sagt, ob sie kommt; bei `geplant` wird auf den
 *  sichtbaren Dialog gewartet (kein Raten mit fester Zeit), bei `keins` (Bestandsstand) geht es sofort weiter. Wichtig: der
 *  Intro-Dialog blockiert Tastenkürzel (F/L/B), darum vor allen anderen Interaktionen sauber wegblättern (nicht nur
 *  ausblenden – das ließe den Dialog-Zustand aktiv und würde spätere R-Eingaben verschlucken). */
export async function dismissIntro(page: Page): Promise<void> {
  if ((await introZustand(page)) === "keins") return;
  await expect(page.locator("#dialogue")).toBeVisible({ timeout: 15_000 });
  await advanceDialogueUntilHidden(page);
}

/** Wartet, bis die Welt aufgebaut ist (`data-kq-world`, WorldScene.create) und – falls geplant – das Intro erschienen ist.
 *  Der Boot-Smoke prüft danach, ob dabei Fehler aufgelaufen sind (statt eine feste Zeit zu warten, #1411). */
export async function awaitWorldAndIntro(page: Page): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute("data-kq-world", "1", { timeout: 15_000 });
  if ((await introZustand(page)) === "geplant") await expect(page.locator("#dialogue")).toBeVisible({ timeout: 15_000 });
}
