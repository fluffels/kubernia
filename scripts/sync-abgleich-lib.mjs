// Blatt-Modul: Erst-Übernahme-Schutz und Vorlage-Einheiten des Sync-Werkzeugs (factory#118). Nur Node-Builtins, keine lokalen Importe.
// Erst-Übernahme: eine ganze Datei, die noch nicht im alten Sync-Stand steht und im Ziel anders vorliegt, überschreibt der Sync nie still;
// erst `--uebernehmen <pfad>` gibt sie frei. Vorlage (`"art": "vorlage"` im Manifest): wird nur angelegt, wenn sie fehlt, und nie überschrieben.

/** Wert des Manifest-Felds `art` für eine Vorlage. */
export const ART_VORLAGE = "vorlage";

/** Ist die Einheit eine Vorlage (nur anlegen, nie überschreiben, nicht im Stand-Hash)? */
export const istVorlage = (e) => e.art === ART_VORLAGE;

/** Fehler des optionalen Felds `art` (leer = gültig oder nicht gesetzt): nur `"vorlage"`, nur an einer ganzen Datei, ohne `pflichtChecks`. */
export function artFehler(e) {
  if (e.art === undefined) return [];
  if (e.art !== ART_VORLAGE) return [`unbekannte art '${String(e.art)}' (erlaubt: ${ART_VORLAGE})`];
  const f = [];
  if (e.block !== undefined || e.schluessel !== undefined) f.push("art vorlage nur an einer ganzen Datei (kein block, kein schluessel)");
  if (e.pflichtChecks !== undefined) f.push("art vorlage trägt keine pflichtChecks");
  return f;
}

/** Pfad-Form für `--uebernehmen`: Schrägstriche, ohne führendes `./`. */
export const normalisiereUebernahmePfad = (p) => p.replace(/\\/g, "/").replace(/^(\.\/)+/, "");

/** Zahl abweichender Zeilen zweier LF-Texte: je Seite die Zeilen außerhalb der längsten gemeinsamen Teilfolge, gezählt wird die größere Seite (eine geänderte Zeile ist 1, eine angehängte oder fehlende Zeile ebenfalls 1). */
export function abweichendeZeilen(aLf, bLf) {
  const a = aLf.split("\n");
  const b = bLf.split("\n");
  let von = 0;
  while (von < a.length && von < b.length && a[von] === b[von]) von++;
  let bisA = a.length;
  let bisB = b.length;
  while (bisA > von && bisB > von && a[bisA - 1] === b[bisB - 1]) {
    bisA--;
    bisB--;
  }
  const x = a.slice(von, bisA);
  const y = b.slice(von, bisB);
  let vor = new Array(y.length + 1).fill(0);
  for (const zx of x) {
    const jetzt = [0];
    for (let j = 1; j <= y.length; j++) jetzt[j] = zx === y[j - 1] ? vor[j - 1] + 1 : Math.max(vor[j], jetzt[j - 1]);
    vor = jetzt;
  }
  const lcs = vor[y.length];
  return Math.max(x.length - lcs, y.length - lcs);
}

/**
 * Erst-Übernahme-Prüfung. `kandidaten`: ganze, verteilte Besitz-Dateien als `{ pfad, zielLf, ergebnis }` (beide LF, `zielLf` ist `null`, wenn das Ziel fehlt);
 * `altEinheiten`: Einheiten-IDs des alten Sync-Stands (Pfad einer ganzen Datei = ID); `uebernehmen`: freigegebene Pfade.
 * Ergebnis `{ fehler, hinweise }`: jede abweichende, noch nicht übernommene Datei eine `ABGLEICH`-Zeile, dazu eine Weg-Zeile.
 */
export function erstUebernahme({ kandidaten, altEinheiten, uebernehmen }) {
  const frei = new Set(uebernehmen.map(normalisiereUebernahmePfad));
  const bekannt = new Set(kandidaten.map((k) => k.pfad));
  const alt = new Set(altEinheiten);
  const fehler = [];
  const hinweise = [];
  for (const p of frei) {
    if (!bekannt.has(p)) fehler.push(`--uebernehmen '${p}': keine ganze, verteilte Besitz-Datei im Manifest (Tippfehler, Vorlage oder Teil-Einheit)`);
  }
  const offen = [];
  for (const k of kandidaten) {
    if (alt.has(k.pfad) || k.zielLf === null || k.zielLf === k.ergebnis) {
      if (frei.has(k.pfad)) hinweise.push(`--uebernehmen '${k.pfad}' ohne Wirkung (kein Abgleich nötig)`);
      continue;
    }
    if (frei.has(k.pfad)) {
      hinweise.push(`Erst-Übernahme: '${k.pfad}' mit eigener Fassung des Ziels übernommen (abweichende Zeilen: ${abweichendeZeilen(k.zielLf, k.ergebnis)})`);
      continue;
    }
    offen.push(k.pfad);
    fehler.push(`ABGLEICH ${k.pfad}: Ziel hat eine eigene Fassung (abweichende Zeilen: ${abweichendeZeilen(k.zielLf, k.ergebnis)})`);
  }
  if (offen.length > 0) fehler.push(`ABGLEICH Weg: Fassung prüfen und die Datei mit --uebernehmen <pfad> freigeben (wiederholbar): ${offen.map((p) => `--uebernehmen ${p}`).join(" ")}`);
  return { fehler, hinweise };
}
