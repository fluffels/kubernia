/**
 * Gemeinsamer Start der Inbox-Skripte (`audit-einordnung`, `codescanning-inbox`, `wiedervorlage`, `harness-doctor-melden`): erst der
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
