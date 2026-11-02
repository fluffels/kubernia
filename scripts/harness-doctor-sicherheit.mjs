/* Harness-Doctor, Sicherheitspunkte (factory#116, ADR 0022): die acht Einstellungen, die ein Repo gegen Geheimnis-Lecks und Lieferketten-Angriffe
 * härten, je Punkt `gut`, `LÜCKE` oder `nicht prüfbar` mit Grund. Pur: keine Imports, kein gh, kein fs; die Lib liest die Quellen und reicht sie her.
 *
 * Jede Quelle ist `{ wert }` (Antwort des Endpunkts) oder `{ fehler: "<erste Fehlerzeile>", fix? }`. `pruefeSicherheit` liefert immer genau
 * acht Ergebnisse in der Reihenfolge von `SICHERHEIT_PUNKTE`, nie weniger und nie still grün: ein Fehler des Endpunkts (403, 404, Netz) und ein
 * fehlendes oder unbekanntes Feld ergeben „nicht prüfbar“ (`ok: false, nichtPruefbar: true`), nur ein belegter Wert ergibt OK oder LÜCKE.
 * Lücken nennen den Klickpfad in den Einstellungen, nie einen schreibenden `gh`-Befehl: `--einrichten` ändert diese Punkte nicht.
 * Grenze: `secret_scanning_validity_checks` steht nicht in der REST-Doku von „Get a repository“; die Live-Probe mit Admin-Recht zeigt ihn; fehlt er in einem Projekt, ist der Punkt nicht prüfbar.
 */

export const LINK_RULESET = "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository";
export const LINK_ACTIONS = "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository";
const DOKU = "https://docs.github.com/en/code-security";

/** Die acht Punkte in der Reihenfolge der Ausgabe. */
export const SICHERHEIT_PUNKTE = ["Secret Scanning", "Push Protection", "Non-Provider-Patterns", "Validity Checks", "PVR", "Dependabot Security Updates", "Code-Scanning", "SHA-Pinning"];

/** Doku-Seite je Punkt (nur `--einrichten`, als `Link:`). */
export const LINK_SICHERHEIT = {
  "Secret Scanning": `${DOKU}/how-tos/secure-your-secrets/detect-secret-leaks/enabling-secret-scanning-for-your-repository`,
  "Push Protection": `${DOKU}/how-tos/secure-your-secrets/prevent-future-leaks/enabling-push-protection-for-your-repository`,
  "Non-Provider-Patterns": `${DOKU}/secret-scanning/using-advanced-secret-scanning-and-push-protection-features/non-provider-patterns/enabling-secret-scanning-for-non-provider-patterns`,
  "Validity Checks": `${DOKU}/secret-scanning/enabling-secret-scanning-features/enabling-validity-checks-for-your-repository`,
  PVR: `${DOKU}/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configuring-private-vulnerability-reporting-for-a-repository`,
  "Dependabot Security Updates": `${DOKU}/dependabot/dependabot-security-updates/configuring-dependabot-security-updates`,
  "Code-Scanning": LINK_RULESET,
  "SHA-Pinning": LINK_ACTIONS,
};

const FIX_FEHLER = "mit einem Konto mit Admin-Recht prüfen (gh auth status), dann erneut prüfen";
const FIX_FELD = "Funktion im Plan nicht verfügbar oder Feld unbekannt: in den Einstellungen von Hand prüfen";
export const GRENZE_PRIVAT = " (private Repos auf GitHub Free kennen keine Rulesets, ADR 0022)";

const gut = (punkt, hinweis) => ({ punkt, ok: true, ...(hinweis ? { hinweis } : {}) });
const luecke = (punkt, befund, fix) => ({ punkt, ok: false, befund, fix, link: LINK_SICHERHEIT[punkt] });
const nichtPruefbar = (punkt, grund, fix = FIX_FELD) => ({ punkt, ok: false, nichtPruefbar: true, befund: grund, fix, link: LINK_SICHERHEIT[punkt] });
/** Nicht prüfbar, weil die Quelle selbst fehlschlug; `quelle.fix` (etwa „erst den Token-Punkt beheben“) hat Vorrang. */
const ausFehler = (punkt, was, quelle) => nichtPruefbar(punkt, `${was} nicht lesbar (${quelle.fehler})`, quelle.fix ?? FIX_FEHLER);

