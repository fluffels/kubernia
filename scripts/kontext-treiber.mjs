// Kein Shebang: wird per `node scripts/kontext-treiber.mjs` gestartet UND von test/kontext-treiber.test.ts importiert.
/**
 * Kontext-Treiber eines Subagent-Typs (#1559), Standard der Umsetzer der Projekt-Config (`agenten.umsetzer`): was macht den Kontext je Call groß und was kostet es?
 *
 *   node scripts/kontext-treiber.mjs --von <ISO> [--bis <ISO>] [--agent <name>] [--ticket <nr>]… [--ohne <nr>]… [--delta ja|nein] [--brille <name>] [--projekt <slug>] [--je-ticket] [--json]
 *
 * Die Agentennamen (`agenten.umsetzer` als Standard, `agenten.lens` für die Review-Phase) und das Worktree-Präfix kommen aus der Projekt-Config; fehlt sie oder ein Schlüssel, endet das CLI mit Exit 1 und der Meldung samt `Fix:`-Zeile (fail-closed).
 *
 * Je Lauf (Transkript unter `<session>/subagents/`): Requests, Kontext je Call (input + cacheWrite + cacheRead), Kosten (aus PRICES,
 * nur aufgezeichnete Usage: Output unterzählt), Phase je Call, Tool-Ergebnisse mit Größe und Last, Cache-Neuaufbauten mit Ursache.
 *  - Phase (Heuristik, Vorrang von oben): CI-Warten (`gh pr checks`, `pr-warten`, `gh run watch`, `until`-Schleife mit `gh pr view`),
 *    verify (`verify:*`, `vitest`, `eslint`, `typecheck`, `check:*`), sonst der Zustand: Umsetzung → Pflege (zwischen den Markern
 *    `pflege: start/ende`) → Review (ab dem ersten Spawn des Lens-Agenten) → Lens-Fix (Edit/Write im Review) → ab `gh pr create` CI-Fix
 *    (Edit/Write) bzw. Merge/Cleanup. Calls ohne Tool erben den Zustand. Grenze: ein Befehl mit mehreren Zwecken zählt zum ersten Treffer.
 *  - Tokens eines Tool-Ergebnisses = Zeichen / 4 (Konvention aus docs/model-routing.md § Planer-Kosten); Last = Tokens × Zahl der
 *    späteren Calls des Laufs (so oft wird das Ergebnis erneut aus dem Cache gelesen).
 *  - Neuaufbau: Pause > 5 min zum Vorgänger und Cache-Read unter der Hälfte des Kontexts (wie `countCacheRebuilds`); Mehrkosten =
 *    neu geschriebene Tokens × (Write-5m − Read-Preis), ohne Preisstufen.
 *  - Wartepausen (#1588): jede Lücke > 240 s zum Vorgänger-Call, mit Ursache wie beim Neuaufbau und Ticks = Lücke / 240 s abgerundet
 *    (so viele Wach-Calls hätte ein Keep-alive im 4-min-Takt gebraucht); eine Pause ist kein Neuaufbau, der Cache kann gehalten haben.
 * `--je-ticket` (#1592, Phasen-Schnitt): alle Läufe eines Tickets sind ein Lauf. Vorgänger = Läufe ohne `Einstieg:`-Zeile im Prompt, Nachfolger = mit
 * (`Einstieg: pr|verify`, startet im Zustand verify bzw. Merge/Cleanup); Gruppen nach dem `Schnitt:` des Vorgängers (Intention-to-treat). Kennzahlen:
 * Kontext beim ersten Call des Nachfolgers, Nachlese-Calls (Read oder cat/sed/head des Nachfolgers auf Pfade, die ein Vorgänger per Edit/Write geändert hat;
 * grep und andere Lesewege zählen nicht), Kosten ab Phase X (Σ der Calls ab X in `PHASEN`-Reihenfolge). Grenzen: der Startzustand verify zählt Edits vor
 * dem ersten Lens-Spawn zu verify (konservativ gegen den Schnitt); Mehrkosten des Hauptchats für den zweiten Prompt sind nicht gemessen.
 * Offene Läufe (Tool-Aufruf ohne Ergebnis am Ende, #1646) zählen nur als `offen` und stehen in der Tabelle „Läufe"; in keinem Median, keiner Summe.
 * Ohne `--je-ticket` gelten die Mediane je Lauf: der Kopf jeder Gruppe nennt die Zahl der Tickets (`Tickets`), und hat ein Ticket mehrere Läufe, steht eine Warnzeile (`mehrlaufHinweis`, #1646).
 * Im `--je-ticket`-Modus lädt das CLI 48 h vor `--von` (`mitVorlauf`), damit der Vorgänger eines Nachfolgers im Fenster dabei ist.
 * Pur und ohne IO bis auf das CLI. Importiert transkript-calls, preise, brain-metrics, subagent-laeufe; wird selbst nicht importiert.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { readdirSync } from "node:fs";
import { toolEventsFromTranscript } from "./brain-metrics.mjs";
import { callsFromTranscript } from "./transkript-calls.mjs";
import { escapeRegex } from "./ticket-namen.mjs";
import { PRICES, priceFor } from "./preise.mjs";
import { bereinige, istNeuaufbau, kontextVon, median, normPfad, mehrlaufHinweis, passtTicketFilter, TICKET_OPTIONEN, ticketFilterAus, ticketMeldung, ticketZaehlung } from "./mess-lib.mjs";
import { flagsLesen } from "./flag-lib.mjs";
import { namenOderGrund } from "./ticket-namen.mjs";
import { hauptrepoWurzel, projektOrdner } from "./transkript.mjs";
import { ladeLaeufe, laufAus, mitVorlauf } from "./subagent-laeufe.mjs";

const MIN = 60_000;
const PAUSE_MS = 5 * MIN;
const TICK_MS = 4 * MIN;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
export const PHASEN = ["Umsetzung", "Pflege", "verify", "Review", "Lens-Fix", "CI-Warten", "CI-Fix", "Merge/Cleanup"];

const CI_WARTEN = /gh\s+pr\s+checks|pr-warten|gh\s+run\s+watch|until\b[^\n]*gh\s+pr\s+view/;
const VERIFY = /verify:|npm\s+run\s+verify|vitest|eslint|typecheck|check:/;
const num = (x) => (Number.isFinite(x) ? x : 0);
const summe = (liste) => liste.reduce((s, x) => s + x, 0);

const befehlVon = (tool) => (SHELL_TOOLS.has(tool.tool) ? String(tool.input?.command ?? "") : "");
const istLinse = (tool, namen) => tool.tool === "Agent" && String(tool.input?.subagent_type ?? "") === namen.agenten.lens;

/** Kurzbeschreibung eines Tool-Aufrufs für die Top-10 (Tool plus ~60 Zeichen Befehl, Pfad oder Muster). */
function labelVon(tool, wurzel, namen) {
  const i = tool.input ?? {};
  const detail = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.description ?? i.subagent_type ?? "";
  return bereinige(`${tool.tool} ${detail}`, { wurzel, worktree: namen.praefixe.worktree }).slice(0, 70).trim();
}

