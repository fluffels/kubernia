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
// Zwei Werte (#1411): (1) ein Lebenszeichen kurz nach dem Intro, (2) der eingeschwungene Wert nach Phasers Anlauf.
// Phasers Zeitgeber klemmt die ersten 120 Frames (`panicMax`) auf 16,7 ms; der Sampler meldet dort immer ~60, egal wie
// schnell der Rechner ist. Das erklärt den scheinbaren „Abfall nach 3,5 s" in der CI (Reihe 60, 35, 21, 16 …): es war kein
// Einbruch im Spiel, sondern das Ende des Anlaufs, ab dem der echte Wert des Runners sichtbar wird (Software-Rendering, 16-31 FPS;
// lokal reproduzierbar mit gedrosselter CPU: Sampler 60 → 24, ein eigener rAF-Zähler zeigt von Anfang an ~25). Darum prüft der
// frühe Wert nur „rendert überhaupt", der echte Wert hat einen eigenen, am Runner kalibrierten Boden.

test.beforeAll(requireOfflineBuild);

/** FPS-Boden für das Lebenszeichen innerhalb von Phasers Anlauf (siehe unten). Phaser rendert per requestAnimationFrame
 *  (Ziel 60). */
const FPS_FLOOR = 40;

/** Boden für den eingeschwungenen Wert (#1411). Gemessen in der CI (mehrere Läufe, Software-Rendering, 2026-10-07): 16-31 FPS,
 *  lokal 60. Der Boden fängt einen katastrophalen Einbruch (unter 10), keine normale Runner-Streuung: ein höherer Boden wäre
 *  auf dem Runner dauerhaft rot, ohne dass im Spiel etwas kaputt ist. */
const STEADY_FLOOR = 10;

/** Frames seit dem Laden, ab denen Phasers Anlauf (`panicMax`, 120 Frames) sicher vorbei ist (plus Puffer für Boot/Intro). */
const FRAMES_NACH_ANLAUF = 200;

test("Frame-Budget: das Spiel läuft mit gesunder FPS (Perf-HUD-Messwert)", async ({ page }) => {
  test.setTimeout(90_000); // 200 Frames brauchen auf einem langsamen Runner (16 FPS) ~13 s plus Messfenster
  // Eigener Bildzähler, unabhängig vom Perf-HUD: Phasers Zeitgeber klemmt die ersten 120 Frames (Anlauf, `panicMax`) auf
  // 16,7 ms; der FrameSampler meldet dort immer ~60, egal wie langsam der Rechner ist. Erst danach zeigt er den echten Wert.
  await page.addInitScript(() => {
    (window as unknown as { __kqFrames: number }).__kqFrames = 0;
    const tick = () => {
      (window as unknown as { __kqFrames: number }).__kqFrames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await bootGame(page, "perf");
  await dismissIntro(page);

  // Warten, bis der FrameSampler sein 30-Frame-Fenster gefüllt und die FPS auf das
  // DOM gespiegelt hat (fps > 0 heißt: es wurden echte Frames gemessen). Großzügiger
  // Timeout, damit langsame CI-Runner das Fenster sicher füllen können.
  await page.waitForFunction(() => Number(document.body.dataset.kqFps) > 0, null, { timeout: 10_000 });

  // Messfenster, keine Warteschleife auf einen Zustand: der rollende Mittelwert des Samplers schwingt sich über 30 Frames ein
  // (nicht am allerersten, oft langen Boot-Frame hängenbleiben). Es gibt dafür kein DOM-Signal, darum bleibt es zeitbasiert.
  await page.waitForTimeout(1_500);

  // Lebenszeichen: der Sampler läuft und das Spiel rendert. Der Wert liegt noch in Phasers Anlauf (siehe oben), ist also
  // kein Maß für die Geschwindigkeit des Rechners, fängt aber ein Spiel, das gar nicht richtig rendert.
  const fps = await page.evaluate(() => Number(document.body.dataset.kqFps));
  expect(fps).toBeGreaterThanOrEqual(FPS_FLOOR);

  // Eingeschwungener Wert (#1411): erst nach dem Anlauf messen, Median aus fünf Werten im Abstand von 500 ms (Messfenster).
  await page.waitForFunction((n) => (window as unknown as { __kqFrames: number }).__kqFrames >= n, FRAMES_NACH_ANLAUF, { timeout: 60_000 });
  const danach: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(500);
    danach.push(await page.evaluate(() => Number(document.body.dataset.kqFps)));
  }
  const steady = [...danach].sort((a, b) => a - b)[2];
  console.log(`FPS-Messwert ${fps} (Anlauf), eingeschwungen ${danach.join(", ")} → Median ${steady} (Boden ${FPS_FLOOR} im Anlauf, ${STEADY_FLOOR} eingeschwungen)`);
  expect(steady).toBeGreaterThanOrEqual(STEADY_FLOOR);
});
