/* Struktur-Tests für die Beispiel-Manifeste (Manifest-Bibliothek data/manifests via
 * manifest-lib, #514). Die YAML-Schnipsel werden von Quests/Drills/Sim als „virtuelle
 * Dateien" konsumiert – ein Tippfehler in der Einrückung oder ein fehlender Pflicht-Block
 * fällt sonst erst spät auf. Hier prüfen wir die Invarianten, auf die die GitOps-Tickets
 * (Phase 4) bauen.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { getManifest } from "../src/content/manifest-lib";

const ARGO_APPLICATION_YAML = getManifest("argo-application-auto");
const APP_OF_APPS_YAML = getManifest("argo-app-of-apps");

/** Minimal-Check für ein Argo-CD-`Application`-Manifest. Gibt eine Liste gefundener
 *  Probleme zurück (leer = ok), damit wir ihn Red-Green gegen kaputte Eingaben prüfen. */
function pruefeArgoApplication(yaml: string): string[] {
  const fehler: string[] = [];
  const hat = (re: RegExp, was: string) => { if (!re.test(yaml)) fehler.push("fehlt: " + was); };
  hat(/^apiVersion: argoproj\.io\/v1alpha1$/m, "apiVersion argoproj.io/v1alpha1");
  hat(/^kind: Application$/m, "kind: Application");
  hat(/^ {2}name: \S+/m, "metadata.name (2 Leerzeichen eingerückt)");
  hat(/^ {2}source:/m, "spec.source");
  hat(/^ {4}repoURL: \S+/m, "source.repoURL (4 Leerzeichen eingerückt)");
  hat(/^ {4}path: \S+/m, "source.path");
  hat(/^ {2}destination:/m, "spec.destination");
  hat(/^ {4}namespace: \S+/m, "destination.namespace");
  hat(/^ {2}syncPolicy:/m, "spec.syncPolicy");
  hat(/^ {6}selfHeal: true/m, "syncPolicy.automated.selfHeal (Pull-/Self-Heal-Prinzip)");
  return fehler;
}

test("ARGO_APPLICATION_YAML: vollständiges, korrekt eingerücktes Application-Manifest", () => {
  assert.deepEqual(pruefeArgoApplication(ARGO_APPLICATION_YAML), [],
    "ARGO_APPLICATION_YAML hat Struktur-Probleme");
});

test("APP_OF_APPS_YAML: ist selbst eine Application und zeigt auf einen Ordner (App-of-Apps)", () => {
  assert.deepEqual(pruefeArgoApplication(APP_OF_APPS_YAML), [],
    "APP_OF_APPS_YAML hat Struktur-Probleme");
  // Das App-of-Apps-Muster: source.path zeigt auf einen Ordner voller weiterer Applications,
  // nicht auf ein einzelnes Dienst-Manifest.
  assert.match(APP_OF_APPS_YAML, /^ {4}path: flotte$/m,
    "App-of-Apps muss auf den Sammel-Ordner (path: flotte) zeigen");
});

test("Red-Green: ein Manifest mit kaputter Einrückung / fehlendem syncPolicy wird gemeldet", () => {
  // Beweist, dass der Check Zähne hat: ohne syncPolicy und mit verrutschter Einrückung
  // MUSS pruefeArgoApplication anschlagen – sonst wäre der Test wertlos.
  const kaputt = [
    "apiVersion: argoproj.io/v1alpha1", "kind: Application", "metadata:",
    " name: schief",                 // nur 1 Leerzeichen statt 2 → ungültiges YAML
    "spec:",
    "  source:", "    repoURL: x", "    path: y",
    "  destination:", "    namespace: z",
    // syncPolicy fehlt komplett
  ].join("\n");
  const fehler = pruefeArgoApplication(kaputt);
  assert.ok(fehler.some(f => f.includes("metadata.name")), "verrutschte Einrückung nicht gemeldet:\n" + fehler.join("\n"));
  assert.ok(fehler.some(f => f.includes("syncPolicy")), "fehlendes syncPolicy nicht gemeldet:\n" + fehler.join("\n"));
});