/** Calls des Laufs mit ihren Tool-Aufrufen und der Phase je Call. */
function phasenUndTools(zeilen, einstieg, namen) {
  if (!namen?.agenten?.lens) throw new Error("Phasen-Erkennung braucht die Ticket-Namen (ticketNamen(config)) als drittes Argument");
  const { calls } = callsFromTranscript(zeilen);
  const events = toolEventsFromTranscript(zeilen);
  const jeCall = new Map();
  for (const ev of events) {
    if (!jeCall.has(ev.msgId)) jeCall.set(ev.msgId, []);
    jeCall.get(ev.msgId).push(ev);
  }
  // Startzustand je Einstieg (#1592): ein Nachfolger beginnt hinter dem Schnitt, nicht in der Umsetzung.
  let zustand = einstieg === "verify" ? "verify" : einstieg === "pr" ? "Merge/Cleanup" : "Umsetzung";
  let pflege = false;
  let review = false;
  let pr = einstieg === "pr";
  const eintraege = calls.map((call) => {
    const tools = jeCall.get(call.id) ?? [];
    let ci = false;
    let verify = false;
    let edit = false;
    for (const tool of tools) {
      const befehl = befehlVon(tool);
      if (/pflege:\s*start/.test(befehl)) pflege = true;
      if (/pflege:\s*ende/.test(befehl)) pflege = false;
      if (/gh\s+pr\s+create/.test(befehl)) pr = true;
      if (istLinse(tool, namen)) {
        review = true;
        zustand = "Review";
      }
      if (EDIT_TOOLS.has(tool.tool)) edit = true;
      if (CI_WARTEN.test(befehl)) ci = true;
      else if (VERIFY.test(befehl)) verify = true;
    }
    if (pr && tools.length) zustand = edit ? "CI-Fix" : "Merge/Cleanup";
    else if (review && edit) zustand = "Lens-Fix";
    const phase = ci ? "CI-Warten" : verify ? "verify" : pflege ? "Pflege" : zustand;
    return { call, tools, phase };
  });
  return eintraege;
}

/** Phase je Call (gleiche Reihenfolge wie `callsFromTranscript`). */
export function phaseDerCalls(zeilen, einstieg, namen) {
  return phasenUndTools(zeilen, einstieg ?? null, namen).map((e) => e.phase);
}

function ursacheVon(vorher, namen) {
  if (!vorher) return "sonstiges";
  if (vorher.phase === "CI-Warten") return "CI-Warten";
  if (vorher.tools.some((t) => istLinse(t, namen)) || (!vorher.tools.length && (vorher.phase === "Review" || vorher.phase === "Lens-Fix"))) return "Lens-Warten";
  if (vorher.phase === "verify") return "verify";
  return "sonstiges";
}

