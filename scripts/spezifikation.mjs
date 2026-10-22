#!/usr/bin/env node
/**
 * Spezifikations-Gate, Schreibseite (#1698, ADR 0022 F12): neue Befund-Issues entstehen nur geprüft, ein vertrautes Ticket ohne
 * Spezifikation wird nachgezogen. Die Auswahl (`naechstes-ticket.mjs`) meldet nur (`reparieren #<nr>`), dieses Skript schreibt.
 *
 *   node scripts/spezifikation.mjs pruefen --body-datei <pfad>
 *   node scripts/spezifikation.mjs anlegen --titel "<t>" --body-datei <pfad> --label area:<x> [--label <l> …] (--nach <nr> | --notfall <art>) [--blocker <nr> …]
 *   node scripts/spezifikation.mjs reparieren <nr> --body-datei <pfad>
 *   node scripts/spezifikation.mjs gescheitert <nr> --mangel "<text>"
 *
 * `gescheitert` meldet eine Reparatur, die nicht gelang (Exit 1 oder 3, Body nicht nachziehbar): eine Zeile `- [ ] <Datum> Reparatur gescheitert: #<nr> (<Mängel>). Fix: …`
 * als Kommentar ins jüngste ungeclaimte Harness-Sammelticket (Exit 1: keins da, Fix: `sammelticket-anlegen.mjs harness`). Steht die Zeile zu dieser Nummer schon
 * offen (`- [ ]`) von einem vertrauten Autor in einem offenen Sammelticket, bleibt es bei Exit 0 ohne Post. Wochenliste der offenen Fälle: `naechstes-ticket.mjs --maengel`.
 *
 * `anlegen` prüft vorab mit `pruefeEingang` (`## Ziel`, `## Akzeptanzkriterien` samt Negativfall) und den `--nach`-Anker (steht er nur auf dem anderen Board: Exit 2, nichts angelegt), legt ohne Assignee an und sortiert
 * über `board-place.mjs` ein (`--nach` = hinter diese Nummer, `--notfall` = ganz oben). `reparieren` ersetzt den Body eines freien,
 * vertrauten Issues, wenn der neue Body vollständig ist und keine Zeile des alten verliert (`verloreneZeilen`); ein Fremdeingang
 * (Autor nicht vertraut oder Forum-Label der Projekt-Config) wird nie umgeschrieben. Der Body wird nie ausgegeben, nur Mängel und verlorene Zeilen.
 *
 * Exit 0 = angelegt/repariert/nichts zu tun/vollständig, 1 = Spezifikation unvollständig oder Inhaltsverlust (nichts geschrieben),
 * 2 = Aufruf- oder gh-Fehler (scheitert nach dem Anlegen nur das Einsortieren: Nummer und Nachhol-Befehl), 3 = Fremdeingang (nur `reparieren`).
 * Grenze: Exit 3 heißt hier immer Fremdeingang; ein knappes API-Kontingent meldet `mitKontingent` mit Exit 5.
 * Grenze: zwei gleichzeitige Reparaturen desselben Tickets: der letzte Schreiber gewinnt.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ladeSammelKontext, postZeilen, waehleSammelticket } from "./inbox-lib.mjs";
import { ankerFehler, boardFuerRolle, boardRolleFuer, loadItems, NOTFALL_ARTEN, OWNER, REPO } from "./board-lib.mjs";
import { istFremdeingang, istVertraut } from "./fremdtext-lib.mjs";
import { befehlLesen, direktaufruf } from "./flag-lib.mjs";
import { configAusAufruf, labelAus, spracheAus } from "./projekt-config-lib.mjs";
import { fehlerText, ghJson } from "./gh-cli.mjs";
import { mitKontingent } from "./kontingent-lib.mjs";
import { blockerNummern, blockerZeile, pruefeEingang, spezifikationsMaengel, verloreneZeilen } from "./spezifikation-lib.mjs";

const AUFRUF = [
  "Aufruf:",
  "  node scripts/spezifikation.mjs pruefen --body-datei <pfad>",
  '  node scripts/spezifikation.mjs anlegen --titel "<t>" --body-datei <pfad> --label area:<x> [--label <l> …] (--nach <nr> | --notfall <art>) [--blocker <nr> …]',
  "  node scripts/spezifikation.mjs reparieren <nr> --body-datei <pfad>",
  '  node scripts/spezifikation.mjs gescheitert <nr> --mangel "<text>"',
].join("\n");

const ergebnis = (code, out = "", err = "") => ({ code, out, err });
const aufrufFehler = (text) => ergebnis(2, "", `✖ spezifikation: ${text}\n`);
const liste = (zeilen) => zeilen.map((z) => `  - ${z}`).join("\n");

const BEFEHLE = {
  pruefen: { optionen: { "body-datei": { type: "string" } }, positionale: 0 },
  anlegen: {
    optionen: { titel: { type: "string" }, "body-datei": { type: "string" }, label: { type: "string", multiple: true }, nach: { type: "string" }, notfall: { type: "string" }, blocker: { type: "string", multiple: true } },
    positionale: 0,
  },
  reparieren: { optionen: { "body-datei": { type: "string" } }, positionale: 1 },
  gescheitert: { optionen: { mangel: { type: "string" } }, positionale: 1 },
};

const positiveZahl = (t) => (/^#?([1-9][0-9]*)$/.exec(String(t ?? "")) ? Number(String(t).replace("#", "")) : null);

/**
 * Prüft den Aufruf vor jedem I/O (`befehlLesen`): Unterbefehl, dann die Flag-Menge dieses Unterbefehls (`--blocker` nur mit Ticketnummern, Liste in `werte.blocker`); `reparieren` nimmt genau ein
 * Positionsargument, die anderen keins. Liefert `{ befehl, werte, positional }` (`werte.label` immer eine Liste) oder `{ fehler }`. Pur.
 */
