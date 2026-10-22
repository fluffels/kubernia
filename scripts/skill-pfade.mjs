// Skill-Pfade (#1866): einzige Stelle der Literale für Skill-Quelle, Zeiger-Wurzel und Zeiger-Marke. Guard-frei (nur
// Konstanten, keine Imports), damit Hook-Skripte (haupt-sync) und Generatoren sie ohne Seiteneffekt laden.
// Ein Scan-Wächter in test/harness/skills-sync.test.ts hält die Pfad-Literale außerhalb dieser Datei aus Code heraus.

/** Skill-Quellen (tool-neutral). */
export const QUELL_VERZEICHNIS = ".agents/skills";
/** Zeiger-Verzeichnis des Werkzeugs Claude Code (generiert, hält nur Frontmatter und Verweis). */
export const ZEIGER_WURZEL = ".claude/skills";
/** Marke, an der ein generierter Zeiger erkannt wird. */
export const ZEIGER_MARKE = "<!-- skills-sync: generierter Skill-Zeiger, nicht von Hand ändern (npm run skills:sync) -->";
