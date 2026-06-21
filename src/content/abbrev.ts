/* ===== KubeQuest – Baustein-Katalog: Langform ↔ Kürzel (#287/#298) =====
 * Die EINE zentrale Liste aller Konsolen-Bausteine, die in ZWEI gültigen Formen
 * existieren: eine selbsterklärende Langform und eine (oder mehrere) kürzere
 * Abkürzung(en). Pure Domäne (Phaser-/DOM-frei), damit im Node-Test prüfbar.
 *
 * Wofür: Grundlage der „verdiente Abkürzung"-Mechanik (#287). Die Freischalt-IDs
 * hier sind die IDs, die `Game.unlockAbbrev`/`isAbbrevUnlocked` (#297) verwalten;
 * das Akzeptanz-Gating (#299) erkennt über `findAbbrevByShort` die Kürzel-Tokens
 * und sperrt sie, bis sie freigeschaltet sind; der Lernpfad/Freischalt-Moment
 * (#300) hängt den Unlock an die passende Quest.
 *
 * WICHTIG: Nur ECHTE, am CLI gültige Äquivalente. KEINE erfundenen Formen
 * (z.B. `git checkout -b` hat KEIN `--branch` und steht daher NICHT hier). Der
 * Test in test/abbrev.test.ts erzwingt, dass jede gelistete Form tatsächlich
 * irgendwo im Spiel-Content (accept-Regex) vorkommt – tote/erfundene Einträge
 * fliegen auf.
 */

export interface AbbrevPair {
  /** Stabile Freischalt-ID (Schlüssel für unlockedAbbrev, #297). */
  readonly id: string;
  /** Menschenlesbarer Kontext/Befehl, in dem das Paar gilt (nur Doku/Anzeige). */
  readonly context: string;
  /** Art: Flag (`-a`/`--all`) oder Ressourcen-/Unterbefehl-Kürzel (`pods`/`po`). */
  readonly kind: "flag" | "alias";
  /** Die selbsterklärende Langform (wird zuerst gelehrt, #300). */
  readonly long: string;
  /** Die Abkürzung(en) – gleichwertig, aber Tipp-Ersparnis für Wissende. */
  readonly short: readonly string[];
  /** Unterbefehl-Tokens, bei deren Vorkommen VOR dem Alias-Token das Gating
   *  ausgesetzt wird — weil das Token dort literaler Unterbefehl ist, kein
   *  Ressourcen-Alias. Nur für `kind: "alias"` sinnvoll. Beispiel: `["create"]`
   *  für kubectl-secrets verhindert, dass `kubectl create secret generic …`
   *  blockiert wird, obwohl `secret` hier kein Kürzel für `secrets` ist (#308). */
  readonly excludeVerbs?: readonly string[];
}

/** Der Katalog. Reihenfolge ~ Lernpfad (Docker → kubectl → helm → git/argocd). */
export const ABBREVS: readonly AbbrevPair[] = [
  // ---- Flags: kurze UND lange Form sind echtes CLI (#286) ----
  { id: "docker-ps-all",      context: "docker ps",                     kind: "flag", long: "--all",       short: ["-a"] },
  { id: "docker-run-detach",  context: "docker run",                    kind: "flag", long: "--detach",    short: ["-d"] },
  { id: "docker-build-tag",   context: "docker build",                  kind: "flag", long: "--tag",       short: ["-t"] },
  { id: "kubectl-namespace",  context: "kubectl … (Namespace)",         kind: "flag", long: "--namespace", short: ["-n"] },
  // `-f` ist bei apply/create/delete die Kurzform von `--filename` – aber bei
  // `kubectl logs -f` ist es `--follow` (ein völlig anderes Flag). `excludeVerbs`
  // setzt das Gating aus, sobald `logs` vor dem `-f` steht, damit `kubectl logs -f`
  // nie fälschlich als gesperrte filename-Kurzform behandelt wird (#380).
  { id: "kubectl-filename",   context: "kubectl apply/create/delete",   kind: "flag", long: "--filename",  short: ["-f"], excludeVerbs: ["logs"] },
  { id: "helm-values",        context: "helm install/upgrade",          kind: "flag", long: "--values",    short: ["-f"] },
  { id: "git-commit-message", context: "git commit",                    kind: "flag", long: "--message",   short: ["-m"] },

  // ---- Ressourcen-/Unterbefehl-Kürzel (kubectl/helm/argocd) ----
  // Nur ECHTE Profi-Kürzel stehen in `short` — Singular-Formen (pod/node/service)
  // sind genauso kanonisch wie Plural und gehören nicht ins Gating (#308).
  { id: "kubectl-pods",       context: "kubectl get pods",              kind: "alias", long: "pods",            short: ["po"] },
  { id: "kubectl-nodes",      context: "kubectl get nodes",             kind: "alias", long: "nodes",           short: ["no"] },
  { id: "kubectl-services",   context: "kubectl get services",          kind: "alias", long: "services",        short: ["svc"] },
  // `secret` ist in `get/describe/delete` ein Alias für `secrets`, aber nach
  // `create` ein literaler Unterbefehl → Gating dort aussetzen (#308).
  { id: "kubectl-secrets",    context: "kubectl get secrets",           kind: "alias", long: "secrets",         short: ["secret"], excludeVerbs: ["create"] },
  { id: "kubectl-ingress",    context: "kubectl get ingress",           kind: "alias", long: "ingress",         short: ["ingresses", "ing"] },
  { id: "kubectl-netpol",     context: "kubectl get/describe/delete networkpolicies", kind: "alias", long: "networkpolicies", short: ["networkpolicy", "netpol", "netpols"] },
  { id: "helm-list",          context: "helm list",                     kind: "alias", long: "list",            short: ["ls"] },
  { id: "helm-dependency",    context: "helm dependency",               kind: "alias", long: "dependency",      short: ["dep"] },
  { id: "argocd-app-list",    context: "argocd app list",               kind: "alias", long: "list",            short: ["ls"] },
];

