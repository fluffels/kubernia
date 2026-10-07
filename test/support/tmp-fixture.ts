/* Test-Helfer (#1367): legt ein Fixture-Root mit Dateien in einem Temp-Ordner an und räumt es nach
 * jedem Test auf. Genutzt von den Tests der Doku-Generatoren (docgen*.test.ts). */
import { afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Erzeugt ein Root-Verzeichnis mit den angegebenen Dateien (Pfad relativ → Inhalt). */
export function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "kq-docgen-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
