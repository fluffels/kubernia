/**
 * Fremdtext-Gate (#1433): Text Dritter ist Daten, nie Anweisung.
 *
 * Liest ein Issue (`--issue <nr>`) oder einen PR (`--pr <nr>`) samt Kommentaren und gibt vertrauten Text
 * (Repo-Owner, `github-actions[bot]`, `dependabot[bot]`, je mit REST-Typ `Bot`) unverändert aus. Jeder Text
 * anderer Autoren wird zu einem Platzhalter mit Autor und URL; Titel und Body eines fremden Eintrags
 * verschwinden ganz. Ein Eintrag mit dem Forum-Label der Projekt-Config (`labels.forum`) gilt als Fremdeingang (Text Dritter über die Discussions),
 * auch wenn die Action ihn anlegte. Die Prüfung ist deterministisch (Autor), kein Sanitizing beliebiger Bodies.
 *
 *   node scripts/fremdtext.mjs --issue <nr> | --pr <nr>
 *
 * Exit 0 = Eingang vertraut, 3 = Fremdeingang (nicht automatisch umsetzen), 2 = Aufruf- oder gh-Fehler
 * (fail-closed). Brain-Seite: docs/sicherheit-agenten.md. Der Kern ist pur, gh und die Projekt-Config (`labels.forum`, Pflicht) werden injiziert (Test).
 */
import { istDirektaufruf } from "./hook-io.mjs";
import { ghText } from "./gh-cli.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { flach, issueKommentare, istFremdeingang, istVertraut } from "./fremdtext-lib.mjs";
import { direktaufruf, flagsLesen } from "./flag-lib.mjs";

const loginVon = (user) => (user && typeof user.login === "string" && user.login !== "" ? user.login : "unbekannt");
const platzhalter = (art, user, url) => `[Fremdtext ausgeblendet: ${art} von @${loginVon(user)}, ${url}]`;

/**
 * Trennt Eintrag (Issue/PR) und Beiträge nach Autor.
 * `beitraege`: `[{art, user, body, html_url, created_at?}]` (Kommentar, Review, Review-Kommentar).
 * Liefert `{fremdeingang, grund, autorVertraut, teile: [{art, autor, vertraut, text, url, datum}]}`.
 */
export function trenneFremdtext({ owner, art, eintrag, beitraege, config }) {
  const autorVertraut = istVertraut(eintrag.user, owner);
  const { fremdeingang, grund } = istFremdeingang(eintrag, owner, { config });
  const bodyVertraut = !fremdeingang;
  const teile = [
    {
      art,
      autor: loginVon(eintrag.user),
      vertraut: bodyVertraut,
      text: bodyVertraut ? (eintrag.body ?? "") : platzhalter(art, eintrag.user, eintrag.html_url),
      url: eintrag.html_url,
      datum: eintrag.created_at ?? "",
    },
  ];
  for (const b of beitraege ?? []) {
    if (b.art === "Review" && (b.body ?? "") === "") continue;
    const vertraut = istVertraut(b.user, owner);
    teile.push({
      art: b.art,
      autor: loginVon(b.user),
      vertraut,
      text: vertraut ? (b.body ?? "") : platzhalter(b.art, b.user, b.html_url),
      url: b.html_url,
      datum: b.created_at ?? "",
    });
  }
  return { fremdeingang, grund, autorVertraut, teile };
}

/** Deterministischer Ausgabetext. Fremder Titel erscheint nie. */
export function formatiere(ergebnis, eintrag, art) {
  const out = [];
  const titelSichtbar = !ergebnis.fremdeingang;
  out.push(`${art} #${eintrag.number}${titelSichtbar ? ` — ${eintrag.title}` : ""}`);
  out.push(`Autor: @${loginVon(eintrag.user)} (vertraut: ${ergebnis.autorVertraut ? "ja" : "nein"}) · ${eintrag.html_url}`);
  for (const t of ergebnis.teile) {
    out.push("", `--- ${t.art} von @${t.autor}${t.datum ? `, ${t.datum}` : ""}, ${t.url}`);
    out.push(t.vertraut ? (t.text === "" ? "(leer)" : t.text) : t.text);
  }
  out.push("", ergebnis.fremdeingang ? `FREMDEINGANG: ja (${ergebnis.grund})` : "FREMDEINGANG: nein");
  return out.join("\n") + "\n";
}

