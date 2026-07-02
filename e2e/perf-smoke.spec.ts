import { test, expect } from "@playwright/test";
import { requireOfflineBuild, bootGame, dismissIntro } from "./support";

// FPS-/Frame-Budget-Smoke (#524) – über den Boot- (#391) und Interaktions-Smoke
// (#480) hinaus. Die FPS werden längst gemessen (FrameSampler in src/hud/cull.ts,
// gefüttert pro Frame in WorldScene.cullDecor), aber bisher NIRGENDS als Budget
// assertiert – ein schleichender Frame-Einbruch (zu viele Sprites, ungedrosselter
// Sync) würde unbemerkt durchrutschen. Für ein Lern-Vorzeigeprojekt erodiert das
// ungemessen. Dieser Smoke lädt den echten Offline-Build headless mit ?perf (das
// #82-Perf-HUD), das die FrameSampler-FPS zusätzlich auf body[data-kq-fps]
// spiegelt – ohne Test-Hintertür (window.kqGame ist im Offline-Build gestrippt).
//
// Bewusst konservativ: headless-Chromium in der CI ist langsamer als ein echter
// Desktop, und der Sampler mittelt nur die letzten 30 Frames. Der Floor prüft
// darum „läuft flüssig genug", nicht eine exakte Zahl – er fängt einen ECHTEN
// Einbruch (einstellige/20er-FPS) und lässt normale Schwankung durch.

test.beforeAll(requireOfflineBuild);

/** Konservativer FPS-Boden. Phaser rendert per requestAnimationFrame (Ziel 60);
 *  ein gesunder Lauf liegt klar darüber, ein echter Einbruch klar darunter. */
const FPS_FLOOR = 40;

test("Frame-Budget: das Spiel läuft mit gesunder FPS (Perf-HUD-Messwert)", async ({ page }) => {
  await bootGame(page, "perf");
  await dismissIntro(page);

  // Warten, bis der FrameSampler sein 30-Frame-Fenster gefüllt und die FPS auf das
  // DOM gespiegelt hat (fps > 0 heißt: es wurden echte Frames gemessen). Großzügiger
  // Timeout, damit langsame CI-Runner das Fenster sicher füllen können.
  await page.waitForFunction(() => Number(document.body.dataset.kqFps) > 0, null, { timeout: 10_000 });

  // Kurz laufen lassen, damit sich der rollende Mittelwert einschwingt (nicht am
  // allerersten, oft langen Boot-Frame hängenbleiben).
  await page.waitForTimeout(1_500);

  const fps = await page.evaluate(() => Number(document.body.dataset.kqFps));
  expect(fps).toBeGreaterThanOrEqual(FPS_FLOOR);
});
