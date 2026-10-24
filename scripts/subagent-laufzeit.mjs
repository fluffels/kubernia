// Kein Shebang: wird per `node scripts/subagent-laufzeit.mjs` gestartet UND von test/subagent-laufzeit.test.ts importiert.
/**
 * Laufzeit eines Subagent-Typs (#1382), z. B. der Planer-Laufzeit aus docs/model-routing.md § Planer-Laufzeit.
 *
 *   node scripts/subagent-laufzeit.mjs --von <ISO> [--bis <ISO>] [--agent <name> | --typen] [--ticket <nr>…] [--ohne <nr>…] [--schnitt <ISO>] [--projekt <slug>] [--json]
 *
 * Ohne `--agent` gilt der Planer der Projekt-Config (`agenten.planer`); fehlt er oder die Config, endet das CLI mit Exit 1 und der Meldung samt `Fix:`-Zeile (kein Standardname, fail-closed).
 *
 * `--typen` (#1668) statt `--agent`: Rollen-Übersicht über alle Typen (`typenUebersicht`), je `agentType` (fehlend oder kein String: `unbekannt`) Läufe, offene, Requests, Σ Kosten (aufgezeichnet) und
 * Σ geschätzt getrennt (`-` ohne bepreisten Lauf), Läufe ohne Preis und Modelle; offene Läufe zählen mit. `--typen` mit `--agent` oder `--schnitt` ist ein Aufruf-Fehler.
 *
 * `--ticket`/`--ohne` (wiederholbar) lassen Läufe eines Tickets ein- bzw. ausschließen, bevor `parallel` und das Aggregat gerechnet werden (z. B. Gegenprobe-Läufe).
 * Liest nur `<session>/subagents/*.meta.json` mit passendem `agentType` (mit `--typen` alle) und deren JSONL (nicht alle Haupttranskripte).
 * Je Lauf: Ticket (`<praefixe.worktree><nr>` im Patch-Pfad, sonst Worktree, sonst erstes `#<nr>` im Prompt; `ticketAusLauf`), Sammelticket (`(gesammelt)` im Prompt, Heuristik), Start, Ende, Dauer, Requests,
 * die verschiedenen `model` der Calls (`modelle`, sortiert), die Transkriptdatei relativ zum Projektordner (`datei`, `null` ohne; mit Transkriptordner zusätzlich `session`, die Session-ID), Toolzeit (Vereinigung der Intervalle von `tool_use` bis `tool_result`), Modellzeit (Dauer minus Toolzeit), größter Kontext und
 * Sekunden Modellzeit je Request (`sProRequest`, `null` ohne Request), Kosten in $ (`kosten`, Summe der Call-Preise aus PRICES, `null` bei einem Call ohne Preis; nur
 * aufgezeichnete Usage: Output-Tokens im Transkript stehen auf dem Stand von `message_start`, die Output-Kosten sind unterschätzt, Kinder-Läufe zählen nicht mit) und Zahl der parallel laufenden Läufe desselben Typs. Für Lens-Läufe (#1582) zusätzlich: Beschreibung, `brille`, `runde`, `deltaArt` (`null` ohne Delta-Patch-Pfad im Prompt (gelabelt oder `<praefixe.worktree><nr>-r<n>-delta.patch`), `merge`, `fix`), `promptZeichen`, `ersterCall` und `patch` (Zugriffe auf den vollen und den Delta-Patch, siehe patch-zugriff.mjs). Aggregat: Median je UTC-Tag (alle Läufe, `sammelN` = darin enthaltene Sammeltickets), alt/neu am Schnitt (Start ab Schnitt = neu,
 * alle Läufe; Sammeltickets zusätzlich getrennt). Ein Lauf ohne Ende (letzter `tool_use` ohne Ergebnis) gilt als offen und zählt nicht in die Mediane.
 *
 * Aufzeichnungsbasis: Die Tabelle nennt je Gruppe `Kosten geschätzt ($, Median)` und die `Output-Quote` (aufgezeichneter / geschätzter Output, `outputQuote`, `null` ohne geschätzten Output). Weichen die Quoten
 * von alt und neu (mit `--schnitt`) oder die Spanne der Tagesquoten (nur Tage und Seiten mit mindestens `BASIS_MIN_N` = 5 Läufen) um mehr als `BASIS_SPRUNG` (0,2) ab, hat die Output-Aufzeichnung im Transkript gewechselt: `aggregat.basisWarnung` (auch in `--json`, sonst `null`)
 * und eine Zeile „Hinweis Aufzeichnungsbasis“ unter der Tabelle sagen, dass aufgezeichnete Kosten über diese Gruppen nicht vergleichbar sind; verglichen wird dann nur geschätzt.
 *
 * Je Gruppe nennt die Spalte `Tickets` die verschiedenen Tickets; hat ein Ticket mehrere Läufe, steht unter der Tabelle eine Warnzeile (Mediane je Lauf, nicht je Ticket; #1646).
 *
 * Pur und ohne IO bis auf das CLI; der Kern ist getestet. Läufe aus den Transkripten stehen in subagent-laeufe.mjs.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { median, mehrlaufHinweis, passtTicketFilter, TICKET_OPTIONEN, ticketFilterAus, ticketMeldung, ticketZaehlung } from "./mess-lib.mjs";
import { flagsLesen } from "./flag-lib.mjs";
import { namenOderGrund } from "./ticket-namen.mjs";
import { projektOrdner } from "./transkript.mjs";
import { ladeAlleLaeufe, ladeLaeufe, laufAus, ms } from "./subagent-laeufe.mjs";

const tagVon = (t) => new Date(t).toISOString().slice(0, 10);
// Summe nur über vorhandene Werte; ohne einen solchen null (nie 0 $ für ein unbekanntes Modell), wie typZeile.
const summeOderNull = (werte) => {
  const da = werte.filter((x) => x !== null);
  return da.length ? da.reduce((s, x) => s + x, 0) : null;
};
const stat = (laeufe) => {
  const s = statRoh(laeufe);
  // Anteil des aufgezeichneten am geschätzten Output (`null` ohne geschätzten Output).
  return { ...s, outputQuote: s.outputGeschaetzt > 0 ? s.output / s.outputGeschaetzt : null };
};
const statRoh = (laeufe) => ({
  n: laeufe.length,
  // Verschiedene Tickets und die mit mehr als einem Lauf (#1646): die Mediane gelten je Lauf, nicht je Ticket.
  ...ticketZaehlung(laeufe),
  dauerMin: median(laeufe.map((l) => l.dauerMin)),
  modellMin: median(laeufe.map((l) => l.modellMin)),
  toolMin: median(laeufe.map((l) => l.toolMin)),
  requests: median(laeufe.map((l) => l.requests)),
  // Median und Summe nur über Läufe mit Preis; `ohnePreis` zählt die übrigen (kein 0 $ für ein unbekanntes Modell).
  kosten: median(laeufe.map((l) => l.kosten).filter((x) => x !== null)),
  kostenSumme: summeOderNull(laeufe.map((l) => l.kosten)),
  // Mit dem aus dem Kontext-Zuwachs geschätzten Output (#1568); `kosten` bleibt der aufgezeichnete Wert.
  kostenGeschaetzt: median(laeufe.map((l) => l.kostenGeschaetzt ?? null).filter((x) => x !== null)),
  kostenGeschaetztSumme: summeOderNull(laeufe.map((l) => l.kostenGeschaetzt ?? null)),
  output: laeufe.reduce((n, l) => n + (l.output ?? 0), 0),
  outputGeschaetzt: laeufe.reduce((n, l) => n + (l.outputGeschaetzt ?? 0), 0),
  ohnePreis: laeufe.filter((l) => l.kosten === null).length,
  // Läufe ohne Request haben keinen Wert je Request (kein Infinity/NaN im Median).
  sProRequest: median(laeufe.map((l) => l.sProRequest).filter((x) => x !== null)),
  parallel: median(laeufe.map((l) => l.parallel)),
  maxKontext: median(laeufe.map((l) => l.maxKontext)),
  maxDauerMin: laeufe.length ? Math.max(...laeufe.map((l) => l.dauerMin)) : null,
});

/** Mindestzahl Läufe je Tag (und je Schnitt-Seite), damit deren Output-Quote in den Vergleich der Basiswarnung eingeht: wenige Läufe schwanken von Natur aus. */
export const BASIS_MIN_N = 5;
/** Quoten (aufgezeichneter / geschätzter Output) weiter als dies auseinander: die Aufzeichnungsbasis hat gewechselt, aufgezeichnete Kosten sind nicht vergleichbar. */
const BASIS_SPRUNG = 0.2;
const prozent = (q) => `${Math.round(q * 100)} %`;
// Auf drei Stellen gerundet, damit genau 0,2 Abstand nicht an Gleitkomma-Rauschen warnt.
const spruenge = (a, b) => Math.round(Math.abs(a - b) * 1000) / 1000 > BASIS_SPRUNG;
const BASIS_HINWEIS = "aufgezeichnete Kosten über diese Gruppen nicht vergleichbar, nur „geschätzt“ vergleichen.";