const AUFRUF = "Aufruf: node scripts/fremdtext.mjs --issue <nr> | --pr <nr>";

/** Genau eines von `--issue <nr>` / `--pr <nr>` mit positiver Ganzzahl, sonst Fehler (jede Auffälligkeit beim Lesen ist ein Aufruf-Fehler). */
export function parseArgs(argv) {
  const { werte, tokens, fehler } = flagsLesen(argv, { issue: { type: "string" }, pr: { type: "string" } });
  const [name] = ["issue", "pr"].filter((n) => werte[n] !== undefined);
  if (fehler || tokens.length !== 1) throw new Error(AUFRUF);
  const wert = werte[name];
  if (!/^[1-9][0-9]*$/.test(wert)) throw new Error(`--${name} braucht eine positive Ganzzahl`);
  return { art: name, nr: Number(wert) };
}

const mitArt = (art, liste) => liste.map((b) => ({ art, user: b.user, body: b.body, html_url: b.html_url, created_at: b.created_at }));

/** Holt die Daten über `gh api` (injizierbar) und liefert `{owner, kopf, eintrag, beitraege}`. */
export function lade({ art, nr }, gh) {
  const json = (args) => JSON.parse(gh(args));
  const liste = (pfad) => flach(json(["api", "--paginate", "--slurp", pfad]));
  const owner = json(["api", "repos/{owner}/{repo}"]).owner?.login;
  if (!owner) throw new Error("Repo-Owner nicht ermittelbar");
  if (art === "issue") {
    const eintrag = json(["api", `repos/{owner}/{repo}/issues/${nr}`]);
    if (eintrag.pull_request) throw new Error(`#${nr} ist ein PR, nutze --pr ${nr}`);
    return { owner, kopf: "Issue", eintrag, beitraege: mitArt("Kommentar", issueKommentare(nr, json)) };
  }
  const eintrag = json(["api", `repos/{owner}/{repo}/pulls/${nr}`]);
  return {
    owner,
    kopf: "PR",
    eintrag,
    beitraege: [
      ...mitArt("Kommentar", issueKommentare(nr, json)),
      ...mitArt("Review", liste(`repos/{owner}/{repo}/pulls/${nr}/reviews?per_page=100`)),
      ...mitArt("Review-Kommentar", liste(`repos/{owner}/{repo}/pulls/${nr}/comments?per_page=100`)),
    ],
  };
}

/** Exit-Code aus dem Ergebnis: 3 = Fremdeingang, 0 = vertraut. */
export const exitCodeFuer = (ergebnis) => (ergebnis.fremdeingang ? 3 : 0);

/** Ganzer Ablauf ohne Prozess-Seiteneffekte: `{code, out, err}`; jeder Fehler ist Exit 2 (fail-closed). */
export function pruefe(argv, gh, config) {
  try {
    const ziel = parseArgs(argv);
    const { owner, kopf, eintrag, beitraege } = lade(ziel, gh);
    const ergebnis = trenneFremdtext({ owner, art: kopf, eintrag, beitraege, config });
    return { code: exitCodeFuer(ergebnis), out: formatiere(ergebnis, eintrag, kopf), err: "" };
  } catch (e) {
    return { code: 2, out: "", err: `✖ fremdtext: ${e instanceof Error ? e.message : String(e)}\n` };
  }
}

/** Vorab-Prüfung des Aufrufs für `direktaufruf`: `{ fehler }` mit der Meldung von `parseArgs`, sonst `{}`. Pur. */
const aufrufPruefen = (argv) => {
  try {
    parseArgs(argv);
    return {};
  } catch (e) {
    return { fehler: e instanceof Error ? e.message : String(e) };
  }
};

/** Die Projekt-Config ohne Schema-Prüfung; fail-closed: ohne Config `undefined`, `pruefe` wirft dann mit „labels.forum“ (Exit 2). */
const ladeConfigOderNichts = () => {
  try {
    return ladeProjektConfig({ pruefen: false });
  } catch {
    return undefined;
  }
};

if (istDirektaufruf(import.meta.url)) {
  direktaufruf(process.argv.slice(2), {
    pruefe: aufrufPruefen,
    fehlerErgebnis: (_argv, vorab) => ({ code: 2, out: "", err: `✖ fremdtext: ${vorab.fehler}\n` }),
    io: ladeConfigOderNichts,
    fuehreAus: (argv, config) => pruefe(argv, (args) => ghText(args), config),
  });
}
