import { defineConfig, devices } from "@playwright/test";

// Boot-Smoke-Test (#391): lädt den gebauten Offline-Build headless in Chromium
// und prüft, dass das Spiel ohne Konsolen-/Laufzeit-Fehler hochfährt. Bewusst
// GETRENNT von den Vitest-Unit-Tests (test/**/*.test.ts): die decken die pure
// Domäne/Anwendung im Node-Test ab, fassen aber Phaser/DOM bewusst nicht an.
// Dieser Lauf schließt genau die Lücke – ein echter Boot des ausgelieferten
// Builds, der Init-Fehler (Phaser, Content-Loader, kaputtes Asset-Manifest)
// fängt, die erst zur Laufzeit auftreten.
//
// Voraussetzung: der Offline-Build muss existieren (dist-offline/index.html).
// Lokal: `npm run build:offline` davor (oder einfach `npm run smoke`, das beides
// in einem Rutsch macht). In der CI baut der Schritt davor den Build bereits.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // EIN Worker (#524): der FPS-Budget-Smoke misst echte Bilder/Sekunde in Echtzeit.
  // Läuft ein zweiter headless-Chromium (v.a. der CPU-schwere axe-Scan) parallel auf
  // demselben Runner, bricht die gemessene FPS künstlich ein (60 → ~15) und der Gate
  // wird flakig. Die Smoke-Suite ist klein, darum serialisieren wir sie bewusst –
  // deterministisches Timing ist hier mehr wert als die paar Sekunden Parallelität.
  workers: 1,
  // Kein versehentliches `test.only` in der CI durchwinken.
  forbidOnly: !!process.env.CI,
  // Ein Boot-Smoke-Test soll deterministisch sein; ein einzelner Retry fängt nur
  // echte Infrastruktur-Aussetzer der CI ab, ohne ein flakiges Ergebnis zu maskieren.
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    // Bei Fehlschlag eine Trace zur Diagnose sichern (test-results/).
    trace: "retain-on-failure",
  },
  // Dev-Server für den Lern-Loop-Smoke (#602). Die Boot-/Interaktions-/Perf-/A11y-
  // Smokes laden den gebauten OFFLINE-Build per file:// (kein Server nötig); der
  // Lern-Loop-Smoke braucht aber die Dev-Affordanzen `window.kqGame`/`kqDev` (in
  // main.ts hinter `import.meta.env.DEV`, im Offline-/Prod-Build rausgestrippt),
  // um die Figur ohne fragile Blind-Navigation an den Quiz-/Drill-NPC zu setzen –
  // Begründung im Kopf von e2e/learning-loop.spec.ts. Playwright startet dafür
  // `npm run dev` und wartet, bis der Vite-Server steht; lokal wird ein bereits
  // laufender wiederverwendet.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