/** Warnzeile zur Aufzeichnungsbasis oder `null`: Schnitt-Vergleich (alt/neu) zuerst, sonst die Spanne der Tagesquoten. */
function basisWarnung(aggregat) {
  const { alt, neu } = aggregat;
  const tragfaehig = (s) => s.n >= BASIS_MIN_N && s.outputQuote !== null;
  if (alt && neu && tragfaehig(alt) && tragfaehig(neu) && spruenge(alt.outputQuote, neu.outputQuote)) {
    return `Hinweis Aufzeichnungsbasis: Output-Aufzeichnung schwankt (alt ${prozent(alt.outputQuote)}, neu ${prozent(neu.outputQuote)}): ${BASIS_HINWEIS}`;
  }
  const tage = aggregat.jeTag.filter(tragfaehig);
  if (tage.length < 2) return null;
  const sortiert = [...tage].sort((a, b) => a.outputQuote - b.outputQuote);
  const klein = sortiert[0];
  const gross = sortiert[sortiert.length - 1];
  if (!spruenge(klein.outputQuote, gross.outputQuote)) return null;
  return `Hinweis Aufzeichnungsbasis: Output-Aufzeichnung schwankt (Tage ${klein.tag} ${prozent(klein.outputQuote)} bis ${gross.tag} ${prozent(gross.outputQuote)}): ${BASIS_HINWEIS}`;
}

