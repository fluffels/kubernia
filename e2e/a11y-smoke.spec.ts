import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { requireOfflineBuild, bootGame, dismissIntro } from "./support";

// A11y-Smoke (#524) – ein automatisches Barrierefreiheits-Netz über den echten
// Offline-Build, analog zum FPS-Budget-Smoke. Für ein Lern-Vorzeigeprojekt soll
// die Zugänglichkeit der DOM-Oberfläche (HUD + Overlay-Panels) nicht ungemessen
// erodieren – axe-core fängt echte Regressionen wie unbeschriftete Buttons,
// fehlende Formular-Labels oder Kontrast-Ausfälle.
//
// Grenze der Methode: axe prüft nur das DOM, nicht den Phaser-Canvas (die Spielwelt
// selbst ist kein DOM). Der Wert liegt also in HUD und den DOM-Overlays (Terminal,
// Logbuch, Album, Menü …) – genau die zugänglichen Steuerflächen. Getrieben wie ein
// Mensch über Tastatur/DOM (keine Test-Hintertür), wie der Rest von e2e/.
//
// Gate-Politik (kein Grün-durch-Aufweichen): assertiert NULL Verletzungen, mit EINER
// bewusst dokumentierten Ausnahme – die `region`-Regel (moderate: „alle Inhalte in
// Landmark-Regionen"). Die scheitert nur an fehlenden <main>/role-Landmarks um HUD +
// Canvas; das ist ein eigenes, strukturelles Optik-/Layout-Thema (Folge-Ticket),
// keine Interaktions-Barriere. Alles andere – inkl. moderate – bricht den Smoke.

test.beforeAll(requireOfflineBuild);

/** Bekannte, bewusst ausgeklammerte axe-Regeln (mit Grund). NUR diese eine –
 *  jede andere Verletzung soll den Smoke rot machen. */
const KNOWN_EXCLUDED_RULES = ["region"];

/** Scannt den aktuellen DOM-Zustand und gibt die (gefilterten) Verletzungen zurück. */
async function a11yViolations(page: import("@playwright/test").Page) {
  const res = await new AxeBuilder({ page }).disableRules(KNOWN_EXCLUDED_RULES).analyze();
  return res.violations;
}

test("A11y: HUD und Overlay-Panels sind ohne Verletzung zugänglich", async ({ page }) => {
  await bootGame(page);
  await dismissIntro(page);

  // Weltansicht mit HUD.
  expect(await a11yViolations(page), "Weltansicht (HUD)").toEqual([]);

  // Terminal-Overlay (Funkgerät) – die interaktivste DOM-Fläche.
  await page.keyboard.press("t");
  await expect(page.locator("#overlay-terminal")).toBeVisible();
  expect(await a11yViolations(page), "Terminal-Overlay").toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#overlay-terminal")).toBeHidden();

  // Logbuch-Overlay.
  await page.keyboard.press("j");
  await expect(page.locator("#overlay-quest")).toBeVisible();
  expect(await a11yViolations(page), "Logbuch-Overlay").toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#overlay-quest")).toBeHidden();

  // Sammelalbum-Overlay.
  await page.keyboard.press("b");
  await expect(page.locator("#overlay-album")).toBeVisible();
  expect(await a11yViolations(page), "Album-Overlay").toEqual([]);
});
