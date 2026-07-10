import { test, expect } from "@playwright/test";
import { requireOfflineBuild, bootGame, dismissIntro, advanceDialogueUntilHidden } from "./support";

// Interaktions-Smokes (#480) – ein SCHLANKES Regressionsnetz über den Boot-Smoke
// (#391) hinaus. Der Boot-Smoke prüft nur, DASS das Spiel fehlerfrei hochfährt;
// eine Interaktions-Regression (Terminal nimmt keine Eingabe, Overlay geht nicht
// auf/zu, Quest lässt sich nicht abschließen) käme dort durch, weil die Unit-Tests
// die Präsentation (Phaser/DOM) bewusst nicht anfassen.
//
// Bewusst KEINE Voll-UI-Abdeckung: nur die drei Flows, deren Bruch das Spiel
// unspielbar macht – Terminal-Eingabe, Overlay auf/zu, ein Quest-Durchlauf. Alles
// über Tastatur/DOM gegen den echten Offline-Build getrieben (siehe support.ts),
// ohne Test-Hintertür. Getrennt von den Vitest-Unit-Tests, wie das ganze e2e/.

test.beforeAll(requireOfflineBuild);

test("Terminal: Befehl eintippen zeigt ein Ergebnis", async ({ page }) => {
  await bootGame(page);
  await dismissIntro(page);

  // Terminal öffnen (F) und auf das Eingabefeld warten.
  await page.keyboard.press("f");
  await expect(page.locator("#overlay-terminal")).toBeVisible();

  // `help` ist immer verfügbar (#358) und liefert eine deterministische Ausgabe.
  const input = page.locator("#term-input");
  await input.fill("help");
  await input.press("Enter");

  // Der Befehl wird als Prompt-Zeile gespiegelt UND es erscheint echte Ausgabe
  // (der help-Katalog nennt „Hilfe anzeigen") – nicht nur das Echo.
  const out = page.locator("#term-out");
  await expect(out).toContainText("crew@hafen:~$ help");
  await expect(out).toContainText("Hilfe");
});

test("Dialoge lassen sich mit Leertaste und Enter weiterschalten (#312)", async ({ page }) => {
  await bootGame(page);

  // Der Intro-Dialog erscheint ~600 ms nach dem Boot – ein mehrzeiliger Lese-Dialog.
  const dlg = page.locator("#dialogue");
  await expect(dlg).toBeVisible({ timeout: 5_000 });

  // Der Weiter-Hinweis nennt genau die Tasten, die auch wirken (#312: "Leer/Enter",
  // statt wie früher nur "(E)").
  await expect(page.locator("#dlg-next")).toContainText("Leer/Enter");

  // Abwechselnd Leertaste und Enter blättern den Dialog bis zum Ende durch – beweist,
  // dass BEIDE Tasten (nicht nur das weiterhin erlaubte E) zuverlässig weiterschalten.
  for (let i = 0; i < 20 && (await dlg.isVisible()); i++) {
    await page.keyboard.press(i % 2 === 0 ? "Space" : "Enter");
    await page.waitForTimeout(150);
  }
  await expect(dlg).toBeHidden();
});

test("Overlays: Logbuch, Album und Menü öffnen und wieder schließen", async ({ page }) => {
  await bootGame(page);
  await dismissIntro(page);

  const quest = page.locator("#overlay-quest");
  const album = page.locator("#overlay-album");
  const menu = page.locator("#overlay-menu");

  // Logbuch (L) auf/zu.
  await page.keyboard.press("l");
  await expect(quest).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(quest).toBeHidden();

  // Sammelalbum (B) auf/zu.
  await page.keyboard.press("b");
  await expect(album).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(album).toBeHidden();

  // Menü (Esc öffnet, wenn nichts blockiert; Esc schließt wieder).
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Shop/Quiz/Stapel teilen dieselbe Overlay-Mechanik (closeOverlays/blocking),
  // brauchen zum Öffnen aber NPC-Nähe (Bewegung) – hier bewusst ausgespart, um
  // das Netz schlank und flake-frei zu halten. Die Mechanik ist über die drei
  // tastatur-öffenbaren Overlays oben abgedeckt.
});

test("Quest annehmen und abschließen (Onboarding bei Ole)", async ({ page }) => {
  await bootGame(page);
  // Frischer Start: die Figur steht vor Oles Hafenmeisterei; das Intro erscheint zuerst.
  await dismissIntro(page);

  // Ole ansprechen (E) → Onboarding-Quest wird angenommen (Begrüßungs-Dialog),
  // durchblättern bis zum ersten Terminal-Schritt.
  await page.keyboard.press("r");
  await expect(page.locator("#dialogue")).toBeVisible();
  await advanceDialogueUntilHidden(page);

  // Der Schritt verlangt `help` im Terminal – eintippen löst ihn.
  await page.keyboard.press("f");
  await expect(page.locator("#overlay-terminal")).toBeVisible();
  const input = page.locator("#term-input");
  await input.fill("help");
  await input.press("Enter");
  await expect(page.locator("#term-out")).toContainText("crew@hafen:~$ help");

  // Terminal schließen, wieder Ole ansprechen → Abschluss-Dialog → Quest fertig.
  await page.keyboard.press("Escape");
  await expect(page.locator("#overlay-terminal")).toBeHidden();
  await page.keyboard.press("r");
  await expect(page.locator("#dialogue")).toBeVisible();
  await advanceDialogueUntilHidden(page);

  // Abschluss wird per Toast gemeldet ("🏁 Quest … abgeschlossen!").
  await expect(page.locator("#toasts")).toContainText("abgeschlossen");
});
