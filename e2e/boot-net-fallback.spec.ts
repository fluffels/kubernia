import { test, expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Negativfall zum Boot-Sicherheitsnetz (#455): Wird die ROHE Entwickler-index.html
// aus der Repo-Wurzel ohne den Vite-Dev-Server geladen – genau der Doppelklick-
// Fehlgriff, den das Netz auffangen soll –, kann der Browser das Modul
// /src/main.ts nicht übersetzen, boot() läuft nie und setzt den Boot-Flag nie.
// Dann MUSS der „startet so nicht"-Hinweis (nach der Karenz) erscheinen und stehen
// bleiben.
//
// Das ist das bewusste Gegenstück zum Positivfall in boot-smoke.spec.ts, wo das
// Netz bei erfolgreichem – auch langsamem – Boot garantiert wieder verschwindet.
// Anders als der Smoke-Test braucht dieser Lauf KEINEN Offline-Build (eigene Datei,
// kein beforeAll-Gate): er lädt direkt die rohe index.html per file://.
const rawDevHtml = fileURLToPath(new URL("../index.html", import.meta.url));

test("rohe Dev-index.html ohne Server zeigt das Boot-Sicherheitsnetz", async ({ page }) => {
  await page.goto(pathToFileURL(rawDevHtml).href);

  // Der Hinweis muss nach Ablauf der Karenz auftauchen ...
  await expect(page.getByText("KubeQuest startet so nicht")).toBeVisible({ timeout: 10_000 });

  // ... und das Boot-Flag darf nie gesetzt worden sein (ohne Server bootet nichts).
  // Erst hier geprüft – nachdem das Netz schon da ist –, damit ein hypothetischer
  // (hier unmöglicher) Spät-Boot nicht durchrutscht.
  await expect(page.locator("body")).not.toHaveAttribute("data-kq-booted", "1");
});

// Kern-Regressionstest für #455: ein LANGSAMER, aber erfolgreicher Boot. Das Netz
// wird (mangels Server) erst gezeigt, und DANACH erscheint der Boot-Flag verspätet
// – genau die Reihenfolge, die früher den Hinweis dauerhaft über dem laufenden
// Spiel liegen ließ. Jetzt muss die aktive Flag-Beobachtung das Netz wieder
// entfernen. Wir simulieren den Spät-Boot, indem wir das Flag von Hand setzen.
test("verspäteter Boot-Flag entfernt ein bereits gezeigtes Sicherheitsnetz wieder", async ({ page }) => {
  await page.goto(pathToFileURL(rawDevHtml).href);

  // Erst das Netz abwarten (Boot ist hier mangels Server noch nicht passiert) ...
  await expect(page.getByText("KubeQuest startet so nicht")).toBeVisible({ timeout: 10_000 });

  // ... dann den langsamen, aber erfolgreichen Boot nachstellen: Flag setzen.
  await page.evaluate(() => { document.body.dataset.kqBooted = "1"; });

  // Die Beobachtung muss das Netz nun wieder aus dem DOM nehmen.
  await expect(page.getByText("KubeQuest startet so nicht")).toHaveCount(0);
});
