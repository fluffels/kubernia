import { test, expect, type Page } from "@playwright/test";

// Lern-Loop-Smoke (#602) – schließt die vom Ticket benannte Lücke: der EIGENTLICHE
// Lernkern (einen Drill lösen UND ein Quiz bei Krabbe Kralle beantworten) lief bisher
// e2e NIE über die echte Phaser/DOM-UI, nur die Onboarding-Quest (Terminal `help`,
// interaction.spec.ts) und der Voll-Durchspiel gegen die reine Sim-Domäne. Ein Bruch
// in der Quiz-/Drill-Verdrahtung (radio-Drill, answerChoice, answerReviewQuiz) käme so
// durch alle Gates.
//
// WARUM DEV-BUILD (statt des Offline-Builds wie die anderen Smokes)? Quiz und Drill
// sitzen bei NPCs (Bo am Dock, Kralle an Deck des Schiffs), die man nur durch Laufen
// über Wasser/Piers erreicht. Blindes Tastatur-Laufen ist in headless-CI nicht robust
// (keine auslesbare Spielerposition, Kollision) – genau die Flakiness, die die
// bestehenden Smokes (#480) bewusst vermeiden. Darum nutzt DIESER Smoke die
// dokumentierte Dev-Affordanz `window.kqGame` (main.ts, hinter `import.meta.env.DEV`),
// um die Figur an den jeweiligen NPC zu SETZEN (kqGame.scene.getScene("World").playerPos).
// Die Navigation ist NICHT das Testziel; der eigentliche Lern-Loop (Onboarding-Quest,
// Docker-Quest inkl. Terminal-Aufgabe/Drill/Inline-Quiz, Kralle-Quiz) wird zu 100 % über
// echte Tastatur/DOM gespielt. Bewusst OHNE `kqDev.jump` (Quest-Sprung) und OHNE Reload:
// jump reloadet, und der async-Persist-Race (#473, separat in Arbeit) macht das Setup
// flakig. Stattdessen spielen wir den echten Fortschritt vorwärts – kein Reload, kein
// Race. Der Quiz-/Drill-UI-Code (ui/radio.ts, ui/dialog.ts, ui/quiz.ts) ist build-
// unabhängig identisch, dieser Smoke bewacht ihn also gültig. Playwright startet den
// Vite-Dev-Server (webServer in playwright.config.ts).

const DEV_URL = "http://localhost:5173/";
const T = 16; // Kachelgröße → Pixel

/** Bootet den Dev-Build und wartet, bis Spiel + Dev-Affordanzen (kqGame/kqDev) bereit sind. */
async function bootDev(page: Page): Promise<void> {
  await page.goto(DEV_URL);
  await expect(page.locator("body")).toHaveAttribute("data-kq-booted", "1", { timeout: 20_000 });
  await expect(page.locator("#game-container canvas")).toBeVisible();
  await page.waitForFunction(
    () => !!(window as unknown as { kqDev?: unknown }).kqDev && !!(window as unknown as { kqGame?: unknown }).kqGame,
    null,
    { timeout: 10_000 },
  );
}

type KqDev = { roadmap(): { id: string; completed: boolean }[] };
type KqGame = { scene: { getScene(k: string): { playerPos: { x: number; y: number } } } };

/** Ist die Quest `id` bereits abgeschlossen? (liest den Live-Stand, kein Reload) */
function questDone(page: Page, id: string): Promise<boolean> {
  return page.evaluate((qid) => (window as unknown as { kqDev: KqDev }).kqDev.roadmap().find((r) => r.id === qid)?.completed ?? false, id);
}

/** Setzt die Figur auf die Kachel (tx,ty) – live, ohne Reload (Navigation ist nicht das
 *  Testziel). Kurz warten, damit die Szene die neue Position übernimmt (nearestNpc/Prompt). */
async function teleport(page: Page, tx: number, ty: number): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const ws = (window as unknown as { kqGame: KqGame }).kqGame.scene.getScene("World");
      ws.playerPos.x = x;
      ws.playerPos.y = y;
    },
    { x: tx * T, y: ty * T },
  );
  await page.waitForTimeout(200);
}