export function aufrufPruefen(argv) {
  const r = befehlLesen(argv, BEFEHLE);
  if (r.fehler) return { fehler: r.fehler.text };
  if (r.befehl === "gescheitert") {
    if (positiveZahl(r.positionale[0]) === null) return { fehler: "gescheitert braucht eine Ticketnummer" };
    if (String(r.werte.mangel ?? "").trim() === "") return { fehler: "gescheitert braucht --mangel \"<text>\"" };
  }
  const blocker = (r.werte.blocker ?? []).map(positiveZahl);
  if (blocker.includes(null)) return { fehler: "--blocker braucht eine Ticketnummer (--blocker <nr>, mehrfach möglich)" };
  return { befehl: r.befehl, werte: { ...r.werte, label: r.werte.label ?? [], ...(r.befehl === "anlegen" ? { blocker } : {}) }, positional: r.positionale };
}

function leseBody(werte, io) {
  if (!werte["body-datei"]) return { fehler: "--body-datei fehlt" };
  let body;
  try {
    body = io.leseDatei(werte["body-datei"]);
  } catch (e) {
    return { fehler: `Body-Datei nicht lesbar (${e instanceof Error ? e.message : String(e)})` };
  }
  if (String(body).trim() === "") return { fehler: "Body-Datei ist leer" };
  return { body: String(body) };
}

function pruefen(werte, io, sprache) {
  const b = leseBody(werte, io);
  if (b.fehler) return aufrufFehler(b.fehler);
  const maengel = spezifikationsMaengel(b.body, sprache);
  return maengel.length === 0 ? ergebnis(0, "Spezifikation vollständig\n") : ergebnis(1, "", `✖ Spezifikation unvollständig:\n${liste(maengel)}\n`);
}

const einzeilig = (t) => String(t).replace(/\s*\n\s*/g, " ").trim();
const gescheitertSchluessel = (nr) => `Reparatur gescheitert: #${nr} (`;

