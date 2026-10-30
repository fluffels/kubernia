// Rollen-SSOT für Codex-Generierung, Quellenprüfung und Belegdiagnose; kein Einstieg.
const ROLLEN = [
  ["planer", "factory-planer", "Plane nur; keine Umsetzung.", "high"],
  ["umsetzer", "factory-umsetzer", "Setze den übergebenen Plan um.", "medium"],
  ["lens", "factory-lens", "Prüfe die beauftragte Brille. Sabotage ausschließlich im eigenen isolierten Lens-Worktree; Feature-Worktree nur lesen.", "high"],
  ["gruppe", "factory-gruppe", "Bearbeite nur die beauftragte Gruppe im gemeinsamen Worktree.", "medium"],
  ["explore", "explore", "Erkunde gezielt; keine Änderungen.", "medium"],
  ["holdout-szenario", "holdout-szenario", "Leite Szenarien allein aus dem übergebenen Ticket ab; beschaffe keine Quellen und nutze keine Tools.", "high"],
  ["holdout-abnahme", "holdout-abnahme", "Prüfe nur das Ergebnis gegen die Kriterien; lies keinen Implementierungscode.", "high"],
];
const nameGueltig = n => typeof n === "string" && n.trim() === n && /^[a-z][a-z0-9-]{0,63}$/.test(n);
export function rollenFuer(config) {
  const rollen = ROLLEN.map(([key, quelle, aufgabe, effort]) => ({
    name: key.includes("-") || key === "explore" ? key : config.agenten?.[key], quelle, aufgabe, effort,
    ohneShell: key === "holdout-szenario",
  }));
  if (rollen.some(r => !nameGueltig(r.name)) || new Set(rollen.map(r => r.name)).size !== rollen.length) throw new Error("Fehlender, doppelter oder ungültiger Rollenname");
  return rollen;
}
