// Kein Shebang: Baustein des gh-Guards (scripts/gh-guard-hook.mjs), wird von diesem und von Tests importiert.
/**
 * Quote-Zerlegung für Textprüfungen (#1311): EINE Hilfsfunktion für Segmentierung, Variablen-Suche, Endpunkt- und
 * Interpreter-String-Erkennung des gh-Guards. Pur, nur Builtins, kein Bezug zu Hook-I/O (darum nicht in hook-io.mjs).
 */

/** Maskiert das Zeichen `c` an `i` das nächste (`\` oder Backtick, nicht in `'…'`, ggf. nur innerhalb von `"…"`)? */
const maskiert = (c, q, hatNaechstes, escAussen) => (c === "\\" || c === "`") && hatNaechstes && (q !== null || escAussen);

/** Zustand nach dem Zeichen `c` (das Quote-Zeichen öffnet, schließt oder bleibt unberührt). */
function naechsterZustand(q, c) {
  if (q === "'") return c === "'" ? null : q;
  if (c === q) return null;
  return q === null && (c === "'" || c === '"') ? c : q;
}

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
    if (q !== "'" && maskiert(c, q, i + 1 < text.length, escAussen)) {
      out.push({ i: i + 1, c: text[i + 1], q, masked: true });
      i++;
    } else q = naechsterZustand(q, c);
  }
  out.ende = q;
  return out;
}
