/**
 * Gemeinsamer Start der Inbox-Skripte (`audit-einordnung`, `codescanning-inbox`, `secret-inbox`, `wiedervorlage`, `harness-doctor-melden`): erst der
 * Aufruf-Check (`--dry-run`), dann die Projekt-Config, dann der Import der Board-Libs. Die Libs lesen die Config beim Import (`REPO`),
 * deshalb kommen sie erst nach dem Check und der Config: eine kaputte Config meldet sich als `::error::` mit Fix-Zeile und Exit 2 statt als
 * Stacktrace (das direkte Laden von `board-lib` endet bei einer kaputten Config ebenso mit Exit 2, `ladeProjektOderAbbruch`). Kein Guard, kein Import von `board-lib`/`inbox-lib` beim Laden dieser Datei.
 */
import { fehlerMeldung } from "./gh-cli.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";

/** Die Board-Bausteine beider Libs in einem Objekt (`REPO`, `OWNER`, `ladeSammelKontext`, `postZeilen` …); erst beim Aufruf importiert. */
export const ladeBoardLibs = async () => ({ ...(await import("./board-lib.mjs")), ...(await import("./inbox-lib.mjs")) });

/**
 * Startet ein Inbox-Skript. `skript` ist der Dateiname ohne Endung (für die Aufrufzeile), `praefix` der Anfang der `::error::`-Meldung.
 * Rückgabe: `{ code }` bei Aufruf-, Config- oder Import-Fehler (Meldung ist ausgegeben, der Aufrufer gibt `code` zurück), sonst
 * `{ trocken, config, libs }`. `ladeConfig`, `ladeLibs`, `log`, `err` sind Test-Nähte.
 */
export async function inboxStart(argv, { skript, praefix, ladeConfig = () => ladeProjektConfig(), ladeLibs = ladeBoardLibs, log, err }) {
  const { werte, fehler } = flagsLesen(argv, { "dry-run": { type: "boolean" } });
  if (fehler) {
    err(`${fehler.text}\nAufruf: node scripts/${skript}.mjs [--dry-run]`);
    return { code: AUFRUF_EXIT };
  }
  try {
    const config = ladeConfig();
    const libs = await ladeLibs();
    return { trocken: werte["dry-run"] === true, config, libs };
  } catch (e) {
    log(fehlerMeldung(e, { praefix }));
    return { code: AUFRUF_EXIT };
  }
}

/**
 * Das Ziel-Repo der Harness-Befunde (#76) und der Aufruf-Zusatz (`{ token }`) für `gh`-Aufrufe dorthin: `libs.ZIEL` bzw. `libs.zielToken()`, ohne beide das eigene Repo `libs.REPO`
 * ohne Token. Tickets der Inboxen werden dort gesucht, angelegt, aktualisiert und geschlossen (ein Repo für alles, sonst fände ein Lauf sein eigenes Ticket nie wieder). Pur.
 */
export const zielZugang = (libs) => ({ ziel: libs.ZIEL ?? libs.REPO, zielOpt: { token: libs.zielToken ? libs.zielToken() : undefined } });

/**
 * Die Ticket-Aktionen der Inboxen, alle gegen das Ziel-Repo (`zielZugang`): `holeBody(nr)`, `legeIssueAn(titel, body)` (Rückgabe: Nummer; mit `label` nur, wenn gesetzt),
 * `aktualisiere(nr, body)`, `kommentiere(nr, text)`, `schliesse(nr, kommentar)` und `platziere(nr, art)` (wirft; `platziereOben` bekommt `PROJECT_TOKEN` und das Ziel-Repo, wenn es nicht
 * das eigene ist). `gh` ist `{ text(args, opt), json(args, opt) }` (Test-Naht). Pur bis auf diese Aufrufe.
 */
export function zielAktionen({ gh, libs, label }) {
  const { ziel, zielOpt } = zielZugang(libs);
  return {
    ziel,
    holeBody: (nr) => String(gh.json(["api", `repos/${ziel}/issues/${nr}`], zielOpt).body ?? ""),
    legeIssueAn: (titel, body) => gh.text(["issue", "create", "--repo", ziel, "--title", titel, ...(label ? ["--label", label] : []), "--body", body], zielOpt).trim().split("/").pop(),
    aktualisiere: (nr, body) => gh.text(["api", "-X", "PATCH", `repos/${ziel}/issues/${nr}`, "-f", `body=${body}`], zielOpt),
    kommentiere: (nr, text) => gh.text(["api", `repos/${ziel}/issues/${nr}/comments`, "-f", `body=${text}`], zielOpt),
    schliesse: (nr, kommentar) => gh.text(["issue", "close", String(nr), "--repo", ziel, "--reason", "completed", "--comment", kommentar], zielOpt),
    platziere: (nr, art) => libs.platziereOben(nr, art, process.env.PROJECT_TOKEN, ziel === libs.REPO ? undefined : ziel),
  };
}

/** Der Owner, gegen den `istVertraut` prüft: der des Ziel-Repos (`kontext.owner` aus `ladeSammelKontext`), sonst der des eigenen Repos. Dort liegen die Tickets, ihr Autor ist der Token-Inhaber. Pur. */
export const vertrauterOwner = (kontext, libs) => kontext.owner ?? libs.OWNER;