/** Die Sammelticket-Zeile zu einer gescheiterten Reparatur von #`nr` (`mangel` einzeilig). Pur. */
export const gescheitertZeile = ({ nr, mangel, heute }) =>
  `- [ ] ${heute} ${gescheitertSchluessel(nr)}${einzeilig(mangel)}). Fix: Body über den Reparaturweg nachziehen`;

/** Steht zu #`nr` schon eine offene Zeile (`- [ ]`) eines vertrauten Autors in `kommentare` (`[{ user, body }]`)? Pur. */
export function gescheitertBekannt(nr, kommentare, owner) {
  const schluessel = gescheitertSchluessel(nr);
  return kommentare.some(
    (k) => istVertraut(k?.user ?? null, owner) && String(k?.body ?? "").split(/\r?\n/).some((z) => /^\s*[-*]\s+\[ \]/.test(z) && z.includes(schluessel)),
  );
}

function gescheitert(werte, nrText, io) {
  const nr = positiveZahl(nrText);
  let kontext;
  try {
    kontext = io.sammelKontext();
  } catch (e) {
    return aufrufFehler(`Sammelticket nicht lesbar: ${fehlerText(e)}`);
  }
  if (!kontext.ziel) return ergebnis(1, "", "✖ kein ungeclaimtes Harness-Sammelticket für die Zeile\nFix: node scripts/sammelticket-anlegen.mjs harness\n");
  if (gescheitertBekannt(nr, kontext.kommentare, io.owner)) return ergebnis(0, `#${nr}: gescheiterte Reparatur schon als offene Zeile gemeldet, nichts gepostet\n`);
  try {
    io.postZeilen(kontext.ziel, gescheitertZeile({ nr, mangel: werte.mangel, heute: io.heute() }));
  } catch (e) {
    return aufrufFehler(`Zeile nicht gepostet: ${fehlerText(e)}`);
  }
  return ergebnis(0, `Zeile für #${nr} in #${kontext.ziel} gepostet\n`);
}

function nachholBefehl(werte, nach, nr) {
  return nach ? `node scripts/board-place.mjs --after ${nach} ${nr}` : `node scripts/board-place.mjs --notfall ${werte.notfall} --top ${nr}`;
}

/** Hängt die Blocker-Zeile (`<blocker> #a, #b`) mit den Nummern an, die der Body noch nicht als Blocker nennt; nichts Fehlendes: der Body bleibt unverändert. Pur. */
export function mitBlockerZeile(body, nummern, sprache) {
  const da = new Set(blockerNummern(body, sprache));
  const fehlt = nummern.filter((n) => !da.has(n));
  return fehlt.length === 0 ? body : `${body.replace(/\s+$/, "")}\n\n${blockerZeile(fehlt, sprache)}\n`;
}