/** Findet den Katalog-Eintrag, dessen Kürzel exakt dieses Token ist (für das
 *  Akzeptanz-Gating #299: nur Kürzel sind freischaltpflichtig, Langformen nie).
 *  Achtung: das Token `ls`/`list` kommt in mehreren Kontexten vor – diese Funktion
 *  liefert den ERSTEN Treffer; das Gating wird den Kontext (Befehl) zusätzlich
 *  berücksichtigen müssen. */
export function findAbbrevByShort(token: string): AbbrevPair | undefined {
  return ABBREVS.find(a => a.short.includes(token));
}

/** Der Befehl (erstes Wort des Kontexts) eines Eintrags – „docker", „kubectl",
 *  „helm", „git", „argocd". Disambiguiert mehrdeutige Kürzel anhand des getippten
 *  Befehls (`-f` = kubectl `--filename` ODER helm `--values`; `ls` = helm ODER
 *  argocd). Der Kontext-String ist die SSOT dafür; das erste Wort ist immer der
 *  CLI-Befehl. */
function abbrevCommand(a: AbbrevPair): string {
  return a.context.trim().toLowerCase().split(/\s+/)[0];
}

/** Welche Abkürzungs-Bausteine nutzt die Eingabe in ihrer LANGFORM? (#313)
 *  Befehls-genau wie das Gating (ein `-f` zählt nur fürs passende Kommando). Das ist
 *  die Grundlage des Nutzungszählers „verdiente Abkürzung": jede korrekt getippte
 *  Langform zählt Richtung Freischaltung der zugehörigen Kurzform. Kurzformen zählen
 *  nicht (die werden ja verdient, nicht geübt). Pur (Phaser-/DOM-frei), testbar. */
export function longFormsInInput(input: string): string[] {
  const tokens = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const cmd = tokens[0];
  const ids: string[] = [];
  for (const a of ABBREVS) {
    if (abbrevCommand(a) !== cmd) continue;
    if (tokens.includes(a.long.toLowerCase())) ids.push(a.id);
  }
  return ids;
}

/** Treffer des Gatings: das gesperrte Paar + das konkret getippte Kürzel-Token. */
export interface LockedAbbrev {
  readonly pair: AbbrevPair;
  readonly used: string;
}

/** Akzeptanz-Gating (#299): Nutzt die Eingabe ein Kürzel, das für IHREN Befehl
 *  gilt, aber noch nicht freigeschaltet ist? Dann liefert die Funktion das
 *  gesperrte Paar + das getippte Kürzel (für den Hinweis), sonst `undefined`.
 *
 *  - Die Langform gilt IMMER (steht nie in `short`, löst also nie aus).
 *  - Der Befehl (erstes Token der Eingabe) muss zum Eintrag passen – so wird
 *    `helm install -f` NICHT von `kubectl --filename` und `argocd app ls` NICHT
 *    von `helm list` blockiert.
 *  - Token-genau (`pods` triggert nicht das Kürzel `pod`/`po`).
 *
 *  Pur: `isUnlocked` wird injiziert (keine Game-Kopplung) → im Node-Test prüfbar.
 *  Das UI ruft das VOR der Erfolgswertung auf und ersetzt einen Treffer durch
 *  einen freundlichen Hinweis statt eines harten „Falsch".
 *
 *  `exemptId` (#366): die Abkürzung, die der GERADE laufende Lehr-Schritt selbst
 *  freischaltet (`step.unlockAbbrev`). Genau dieser Schritt führt die Kurzform ein
 *  und schaltet sie beim Abschluss frei – seine eigene Kurzform darf er deshalb
 *  schon verwenden, sonst widerspricht der Auftrag („tippe <code>docker ps -a</code>")
 *  dem Gating („-a ist noch gesperrt, schreib --all"). Das Gating schützt also nur
 *  noch VOR dem Lehr-Schritt, nicht IN ihm. Andere (noch gesperrte) Abkürzungen
 *  bleiben auch in diesem Schritt blockiert. */
