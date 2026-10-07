#!/usr/bin/env node
/**
 * Abschnitte eines Review-Patches für `Read` (#1379 Z7): `node scripts/patch-abschnitte.mjs <patch>` nennt je Abschnitt
 * `offset=<n> limit=<m>`, jeder unter dem Token-Limit des Read-Tools (25.000 Tokens je Aufruf). Jede Zeile steht in genau
 * einem Abschnitt, ohne Überlappung. Ein kleiner Patch ergibt einen Abschnitt.
 *
 * Budget: 32.000 Zeichen je Abschnitt (inklusive 8 Zeichen Zeilennummer-Präfix je Zeile). Kalibriert an einem echten Patch
 * (1.328 Zeilen, 123.253 Bytes): 1,88 bis 1,92 Zeichen je Token, also ≈ 17.000 Tokens; selbst bei 1,3 Zeichen je Token
 * (dichter Code) ≈ 24.600, unter dem Limit.
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MAX_ZEICHEN = 32_000;
const PRAEFIX = 8;

/** Zerlegt Text in Abschnitte `{ offset, limit }` (1-basiert, Zeilenzahl). Eine einzelne Zeile über dem Budget bildet einen eigenen Abschnitt. */
export function abschnitte(text, maxZeichen = MAX_ZEICHEN) {
  if (!text) return [];
  const zeilen = text.replace(/\r\n/g, "\n").split("\n");
  if (zeilen[zeilen.length - 1] === "") zeilen.pop();
  const out = [];
  let start = 1;
  let summe = 0;
  zeilen.forEach((z, i) => {
    const kosten = z.length + PRAEFIX;
    if (summe > 0 && summe + kosten > maxZeichen) {
      out.push({ offset: start, limit: i + 1 - start });
      start = i + 1;
      summe = 0;
    }
    summe += kosten;
  });
  if (zeilen.length) out.push({ offset: start, limit: zeilen.length + 1 - start });
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const datei = process.argv[2];
  if (!datei || !existsSync(datei)) {
    console.error(`Patch-Datei fehlt: ${datei ?? "(kein Pfad angegeben)"}`);
    process.exit(2);
  }
  for (const a of abschnitte(readFileSync(datei, "utf8"))) console.log(`offset=${a.offset} limit=${a.limit}`);
}