/** Leitet aus dem HTML der aktuellen Terminal-Aufgabe den zu tippenden Befehl ab.
 *  Deckt die in Onboarding + Docker-Einstiegsquest vorkommenden Aufgaben ab:
 *  - kubectl get nodes/pods (Nodes/Stege bzw. Pods),
 *  - docker pull/run <image> (Verb „Lade/Registry" → pull, „Starte/Container" → run;
 *    das Image steht im <code>…</code> der Aufgabe),
 *  - sonst `help`. */
function cmdFor(text: string, code: string): string {
  if (/kubectl|node|steg|\bpod/i.test(text)) return /\bpod/i.test(text) ? "kubectl get pods" : "kubectl get nodes";
  if (/lade|registry|pull|herunter/i.test(text)) return `docker pull ${code}`;
  if (/starte|container|\brun\b/i.test(text)) return `docker run ${code}`;
  return "help";
}

// Bekannte korrekte Inline-Quiz-Antworten (choice-Steps) per Textausschnitt.
const CORRECT_CHOICE = [/Bauplan/i, /kleinste Einheit/i];

interface PlayResult {
  solvedTerminal: boolean;
  solvedDrill: boolean;
  answeredChoice: boolean;
}

/** Spielt die aktuelle Quest über die echte UI bis zu ihrem Abschluss durch (Zustands-
 *  automat: je nach offenem Panel Dialog/Terminal/Welt die passende Eingabe). Voraussetzung:
 *  die Figur steht beim Quest-Geber (vorher teleportieren). Robust gegen die genaue
 *  Schritt-Reihenfolge; sammelt, ob eine Terminal-Aufgabe, ein Drill und ein Inline-Quiz
 *  vorkamen. */
async function playQuestToEnd(page: Page, questId: string): Promise<PlayResult> {
  const res: PlayResult = { solvedTerminal: false, solvedDrill: false, answeredChoice: false };
  const dlg = page.locator("#dialogue");
  const term = page.locator("#overlay-terminal");

  for (let i = 0; i < 90; i++) {
    if (await questDone(page, questId)) break;

    if (await dlg.isVisible()) {
      const choices = page.locator("#dlg-choices button:not([disabled])");
      if ((await choices.count()) > 0) {
        const texts = await choices.allTextContents();
        const idx = texts.findIndex((t) => CORRECT_CHOICE.some((re) => re.test(t)));
        if (idx >= 0) {
          // Inline-Quiz (choice-Step): die korrekte Antwort wählen.
          await choices.nth(idx).click();
          await page.waitForTimeout(200);
          if ((await page.locator("#dlg-choices button.correct").count()) > 0) res.answeredChoice = true;
        } else {
          // NPC-Menü o.ä. (kein Quiz) → schließen, nicht blind draufklicken.
          await page.keyboard.press("Escape");
          await page.waitForTimeout(120);
        }
      } else {
        await page.keyboard.press("r");
        await page.waitForTimeout(120);
      }
      continue;
    }

    if (await term.isVisible()) {
      const cur = page.locator("#term-tasks .tt-item.current");
      if ((await cur.count()) > 0) {
        const box = (await page.locator("#term-tasks").textContent()) ?? "";
        const isDrill = /Übung\s+\d+\s+von/i.test(box); // Drill-Step zeigt „Übung X von Y"
        const text = (await cur.first().textContent()) ?? "";
        const code = (await cur.first().locator("code").first().textContent().catch(() => "")) ?? "";
        const input = page.locator("#term-input");
        await input.fill(cmdFor(text, code));
        await input.press("Enter");
        await page.waitForTimeout(250);
        res.solvedTerminal = true;
        if (isDrill) res.solvedDrill = true;
      } else {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(120);
      }
      continue;
    }

    // Weltansicht: HUD-Hinweis sagt, ob Terminal (F) oder Reden (R) dran ist.
    const hint = (await page.locator("#hud-quest").textContent()) ?? "";
    await page.keyboard.press(/Terminal öffnen/.test(hint) ? "f" : "r");
    await page.waitForTimeout(150);
  }
  // #314: Ein Quest-Abschluss kann ein blockierendes Erfolgs-Feier-Popup öffnen (Album-
  // Einträge / Rang-Aufstieg) – im echten Spiel klickt man es mit Enter weg, bevor es
  // weitergeht. Sonst bliebe es offen und sperrte die nächste Interaktion.
  await dismissCelebration(page);
  return res;
}

