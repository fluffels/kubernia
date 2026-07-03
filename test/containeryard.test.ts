import { describe, it, expect } from "vitest";
import { CONTAINER_DOCK, CONTAINER_LAGER, containerBarrelTile } from "../src/hud/containeryard";

// #303: gestoppte Container gehören in den Lagerschuppen, laufende ans Dock bei Bo.
// Die Platzierungs-Mathe ist pur (Phaser-frei) und hier direkt prüfbar – die
// eigentliche Optik (Fass-/Schuppen-Sprites) wird im Browser verifiziert.
describe("containerBarrelTile (#303)", () => {
  it("legt laufende Container ans Dock (CONTAINER_DOCK-Anker)", () => {
    expect(containerBarrelTile(true, 0)).toEqual({ x: CONTAINER_DOCK.x0, y: CONTAINER_DOCK.y });
  });

  it("legt gestoppte Container in den Lagerschuppen (CONTAINER_LAGER-Anker)", () => {
    expect(containerBarrelTile(false, 0)).toEqual({ x: CONTAINER_LAGER.x0, y: CONTAINER_LAGER.y });
  });

  it("trennt laufend und gestoppt räumlich (verschiedener Ort – der Kern des Tickets)", () => {
    const run = containerBarrelTile(true, 0);
    const stop = containerBarrelTile(false, 0);
    // Nicht nur die Reihe (y) unterscheidet sich, sondern auch die Spalte (x):
    // der Lager-Anker liegt spürbar östlich des Docks.
    expect(stop).not.toEqual(run);
    expect(stop.x).toBeGreaterThan(run.x);
    expect(stop.y).not.toBe(run.y);
  });

  it("packt jede Gruppe ab dem eigenen Index (k), Spalten mit colStep versetzt", () => {
    // k=0 sitzt am Anker, k=1 eine colStep-Spalte weiter rechts (gleiche Reihe).
    expect(containerBarrelTile(true, 1)).toEqual({
      x: CONTAINER_DOCK.x0 + CONTAINER_DOCK.colStep,
      y: CONTAINER_DOCK.y,
    });
    expect(containerBarrelTile(false, 1)).toEqual({
      x: CONTAINER_LAGER.x0 + CONTAINER_LAGER.colStep,
      y: CONTAINER_LAGER.y,
    });
  });

  it("bricht nach `cols` in die nächste Reihe um (Spalte wieder am Anker)", () => {
    // Das k-te Fass mit k === cols hat wieder Spalten-Offset 0 (Modulo cols).
    const wrapped = containerBarrelTile(false, CONTAINER_LAGER.cols);
    expect(wrapped.x).toBe(CONTAINER_LAGER.x0);
  });

  it("Dock-Anker bleibt beim historischen Platz (4,26) – kein Bruch bestehender Optik", () => {
    // Negativ-Absicherung: das Ticket verschiebt NUR die gestoppten Container; die
    // laufenden dürfen sich nicht mitverschoben haben (Regressions-Anker).
    expect(CONTAINER_DOCK.x0).toBe(4);
    expect(CONTAINER_DOCK.y).toBe(26);
  });

  it("der Schuppen-Fußabdruck umschließt die gestoppten Fässer (Optik-Konsistenz)", () => {
    const shed = CONTAINER_LAGER.shed;
    const stop0 = containerBarrelTile(false, 0);
    // Erstes Lager-Fass liegt horizontal innerhalb der Schuppenbreite …
    expect(stop0.x).toBeGreaterThanOrEqual(shed.x);
    expect(stop0.x).toBeLessThanOrEqual(shed.x + shed.w);
    // … und die Fass-Reihe liegt unterhalb der Schuppen-Oberkante (davor, nicht dahinter).
    expect(stop0.y).toBeGreaterThan(shed.y);
  });
});