/** Ein Lauf liegt im Fenster [von, bis] (Start) und passt zum Ticket-Filter (#1693, gemeinsam für laufzeiten und typenUebersicht). */
const imFenster = (l, { von, bis, tickets, ohne }) => passtTicketFilter(l.ticket, { tickets, ohne }) && (!von || l.start >= ms(von)) && (!bis || l.start <= ms(bis));

/**
 * Kern: Läufe aus `{ meta, zeilen }` des gewünschten `agentType` im Fenster [von, bis] (Start) → Läufe plus Aggregat. `namen` = Ticket-Namen aus der Projekt-Config
 * (`ticket-namen.mjs`), ohne `agent` gilt `namen.agenten.planer`; ohne beides wirft die Funktion.
 * @param {{ laeufe: { meta: object, zeilen: object[], datei?: string, session?: string }[], namen: object, agent?: string, von?: string, bis?: string, schnitt?: string, tickets?: number[], ohne?: number[] }} e
 */
export function laufzeiten({ laeufe, namen, agent = namen?.agenten?.planer, von, bis, schnitt, tickets = [], ohne = [] }) {
  if (typeof agent !== "string" || agent === "") throw new Error("laufzeiten braucht den Agenten-Typ: `agent` oder namen.agenten.planer");
  const alle = laeufe
    .filter((l) => l?.meta?.agentType === agent)
    .map((l) => laufAus(l, namen))
    .filter(Boolean)
    .filter((l) => imFenster(l, { von, bis, tickets, ohne }))
    .sort((a, b) => a.start - b.start);
  for (const l of alle) l.parallel = alle.filter((o) => o !== l && o.start < l.ende && o.ende > l.start).length;
  const gemessen = alle.filter((l) => !l.offen);
  const ohneSammel = gemessen.filter((l) => !l.sammel);
  const tage = [...new Set(gemessen.map((l) => tagVon(l.start)))].sort();
  const je = (liste) => stat(liste);
  const aggregat = {
    gesamt: je(gemessen),
    ohneSammel: je(ohneSammel),
    sammel: je(gemessen.filter((l) => l.sammel)),
    jeTag: tage.map((t) => ({ tag: t, sammelN: gemessen.filter((l) => l.sammel && tagVon(l.start) === t).length, ...je(gemessen.filter((l) => tagVon(l.start) === t)) })),
    offen: alle.length - gemessen.length,
  };
  if (schnitt) {
    const s = ms(schnitt);
    aggregat.alt = je(gemessen.filter((l) => l.start < s));
    aggregat.neu = je(gemessen.filter((l) => l.start >= s));
    aggregat.neuSammel = je(gemessen.filter((l) => l.sammel && l.start >= s));
    aggregat.altSammel = je(gemessen.filter((l) => l.sammel && l.start < s));
    aggregat.altOhneSammel = je(ohneSammel.filter((l) => l.start < s));
    aggregat.neuOhneSammel = je(ohneSammel.filter((l) => l.start >= s));
  }
  aggregat.basisWarnung = basisWarnung(aggregat);
  return { agent, laeufe: alle.map((l) => ({ ...l, start: new Date(l.start).toISOString(), ende: new Date(l.ende).toISOString() })), aggregat };
}

