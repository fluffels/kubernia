// Kein Shebang, kein Direktaufruf: Lib für `langfuse-nachliefern.mjs` (#1579, Konvention #1398: Einstiegsskripte importieren
// nicht voneinander, gemeinsamer Code steht in einer Lib). Importiert nur Builtins.
/**
 * Prozess-Lock und Log des Nachlieferns (#1578): `lockNehmen`/`lockFreigeben` (eine schreibende Instanz zugleich),
 * `logAnhaengen`/`logEintrag` (eine JSON-Zeile je Lauf, rotiert) und `gesperrterLauf` (ein Lauf unter Lock mit Logzeile).
 *
 * Lock-Übernahme ohne TOCTOU: ein veralteter Lock wird nicht blind gelöscht, sondern per Hardlink auf einen Grabstein
 * `<lock>.verwaist-<pid>-<zeit>` gelegt, dessen Name aus dem Inhalt des veralteten Locks folgt. Alle Bewerber, die denselben
 * veralteten Lock sahen, wollen denselben Namen: genau einer gewinnt (`EEXIST` für die übrigen = belegt). Der Hardlink verändert den
 * Lock nie; trägt der Grabstein nach dem Verlinken nicht den gesehenen Inhalt, wurde ein inzwischen frischer Lock erwischt:
 * der Link geht wieder weg und der Lock bleibt unberührt.
 */
import { appendFileSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Belegter Lock an SessionEnd: einmal nach dieser Zeit erneut versuchen (`/clear` löst SessionEnd und SessionStart fast gleichzeitig aus). */
export const WARTE_LOCK = 60_000;
export const LOCK_VERALTET_MS = 15 * 60_000;
/** Grabsteine veralteter Locks werden ab diesem Alter weggeräumt (weit über LOCK_VERALTET_MS). */
const GRABSTEIN_ALTER_MS = 24 * 3_600_000;
export const LOG_MAX_BYTES = 1_048_576;
export const LOCK_NAME = "langfuse-abgleich.lock";
export const LOG_NAME = "langfuse-abgleich.log";
export const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/** Inhalt des Locks als `{ id, zeit }` (id aus pid und Zeit, bei kaputtem Inhalt aus der Änderungszeit); `null`, wenn er fehlt. */
function lockZustand(datei) {
  let mtime;
  try {
    mtime = statSync(datei).mtimeMs;
  } catch {
    return null; // weg
  }
  try {
    const j = JSON.parse(readFileSync(datei, "utf8"));
    if (Number.isFinite(j?.zeit)) return { id: `${j.pid ?? "x"}-${j.zeit}`, zeit: j.zeit };
  } catch {
    // kaputter Inhalt: dann zählt die Änderungszeit
  }
  return { id: `kaputt-${Math.trunc(mtime)}`, zeit: mtime };
}

/** Ist der Lock älter als LOCK_VERALTET_MS? Ein fehlender Lock gilt als veraltet. */
export function lockVeraltet(datei, now) {
  const z = lockZustand(datei);
  return !z || now - z.zeit > LOCK_VERALTET_MS;
}

function raeumeGrabsteine(datei, now) {
  const praefix = `${basename(datei)}.verwaist-`;
  try {
    for (const n of readdirSync(dirname(datei)).filter((x) => x.startsWith(praefix))) {
      const pfad = join(dirname(datei), n);
      try {
        if (now - statSync(pfad).mtimeMs > GRABSTEIN_ALTER_MS) unlinkSync(pfad);
      } catch {
        // schon weg
      }
    }
  } catch {
    // Ordner nicht lesbar: Aufräumen ist nur Kosmetik
  }
}

/**
 * `"frei"` (neu angelegt), `"übernommen"` (veralteten Lock ersetzt) oder `"belegt"`. Anlage atomar per `wx` mit pid und Zeit.
 * `nachPruefung` ist eine Testnaht zwischen „veraltet gesehen“ und „übernehmen“.
 */
export function lockNehmen(datei, { now = Date.now(), pid = process.pid, nachPruefung = null } = {}) {
  mkdirSync(dirname(datei), { recursive: true });
  const versuch = () => {
    try {
      writeFileSync(datei, JSON.stringify({ pid, zeit: now }), { flag: "wx" });
      return true;
    } catch (e) {
      if (e.code === "EEXIST") return false;
      throw e;
    }
  };
  if (versuch()) return "frei";
  const z = lockZustand(datei);
  if (z && now - z.zeit <= LOCK_VERALTET_MS) return "belegt";
  if (!z) return versuch() ? "frei" : "belegt"; // inzwischen weg
  nachPruefung?.();
  raeumeGrabsteine(datei, now);
  const grab = `${datei}.verwaist-${z.id}`;
  try {
    linkSync(datei, grab);
  } catch (e) {
    if (e.code === "EEXIST") return "belegt"; // ein anderer Bewerber übernimmt diesen veralteten Lock
    if (e.code === "ENOENT") return versuch() ? "frei" : "belegt"; // inzwischen freigegeben
    throw e;
  }
  if (lockZustand(grab)?.id !== z.id) {
    // Verlinkt wurde ein inzwischen frischer Lock eines anderen Laufs: nur den eigenen Link lösen, der Lock bleibt.
    unlinkSync(grab);
    return "belegt";
  }
  try {
    unlinkSync(datei);
  } catch {
    // weg: der wx entscheidet
  }
  return versuch() ? "übernommen" : "belegt";
}

/** Gibt den Lock nur frei, wenn er die eigene pid trägt (ein übernommener Lock gehört einem anderen Lauf). */
export function lockFreigeben(datei, pid = process.pid) {
  try {
    if (JSON.parse(readFileSync(datei, "utf8"))?.pid === pid) unlinkSync(datei);
  } catch {
    // weg oder kaputt: nichts zu tun
  }
}

/** Die Konsolenmeldung eines manuellen Laufs, dessen Lock belegt blieb, nicht anzulegen war oder dessen Lauf abstürzte. */
export function lockMeldung(lock) {
  if (lock === "belegt") return `Ein anderer Nachlieferlauf hält den Lock (~/.claude/state/${LOCK_NAME}); später erneut versuchen.`;
  if (lock === "fehler") return "Der Lock ließ sich nicht anlegen: ~/.claude/state prüfen.";
  return `Nachliefern abgestürzt, siehe ~/.claude/state/${LOG_NAME}.`;
}

/** Hängt `eintrag` als eine JSON-Zeile an; ab `max` Bytes wandert die Datei vorher nach `<datei>.1` (eine ältere `.1` wird ersetzt). */
export function logAnhaengen(datei, eintrag, { max = LOG_MAX_BYTES } = {}) {
  mkdirSync(dirname(datei), { recursive: true });
  try {
    if (statSync(datei).size >= max) renameSync(datei, `${datei}.1`);
  } catch {
    // keine Datei: die erste Zeile legt sie an
  }
  appendFileSync(datei, JSON.stringify(eintrag) + "\n");
}

/** Gehört die Session-Zeile in Bericht und Log (etwas gesendet, gefunden oder schiefgegangen)? */
export const zeigenswert = (x) => x.gesendet || x.wuerdeSenden || x.dubletten || x.ausstehend || x.befund || x.status === "Fehler" || x.status === "mehrdeutig";

/** Die Logzeile eines Laufs aus dem `protokoll` (ohne Protokoll, z.B. Lock belegt: Nullwerte). Keine Zugangswerte, nur ja/nein. */
export function logEintrag({ zeit, ausloeser, session, lock, exitCode = null, protokoll = null, fehler = [] }) {
  const p = protokoll ?? { zugang: null, geprueft: 0, gesendet: 0, spans: 0, dubletten: 0, wuerdeSenden: 0, sessions: [], fehler: [] };
  const kurz = (f) => ({ ...f, meldung: String(f.meldung ?? "").slice(0, 300) });
  return {
    zeit,
    ausloeser,
    session: session ?? null,
    lock,
    zugang: p.zugang,
    exitCode,
    geprueft: p.geprueft,
    gesendet: p.gesendet,
    spans: p.spans,
    dubletten: p.dubletten,
    wuerdeSenden: p.wuerdeSenden,
    sessions: p.sessions.filter(zeigenswert).map((r) => ({ session: r.session, status: r.status, gesendet: r.gesendet, wuerdeSenden: r.wuerdeSenden, dubletten: r.dubletten, ausstehend: r.ausstehend })),
    fehler: [...p.fehler, ...fehler].map(kurz),
  };
}

/**
 * Ein Lauf unter Lock mit Logzeile: `{ lock, ergebnis }` (`ergebnis` null, wenn der Lock belegt blieb oder der Lauf abstürzte). `wiederholen`: bei belegtem
 * Lock einmal nach WARTE_LOCK erneut versuchen. Ein Absturz in `lauf` wird protokolliert, der Lock im `finally` freigegeben.
 */
export async function gesperrterLauf(args, { stateDir, lauf, ausloeser, wiederholen = false, schlafen = warte, uhr = Date.now, pid = process.pid }) {
  const lockDatei = join(stateDir, LOCK_NAME);
  const basis = { ausloeser, session: args.session ?? args.aktuell ?? null, lock: null };
  const logge = (extra) => {
    try {
      logAnhaengen(join(stateDir, LOG_NAME), logEintrag({ zeit: new Date(uhr()).toISOString(), ...basis, ...extra }));
    } catch {
      // Ein Logfehler darf den Lauf nie kippen.
    }
  };
  const nimm = () => {
    try {
      return lockNehmen(lockDatei, { now: uhr(), pid });
    } catch (e) {
      basis.fehler = [{ session: basis.session, status: null, meldung: `Lock: ${e.message}` }];
      return "fehler"; // ein unlesbarer Zustandsordner: kein Lauf, aber nie ein Wurf
    }
  };
  let lock = nimm();
  if (lock === "belegt" && wiederholen) {
    await schlafen(WARTE_LOCK);
    lock = nimm();
  }
  basis.lock = lock;
  if (lock === "belegt" || lock === "fehler") {
    logge({ fehler: basis.fehler });
    return { lock, ergebnis: null };
  }
  try {
    const ergebnis = await lauf(args, { now: uhr() });
    logge({ exitCode: ergebnis.exitCode, protokoll: ergebnis.protokoll });
    return { lock, ergebnis };
  } catch (e) {
    logge({ exitCode: 1, fehler: [{ session: basis.session, status: null, meldung: e.message }] });
    return { lock, ergebnis: null };
  } finally {
    lockFreigeben(lockDatei, pid);
  }
}
