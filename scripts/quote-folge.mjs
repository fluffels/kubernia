// Kein Shebang: Baustein des gh-Guards (scripts/gh-guard-hook.mjs), wird von diesem und von Tests importiert.
/**
 * Quote-Zerlegung für Textprüfungen (#1311): EINE Hilfsfunktion für Segmentierung, Variablen-Suche, Endpunkt- und
 * Interpreter-String-Erkennung des gh-Guards. Pur, nur Builtins, kein Bezug zu Hook-I/O (darum nicht in hook-io.mjs).
 */

/**
 * Quote-Zerlegung für Textprüfungen (gh-Guard): liefert je Zeichen ab `von` den Zustand VOR dem Zeichen
 * `{ i, c, q, masked }` (`q`: `'`, `"` oder null; `masked`: durch `\` oder PowerShell-Backtick maskiert, außerhalb von
 * `'…'`). `.ende` ist der Zustand nach dem letzten Zeichen. `q0` setzt den Startzustand (Start mitten in einem Quote).
 * `escAussen: false`: Backslash und Backtick maskieren nur INNERHALB von `"…"` (Segmentierung; in PowerShell ist `\` außerhalb
 * von Quotes ein Pfadzeichen, `C:\dev\; gh api …` trennt bei `;`).
 */
export function quoteFolge(text, von = 0, q0 = null, escAussen = true) {
  const out = [];
  let q = q0;
  for (let i = von; i < text.length; i++) {
    const c = text[i];
    out.push({ i, c, q, masked: false });
    if (q === "'") {
      if (c === "'") q = null;
    } else if ((c === "\\" || c === "`") && i + 1 < text.length && (q !== null || escAussen)) {
      out.push({ i: i + 1, c: text[i + 1], q, masked: true });
      i++;
    } else if (c === q) q = null;
    else if (q === null && (c === "'" || c === '"')) q = c;
  }
  out.ende = q;
  return out;
}