const TYP_UNBEKANNT = "unbekannt";
const typZeile = (agentType, liste) => {
  const bepreist = liste.filter((l) => l.kosten !== null);
  const geschaetzt = liste.filter((l) => l.kostenGeschaetzt !== null);
  return {
    agentType,
    n: liste.length,
    offen: liste.filter((l) => l.offen).length,
    requests: liste.reduce((n, l) => n + l.requests, 0),
    // Summe nur über Läufe mit Preis; ohne einen solchen Lauf null (nie 0 $ für ein unbekanntes Modell).
    kostenSumme: bepreist.length ? bepreist.reduce((s, l) => s + l.kosten, 0) : null,
    kostenGeschaetztSumme: geschaetzt.length ? geschaetzt.reduce((s, l) => s + l.kostenGeschaetzt, 0) : null,
    ohnePreis: liste.length - bepreist.length,
    modelle: [...new Set(liste.flatMap((l) => l.modelle))].sort(),
  };
};

/**
 * Rollen-Übersicht (#1668): alle Läufe im Fenster [von, bis] (Start) je `agentType`, offene Läufe zählen mit.
 * @param {{ laeufe: { meta: object, zeilen: object[], datei?: string }[], namen: object, von?: string, bis?: string, tickets?: number[], ohne?: number[] }} e
 */
export function typenUebersicht({ laeufe, namen, von, bis, tickets = [], ohne = [] }) {
  const alle = laeufe
    .map((l) => laufAus(l, namen))
    .filter(Boolean)
    .filter((l) => imFenster(l, { von, bis, tickets, ohne }));
  const typ = (l) => (typeof l.agentType === "string" && l.agentType !== "" ? l.agentType : TYP_UNBEKANNT);
  const typNamen = [...new Set(alle.map(typ))].sort((a, b) => (a === TYP_UNBEKANNT) - (b === TYP_UNBEKANNT) || (a < b ? -1 : a > b ? 1 : 0));
  return {
    modus: "typen",
    von: von ?? null,
    bis: bis ?? null,
    typen: typNamen.map((n) => typZeile(n, alle.filter((l) => typ(l) === n))),
    gesamt: typZeile("alle", alle),
  };
}

