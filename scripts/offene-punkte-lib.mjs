// Kein Shebang, kein Direktaufruf: Lib für `offene-punkte.mjs` (factory#152), pur (kein Dateizugriff, kein `gh`): die Quellen kommen als Daten herein.
//
// Die Sicht „Offene Punkte der Maintainerin“: vier Gruppen in fester Reihenfolge (geschlossene Liste `GRUPPEN`), je Punkt mit Link:
//   entscheidung     offene Issues und PRs mit `labels.entscheidung` (ohne die aus `nicht-eintragbar`); fehlt der Schlüssel: NICHT PRÜFBAR
//   festgefahren     offene Issues und PRs mit `labels.festgefahren`
//   nicht-eintragbar offene Issues mit Titelpräfix `NICHT_EINTRAGBAR_PRAEFIX` von einem vertrauten Autor (Befund, der sein Ziel-Repo nicht erreichte)
//   bezieher         Kommentare in offenen Sammeltickets, deren letzte nicht-leere Zeile eine Stand-Zeile ist (Meldungen von Beziehern, `istStandZeile`)
// Fremdtext ist Daten: ein Titel erscheint nur bei vertrautem Autor, eine fremde Bezieher-Meldung nur mit Autor und Link, nie mit Text.
// Eine nicht lesbare Quelle macht die betroffenen Gruppen zu NICHT PRÜFBAR (`status: "nicht-pruefbar"` mit Grund und Fix), nie zu „keine“.
//
// JSON-Vertrag (`--json`, das spätere Cockpit-Panel baut darauf):
//   { repo, gruppen: [{ id, titel, status: "ok"|"nicht-pruefbar", grund, fix, punkte: [{ art: "issue"|"pr"|"kommentar", nr, titel, url }] }] }
// `grund`/`fix` sind bei `ok` leer (`""`); `punkte` ist bei `nicht-pruefbar` leer. Exit-Code der CLI: `exitCode`.
import { istStandZeile } from "./meldung-lib.mjs";
import { istVertraut } from "./fremdtext-lib.mjs";
import { labelAus } from "./projekt-config-lib.mjs";

/** Titelpräfix eines Issues, das einen Befund festhält, der sein Ziel-Repo nicht erreichte (Weg: ADR 0031, Fortschreibung zu factory#152). */
export const NICHT_EINTRAGBAR_PRAEFIX = "Nicht eintragbar: ";

/** Die Gruppen in fester Reihenfolge. */
export const GRUPPEN = Object.freeze([
  { id: "entscheidung", titel: "Entscheidung nötig" },
  { id: "festgefahren", titel: "Festgefahren" },
  { id: "nicht-eintragbar", titel: "Nicht eintragbare Befunde" },
  { id: "bezieher", titel: "Bezieher-Befunde" },
]);

const labelName = (l) => (typeof l === "string" ? l : l?.name);
const hatLabel = (i, label) => (i.labels ?? []).some((l) => labelName(l) === label);
const art = (i) => (i.pull_request ? "pr" : "issue");
const login = (user) => (typeof user?.login === "string" && user.login !== "" ? user.login : "unbekannt");
const ownerAus = (config) => String(config?.repo ?? "").split("/")[0];

/** Pur: das Ergebnis einer Gruppe; `grund` (nicht lesbar) setzt `NICHT PRÜFBAR`. */
const gruppe = (id, { punkte = [], grund = "", fix = "" } = {}) => ({
  id,
  titel: GRUPPEN.find((g) => g.id === id).titel,
  status: grund === "" ? "ok" : "nicht-pruefbar",
  grund,
  fix,
  punkte,
});

const ARTNAME = { issue: "Issue", pr: "PR", kommentar: "Kommentar" };

/** Pur: ein Punkt aus einem REST-Issue/-PR; der Titel nur bei vertrautem Autor. */
function punktAus(i, owner) {
  const a = art(i);
  const titel = istVertraut(i.user, owner) ? String(i.title ?? "") : `[Titel ausgeblendet: ${ARTNAME[a]} von @${login(i.user)}]`;
  return { art: a, nr: i.number, titel, url: i.html_url };
}

const istNichtEintragbar = (i, owner) => !i.pull_request && istVertraut(i.user, owner) && String(i.title ?? "").startsWith(NICHT_EINTRAGBAR_PRAEFIX);

/** Pur: Gruppe `entscheidung` (`label`: `labels.entscheidung` oder leer = nicht gesetzt). */
function entscheidungGruppe(issues, label, owner) {
  if (typeof label !== "string" || label === "") return gruppe("entscheidung", { grund: "labels.entscheidung fehlt in der Projekt-Config", fix: "labels.entscheidung in der Projekt-Config eintragen" });
  const punkte = issues.filter((i) => hatLabel(i, label) && !istNichtEintragbar(i, owner)).map((i) => punktAus(i, owner));
  return gruppe("entscheidung", { punkte });
}

/** Pur: Gruppe `festgefahren` (`label` aus der Config). */
function festgefahrenGruppe(issues, label, owner) {
  return gruppe("festgefahren", { punkte: issues.filter((i) => hatLabel(i, label)).map((i) => punktAus(i, owner)) });
}

/** Pur: Gruppe `nicht-eintragbar`. */
function nichtEintragbarGruppe(issues, owner) {
  return gruppe("nicht-eintragbar", { punkte: issues.filter((i) => istNichtEintragbar(i, owner)).map((i) => punktAus(i, owner)) });
}

/** Pur: die offenen Sammeltickets (Titel aus `titelListe`, vertrauter Autor) aus der Issue-Liste (ohne PRs). */
export function sammeltickets(issues, titelListe, owner) {
  return issues.filter((i) => !i.pull_request && titelListe.includes(i.title) && istVertraut(i.user, owner));
}