export function lockedAbbrevInInput(
  input: string,
  isUnlocked: (id: string) => boolean,
  exemptId?: string,
): LockedAbbrev | undefined {
  const tokens = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  const cmd = tokens[0];
  for (const a of ABBREVS) {
    if (abbrevCommand(a) !== cmd) continue;     // nur Einträge dieses Befehls
    if (a.id === exemptId) continue;            // #366: der freischaltende Schritt darf seine eigene Kurzform nutzen
    if (isUnlocked(a.id)) continue;             // freigeschaltet → beide Formen gelten
    const used = a.short.find(s => tokens.includes(s));
    if (!used) continue;
    // Unterbefehl-Ausnahme (#308): steht ein excludeVerb VOR dem Alias-Token,
    // wird das Token dort als literaler Unterbefehl benutzt — kein Gating.
    if (a.excludeVerbs) {
      const aliasIdx = tokens.indexOf(used);
      const tokensBefore = tokens.slice(0, aliasIdx);
      if (a.excludeVerbs.some(v => tokensBefore.includes(v))) continue;
    }
    return { pair: a, used };                   // gesperrtes Kürzel getippt
  }
  return undefined;
}

/** Freundlicher Hinweis fürs Gating (#299): nennt das getippte Kürzel und die
 *  jetzt zu verwendende Langform. Enthält `<code>` passend zu den übrigen
 *  Eingabe-Rückmeldungen, die per innerHTML gerendert werden. */
export function abbrevLockHint(hit: LockedAbbrev): string {
  return `🔒 <code>${hit.used}</code> ist eine Profi-Abkürzung, die du <b>später freischaltest</b>. `
    + `Schreib sie vorerst aus: <code>${hit.pair.long}</code>.`;
}

/** Treffer einer „Beinahe"-Schreibweise: richtiges Flag, falsche Bindestrich-Anzahl. */
export interface FlagNearMiss {
  readonly pair: AbbrevPair;
  /** Das falsch geschriebene Token, z.B. `-all` (statt `-a`/`--all`) oder `--a`. */
  readonly used: string;
}

/** Erkennt eine „Beinahe"-Schreibweise eines Flags (#367): richtige Buchstaben,
 *  aber falsche Bindestrich-Anzahl – der klassische Anfänger-Stolperstein
 *  `docker ps -all` (ein Strich + ganzes Wort) statt `-a`/`--all`, sowie
 *  symmetrisch `--a` (zwei Striche + ein Buchstabe). Nur für `kind: "flag"`
 *  (Aliase wie `pods`/`po` haben keine Bindestrich-Form). Befehls-genau wie das
 *  Gating: nur Flags DES getippten Befehls. Pur (Phaser-/DOM-frei), testbar.
 *
 *  Gibt das gemeinte Paar + das falsche Token zurück, sonst `undefined`. Gültige
 *  Formen (`-a`, `--all`) lösen NIE aus – die führt der Akzeptanz-Pfad. */
export function flagNearMiss(input: string): FlagNearMiss | undefined {
  const tokens = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  const cmd = tokens[0];
  for (const a of ABBREVS) {
    if (a.kind !== "flag") continue;
    if (abbrevCommand(a) !== cmd) continue;
    // Falsche Schreibweisen sammeln: „-<langwort>" (ein Strich) + je Kürzel „--<buchstabe>".
    const malformed = new Set<string>(["-" + a.long.replace(/^--/, "")]);
    for (const s of a.short) malformed.add("--" + s.replace(/^-+/, ""));
    const used = tokens.find(t => malformed.has(t) && t !== a.long && !a.short.includes(t));
    if (used) return { pair: a, used };
  }
  return undefined;
}

/** Hinweis für eine Beinahe-Schreibweise (#367): nennt die korrekten Formen.
 *  Die **Kurzform wird nur vorgeschlagen, wenn sie verfügbar ist** – freigeschaltet
 *  ODER vom gerade laufenden Lehr-Schritt freigeschaltet (`exemptId`, #366). Solange
 *  sie gesperrt ist, nennt der Hinweis NUR die Langform, damit er kein Kürzel
 *  vorwegnimmt (gleiche Regel wie das Gating). `undefined`, wenn keine Beinahe-
 *  Schreibweise vorliegt. */
export function flagNearMissHint(
  input: string,
  isUnlocked: (id: string) => boolean,
  exemptId?: string,
): string | undefined {
  const hit = flagNearMiss(input);
  if (!hit) return undefined;
  const shortAvailable = isUnlocked(hit.pair.id) || hit.pair.id === exemptId;
  if (shortAvailable) {
    return `🔧 <code>${hit.used}</code> gibt es nicht. Gemeint ist <code>${hit.pair.short[0]}</code> `
      + `(ein Strich + ein Buchstabe) oder <code>${hit.pair.long}</code> (zwei Striche + ganzes Wort).`;
  }
  return `🔧 <code>${hit.used}</code> gibt es nicht – schreib <code>${hit.pair.long}</code> `
    + `(zwei Striche + ganzes Wort).`;
}