function anlegen(werte, io, sprache) {
  if (!werte.titel || werte.titel.trim() === "") return aufrufFehler("--titel fehlt");
  if (!werte.label.some((l) => /^area:\S+/.test(l))) return aufrufFehler("ein Label `area:<x>` ist Pflicht (--label area:<x>)");
  if (Boolean(werte.nach) === Boolean(werte.notfall)) return aufrufFehler("genau eines von --nach <nr> und --notfall <art> ist Pflicht");
  const nach = werte.nach ? positiveZahl(werte.nach) : null; // einmal parsen: `#12` und `12` sind dieselbe Nummer
  if (werte.nach && nach === null) return aufrufFehler("--nach braucht eine Ticketnummer");
  if (werte.notfall && !NOTFALL_ARTEN.includes(werte.notfall)) return aufrufFehler(`--notfall kennt ${NOTFALL_ARTEN.join(", ")} (bekommen: ${werte.notfall})`);
  const b = leseBody(werte, io);
  if (b.fehler) return aufrufFehler(b.fehler);
  const body = mitBlockerZeile(b.body, werte.blocker, sprache);
  const gate = pruefeEingang({ nummer: 0, titel: werte.titel, body }, { sprache }); // neu angelegt: nie Bestand, nie ausgenommen
  if (gate.art !== "ok") return ergebnis(1, "", `✖ Spezifikation unvollständig, nichts angelegt:\n${liste(gate.fehlt)}\n`);
  if (nach !== null) {
    // Anker vor dem Anlegen prüfen: ein Anker vom falschen Board ließe sonst ein angelegtes, aber nicht einsortiertes Issue zurück.
    let ankerText;
    try {
      ankerText = io.pruefeAnker({ nach, labels: werte.label });
    } catch (e) {
      return aufrufFehler(`Anker #${nach} nicht prüfbar, nichts angelegt (${fehlerText(e)})`);
    }
    if (ankerText) return aufrufFehler(`nichts angelegt: ${ankerText}`);
  }
  let neu;
  try {
    neu = io.erzeuge({ titel: werte.titel, body, labels: werte.label });
  } catch (e) {
    return aufrufFehler(`Anlegen fehlgeschlagen: ${fehlerText(e)}`);
  }
  try {
    io.einsortiere({ nr: neu.number, nach, notfall: werte.notfall ?? null });
  } catch (e) {
    return aufrufFehler(`#${neu.number} angelegt, aber nicht einsortiert (${fehlerText(e)}). Nachholen: ${nachholBefehl(werte, nach, neu.number)}`);
  }
  return ergebnis(0, `angelegt #${neu.number}${neu.html_url ? ` ${neu.html_url}` : ""}\n`);
}

function reparieren(werte, nrText, io, sprache) {
  const nr = positiveZahl(nrText);
  if (nr === null) return aufrufFehler("reparieren braucht eine Ticketnummer");
  const b = leseBody(werte, io);
  if (b.fehler) return aufrufFehler(b.fehler);
  let issue;
  try {
    issue = io.ladeIssue(nr);
  } catch (e) {
    return aufrufFehler(`#${nr} nicht ladbar: ${fehlerText(e)}`);
  }
  if (issue.pull_request) return aufrufFehler(`#${nr} ist ein PR`);
  if (issue.state !== "open") return aufrufFehler(`#${nr} ist nicht offen`);
  if (istFremdeingang(issue, io.owner, { config: io.config }).fremdeingang) return ergebnis(3, "", `✖ #${nr} ist ein Fremdeingang (Autor nicht vertraut oder Label ${labelAus(io.config, "forum")}): wird nie umgeschrieben, als Befund melden\n`);
  if ((issue.assignees ?? []).length > 0) return aufrufFehler(`#${nr} hat einen Assignee (wird schon bearbeitet), nicht umschreiben`);
  if (spezifikationsMaengel(issue.body, sprache).length === 0) return ergebnis(0, `#${nr}: Spezifikation schon vollständig, nichts zu tun\n`);
  const maengel = spezifikationsMaengel(b.body, sprache);
  if (maengel.length > 0) return ergebnis(1, "", `✖ neuer Body unvollständig, nichts geschrieben:\n${liste(maengel)}\n`);
  const verloren = verloreneZeilen(issue.body, b.body);
  if (verloren.length > 0) {
    const gezeigt = verloren.slice(0, 10).map((z) => (z.length > 120 ? `${z.slice(0, 120)}…` : z));
    return ergebnis(1, "", `✖ Inhaltsverlust (${verloren.length} Zeile(n) des alten Bodys fehlen), nichts geschrieben:\n${liste(gezeigt)}\n`);
  }
  try {
    io.bearbeite(nr, b.body);
  } catch (e) {
    return aufrufFehler(`#${nr} nicht geschrieben: ${fehlerText(e)}`);
  }
  return ergebnis(0, `repariert #${nr}\n`);
}

