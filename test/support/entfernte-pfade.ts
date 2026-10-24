/* Scan-Kern der Wächter gegen Textreste entfernter Pfade (#1067, ADR 0028; #1906): die Regelmenge geben `entfernte-pfade.test.ts` (Kern)
 * und `entfernte-pfade-projekt.test.ts` (Projekthistorie) mit; hier stehen Scan, Schnappschuss-Blöcke und Meldung. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Rest {
  name: string;
  muster: RegExp;
  fix: string;
}
export interface Datei {
  pfad: string;
  inhalt: string;
}
export interface Ausnahme {
  praefix: string;
  grund: string;
}

/** Pfad-Präfixe, die die Namen bewusst tragen. Je Eintrag der Grund. */
export const AUSNAHMEN: Ausnahme[] = [
  { praefix: "docs/adr/", grund: "ADRs sind historisch und werden nie umgeschrieben (AGENTS.md § Projekt-Brain pflegen)" },
  { praefix: "test/harness/model-routing.test.ts", grund: "Absenz-Test: prüft, dass die entfernten Dateien nicht mehr existieren (ADR 0028)" },
  { praefix: "test/harness/entfernte-pfade.test.ts", grund: "dieser Wächter trägt die Muster selbst" },
  { praefix: "docs/lens-gegenprobe-", grund: "datierte Schnappschüsse nennen die damaligen Dateinamen (Schnappschuss, nicht aktualisiert)" },
];

/** Ausnahmen für genau eine Regel in genau einer Datei (exakter Pfad); alle anderen Regeln prüfen die Datei weiter. */
export const REGEL_AUSNAHMEN: { pfad: string; regel: string; grund: string }[] = [];

/** Marker eines Schnappschuss-Blocks: datierter Text, der die damaligen Namen bewusst trägt (Glossar „Schnappschuss-Block“). */
export const SCHNAPPSCHUSS_START = "<!-- schnappschuss:start -->";
export const SCHNAPPSCHUSS_ENDE = "<!-- schnappschuss:ende -->";
const ISO_DATUM = /\d{4}-\d{2}-\d{2}/;

/** Findet Reste in den übergebenen Dateien; leer = sauber. */
export function findeReste(dateien: Datei[], regeln: Rest[], ausnahmen: Ausnahme[] = AUSNAHMEN): string[] {
  const treffer: string[] = [];
  for (const d of dateien) {
    if (ausnahmen.some((a) => d.pfad.startsWith(a.praefix))) continue;
    const aktiv = regeln.filter((r) => !REGEL_AUSNAHMEN.some((a) => a.pfad === d.pfad && a.regel === r.name));
    let blockStart = 0; // Zeilennummer des offenen Schnappschuss-Blocks, 0 = außerhalb
    let blockDatiert = false; // trägt der offene Block zwischen Start und Ende ein ISO-Datum
    d.inhalt.split("\n").forEach((zeile, i) => {
      const marker = zeile.trim();
      if (marker === SCHNAPPSCHUSS_START) {
        if (blockStart) treffer.push(`${d.pfad}:${i + 1}: Schnappschuss-Block verschachtelt`);
        else {
          blockStart = i + 1;
          blockDatiert = false;
        }
        return;
      }
      if (marker === SCHNAPPSCHUSS_ENDE) {
        if (!blockStart) treffer.push(`${d.pfad}:${i + 1}: Schnappschuss-Ende ohne Start`);
        else if (!blockDatiert) treffer.push(`${d.pfad}:${blockStart}: Schnappschuss-Block ohne Datum`);
        blockStart = 0;
        return;
      }
      if (blockStart) {
        if (ISO_DATUM.test(zeile)) blockDatiert = true;
        return;
      }
      for (const r of aktiv) if (r.muster.test(zeile)) treffer.push(`${d.pfad}:${i + 1}: ${r.name}`);
    });
    if (blockStart) treffer.push(`${d.pfad}:${blockStart}: Schnappschuss-Block ohne Ende`);
  }
  return treffer;
}

/** Meldung mit dem Fix-Hinweis je getroffener Regel (ein Hinweis pro Regel, auch bei mehreren Treffern). */
export function meldungMitFix(treffer: string[], regeln: Rest[]): string {
  const hinweise = regeln.filter((r) => treffer.some((t) => t.endsWith(`: ${r.name}`))).map((r) => `- ${r.name}: ${r.fix}`);
  const bloecke = treffer.some((t) => t.includes("Schnappschuss-Block") || t.includes("Schnappschuss-Ende"))
    ? ["- Schnappschuss-Block: Marker nur allein auf der Zeile, jeder Start braucht genau ein Ende (und jedes Ende einen Start) und zwischen beiden ein ISO-Datum (JJJJ-MM-TT)"]
    : [];
  return `Rest des entfernten Pfads gefunden:\n${[...hinweise, ...bloecke].join("\n")}`;
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Alle getrackten Textdateien mit Inhalt (Binärdateien und nicht lesbare Pfade werden übersprungen). */
export function getrackteTextdateien(): Datei[] {
  const liste = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const aus: Datei[] = [];
  for (const pfad of liste) {
    if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|mp3|ogg|wav|zip|gz|lock)$/i.test(pfad) || pfad === "package-lock.json") continue;
    try {
      const inhalt = readFileSync(`${ROOT}${pfad}`, "utf8");
      if (!inhalt.includes("\u0000")) aus.push({ pfad, inhalt });
    } catch {
      // gelöscht im Arbeitsbaum, aber noch im Index: nichts zu scannen
    }
  }
  return aus;
}
