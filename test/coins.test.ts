/* Value Object für Dublonen (#490, Forts. #479).
 * Prüft die EINE Regel (nicht-negativ + ganzzahlig) und die zentralisierte
 * Arithmetik (Rundung/Multiplikator/Affordability) in Isolation – inkl.
 * Negativ-/Grenzfällen, die im nackten `number` bisher unmöglich zu fangen waren. */
import { describe, it, expect } from "vitest";
import {
  isCoins, coins, toCoins, applyMultiplier, add, canAfford, subtract, InvalidCoinsError,
} from "../src/core/coins";

describe("isCoins – die EINE Regel", () => {
  it("akzeptiert nicht-negative ganze Zahlen (inkl. 0)", () => {
    expect(isCoins(0)).toBe(true);
    expect(isCoins(1)).toBe(true);
    expect(isCoins(9999)).toBe(true);
  });
  it("lehnt negative, gebrochene und nicht-endliche Werte ab", () => {
    expect(isCoins(-1)).toBe(false);
    expect(isCoins(0.5)).toBe(false);
    expect(isCoins(1.0001)).toBe(false);
    expect(isCoins(NaN)).toBe(false);
    expect(isCoins(Infinity)).toBe(false);
  });
});

describe("coins – prüfender Smart-Constructor", () => {
  it("brandet gültige Werte unverändert", () => {
    expect(coins(40)).toBe(40);
  });
  it("wirft bei ungültigen Werten (negativ/gebrochen)", () => {
    expect(() => coins(-1)).toThrow(InvalidCoinsError);
    expect(() => coins(2.5)).toThrow(InvalidCoinsError);
    expect(() => coins(NaN)).toThrow(InvalidCoinsError);
  });
});

describe("toCoins – härtende Fabrik für unsichere Quellen", () => {
  it("rundet ab und deckelt bei 0 (nie negativ, nie gebrochen)", () => {
    expect(toCoins(3.9)).toBe(3);
    expect(toCoins(-5)).toBe(0);
    expect(toCoins(-0.1)).toBe(0);
  });
  it("bildet nicht-endliche Werte auf 0 ab", () => {
    expect(toCoins(NaN)).toBe(0);
    expect(toCoins(Infinity)).toBe(0);
  });
  it("liefert immer eine gültige Menge", () => {
    for (const raw of [7.7, -3, 0, 100.4, NaN]) expect(isCoins(toCoins(raw))).toBe(true);
  });
});

describe("applyMultiplier – Verdienst × Faktor, kaufmännisch gerundet", () => {
  it("wendet den Faktor an und rundet auf eine ganze Gutschrift", () => {
    expect(applyMultiplier(100, 1)).toBe(100);
    expect(applyMultiplier(100, 1.5)).toBe(150);
    expect(applyMultiplier(5, 1.05)).toBe(5);   // 5.25 -> 5 (kaufmännisch gerundet)
    expect(applyMultiplier(10, 1.05)).toBe(11); // 10.5 -> 11
  });
  it("liefert nie eine negative/gebrochene Gutschrift", () => {
    expect(isCoins(applyMultiplier(3, 1.333))).toBe(true);
  });
});

describe("add / canAfford / subtract – Kontostand-Arithmetik", () => {
  it("addiert zwei Mengen", () => {
    expect(add(coins(40), coins(10))).toBe(50);
  });
  it("canAfford: reicht genau / reicht nicht", () => {
    expect(canAfford(coins(25), coins(25))).toBe(true);
    expect(canAfford(coins(24), coins(25))).toBe(false);
    expect(canAfford(coins(0), coins(0))).toBe(true);
  });
  it("subtract zieht einen gedeckten Preis ab", () => {
    expect(subtract(coins(100), coins(25))).toBe(75);
    expect(subtract(coins(25), coins(25))).toBe(0);
  });
  it("subtract wirft bei ungedecktem Preis (negativer Stand un-repräsentierbar)", () => {
    expect(() => subtract(coins(10), coins(25))).toThrow(InvalidCoinsError);
  });
});