const f1 = (x) => (x === null ? "-" : x.toFixed(1));
const f2 = (x) => (x === null ? "-" : x.toFixed(2));

/** Markdown: Aggregat-Tabelle und Läufe. */
export function renderMarkdown(r) {
  const out = [`Subagent-Typ \`${r.agent}\`: ${r.laeufe.length} Läufe (${r.aggregat.offen} offen, nicht in den Medianen)`, ""];
  out.push("| Gruppe | n | Dauer (min, Median) | Modell (min) | Tool (min) | Requests | Kosten ($, Median) | Σ Kosten ($) | Σ Kosten geschätzt ($) | ohne Preis | Kosten geschätzt ($, Median) | Output-Quote | s/Req (Modell) | parallel | max. Kontext | längster (min) | Tickets |", "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  const z = (name, s) => out.push(`| ${name} | ${s.n} | ${f1(s.dauerMin)} | ${f1(s.modellMin)} | ${f1(s.toolMin)} | ${s.requests ?? "-"} | ${f2(s.kosten)} | ${f2(s.kostenSumme)} | ${f2(s.kostenGeschaetztSumme ?? null)} | ${s.ohnePreis} | ${f2(s.kostenGeschaetzt ?? null)} | ${s.outputQuote === null || s.outputQuote === undefined ? "-" : prozent(s.outputQuote)} | ${f1(s.sProRequest)} | ${f1(s.parallel)} | ${s.maxKontext === null ? "-" : Math.round(s.maxKontext)} | ${f1(s.maxDauerMin)} | ${s.tickets} |`);
  z("alle gemessenen", r.aggregat.gesamt);
  z("ohne Sammeltickets", r.aggregat.ohneSammel);
  z("Sammeltickets", r.aggregat.sammel);
  for (const t of r.aggregat.jeTag) z(`${t.tag} (davon ${t.sammelN} Sammel)`, t);
  if (r.aggregat.alt) {
    z("alle vor Schnitt", r.aggregat.alt);
    z("alle ab Schnitt", r.aggregat.neu);
    z("ohne Sammel vor Schnitt", r.aggregat.altOhneSammel);
    z("ohne Sammel ab Schnitt", r.aggregat.neuOhneSammel);
    z("Sammel vor Schnitt", r.aggregat.altSammel);
    z("Sammel ab Schnitt", r.aggregat.neuSammel);
  }
  const hinweis = mehrlaufHinweis(r.aggregat.gesamt.mehrlauf);
  if (hinweis) out.push("", hinweis);
  if (r.aggregat.basisWarnung) out.push("", r.aggregat.basisWarnung);
  out.push("", "| Start | Ticket | Sammel | Dauer | Modellzeit | Modell | Tool | Requests | Kosten ($) | s/Req | max. Kontext | parallel |", "|---|--:|---|--:|--:|---|--:|--:|--:|--:|--:|--:|");
  for (const l of r.laeufe) {
    out.push(`| ${l.start} | ${l.ticket ? `#${l.ticket}` : "-"} | ${l.sammel ? "ja" : ""} | ${f1(l.dauerMin)}${l.offen ? " (offen)" : ""} | ${f1(l.modellMin)} | ${l.modelle.length ? l.modelle.join(", ") : "-"} | ${f1(l.toolMin)} | ${l.requests} | ${f2(l.kosten)} | ${f1(l.sProRequest ?? null)} | ${Math.round(l.maxKontext)} | ${l.parallel} |`);
  }
  return out.join("\n");
}

/** Markdown der Rollen-Übersicht. */
export function renderTypen(r) {
  if (!r.gesamt.n) return "keine Läufe im Fenster";
  const out = ["| agentType | Läufe | offen | Requests | Σ Kosten ($, aufgezeichnet) | Σ Kosten geschätzt ($) | ohne Preis | Modelle |", "|---|--:|--:|--:|--:|--:|--:|---|"];
  for (const z of [...r.typen, r.gesamt]) out.push(`| ${z.agentType} | ${z.n} | ${z.offen} | ${z.requests} | ${f2(z.kostenSumme)} | ${f2(z.kostenGeschaetztSumme)} | ${z.ohnePreis} | ${z.modelle.length ? z.modelle.join(", ") : "-"} |`);
  return out.join("\n");
}

// ── CLI (dünn, ungetestet: Dateisuche) ───────────────────────────────────────

/** `namen` liefert den Standard-Agenten (`agenten.planer`), wenn `--agent` fehlt. */
export function parseArgs(argv, namen) {
  const optionen = { von: { type: "string" }, bis: { type: "string" }, agent: { type: "string" }, typen: { type: "boolean" }, ...TICKET_OPTIONEN, schnitt: { type: "string" }, projekt: { type: "string" }, json: { type: "boolean" } };
  const { werte, fehler } = flagsLesen(argv, optionen, { meldung: ticketMeldung });
  // Eine Nicht-Ganzzahl wäre NaN und würde still nichts filtern: Aufruf-Fehler statt falscher Teilmenge.
  const { tickets, ohne, fehler: ticketFehler } = ticketFilterAus(werte);
  const a = { agent: werte.agent ?? namen?.agenten?.planer, json: werte.json === true, typen: werte.typen === true, agentGesetzt: werte.agent !== undefined, tickets, ohne };
  for (const name of ["von", "bis", "schnitt", "projekt"]) if (werte[name] !== undefined) a[name] = werte[name];
  const gefunden = fehler?.text ?? ticketFehler;
  if (gefunden) a.fehler = gefunden;
  // `--typen` zählt über alle Typen und kennt keinen Schnitt: die Kombination wäre still falsch.
  if (a.typen && (a.agentGesetzt || a.schnitt)) a.fehler ??= "--typen gilt für alle Typen und verträgt sich nicht mit --agent oder --schnitt";
  return a;
}


/**
 * Das CLI als Funktion: gibt den Exit-Code zurück (0 ok, 1 Projekt-Config nicht nutzbar, 2 Aufruf-Fehler). Die Namen kommen aus der Projekt-Config
 * (`config` ersetzt das Laden, Test) und werden vor allem anderen geprüft: ohne `agenten.planer` liest es kein Transkript.
 */
export function hauptlauf(argv, { config, ordner = projektOrdner, ladeTyp = ladeLaeufe, ladeAlle = ladeAlleLaeufe, out = console.log, err = console.error } = {}) {
  const r = namenOderGrund("subagent-laufzeit", { config });
  if (r.grund) {
    err(r.grund);
    return 1;
  }
  const namen = r.namen;
  const args = parseArgs(argv, namen);
  if (args.fehler || !args.von) {
    if (args.fehler) err(args.fehler);
    err(`Aufruf: node scripts/subagent-laufzeit.mjs --von <ISO> [--bis <ISO>] [--agent ${namen.agenten.planer} | --typen] [--ticket <nr>…] [--ohne <nr>…] [--schnitt <ISO>] [--projekt <slug>] [--json]`);
    return 2;
  }
  const dir = ordner(args.projekt);
  if (args.typen) {
    const u = typenUebersicht({ laeufe: ladeAlle(dir, args.von), namen, von: args.von, bis: args.bis, tickets: args.tickets, ohne: args.ohne });
    out(args.json ? JSON.stringify(u, null, 2) : renderTypen(u));
    return 0;
  }
  const lz = laufzeiten({ laeufe: ladeTyp(dir, args.agent, args.von), namen, agent: args.agent, von: args.von, bis: args.bis, schnitt: args.schnitt, tickets: args.tickets, ohne: args.ohne });
  out(args.json ? JSON.stringify(lz, null, 2) : renderMarkdown(lz));
  return 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = hauptlauf(process.argv.slice(2));