/** Ausführung mit injizierbarer I/O (`leseDatei`, `erzeuge`, `pruefeAnker` (Fehlertext oder `null`), `einsortiere`, `ladeIssue`, `bearbeite`, `owner`): `{ code, out, err }`. */
export function fuehreAus(argv, io) {
  const p = aufrufPruefen(argv);
  if (p.fehler) return aufrufFehler(`${p.fehler}\n${AUFRUF}`);
  if (p.befehl === "gescheitert") return gescheitert(p.werte, p.positional[0], io);
  let sprache;
  try {
    sprache = spracheAus(io.config).spezifikation; // fehlt sie, bricht das Werkzeug ab: kein stiller Deutsch-Standardwert
  } catch (e) {
    return ergebnis(1, "", `✖ spezifikation: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  if (p.befehl === "pruefen") return pruefen(p.werte, io, sprache);
  if (p.befehl === "anlegen") return anlegen(p.werte, io, sprache);
  return reparieren(p.werte, p.positional[0], io, sprache);
}

/**
 * Ankerprüfung mit injiziertem Lader (`lade(rolle)` → Items): zuerst nur das Ziel-Board (Rolle aus den Labels, das Issue gibt es noch
 * nicht); steht der Anker dort, ist nichts zu prüfen. Nur sonst kommt das andere Board dazu, damit die Regel (`ankerFehler`, geteilt mit
 * board-place.mjs) „steht nur auf dem anderen Board“ melden kann. Liefert den Fehlertext oder `null`.
 */
export function ankerPruefung({ nach, labels }, lade, config) {
  const rolle = boardRolleFuer(labels, config);
  const andere = rolle === "factory" ? "produkt" : "factory";
  const ziel = lade(rolle);
  if (ziel.some((i) => i.number === nach)) return null;
  const fehler = ankerFehler({ anchor: nach, rolle, [rolle]: ziel, [andere]: lade(andere) });
  return fehler ? `${fehler}; einen Anker vom passenden Board wählen` : null;
}

const echteIo = (config) => { // Fabrik: erst nach bestandener Aufruf- und Config-Prüfung aufgerufen (`direktaufruf`)
  return {
    owner: OWNER,
    config,
    leseDatei: (pfad) => readFileSync(pfad, "utf8"),
    erzeuge: ({ titel, body, labels }) =>
      ghJson(["api", "-X", "POST", `repos/${REPO}/issues`, "-f", `title=${titel}`, "-f", `body=${body}`, ...labels.flatMap((l) => ["-f", `labels[]=${l}`])]),
    pruefeAnker: (a) => ankerPruefung(a, (rolle) => loadItems(boardFuerRolle(rolle)), config),
    einsortiere: ({ nr, nach, notfall }) => {
      const args = nach ? ["--after", String(nach), String(nr)] : ["--notfall", notfall, "--top", String(nr)];
      execFileSync(process.execPath, [fileURLToPath(new URL("./board-place.mjs", import.meta.url)), ...args], { stdio: "inherit" });
    },
    sammelKontext: () => {
      const k = ladeSammelKontext();
      return { ziel: waehleSammelticket(k.offene)?.number ?? null, kommentare: k.kommentare };
    },
    postZeilen,
    heute: () => new Date().toISOString().slice(0, 10),
    ladeIssue: (nr) => ghJson(["api", `repos/${REPO}/issues/${nr}`]),
    bearbeite: (nr, body) => ghJson(["api", "-X", "PATCH", `repos/${REPO}/issues/${nr}`, "-f", `body=${body}`]),
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Aufruf-Fehler vor jedem I/O: sonst schriebe `mitKontingent` seinen Hinweis vor den Fehler (#1791).
  const { args, config, fehler: configFehler } = configAusAufruf(process.argv.slice(2)); // --config <pfad>, vor jedem I/O
  direktaufruf(args, {
    pruefe: (argv) => (configFehler ? { fehler: configFehler } : aufrufPruefen(argv)),
    fehlerErgebnis: (argv) => (configFehler ? aufrufFehler(configFehler) : fuehreAus(argv, null)),
    vorbereiten: () => mitKontingent("spezifikation", { arten: ["core"] }),
    io: () => echteIo(config),
    fuehreAus,
  });
}