/** Aufeinanderfolgende Call-Paare (#1579): der Vorgänger-Eintrag, der Call und die Lücke zwischen beiden in Millisekunden. */
function paare(eintraege) {
  const liste = [];
  for (let i = 1; i < eintraege.length; i++) {
    liste.push({ vorher: eintraege[i - 1], call: eintraege[i].call, gapMs: Date.parse(eintraege[i].call.ts) - Date.parse(eintraege[i - 1].call.ts) });
  }
  return liste;
}

function neuaufbauten(eintraege, namen) {
  return paare(eintraege)
    .filter(({ call, gapMs }) => istNeuaufbau({ gapMs, pauseMs: PAUSE_MS, call }))
    .map(({ vorher, call }) => {
      const preis = priceFor(call.model, PRICES, call.ts);
      return {
        ursache: ursacheVon(vorher, namen),
        tokens: num(call.cacheWrite),
        mehrkosten: preis ? (num(call.cacheWrite) * (preis.cacheWrite5m - preis.cacheRead)) / 1e6 : null,
      };
    });
}

/** Lücken über 240 s zwischen zwei Calls (#1588): Ursache des Vorgängers, Sekunden, Ticks eines 4-min-Keep-alive. */
function wartepausen(eintraege, namen) {
  return paare(eintraege)
    .filter(({ gapMs }) => gapMs > TICK_MS)
    .map(({ vorher, gapMs }) => ({ ursache: ursacheVon(vorher, namen), sekunden: Math.round(gapMs / 1000), ticks: Math.floor(gapMs / TICK_MS) }));
}

