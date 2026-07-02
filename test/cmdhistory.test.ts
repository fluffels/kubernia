/* Tests für #316 – Befehlshistorie im Funkgerät-Terminal (pure Navigations-Mathematik).
 *
 * Die DOM-Anbindung (Eingabefeld, ↑/↓) ist Präsentation und wird im Browser verifiziert;
 * hier wird die reine Logik aus src/cmdhistory.ts geprüft – inkl. Grenz-/Negativfälle:
 * leere Historie, Klemmen an beiden Enden, ignoredups, Längen-Cap, Whitespace.
 */
import { test, expect } from "vitest";
import { pushHistory, navigateHistory, CMD_HISTORY_MAX } from "../src/hud/cmdhistory";

/* ---------- pushHistory ---------- */

test("pushHistory hängt eine Zeile an (neue Liste, Original unverändert)", () => {
  const h0: string[] = [];
  const h1 = pushHistory(h0, "kubectl get pods");
  expect(h1).toEqual(["kubectl get pods"]);
  expect(h0).toEqual([]); // pur: Eingabe nicht mutiert
});

test("pushHistory ignoriert leere/whitespace-Zeilen", () => {
  expect(pushHistory(["a"], "")).toEqual(["a"]);
  expect(pushHistory(["a"], "   ")).toEqual(["a"]);
});

test("pushHistory trimmt die gespeicherte Zeile", () => {
  expect(pushHistory([], "  docker ps  ")).toEqual(["docker ps"]);
});

test("pushHistory überspringt eine direkte Wiederholung des letzten Befehls (ignoredups)", () => {
  const h = pushHistory(["docker ps"], "docker ps");
  expect(h).toEqual(["docker ps"]);
  // Dieselbe Zeile NICHT direkt hintereinander → keine Dublette …
  // … aber wenn dazwischen etwas anderes kam, wird sie wieder gespeichert:
  expect(pushHistory(["docker ps", "ls"], "docker ps")).toEqual(["docker ps", "ls", "docker ps"]);
});

test("pushHistory kappt vorne (ältester Eintrag) bei Überlänge", () => {
  let h: string[] = [];
  for (let i = 0; i < CMD_HISTORY_MAX + 5; i++) h = pushHistory(h, "cmd" + i);
  expect(h).toHaveLength(CMD_HISTORY_MAX);
  expect(h[0]).toBe("cmd5");                       // die ältesten 5 sind weg
  expect(h[h.length - 1]).toBe("cmd" + (CMD_HISTORY_MAX + 4));
});

/* ---------- navigateHistory ---------- */

const H = ["c0", "c1", "c2"]; // c2 = neuester

test("↑ vom Entwurf (index == length) holt den neuesten Befehl", () => {
  expect(navigateHistory(H, 3, -1)).toEqual({ index: 2, text: "c2" });
});

test("mehrmals ↑ läuft zum ältesten und bleibt dort geklemmt", () => {
  expect(navigateHistory(H, 2, -1)).toEqual({ index: 1, text: "c1" });
  expect(navigateHistory(H, 1, -1)).toEqual({ index: 0, text: "c0" });
  expect(navigateHistory(H, 0, -1)).toEqual({ index: 0, text: "c0" }); // unten geklemmt
});

test("↓ läuft Richtung Entwurf und endet bei leerer Zeile (am length geklemmt)", () => {
  expect(navigateHistory(H, 0, 1)).toEqual({ index: 1, text: "c1" });
  expect(navigateHistory(H, 2, 1)).toEqual({ index: 3, text: "" }); // zurück zum Entwurf
  expect(navigateHistory(H, 3, 1)).toEqual({ index: 3, text: "" }); // oben geklemmt
});

test("leere Historie ist ein No-op (Cursor bleibt 0, Text leer)", () => {
  expect(navigateHistory([], 0, -1)).toEqual({ index: 0, text: "" });
  expect(navigateHistory([], 0, 1)).toEqual({ index: 0, text: "" });
});

test("ein außerhalb liegender Index wird defensiv geklemmt, bevor navigiert wird", () => {
  expect(navigateHistory(H, 99, -1)).toEqual({ index: 2, text: "c2" }); // 99 -> 3 -> ↑ -> 2
  expect(navigateHistory(H, -5, 1)).toEqual({ index: 1, text: "c1" });  // -5 -> 0 -> ↓ -> 1
});