const letzteZeile = (text) => String(text ?? "").split(/\r?\n/).map((z) => z.trim()).filter((z) => z !== "").pop();

/** Pur: die Bezieher-Meldungen eines Sammeltickets aus seinen Kommentaren. */
function meldungenAus(ticket, kommentare, owner) {
  return kommentare
    .filter((k) => istStandZeile(letzteZeile(k.body)))
    .map((k) => {
      const vertraut = istVertraut(k.user, owner);
      const titel = vertraut ? `@${login(k.user)} · ${letzteZeile(k.body)}` : `@${login(k.user)} · Fremdtext ausgeblendet, Sichtung nötig`;
      return { art: "kommentar", nr: ticket.number, titel, url: k.html_url };
    });
}

/**
 * Pur: Gruppe `bezieher`. `sammel`: die Sammeltickets (`sammeltickets`) oder `null` (nicht ermittelbar), `kommentare`: Map Nummer → Kommentarliste
 * oder `{ fehler: "<Text>" }` bei einem Abruffehler (jeder fehlende oder fehlerhafte Abruf macht die Gruppe NICHT PRÜFBAR).
 */
function bezieherGruppe(sammel, kommentare, owner) {
  const fix = "gh-Anmeldung und Leserecht auf das Repo prüfen, dann erneut aufrufen";
  if (sammel === null) return gruppe("bezieher", { grund: "Sammeltickets nicht ermittelbar (Titel der Sammeltickets nicht ladbar)", fix });
  const punkte = [];
  for (const t of sammel) {
    const k = kommentare.get(t.number);
    if (!Array.isArray(k)) return gruppe("bezieher", { grund: `Kommentare von #${t.number} nicht lesbar: ${k?.fehler ?? "kein Abruf"}`, fix });
    punkte.push(...meldungenAus(t, k, owner));
  }
  return gruppe("bezieher", { punkte });
}

/**
 * Pur: alle vier Gruppen. `config`: Projekt-Config (`repo`, `labels`); `issues`: die offenen Issues und PRs (REST-Form) oder `{ fehler }`, wenn der Abruf
 * scheiterte (dann sind alle Gruppen NICHT PRÜFBAR); `sammel` und `kommentare` wie bei `bezieherGruppe`; `stelleOwner`: Besitzer der Meldestelle (vertraute Autoren der
 * Bezieher-Meldungen, Standard der Besitzer von `config.repo`); `bezieherFehler` (nicht leer): die Meldestelle war nicht bestimmbar oder nicht lesbar, nur `bezieher` ist NICHT PRÜFBAR.
 */
export function baueSicht({ config, issues, sammel = null, kommentare = new Map(), stelleOwner = "", bezieherFehler = "" }) {
  const repo = String(config?.repo ?? "");
  if (!Array.isArray(issues)) {
    const grund = `offene Issues und PRs nicht lesbar: ${issues?.fehler ?? "kein Abruf"}`;
    const fix = "gh-Anmeldung und Leserecht auf das Repo prüfen, dann erneut aufrufen";
    return { repo, gruppen: GRUPPEN.map((g) => gruppe(g.id, { grund, fix })) };
  }
  const owner = ownerAus(config);
  let festgefahren;
  try {
    festgefahren = festgefahrenGruppe(issues, labelAus(config, "festgefahren"), owner);
  } catch {
    festgefahren = gruppe("festgefahren", { grund: "labels.festgefahren fehlt in der Projekt-Config", fix: "labels.festgefahren in der Projekt-Config eintragen" });
  }
  return {
    repo,
    gruppen: [
      entscheidungGruppe(issues, config?.labels?.entscheidung, owner),
      festgefahren,
      nichtEintragbarGruppe(issues, owner),
      bezieherFehler === "" ? bezieherGruppe(sammel, kommentare, stelleOwner === "" ? owner : stelleOwner) : gruppe("bezieher", { grund: bezieherFehler, fix: "gh-Anmeldung und Leserecht auf die Meldestelle prüfen (Schlüssel `meldestelle` der Projekt-Config), dann erneut aufrufen" }),
    ],
  };
}

/** Pur: Exit-Code der Sicht: 0 = alle Gruppen prüfbar (auch mit offenen Punkten), 1 = mindestens eine NICHT PRÜFBAR. */
export const exitCode = (sicht) => (sicht.gruppen.some((g) => g.status !== "ok") ? 1 : 0);

/** Pur: die Textausgabe: je Gruppe Kopfzeile (Anzahl, `keine` oder `NICHT PRÜFBAR: <Grund>` mit `Fix:`), darunter je Punkt `#nr Titel — URL`, am Ende die Summe. */
export function alsText(sicht) {
  const zeilen = [`Offene Punkte der Maintainerin (${sicht.repo})`];
  for (const g of sicht.gruppen) {
    if (g.status !== "ok") {
      zeilen.push(`${g.titel}: NICHT PRÜFBAR: ${g.grund}`, `  Fix: ${g.fix}`);
      continue;
    }
    zeilen.push(`${g.titel}: ${g.punkte.length === 0 ? "keine" : g.punkte.length}`);
    for (const p of g.punkte) zeilen.push(`  #${p.nr} ${p.titel} — ${p.url}`);
  }
  const offen = sicht.gruppen.reduce((n, g) => n + g.punkte.length, 0);
  const unklar = sicht.gruppen.filter((g) => g.status !== "ok").length;
  zeilen.push(`Summe: ${offen} offene Punkte${unklar > 0 ? `, ${unklar} Gruppe(n) NICHT PRÜFBAR` : ""}`);
  return zeilen.join("\n");
}

/** Pur: die JSON-Ausgabe (Vertrag im Kopfkommentar). */
export const alsJson = (sicht) => JSON.stringify(sicht, null, 2);