/** Die fünf Punkte aus `security_and_analysis`: Schlüssel und Klickpfad der Lücke. */
const SECURITY_AND_ANALYSIS = {
  "Secret Scanning": ["secret_scanning", "Settings › Advanced Security: Secret Scanning aktivieren"],
  "Push Protection": ["secret_scanning_push_protection", "Settings › Advanced Security: Push protection aktivieren"],
  "Non-Provider-Patterns": ["secret_scanning_non_provider_patterns", "Settings › Advanced Security: Scanning for non-provider patterns aktivieren"],
  "Validity Checks": ["secret_scanning_validity_checks", "Settings › Advanced Security: Automatic validity checks aktivieren"],
  "Dependabot Security Updates": ["dependabot_security_updates", "Settings › Advanced Security: Dependabot security updates aktivieren"],
};

function analysePunkt(punkt, repo) {
  const [schluessel, fix] = SECURITY_AND_ANALYSIS[punkt];
  if (repo.fehler !== undefined) return ausFehler(punkt, "Repo-Einstellungen", repo);
  const sa = repo.wert?.security_and_analysis;
  if (sa === null || typeof sa !== "object") return nichtPruefbar(punkt, "security_and_analysis fehlt in der Antwort (sichtbar nur mit Admin-Recht)", FIX_FEHLER);
  const status = sa[schluessel]?.status;
  if (status === "enabled") return gut(punkt);
  if (status === "disabled") return luecke(punkt, `${schluessel} ist ausgeschaltet`, fix);
  return nichtPruefbar(punkt, `${schluessel} fehlt in security_and_analysis oder hat einen unbekannten Status`);
}

/** Ein boolesches Feld einer Antwort (`feld`): `true` gut, `false` Lücke, alles andere nicht prüfbar. */
function boolPunkt(punkt, quelle, { was, feld, aus, fix }) {
  if (quelle.fehler !== undefined) return ausFehler(punkt, was, quelle);
  const wert = quelle.wert?.[feld];
  if (wert === true) return gut(punkt);
  if (wert === false) return luecke(punkt, aus, fix);
  return nichtPruefbar(punkt, `${feld} fehlt in der Antwort von ${was}`);
}

function codeScanningPunkt(regeln, { spiegel, branch, privat }) {
  const punkt = "Code-Scanning";
  const grenze = privat ? GRENZE_PRIVAT : "";
  if (regeln.fehler !== undefined) return ausFehler(punkt, `Regeln auf ${branch}`, regeln);
  const live = (regeln.wert ?? []).filter((r) => r.type === "code_scanning").flatMap((r) => (r.parameters?.code_scanning_tools ?? []).map((w) => w.tool));
  const soll = (spiegel?.codeScanning ?? []).map((e) => e.tool);
  const rs = spiegel?.name ? `Ruleset "${spiegel.name}"` : "das Ruleset";
  const fehlend = soll.filter((w) => !live.includes(w));
  if (fehlend.length) return luecke(punkt, `Code-Scanning ${fehlend.map((w) => `"${w}"`).join(", ")} fehlt auf ${branch}${grenze}`, `Regel in ${rs} ergänzen (Pre-Flight)`);
  if (soll.length === 0 && live.length === 0) return luecke(punkt, `keine Code-Scanning-Regel auf ${branch}${grenze}`, `Code-Scanning-Regel in ${rs} ergänzen (Pre-Flight)`);
  if (soll.length === 0) return gut(punkt, "der Ruleset-Spiegel nennt kein codeScanning: das Werkzeug dort nachtragen");
  return gut(punkt);
}

/**
 * Pur: die acht Sicherheitspunkte. `repo` = `repos/<repo>`, `actions` = `…/actions/permissions`, `regeln` = die Branch-Regeln (flache Liste),
 * `pvr` = `…/private-vulnerability-reporting`, je als Quelle; `spiegel` der Ruleset-Spiegel, `branch` der Standardzweig, `privat` ob das Repo privat ist.
 */
export function pruefeSicherheit({ repo, actions, regeln, pvr, spiegel, branch = "main", privat = false }) {
  const ergebnis = {
    PVR: () => boolPunkt("PVR", pvr, { was: "private-vulnerability-reporting", feld: "enabled", aus: "Private Vulnerability Reporting ist ausgeschaltet", fix: "Settings › Advanced Security: Private vulnerability reporting aktivieren" }),
    "Code-Scanning": () => codeScanningPunkt(regeln, { spiegel, branch, privat }),
    "SHA-Pinning": () => boolPunkt("SHA-Pinning", actions, { was: "actions/permissions", feld: "sha_pinning_required", aus: "Actions müssen nicht an einen vollen Commit-SHA gepinnt sein", fix: "Settings › Actions › General: Require actions to be pinned to a full-length commit SHA aktivieren" }),
  };
  return SICHERHEIT_PUNKTE.map((p) => (ergebnis[p] ? ergebnis[p]() : analysePunkt(p, repo)));
}