const LESE_BEFEHL = /(^|[\s;&|(])(cat|sed|head)\s/;

/**
 * Pfade, die der Lauf per Edit/Write geändert hat, und seine Lese-Aufrufe (`Read` sowie Shell-Befehle mit cat/sed/head), beide
 * normalisiert (#1592). Grundlage der Nachlese-Calls: ein Nachfolger, der geänderte Dateien des Vorgängers erneut liest.
 */
function pfadZugriffe(eintraege, wurzel, namen) {
  const worktree = namen.praefixe.worktree;
  const geaendertePfade = [];
  const leseAufrufe = [];
  for (const { tools } of eintraege) {
    for (const tool of tools) {
      const datei = tool.input?.file_path;
      if (EDIT_TOOLS.has(tool.tool) && typeof datei === "string") geaendertePfade.push(normPfad(datei, { wurzel, worktree }));
      else if (tool.tool === "Read" && typeof datei === "string") leseAufrufe.push({ art: "read", pfad: normPfad(datei, { wurzel, worktree }) });
      else if (LESE_BEFEHL.test(befehlVon(tool))) leseAufrufe.push({ art: "shell", befehl: befehlVon(tool).replace(/\\/g, "/").toLowerCase() });
    }
  }
  return { geaendertePfade: [...new Set(geaendertePfade)], leseAufrufe };
}


/** Liest der Aufruf diesen (normalisierten) Pfad? Read: gleicher Pfad oder Suffix nach `/`; Shell: Pfad im Befehl, davor kein `[\w.-]`, dahinter kein `\w`. */
function liestPfad(aufruf, pfad) {
  if (aufruf.art === "read") return aufruf.pfad === pfad || aufruf.pfad.endsWith(`/${pfad}`);
  return new RegExp(`(?<![\\w.-])${escapeRegex(pfad)}(?!\\w)`).test(aufruf.befehl);
}

/** Kennzahlen eines Laufs (`{ meta, zeilen }`), `null` ohne Call. `namen` (Ticket-Namen aus der Projekt-Config) ist Pflicht, ohne wirft `laufAus`. */
export function analysiereLauf(lauf, { wurzel = null, namen } = {}) {
  const kopf = laufAus(lauf, namen);
  const eintraege = phasenUndTools(lauf.zeilen, kopf?.einstieg ?? null, namen);
  if (!eintraege.length) return null;
  const { geaendertePfade, leseAufrufe } = pfadZugriffe(eintraege, wurzel, namen);
  const ctx = eintraege.map((e) => kontextVon(e.call));
  const ergebnisse = [];
  const wachstum = { ergebnis: 0, eingabe: 0, rest: 0 };
  eintraege.forEach((e, idx) => {
    const spaeter = eintraege.length - idx - 1;
    let ergTokens = 0;
    let einTokens = 0;
    for (const tool of e.tools) {
      const tokens = Math.round(tool.resultChars / 4);
      ergTokens += tokens;
      einTokens += Math.round(JSON.stringify(tool.input ?? {}).length / 4);
      ergebnisse.push({ label: labelVon(tool, wurzel, namen), tokens, last: tokens * spaeter, phase: e.phase });
    }
    const naechster = idx + 1 < eintraege.length ? ctx[idx + 1] - ctx[idx] : 0;
    if (naechster <= 0) return;
    const erg = Math.min(naechster, ergTokens);
    const ein = Math.min(naechster - erg, einTokens);
    wachstum.ergebnis += erg;
    wachstum.eingabe += ein;
    wachstum.rest += naechster - erg - ein;
  });
  const kosten = eintraege.some((e) => e.call.cost == null) ? null : summe(eintraege.map((e) => e.call.cost));
  const kostenTeile = eintraege.every((e) => e.call.costParts)
    ? {
        read: summe(eintraege.map((e) => e.call.costParts.cacheRead)),
        write: summe(eintraege.map((e) => e.call.costParts.cacheWrite)),
        output: summe(eintraege.map((e) => e.call.costParts.output)),
        input: summe(eintraege.map((e) => e.call.costParts.input)),
      }
    : null;
  return {
    ticket: kopf?.ticket ?? null,
    sammel: kopf?.sammel ?? false,
    offen: Boolean(kopf?.offen),
    sessions: kopf?.session ? [String(kopf.session)] : [],
    brille: kopf?.brille ?? null,
    schnitt: kopf?.schnitt ?? null,
    einstieg: kopf?.einstieg ?? null,
    promptZeichen: kopf?.promptZeichen ?? 0,
    geaendertePfade,
    leseAufrufe,
    delta: Boolean(kopf?.deltaArt),
    start: kopf?.start ?? Date.parse(eintraege[0].call.ts),
    requests: eintraege.length,
    ersterKontext: ctx[0],
    maxKontext: Math.max(...ctx),
    kontextSumme: summe(ctx),
    kosten,
    kostenTeile,
    phasen: eintraege.map((e) => e.phase),
    phasenDetail: eintraege.map((e, i) => ({ phase: e.phase, kontext: ctx[i], kosten: e.call.cost ?? null })),
    ergebnisse,
    neuaufbauten: neuaufbauten(eintraege, namen),
    pausen: wartepausen(eintraege, namen),
    wachstum,
  };
}

/**
 * Kennzahlen der Übergabe über zusammengelegte Tickets (#1592): Nachfolger (Tickets mit mindestens einem), Kontext beim ersten Call
 * des (ersten) Nachfolgers, Nachlese-Calls je Ticket mit Nachfolger und Kosten ab Phase X (Median und Σ über alle Tickets).
 */
function uebergabeKennzahlen(tickets) {
  const mitNachfolger = tickets.filter((a) => a.nachfolgerN > 0);
  const kostenAb = {};
  for (const p of PHASEN) kostenAb[p] = { median: median(tickets.map((a) => a.kostenAb[p])), summe: summe(tickets.map((a) => a.kostenAb[p])) };
  return {
    nachfolger: { n: mitNachfolger.length, ersterKontextMedian: median(mitNachfolger.map((a) => a.ersterKontextNachfolger)) },
    nachlese: { summe: summe(mitNachfolger.map((a) => a.nachlese)), median: median(mitNachfolger.map((a) => a.nachlese)) },
    kostenAb,
  };
}

/** Offene Läufe (Tool-Aufruf ohne Ergebnis am Ende, #1646) zählen nur als `offen`, in keinem Median und keiner Summe. */
function gruppe(alle, { jeTicket = false } = {}) {
  const analysen = alle.filter((a) => !a.offen);
  const offen = alle.length - analysen.length;
  if (!analysen.length) return { gesamt: null, offen, top: [], phasen: {}, neuaufbau: {}, pausen: {}, wachstum: { ergebnis: 0, eingabe: 0, rest: 0 } };
  const requests = summe(analysen.map((a) => a.requests));
  const mitPreis = analysen.filter((a) => a.kosten !== null);
  const phasen = {};
  for (const a of analysen) {
    for (const d of a.phasenDetail) {
      const p = (phasen[d.phase] ??= { calls: 0, kontextSumme: 0, kosten: 0 });
      p.calls += 1;
      p.kontextSumme += d.kontext;
      p.kosten += d.kosten ?? 0;
    }
  }
  const neuaufbau = {};
  for (const a of analysen) {
    for (const n of a.neuaufbauten) {
      const u = (neuaufbau[n.ursache] ??= { n: 0, tokens: 0, mehrkosten: 0 });
      u.n += 1;
      u.tokens += n.tokens;
      u.mehrkosten += n.mehrkosten ?? 0;
    }
  }
  const pausen = {};
  for (const a of analysen) {
    for (const x of a.pausen) {
      const u = (pausen[x.ursache] ??= { n: 0, ticks: 0 });
      u.n += 1;
      u.ticks += x.ticks;
    }
  }
  const teile = mitPreis.map((a) => a.kostenTeile).filter(Boolean);
  const wachstum = { ergebnis: 0, eingabe: 0, rest: 0 };
  for (const a of analysen) for (const k of Object.keys(wachstum)) wachstum[k] += a.wachstum[k];
  return {
    gesamt: {
      n: analysen.length,
      ...ticketZaehlung(analysen),
      requests,
      requestsMedian: median(analysen.map((a) => a.requests)),
      kontextCallGewichtet: summe(analysen.map((a) => a.kontextSumme)) / requests,
      kontextMedianLaeufe: median(analysen.map((a) => a.kontextSumme / a.requests)),
      ersterKontextMedian: median(analysen.map((a) => a.ersterKontext)),
      maxKontextMedian: median(analysen.map((a) => a.maxKontext)),
      kostenMedian: median(mitPreis.map((a) => a.kosten)),
      kostenMittel: mitPreis.length ? summe(mitPreis.map((a) => a.kosten)) / mitPreis.length : null,
      kostenSumme: summe(mitPreis.map((a) => a.kosten)),
      ohnePreis: analysen.length - mitPreis.length,
      kostenRead: summe(teile.map((t) => t.read)),
      kostenWrite: summe(teile.map((t) => t.write)),
      kostenOutput: summe(teile.map((t) => t.output)),
    },
    top: analysen
      .flatMap((a) => a.ergebnisse.map((e) => ({ ...e, ticket: a.ticket })))
      .sort((x, y) => y.last - x.last)
      .slice(0, 10),
    offen,
    phasen,
    neuaufbau,
    pausen,
    wachstum,
    ...(jeTicket ? uebergabeKennzahlen(analysen) : {}),
  };
}

/** Summiert zwei Zähl-Objekte gleicher Schlüssel. */
const addiere = (a, b) => Object.fromEntries(Object.keys(a).map((key) => [key, a[key] + b[key]]));

/** Felder, die ein Ticket-Lauf aus den Läufen summiert bzw. aneinanderhängt (`ersterKontext`, `start`, `ticket` kommen vom ersten Lauf). */
const TICKET_SUMMEN = ["requests", "kontextSumme"];
const TICKET_LISTEN = ["phasen", "ergebnisse", "neuaufbauten", "pausen"];

/**
 * Legt alle Läufe eines Tickets zu einem Lauf zusammen (#1592, `--je-ticket`). Vorgänger = Läufe ohne `einstieg`, Nachfolger = mit;
 * die Gruppe bestimmt der `Schnitt:` des Vorgängers. Summen über alle Läufe, `ersterKontext` und `start` vom ersten; `nachlese` zählt die
 * Lese-Aufrufe der Nachfolger auf Pfade, die ein Vorgänger geändert hat. `null`, wenn kein Vorgänger dabei ist.
 */
function ticketLauf(laeufe) {
  const sortiert = [...laeufe].sort((a, b) => a.start - b.start);
  const vor = sortiert.filter((a) => !a.einstieg);
  const nach = sortiert.filter((a) => a.einstieg);
  if (!vor.length) return null;
  const geaendert = [...new Set(vor.flatMap((a) => a.geaendertePfade))];
  const nachlese = summe(nach.flatMap((a) => a.leseAufrufe).map((l) => (geaendert.some((p) => liestPfad(l, p)) ? 1 : 0)));
  const details = sortiert.flatMap((a) => a.phasenDetail);
  const kostenAb = {};
  for (const p of PHASEN) kostenAb[p] = summe(details.filter((d) => PHASEN.indexOf(d.phase) >= PHASEN.indexOf(p)).map((d) => d.kosten ?? 0));
  const basis = { ...sortiert[0] };
  const summen = Object.fromEntries(TICKET_SUMMEN.map((feld) => [feld, summe(sortiert.map((a) => a[feld]))]));
  const listen = Object.fromEntries(TICKET_LISTEN.map((feld) => [feld, sortiert.flatMap((a) => a[feld])]));
  return {
    ...basis,
    ...summen,
    ...listen,
    sammel: sortiert.some((a) => a.sammel),
    offen: sortiert.some((a) => a.offen),
    sessions: [...new Set(sortiert.flatMap((a) => a.sessions))].sort(),
    brille: null,
    delta: false,
    einstieg: null,
    geaendertePfade: [],
    leseAufrufe: [],
    schnitt: vor.find((a) => a.schnitt)?.schnitt ?? "ohne",
    maxKontext: Math.max(...sortiert.map((a) => a.maxKontext)),
    kosten: sortiert.some((a) => a.kosten === null) ? null : summe(sortiert.map((a) => a.kosten)),
    kostenTeile: sortiert.every((a) => a.kostenTeile) ? sortiert.map((a) => a.kostenTeile).reduce(addiere) : null,
    phasenDetail: details,
    wachstum: sortiert.map((a) => a.wachstum).reduce(addiere),
    nachfolgerN: nach.length,
    promptZeichenNachfolger: summe(nach.map((a) => a.promptZeichen)),
    ersterKontextNachfolger: nach[0]?.ersterKontext ?? null,
    nachlese,
    kostenAb,
  };
}

/** Liste der gezählten Läufe bzw. Tickets (#1646): Start (ISO), Ticket, Sammel, offen. */
const laeufeListe = (analysen, jeTicket = false) =>
  [...analysen].sort((x, y) => x.start - y.start).map((a) => ({
    ticket: a.ticket,
    start: new Date(a.start).toISOString(),
    sammel: a.sammel,
    offen: a.offen,
    sessions: a.sessions,
    // Je Ticket (#1593): Gruppe, Kosten und Nachfolger je Zeile, damit die Ticketlisten je Gruppe aus einem Lauf des Werkzeugs stammen.
    ...(jeTicket ? { schnitt: a.schnitt, kosten: a.kosten, nachfolger: a.nachfolgerN, promptZeichenNachfolger: a.promptZeichenNachfolger } : {}),
  }));

/** Je-Ticket-Bericht (#1592): Läufe pro Ticket zusammenlegen, Fenster am ersten Start des Tickets, Gruppen nach dem Schnitt des Vorgängers. */
function jeTicketBericht(agent, analysen, { von, bis }) {
  const jeNr = new Map();
  let ohneTicket = 0;
  for (const a of analysen) {
    if (a.ticket === null) ohneTicket += 1;
    else jeNr.set(a.ticket, [...(jeNr.get(a.ticket) ?? []), a]);
  }
  const zusammen = [...jeNr.values()].map(ticketLauf);
  const tickets = zusammen
    .filter(Boolean)
    .filter((a) => (!von || a.start >= Date.parse(von)) && (!bis || a.start <= Date.parse(bis)));
  const gr = (liste) => gruppe(liste, { jeTicket: true });
  return {
    agent,
    jeTicket: true,
    laeufe: laeufeListe(tickets, true),
    gesamt: gr(tickets),
    ohneSammel: gr(tickets.filter((a) => !a.sammel)),
    sammel: gr(tickets.filter((a) => a.sammel)),
    schnitt: { verify: gr(tickets.filter((a) => a.schnitt === "verify")), pr: gr(tickets.filter((a) => a.schnitt === "pr")), ohne: gr(tickets.filter((a) => a.schnitt === "ohne")) },
    ohneTicket,
    ohneVorgaenger: zusammen.filter((a) => a === null).length,
  };
}

/**
 * Kern: Läufe des Typs im Start-Fenster [von, bis] (optional nur/ohne bestimmte Tickets) → Bericht je Gruppe (alle, ohne Sammeltickets, Sammeltickets).
 * `delta` (true = nur Läufe mit Delta-Patch-Pfad im Prompt, false = nur ohne) und `brille` (Name wie in `laufAus`, z. B. `Architektur`) filtern zusätzlich (#1582).
 * @param {{ laeufe: { meta: object, zeilen: object[] }[], namen: object, agent?: string, von?: string, bis?: string, tickets?: number[], ohne?: number[], delta?: boolean|null, brille?: string|null, jeTicket?: boolean }} e
 * `jeTicket` (#1592): alle Läufe eines Tickets sind ein Lauf (Vorgänger und Nachfolger nach einer Übergabe), das Fenster gilt für den ersten Start.
 */
export function kontextTreiber({ laeufe, namen, agent = namen?.agenten?.umsetzer, von, bis, tickets = [], ohne = [], wurzel = null, delta = null, brille = null, jeTicket = false }) {
  if (typeof agent !== "string" || agent === "") throw new Error("kontextTreiber braucht den Agenten-Typ: `agent` oder namen.agenten.umsetzer");
  const analysen = laeufe
    .filter((l) => l?.meta?.agentType === agent)
    .map((l) => analysiereLauf(l, { wurzel, namen }))
    .filter(Boolean)
    .filter((a) => jeTicket || ((!von || a.start >= Date.parse(von)) && (!bis || a.start <= Date.parse(bis))))
    .filter((a) => passtTicketFilter(a.ticket, { tickets, ohne }))
    .filter((a) => delta === null || a.delta === delta)
    .filter((a) => !brille || a.brille === brille);
  if (jeTicket) return jeTicketBericht(agent, analysen, { von, bis });
  return {
    agent,
    laeufe: laeufeListe(analysen),
    gesamt: gruppe(analysen),
    ohneSammel: gruppe(analysen.filter((a) => !a.sammel)),
    sammel: gruppe(analysen.filter((a) => a.sammel)),
  };
}

/** Beginn des Ladefensters (#1646): je Ticket 48 h früher, damit der Vorgänger eines Nachfolgers im Fenster mitgeladen wird. */
export const ladeVon = (von, jeTicket) => (jeTicket ? mitVorlauf(von) : von);

const f = (x, d = 2) => (x === null || x === undefined ? "-" : x.toFixed(d));
const k = (x) => (x === null || x === undefined ? "-" : `${Math.round(x / 1000)}k`);

function renderGruppe(titel, g) {
  if (!g.gesamt) return [`## ${titel}`, "", "keine Läufe", ""];
  const s = g.gesamt;
  const out = [`## ${titel}`, ""];
  out.push(
    `n=${s.n}, Tickets ${s.tickets}, Requests gesamt ${s.requests} (Median ${f(s.requestsMedian, 1)} je Lauf), Ø Kontext je Call (call-gewichtet) ${k(s.kontextCallGewichtet)}, Median der Lauf-Mittel ${k(s.kontextMedianLaeufe)}, erster Call (Median) ${k(s.ersterKontextMedian)}, max. Kontext (Median) ${k(s.maxKontextMedian)}`,
    `Kosten je Lauf: Median ${f(s.kostenMedian)} $, Mittel ${f(s.kostenMittel)} $, Σ ${f(s.kostenSumme)} $ (ohne Preis: ${s.ohnePreis}); Read ${f(s.kostenRead)} $, Write ${f(s.kostenWrite)} $, Output ${f(s.kostenOutput)} $ (Output unterzählt)`,
    ...(mehrlaufHinweis(s.mehrlauf) ? [mehrlaufHinweis(s.mehrlauf)] : []),
    "",
    "| Phase | Calls | Anteil | Σ Kontext (Tok) | Kosten ($) |",
    "|---|--:|--:|--:|--:|",
  );
  for (const p of PHASEN.filter((x) => g.phasen[x])) {
    const d = g.phasen[p];
    out.push(`| ${p} | ${d.calls} | ${f((100 * d.calls) / s.requests, 0)} % | ${k(d.kontextSumme)} | ${f(d.kosten)} |`);
  }
  out.push("", "| Neuaufbau-Ursache | Ereignisse | neu geschriebene Tokens | Mehrkosten ($) |", "|---|--:|--:|--:|");
  for (const [u, d] of Object.entries(g.neuaufbau)) out.push(`| ${u} | ${d.n} | ${k(d.tokens)} | ${f(d.mehrkosten)} |`);
  out.push("", "| Pausen-Ursache (> 240 s) | Pausen | Ticks |", "|---|--:|--:|");
  for (const [u, d] of Object.entries(g.pausen)) out.push(`| ${u} | ${d.n} | ${d.ticks} |`);
  out.push("", `Wachstum des Kontexts (Σ Zuwachs): Tool-Ergebnisse ${k(g.wachstum.ergebnis)}, eigene Tool-Eingaben ${k(g.wachstum.eingabe)}, Rest (Text, Overhead) ${k(g.wachstum.rest)}`);
  out.push("", "Top-10 Tool-Ergebnisse nach Last (Tokens × spätere Calls):", "", "| Last (Tok) | Tokens | Phase | Ticket | Tool-Aufruf |", "|--:|--:|---|--:|---|");
  for (const t of g.top) out.push(`| ${k(t.last)} | ${t.tokens} | ${t.phase} | ${t.ticket ? `#${t.ticket}` : "-"} | ${t.label.replace(/\|/g, "/")} |`);
  return [...out, ""];
}

/** Übergabe-Zeile einer Je-Ticket-Gruppe (#1592); leer ohne Läufe. */
function renderUebergabe(g) {
  if (!g.gesamt || !g.nachfolger) return [];
  const ab = (p) => `${f(g.kostenAb[p].median)} $ (Σ ${f(g.kostenAb[p].summe)} $)`;
  return [
    `Übergabe: ${g.gesamt.n} Tickets, ${g.nachfolger.n} mit Nachfolger, Kontext erster Call Nachfolger (Median) ${k(g.nachfolger.ersterKontextMedian)}, Nachlese-Calls Σ ${g.nachlese.summe} (Median ${f(g.nachlese.median, 1)}), Kosten ab verify ${ab("verify")}, ab CI-Warten ${ab("CI-Warten")} (Median je Ticket)`,
    "",
  ];
}

/** Tabelle der gezählten Läufe (#1646). */
function renderLaeufe(laeufe) {
  if (!laeufe?.length) return [];
  const je = laeufe.some((l) => "schnitt" in l);
  const zeilen = laeufe.map((l) => {
    const basis = `| ${l.start} | ${l.ticket ? `#${l.ticket}` : "-"} | ${l.sammel ? "ja" : "nein"} | ${l.offen ? "offen" : "geschlossen"} |`;
    return je ? `${basis} ${l.schnitt} | ${l.kosten == null ? "-" : f(l.kosten)} | ${l.nachfolger} | ${l.promptZeichenNachfolger} |` : basis;
  });
  const kopf = je ? ["| Start | Ticket | Sammel | Status | Schnitt | Kosten ($) | Nachfolger | Prompt-Zeichen Nachfolger |", "|---|--:|---|---|---|--:|--:|--:|"] : ["| Start | Ticket | Sammel | Status |", "|---|--:|---|---|"];
  return ["## Läufe", "", ...kopf, ...zeilen, ""];
}

/** Markdown-Bericht (Top-10, Phasen, Neuaufbau) je Gruppe. */
export function renderMarkdown(r) {
  if (r.jeTicket) {
    const kopf = `Kontext-Treiber \`${r.agent}\` je Ticket (Läufe eines Tickets zusammengelegt; ohne Ticket: ${r.ohneTicket}, Nachfolger ohne Vorgänger: ${r.ohneVorgaenger}, offen: ${r.gesamt.offen})`;
    const gruppen = [
      ["Alle Tickets", r.gesamt],
      ["Ohne Sammeltickets", r.ohneSammel],
      ["Sammeltickets", r.sammel],
      ["Schnitt verify (Vorgänger mit Schnitt: verify)", r.schnitt.verify],
      ["Schnitt pr (Vorgänger mit Schnitt: pr)", r.schnitt.pr],
      ["Schnitt ohne (kein Schnitt)", r.schnitt.ohne],
    ];
    return [kopf, "", ...gruppen.flatMap(([titel, g]) => [...renderGruppe(titel, g), ...renderUebergabe(g)]), ...renderLaeufe(r.laeufe)].join("\n");
  }
  return [`Kontext-Treiber \`${r.agent}\` (offen: ${r.gesamt.offen})`, "", ...renderGruppe("Alle Läufe", r.gesamt), ...renderGruppe("Ohne Sammeltickets", r.ohneSammel), ...renderGruppe("Sammeltickets", r.sammel), ...renderLaeufe(r.laeufe)].join("\n");
}

// ── CLI (dünn, ungetestet: Dateisuche) ───────────────────────────────────────

/** `namen` liefert den Standard-Agenten (`agenten.umsetzer`), wenn `--agent` fehlt. */
export function parseArgs(argv, namen) {
  const optionen = { von: { type: "string" }, bis: { type: "string" }, agent: { type: "string" }, ...TICKET_OPTIONEN, projekt: { type: "string" }, brille: { type: "string" }, delta: { type: "string" }, "je-ticket": { type: "boolean" }, json: { type: "boolean" } };
  const { werte, fehler } = flagsLesen(argv, optionen, { meldung: ticketMeldung });
  // Eine Nicht-Ganzzahl wäre NaN und würde still nichts filtern: Aufruf-Fehler statt falscher Teilmenge.
  const { tickets, ohne, fehler: ticketFehler } = ticketFilterAus(werte);
  const a = { agent: werte.agent ?? namen?.agenten?.umsetzer, tickets, ohne, json: werte.json === true };
  for (const name of ["von", "bis", "projekt", "brille"]) if (werte[name] !== undefined) a[name] = werte[name];
  if (werte["je-ticket"] === true) a.jeTicket = true;
  const gefunden = fehler?.text ?? ticketFehler;
  if (gefunden) a.fehler = gefunden;
  const delta = werte.delta;
  if (delta !== undefined && delta !== "ja" && delta !== "nein") a.fehler ??= `--delta erwartet ja|nein, nicht ${delta}`;
  else if (delta !== undefined) a.delta = delta === "ja";
  return a;
}

/**
 * Das CLI als Funktion: gibt den Exit-Code zurück (0 ok, 1 Projekt-Config nicht nutzbar, 2 Aufruf-Fehler). Die Namen kommen aus der Projekt-Config
 * (`config` ersetzt das Laden, Test) und werden vor allem anderen geprüft: ohne `agenten.umsetzer` liest es kein Transkript.
 */
export function hauptlauf(argv, { config, ordner = projektOrdner, ladeTyp = ladeLaeufe, wurzel = hauptrepoWurzel, out = console.log, err = console.error } = {}) {
  const r = namenOderGrund("kontext-treiber", { config });
  if (r.grund) {
    err(r.grund);
    return 1;
  }
  const namen = r.namen;
  const args = parseArgs(argv, namen);
  if (args.fehler || !args.von) {
    if (args.fehler) err(args.fehler);
    err(`Aufruf: node scripts/kontext-treiber.mjs --von <ISO> [--bis <ISO>] [--agent ${namen.agenten.umsetzer}] [--ticket <nr>]… [--ohne <nr>]… [--delta ja|nein] [--brille <name>] [--projekt <slug>] [--je-ticket] [--json]`);
    return 2;
  }
  const dir = ordner(args.projekt);
  readdirSync(dir);
  const bericht = kontextTreiber({ laeufe: ladeTyp(dir, args.agent, ladeVon(args.von, Boolean(args.jeTicket))), namen, agent: args.agent, von: args.von, bis: args.bis, tickets: args.tickets, ohne: args.ohne, wurzel: wurzel(), delta: args.delta ?? null, brille: args.brille ?? null, jeTicket: Boolean(args.jeTicket) });
  out(args.json ? JSON.stringify(bericht, null, 2) : renderMarkdown(bericht));
  return 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = hauptlauf(process.argv.slice(2));
