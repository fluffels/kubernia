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

/** Einschwingzeit nach dem Intro (Ladephase der Szene, Asset-Dekodierung) und Messreihe (#1398).
 *  Ein Einzelwert 1,5 s nach dem Intro traf in der CI die Ladephase (36 und 38 FPS bei Boden 40, ohne
 *  `src/`-Änderung, nach Rerun grün): der Sampler mittelt 30 Frames, und ein langsamer Runner braucht
 *  für sie länger als die Wartezeit. Gemessen wird darum der MEDIAN mehrerer Werte nach längerem
 *  Einschwingen; der Boden bleibt gleich (Schätzer-Korrektur, kein Senken der Schwelle). */
const EINSCHWINGEN_MS = 3_000;
const MESSUNGEN = 6;
const MESSABSTAND_MS = 500;

/** Median einer nicht leeren Zahlenliste (bei gerader Länge der Mittelwert der zwei mittleren). */
function median(werte: number[]): number {
  const s = [...werte].sort((a, b) => a - b);
  const mitte = s.length >> 1;
  return s.length % 2 === 1 ? s[mitte] : (s[mitte - 1] + s[mitte]) / 2;
}

test("Frame-Budget: das Spiel läuft mit gesunder FPS (Perf-HUD-Messwert)", async ({ page }) => {
  await bootGame(page, "perf");
  await dismissIntro(page);

  // Warten, bis der FrameSampler sein 30-Frame-Fenster gefüllt und die FPS auf das
  // DOM gespiegelt hat (fps > 0 heißt: es wurden echte Frames gemessen). Großzügiger
  // Timeout, damit langsame CI-Runner das Fenster sicher füllen können.
  await page.waitForFunction(() => Number(document.body.dataset.kqFps) > 0, null, { timeout: 10_000 });

  // Laufen lassen, damit sich der rollende Mittelwert einschwingt (nicht am
  // allerersten, oft langen Boot-Frame und nicht in der Ladephase hängenbleiben).
  await page.waitForTimeout(EINSCHWINGEN_MS);

  const reihe: number[] = [];
  for (let i = 0; i < MESSUNGEN; i++) {
    reihe.push(await page.evaluate(() => Number(document.body.dataset.kqFps)));
    if (i < MESSUNGEN - 1) await page.waitForTimeout(MESSABSTAND_MS);
  }
  const fps = median(reihe);

  // Die Reihe immer ausgeben, nicht nur im Fehlerfall: so lässt sich die Streuung der Runner über die Zeit ablesen.
  const zeile = `FPS-Reihe: ${reihe.join(", ")} · Median ${fps} (Boden ${FPS_FLOOR})`;
  test.info().annotations.push({ type: "fps", description: zeile });
  console.log(zeile);

  expect(fps, zeile).toBeGreaterThanOrEqual(FPS_FLOOR);
});
