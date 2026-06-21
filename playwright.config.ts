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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
