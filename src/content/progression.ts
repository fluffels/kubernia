/* ===== Inhalte: Fortschritt & Shop =====
 * Ränge (XP-Schwellen) und Shop-Angebot. Reine Daten, ohne Logik.
 *
 * NPC-Stammdaten sind seit #348 Content-as-Data und leben als JSON in
 * `./data/npcs.json` (geladen vom validierenden `./loader.ts`), nicht mehr hier.
 */

/* ---------- Ränge (geschlechtsneutral) ---------- */
export const RANKS = [
  { xp: 0,    name: "Landratte",  icon: "🦔" },
  { xp: 110,  name: "Moses",      icon: "🧽" },
  { xp: 280,  name: "Deckshand",  icon: "🧹" },
  { xp: 520,  name: "Matrose",    icon: "⚓" },
  { xp: 820,  name: "Maat",       icon: "🪢" },
  { xp: 1200, name: "Steuermaat", icon: "☸️" },
  { xp: 1700, name: "Navigator",  icon: "🧭" },
  { xp: 2300, name: "Käpt'n",     icon: "🫡" },
  { xp: 3000, name: "Admiral",    icon: "🏅" },
];

/* ---------- Shop ---------- */
export const SHOP = [
  { id: "fernrohr", icon: "🔭", name: "Hinweis-Fernrohr", price: 25, type: "consumable",
    desc: "Zeigt dir im Terminal einen Hinweis zur aktuellen Aufgabe. Einmal benutzbar." },
  { id: "kompass", icon: "🧭", name: "Lösungs-Kompass", price: 50, type: "consumable",
    desc: "Verrät dir im Terminal die komplette Lösung der aktuellen Aufgabe. Einmal benutzbar." },
  { id: "pet-ratte", icon: "🐀", sprite: 124, tex: "pet_ratte", name: "Hafenratte Taki", price: 150, type: "pet",
    desc: "Folgt dir überallhin. Hat schon mehr Häfen gesehen als jeder Admiral." },
  { id: "pet-fledermaus", icon: "🦇", sprite: 120, tex: "pet_fledermaus", name: "Fledermaus Echo", price: 250, type: "pet",
    desc: "Flattert hinter dir her. Findet jeden Weg – auch im Dunkeln." },
  { id: "pet-geist", icon: "👻", sprite: 121, tex: "pet_geist", name: "Archiv-Geist Plotter", price: 400, type: "pet",
    desc: "Spukt seit Jahren im Kartenhaus. Kennt YAML auswendig. Gruselig." },
  { id: "flagge-lila", icon: "🟪", color: 0x9b6bdf, name: "Lila Schiffsflagge", price: 80, type: "flag",
    desc: "Dein Schiff am Pier zeigt Flagge – in Edel-Lila." },
  { id: "flagge-gruen", icon: "🟩", color: 0x6fdc8c, name: "Grüne Schiffsflagge", price: 80, type: "flag",
    desc: "Grün wie ein frisch deploytes Release." },
  { id: "flagge-pirat", icon: "🏴‍☠️", color: 0x202028, name: "Piratenflagge", price: 150, type: "flag",
    desc: "Arrr! Streng genommen nicht erlaubt. Ole drückt ein Auge zu." },
  { id: "kanone", icon: "💣", name: "Hafen-Kanone", price: 300, type: "upgrade",
    desc: "Steht danach am Dock. Piraten-Überfälle bringen dir +50% Kopfgeld." },
];