/** Schließt ein evtl. (auch verzögert) aufpoppendes Erfolgs-Feier-Popup (#314). Es wird
 *  erst gezeigt, wenn der Spieler frei ist (Flush in updatePrompt), kann also kurz nach
 *  dem Quest-Abschluss erscheinen – darum gepollt und per Enter (closeOverlays) weg. */
async function dismissCelebration(page: Page): Promise<void> {
  const cel = page.locator("#overlay-celebrate");
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(150);
    if (await cel.isVisible()) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);
      if (!(await cel.isVisible())) return;
    }
  }
}

test("Lern-Loop über die UI: Drill lösen und Quiz bei Krabbe Kralle", async ({ page }) => {
  test.setTimeout(180_000);
  await bootDev(page);

  // --- Onboarding bei Ole (Startposition) durchspielen: schaltet die Docker-Quest bei Bo frei. ---
  await playQuestToEnd(page, "onboarding-sign-on");
  expect(await questDone(page, "onboarding-sign-on"), "Onboarding nicht abgeschlossen").toBe(true);

  // --- Docker-Einstiegsquest bei Bo: Terminal-Aufgabe + Drill + Inline-Quiz über die UI. ---
  await teleport(page, 8, 25); // Bo (Dock-Golem) am West-Dock
  const res = await playQuestToEnd(page, "docker-first-container");
  expect(await questDone(page, "docker-first-container"), "Docker-Quest nicht abgeschlossen").toBe(true);
  expect(res.solvedTerminal, "keine Quest-Terminal-Aufgabe gelöst").toBe(true);
  expect(res.solvedDrill, "keinen Drill gelöst").toBe(true);
  expect(res.answeredChoice, "kein Inline-Quiz (choice) beantwortet").toBe(true);

  // Der Quest-Abschluss hat die Karten der Quest in den Spaced-Repetition-Pool geseedet
  // (registerQuestCards, live – kein Reload). Damit hat Kralle jetzt etwas zum Üben.

  // --- Quiz bei Krabbe Kralle über die UI (freies Üben) ---
  await teleport(page, 36, 32); // Kralle an Deck des Schiffs
  await expect(page.locator("#prompt")).toContainText("Kralle", { timeout: 5_000 });

  await page.keyboard.press("r");
  await expect(page.locator("#overlay-review")).toBeVisible();

  // Nichts ist heute fällig (frisch geseedete Karten sind erst morgen dran) → Kralle bietet
  // „Frei üben" an. Das zieht aus ALLEN gelernten Karten (Quiz + Befehl).
  const freeBtn = page.locator('[data-action="startFreePractice"]');
  if ((await freeBtn.count()) > 0) await freeBtn.first().click();
  await page.waitForTimeout(300);

  // Über die gezogenen Karten gehen, bis eine Quiz-Karte kommt: die beantworten und prüfen,
  // dass die Quiz-Verdrahtung greift (genau eine Antwort wird als richtig markiert).
  // Befehls-(Drill-)Karten dazwischen überspringen wir bewusst.
  let answeredKralleQuiz = false;
  for (let card = 0; card < 12 && !answeredKralleQuiz; card++) {
    const options = page.locator("#quiz-options button");
    const cmdInput = page.locator("#review-input");
    if ((await options.count()) > 0) {
      await options.first().click(); // → answerReviewQuiz
      await page.waitForTimeout(200);
      expect(await page.locator("#quiz-options button.correct").count()).toBe(1);
      answeredKralleQuiz = true;
    } else if ((await cmdInput.count()) > 0) {
      // Befehls-Karte überspringen: dreimal falsch → Lösung wird gezeigt → „Weiter".
      for (let a = 0; a < 3; a++) {
        await cmdInput.fill("überspringen");
        await cmdInput.press("Enter");
        await page.waitForTimeout(150);
      }
      await page.keyboard.press("Enter"); // „Weiter ➡️"
      await page.waitForTimeout(200);
    } else {
      break; // Runde zu Ende ohne Quiz-Karte (bei geseedeten Docker-Quizzes nicht erwartet)
    }
  }

  expect(answeredKralleQuiz, "kein Kralle-Quiz über die UI beantwortet").toBe(true);
});
