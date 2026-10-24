// Skill-Pfade (#1866): einzige Stelle der Literale für Skill-Quelle, Zeiger-Wurzel und Zeiger-Marke, dazu das Zeiger-Format
// (`frontmatterBlock`, `zeigerText`). Guard-frei (nur Konstanten und pure Funktionen, keine Imports), damit Hook-Skripte
// (haupt-sync), Generatoren und der Export sie ohne Seiteneffekt laden.
// Ein Scan-Wächter in test/harness/skills-sync.test.ts hält die Pfad-Literale außerhalb dieser Datei aus Code heraus.

/** Skill-Quellen (tool-neutral). */
export const QUELL_VERZEICHNIS = ".agents/skills";
/** Zeiger-Verzeichnis des Werkzeugs Claude Code (generiert, hält nur Frontmatter und Verweis). */
export const ZEIGER_WURZEL = ".claude/skills";
/** Marke, an der ein generierter Zeiger erkannt wird. */
export const ZEIGER_MARKE = "<!-- skills-sync: generierter Skill-Zeiger, nicht von Hand ändern (npm run skills:sync) -->";

const lf = (text) => text.replace(/\r\n/g, "\n");

/** Frontmatter-Block (von der ersten `---`-Zeile bis zur nächsten, einschließlich) oder null. */
export function frontmatterBlock(text) {
  const zeilen = lf(text).split("\n");
  if (zeilen[0] !== "---") return null;
  const ende = zeilen.indexOf("---", 1);
  return ende < 0 ? null : zeilen.slice(0, ende + 1).join("\n");
}

/** Gewünschter Zeiger-Text zu einer Quelle (immer LF). */
export function zeigerText(name, quelltext) {
  const block = frontmatterBlock(quelltext);
  return `${block}\n\n${ZEIGER_MARKE}\nLies \`${QUELL_VERZEICHNIS}/${name}/SKILL.md\` und folge ihm.\n`;
}
