/* Validierung des Baustein-Katalogs (Langform↔Kürzel, #287/#298).
 *
 * Der Katalog ist die SSOT für die „verdiente Abkürzung"-Mechanik. Dieser Test
 * sichert ihn gegen zwei Fehlerklassen ab:
 *  1. doppelte/leere IDs oder Formen (Datenhygiene),
 *  2. tote/erfundene Einträge: JEDE gelistete Form (Lang UND jedes Kürzel) muss
 *     tatsächlich in einer accept-Regex des Spiel-Contents vorkommen. Damit kann
 *     keine Form im Katalog stehen, die das Spiel gar nicht akzeptiert – und keine
 *     erfundene Langform (z.B. ein nicht existierendes `--branch`) durchrutschen.
 */
import { test, expect, describe } from "vitest";
import assert from "node:assert/strict";
import { ABBREVS, findAbbrevByShort, lockedAbbrevInInput, abbrevLockHint, flagNearMiss, flagNearMissHint, longFormsInInput } from "../src/content/abbrev";
import { KQContent } from "../src/content";
import { Sim as KQSim } from "../src/sim";
import type { QuestStep } from "../src/types";

/** Alle accept-Regex-Quellen des Spiel-Contents einsammeln: Befehlskarten,
 *  Drills (instanziiert – die Alternationen stehen unabhängig von Zufallsnamen
 *  in der Regex) und Quest-Teach-/Terminal-Schritte. */
function allAcceptSources(): string[] {
  const out: string[] = [];
  for (const c of KQContent.CMD_CARDS) for (const re of c.accept) out.push(re.source);
  for (const make of Object.values(KQContent.DRILLS)) for (const re of make(new KQSim({})).accept) out.push(re.source);
  for (const quest of KQContent.QUESTS) for (const step of quest.steps) {
    if (step.type === "teach") for (const re of step.cmd.accept) out.push(re.source);
    if (step.type === "terminal") for (const t of step.tasks) for (const re of t.accept) out.push(re.source);
  }
  return out;
}

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Kommt `token` als eigenständige Alternative in der Regex-Quelle vor? Grenzen
 *  sind Nicht-Wort-/Nicht-Bindestrich-Zeichen, damit `po` NICHT im Inneren von
 *  `pods` und `-d` NICHT in `--detach` fälschlich matcht. */
const tokenAppears = (source: string, token: string) =>
  new RegExp(`(?:^|[^\\w-])${escapeReg(token)}(?:$|[^\\w-])`).test(source);

const SOURCES = allAcceptSources();
const appearsAnywhere = (token: string) => SOURCES.some(s => tokenAppears(s, token));

describe("Baustein-Katalog: Datenhygiene", () => {
  test("IDs sind eindeutig und nicht leer", () => {
    const ids = ABBREVS.map(a => a.id);
    assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), "doppelte Katalog-IDs");
    for (const a of ABBREVS) assert.ok(a.id.trim().length > 0, "leere ID");
  });

  test("jeder Eintrag hat eine Langform und mindestens ein nicht-leeres Kürzel", () => {
    for (const a of ABBREVS) {
      assert.ok(a.long.trim().length > 0, a.id + ": leere Langform");
      assert.ok(a.short.length >= 1, a.id + ": kein Kürzel");
      for (const s of a.short) assert.ok(s.trim().length > 0 && s !== a.long, `${a.id}: Kürzel „${s}" leer oder = Langform`);
    }
  });
});

describe("Baustein-Katalog: keine toten/erfundenen Formen", () => {
  test("jede Langform kommt in einer accept-Regex des Spiels vor", () => {
    const fehlend = ABBREVS.filter(a => !appearsAnywhere(a.long)).map(a => `${a.id} (${a.long})`);
    assert.deepEqual(fehlend, [], "Langformen, die im Content fehlen:\n" + fehlend.join("\n"));
  });

  test("jedes Kürzel kommt in einer accept-Regex des Spiels vor", () => {
    const fehlend: string[] = [];
    for (const a of ABBREVS) for (const s of a.short) if (!appearsAnywhere(s)) fehlend.push(`${a.id} (${s})`);
    assert.deepEqual(fehlend, [], "Kürzel, die im Content fehlen:\n" + fehlend.join("\n"));
  });

  test("Gegenprobe: eine erfundene Langform würde der Test fangen (--branch existiert nicht)", () => {
    // git checkout -b hat KEIN --branch -> darf nirgends auftauchen (Schutz vor Erfindung).
    expect(appearsAnywhere("--branch")).toBe(false);
  });
});

describe("findAbbrevByShort", () => {
  test("liefert den Eintrag zu einem Kürzel-Token", () => {
    expect(findAbbrevByShort("-a")?.id).toBe("docker-ps-all");
    expect(findAbbrevByShort("po")?.id).toBe("kubectl-pods");
    expect(findAbbrevByShort("netpol")?.id).toBe("kubectl-netpol");
  });

  test("liefert undefined für Langformen und Unbekanntes (nur Kürzel sind freischaltpflichtig)", () => {
    expect(findAbbrevByShort("--all")).toBeUndefined();
    expect(findAbbrevByShort("pods")).toBeUndefined();
    expect(findAbbrevByShort("gibtsnicht")).toBeUndefined();
  });
});

/* #299: Akzeptanz-Gating – Kürzel erst nach Freischaltung, Langform immer. */
describe("lockedAbbrevInInput – Gating der Eingabe-Akzeptanz (#299)", () => {
  const NICHTS_FREI = (_id: string) => false;       // frischer Spielstand: alles gesperrt
  const ALLES_FREI = (_id: string) => true;         // grandfathered / alles freigeschaltet
  const nurFrei = (...ids: string[]) => (id: string) => ids.includes(id);

  test("gesperrtes Kürzel wird erkannt (Paar + getipptes Token)", () => {
    const hit = lockedAbbrevInInput("docker ps -a", NICHTS_FREI);
    expect(hit?.pair.id).toBe("docker-ps-all");
    expect(hit?.used).toBe("-a");
  });

  test("Langform löst NIE aus (gilt immer, auch bei allem gesperrt)", () => {
    expect(lockedAbbrevInInput("docker ps --all", NICHTS_FREI)).toBeUndefined();
    expect(lockedAbbrevInInput("kubectl get pods", NICHTS_FREI)).toBeUndefined();
  });

  test("nach Freischaltung gilt das Kürzel (kein Treffer mehr)", () => {
    expect(lockedAbbrevInInput("docker ps -a", nurFrei("docker-ps-all"))).toBeUndefined();
    expect(lockedAbbrevInInput("docker ps -a", ALLES_FREI)).toBeUndefined();
  });

  test("token-genau: Langform „pods“ triggert nicht das Kürzel „pod“/„po“", () => {
    expect(lockedAbbrevInInput("kubectl get pods", NICHTS_FREI)).toBeUndefined();
    expect(lockedAbbrevInInput("kubectl get po", NICHTS_FREI)?.pair.id).toBe("kubectl-pods");
    expect(lockedAbbrevInInput("kubectl get po", NICHTS_FREI)?.used).toBe("po");
  });

  test("Kontext-Disambiguierung „-f“: kubectl vs. helm", () => {
    // -f gehört zu zwei Einträgen – der getippte Befehl entscheidet.
    expect(lockedAbbrevInInput("kubectl apply -f app.yaml", NICHTS_FREI)?.pair.id).toBe("kubectl-filename");
    expect(lockedAbbrevInInput("helm install rel ./c -f values.yaml", NICHTS_FREI)?.pair.id).toBe("helm-values");
  });

  test("ein anderer Befehl mit gleichem Kürzel blockiert NICHT (Negativfall)", () => {
    // helm-values gesperrt, kubectl-filename frei: ein kubectl -f darf nicht über helm-values stolpern.
    expect(lockedAbbrevInInput("kubectl apply -f app.yaml", nurFrei("kubectl-filename"))).toBeUndefined();
    // umgekehrt: helm -f bleibt frei, wenn nur kubectl-filename gesperrt ist.
    expect(lockedAbbrevInInput("helm install rel ./c -f values.yaml", nurFrei("helm-values"))).toBeUndefined();
  });

  test("Kontext-Disambiguierung „ls“: helm vs. argocd", () => {
    expect(lockedAbbrevInInput("helm ls", NICHTS_FREI)?.pair.id).toBe("helm-list");
    expect(lockedAbbrevInInput("argocd app ls", NICHTS_FREI)?.pair.id).toBe("argocd-app-list");
  });

  test("leere Eingabe / fremder Befehl ohne Katalog-Kürzel → kein Treffer", () => {
    expect(lockedAbbrevInInput("", NICHTS_FREI)).toBeUndefined();
    expect(lockedAbbrevInInput("   ", NICHTS_FREI)).toBeUndefined();
    expect(lockedAbbrevInInput("ls -a", NICHTS_FREI)).toBeUndefined();          // „ls" ist hier der Befehl, kein kubectl/helm
    expect(lockedAbbrevInInput("kubectl get deployments", NICHTS_FREI)).toBeUndefined();
  });

  test("der Hinweis nennt das getippte Kürzel und die auszuschreibende Langform", () => {
    const hit = lockedAbbrevInInput("kubectl get svc", NICHTS_FREI)!;
    expect(hit.pair.id).toBe("kubectl-services");
    const msg = abbrevLockHint(hit);
    expect(msg).toContain("svc");        // das getippte Kürzel
    expect(msg).toContain("services");   // die Langform
  });
});

/* #308: Gating-Regression — gültige Musterlösungen dürfen nicht geblockt werden. */
describe("lockedAbbrevInInput – Regressionsfixes #308", () => {
  const NICHTS_FREI = (_id: string) => false;

  test("kubectl create secret generic … darf NICHT geblockt werden (secret ist Unterbefehl von create, kein Alias)", () => {
    expect(lockedAbbrevInInput("kubectl create secret generic db-zugang --from-literal=pass=secret123", NICHTS_FREI)).toBeUndefined();
    expect(lockedAbbrevInInput("kubectl create secret generic webapp-credentials --from-literal=user=admin", NICHTS_FREI)).toBeUndefined();
    expect(lockedAbbrevInInput("kubectl create secret tls my-tls --cert=tls.crt --key=tls.key", NICHTS_FREI)).toBeUndefined();
  });

  test("kubectl get secret (Singular) ist NICHT geblockt — kein offizieller kubectl-Kurzname, kein Gating (#459)", () => {
    expect(lockedAbbrevInInput("kubectl get secret", NICHTS_FREI)).toBeUndefined();
  });

  test("kubectl describe pod <name> darf NICHT geblockt werden — Singular ist kanonisch, kein Profi-Kürzel", () => {
    expect(lockedAbbrevInInput("kubectl describe pod my-pod", NICHTS_FREI)).toBeUndefined();
  });

  test("kubectl delete pod <name> darf NICHT geblockt werden — Singular ist kanonisch", () => {
    expect(lockedAbbrevInInput("kubectl delete pod my-pod", NICHTS_FREI)).toBeUndefined();
  });

  test("kubectl get po blockiert weiterhin — po ist echter Profi-Shortcut für pods", () => {
    const hit = lockedAbbrevInInput("kubectl get po", NICHTS_FREI);
    expect(hit?.pair.id).toBe("kubectl-pods");
    expect(hit?.used).toBe("po");
  });

  test("kubectl get node darf NICHT geblockt werden — Singular ist kanonisch", () => {
    expect(lockedAbbrevInInput("kubectl get node", NICHTS_FREI)).toBeUndefined();
  });

  test("kubectl get service darf NICHT geblockt werden — Singular ist kanonisch", () => {
    expect(lockedAbbrevInInput("kubectl get service", NICHTS_FREI)).toBeUndefined();
  });
});

/* #430: Gating-Konsistenz – das #308-Prinzip (ausgeschriebene Voll-Formen sind
 * keine Profi-Abkürzung) gilt jetzt einheitlich für ALLE Ressourcen, Singular wie
 * Plural. Konkret entschieden:
 *  - networkpolicy (Singular-Vollform) und ingresses (Plural-Vollform) sind NICHT
 *    mehr gegated – nur die echten Kontraktionen netpol/netpols bzw. ing bleiben es.
 *  - Bewusste Ausnahme: secret bleibt gegated, weil `secrets` keinen offiziellen
 *    kubectl-Kurznamen hat und die Singularform als verdienbarer Stellvertreter
 *    dient (siehe Kommentar in abbrev.ts; mögliches Folgeticket). */
describe("lockedAbbrevInInput – #430: kanonische Voll-Formen (Singular/Plural) sind nicht gegated", () => {
  const NICHTS_FREI = (_id: string) => false;

  test("kubectl describe/delete networkpolicy <name> ist NICHT gegated — Singular-Vollform, kein Profi-Kürzel", () => {
    expect(lockedAbbrevInInput("kubectl describe networkpolicy hafenmauer", NICHTS_FREI)).toBeUndefined();
    expect(lockedAbbrevInInput("kubectl delete networkpolicy hafenmauer", NICHTS_FREI)).toBeUndefined();
  });

  test("kubectl get ingresses ist NICHT gegated — Plural-Vollform, kein Profi-Kürzel", () => {
    expect(lockedAbbrevInInput("kubectl get ingresses", NICHTS_FREI)).toBeUndefined();
  });

  test("die echten Kontraktionen bleiben gegated (Red-Green-Gegenprobe)", () => {
    expect(lockedAbbrevInInput("kubectl get netpol", NICHTS_FREI)?.pair.id).toBe("kubectl-netpol");
    expect(lockedAbbrevInInput("kubectl get netpols", NICHTS_FREI)?.pair.id).toBe("kubectl-netpol");
    expect(lockedAbbrevInInput("kubectl get ing", NICHTS_FREI)?.pair.id).toBe("kubectl-ingress");
  });

  test("keine Ausnahme mehr: kubectl get secret ist NICHT gegated — kubectl-secrets entfernt (#459)", () => {
    expect(lockedAbbrevInInput("kubectl get secret", NICHTS_FREI)).toBeUndefined();
  });
});

/* #300: Lernpfad-Vollständigkeit – jede Abkürzung im Katalog muss über einen
 * Quest-Schritt freigeschaltet werden (unlockAbbrev). Damit fliegt sofort auf,
 * wenn eine neue AbbrevPair-ID hinzukommt, aber kein passender Teach-/Terminal-
 * Schritt angelegt wird. */
describe("unlockAbbrev-Lernpfad: jede Abkürzung ist freischaltbar – Quest-Schritt ODER Nutzungszähler (#300/#313)", () => {
  function allUnlockIds(): Set<string> {
    const ids = new Set<string>();
    for (const quest of KQContent.QUESTS) {
      for (const step of quest.steps) {
        if (step.unlockAbbrev) ids.add(step.unlockAbbrev);
      }
    }
    return ids;
  }

  test("jede ABBREVS-ID ist freischaltbar: per Quest-Schritt ODER nutzungsbasiert (Langform im Content)", () => {
    const unlocked = allUnlockIds();
    // #313: Ohne expliziten Freischalt-Schritt muss die Abkürzung über den Nutzungszähler
    // verdienbar sein – das setzt voraus, dass ihre Langform überhaupt im Content vorkommt
    // (sonst könnte man sie nie tippen und damit nie verdienen). Mind. einer der Wege muss gelten.
    const fehlend = ABBREVS.filter(a => !unlocked.has(a.id) && !appearsAnywhere(a.long)).map(a => `${a.id} (${a.long})`);
    assert.deepEqual(fehlend, [], "Abkürzungen, die WEDER per Schritt NOCH per Nutzung freischaltbar sind:\n" + fehlend.join("\n"));
  });

  test("alle unlockAbbrev-Referenzen in Quests zeigen auf existierende ABBREVS-IDs", () => {
    const validIds = new Set(ABBREVS.map(a => a.id));
    const ungültig: string[] = [];
    for (const quest of KQContent.QUESTS) {
      for (const step of quest.steps) {
        if (step.unlockAbbrev && !validIds.has(step.unlockAbbrev)) {
          ungültig.push(`Quest ${quest.id}: unlockAbbrev="${step.unlockAbbrev}" nicht im Katalog`);
        }
      }
    }
    assert.deepEqual(ungültig, [], "Ungültige unlockAbbrev-Referenzen:\n" + ungültig.join("\n"));
  });
});

/* #366: Kein Lehr-/Quest-Text darf eine Profi-Abkürzung verlangen oder vorführen,
 * die zu diesem Zeitpunkt noch gesperrt ist (sonst widerspricht der Auftrag dem
 * Gating: „tippe docker ps -a" ↔ „-a ist gesperrt, schreib --all"). Zwei Wächter,
 * beide über KQContent.QUESTS in Spielreihenfolge – greifen daher auf beiden
 * Content-Repräsentationen (TS-Quests bzw. Content-as-Data via Loader). */
describe("#366: Quest-/Lehrtexte nehmen keine gesperrten Abkürzungen vorweg", () => {
  const NICHTS_FREI = (_id: string) => false;

  test("Baseline: ohne Ausnahme bleibt die Kurzform des Lehr-Schritts geblockt", () => {
    // Beweist, dass der folgende exemptId-Test kein False-Positive ist.
    expect(lockedAbbrevInInput("docker ps -a", NICHTS_FREI)?.pair.id).toBe("docker-ps-all");
  });

  test("der freischaltende Schritt darf seine EIGENE Kurzform schon tippen (exemptId)", () => {
    expect(lockedAbbrevInInput("docker ps -a", NICHTS_FREI, "docker-ps-all")).toBeUndefined();
    expect(lockedAbbrevInInput("docker run -d --name web nginx", NICHTS_FREI, "docker-run-detach")).toBeUndefined();
  });

  test("die Ausnahme gilt NUR für die eigene Abkürzung (Negativfall)", () => {
    // Ein Schritt, der docker-ps-all freischaltet, hebelt docker-run-detach NICHT aus.
    expect(lockedAbbrevInInput("docker run -d", NICHTS_FREI, "docker-ps-all")?.pair.id).toBe("docker-run-detach");
    // Eine fremde exemptId ändert nichts an einer anderen gesperrten Kurzform.
    expect(lockedAbbrevInInput("docker ps -a", NICHTS_FREI, "kubectl-pods")?.pair.id).toBe("docker-ps-all");
  });

  test("(a) keine Sackgasse: jede Musterlösung ist zum Zeitpunkt ihres Schritts tippbar", () => {
    // Spielreihenfolge durchlaufen, Freischaltungen mitführen (Unlock greift erst NACH
    // dem Schritt → die eigene Abkürzung des Schritts ist nur via exemptId erlaubt).
    const unlocked = new Set<string>();
    const isUnlocked = (id: string) => unlocked.has(id);
    const verstoesse: string[] = [];
    for (const quest of KQContent.QUESTS) {
      for (const step of quest.steps) {
        const tasks = step.type === "teach" ? [step.cmd]
                    : step.type === "terminal" ? step.tasks
                    : [];
        for (const t of tasks) {
          const hit = lockedAbbrevInInput(t.solution, isUnlocked, step.unlockAbbrev);
          if (hit) verstoesse.push(`${quest.id}/${t.id}: Lösung „${t.solution}" nutzt gesperrtes „${hit.used}" (${hit.pair.id})`);
        }
        if (step.unlockAbbrev) unlocked.add(step.unlockAbbrev);
      }
    }
    assert.deepEqual(verstoesse, [], "Funk-Schritte mit blockierter Musterlösung:\n" + verstoesse.join("\n"));
  });

  test("(b) keine Vorwegnahme: kein <code>-Befehl zeigt eine erst später freigeschaltete Kurzform", () => {
    const quests = KQContent.QUESTS;
    // Pro Quest: alle Abkürzungen, die bis EINSCHLIESSLICH dieses Quests freigeschaltet
    // werden. Quest-Granularität ist Absicht: die Einführungs-Dialoge im selben Quest
    // wie der Lehr-Schritt dürfen die Kurzform zeigen, nur frühere Quests nicht.
    const unlockedThrough: Set<string>[] = [];
    const acc = new Set<string>();
    for (const quest of quests) {
      for (const step of quest.steps) if (step.unlockAbbrev) acc.add(step.unlockAbbrev);
      unlockedThrough.push(new Set(acc));
    }
    const codeSnippets = (text: string): string[] => {
      const out: string[] = [];
      const re = /<code>([\s\S]*?)<\/code>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        out.push(m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
      }
      return out;
    };
    const stepTexts = (step: QuestStep): string[] => {
      switch (step.type) {
        case "dialog": return step.lines;
        case "choice": return [step.q, ...step.options.flatMap((o) => [o.t, o.reply])];
        case "teach": return [step.cmd.intro, step.cmd.text, step.cmd.hint];
        case "terminal": return step.tasks.flatMap((t) => [t.text, t.hint]);
        case "drill": return [step.intro];
        default: return [];
      }
    };
    const verstoesse: string[] = [];
    quests.forEach((quest, qi) => {
      const frei = unlockedThrough[qi];
      for (const step of quest.steps) {
        for (const text of stepTexts(step)) {
          for (const snippet of codeSnippets(text)) {
            const hit = lockedAbbrevInInput(snippet, (id) => frei.has(id));
            if (hit) verstoesse.push(`${quest.id}: „${snippet}" zeigt „${hit.used}" (${hit.pair.id}), erst später freigeschaltet`);
          }
        }
      }
    });
    assert.deepEqual(verstoesse, [], "Texte mit vorweggenommener Kurzform:\n" + verstoesse.join("\n"));
  });
});

/* #367: „Beinahe"-Schreibweise eines Flags (richtige Buchstaben, falsche Strich-
 * Anzahl) bekommt einen gezielten Hinweis. Die Kurzform wird darin nur genannt,
 * wenn sie verfügbar ist (freigeschaltet ODER vom laufenden Lehr-Schritt, #366). */
describe("#367: Beinahe-Schreibweise eines Flags (-all statt -a/--all)", () => {
  const NICHTS_FREI = (_id: string) => false;
  const nurFrei = (...ids: string[]) => (id: string) => ids.includes(id);

  describe("flagNearMiss – Erkennung", () => {
    test("ein Strich + ganzes Wort wird erkannt (-all)", () => {
      const hit = flagNearMiss("docker ps -all");
      expect(hit?.pair.id).toBe("docker-ps-all");
      expect(hit?.used).toBe("-all");
    });

    test("zwei Striche + ein Buchstabe wird erkannt (--a)", () => {
      const hit = flagNearMiss("docker ps --a");
      expect(hit?.pair.id).toBe("docker-ps-all");
      expect(hit?.used).toBe("--a");
    });

    test("greift für weitere Flags und ist befehls-genau (-detach, -message)", () => {
      expect(flagNearMiss("docker run -detach nginx")?.pair.id).toBe("docker-run-detach");
      expect(flagNearMiss("git commit -message x")?.pair.id).toBe("git-commit-message");
      // -filename gehört zu kubectl; helm hat es nicht → kein Fehlalarm bei helm.
      expect(flagNearMiss("kubectl apply -filename app.yaml")?.pair.id).toBe("kubectl-filename");
    });

    test("gültige Formen lösen NIE aus (Negativfall)", () => {
      expect(flagNearMiss("docker ps -a")).toBeUndefined();
      expect(flagNearMiss("docker ps --all")).toBeUndefined();
      expect(flagNearMiss("docker ps")).toBeUndefined();
    });

    test("Aliase (pods/po) sind keine Flag-Beinahe-Treffer", () => {
      // -pods wäre kein gültiges Flag, aber kubectl-pods ist kind:"alias" → nicht erkannt.
      expect(flagNearMiss("kubectl get -pods")).toBeUndefined();
      expect(flagNearMiss("kubectl get --po")).toBeUndefined();
    });

    test("leere/fremde Eingabe → kein Treffer", () => {
      expect(flagNearMiss("")).toBeUndefined();
      expect(flagNearMiss("ls -all")).toBeUndefined();   // „ls" ist hier der Befehl, kein Katalog-Befehl
    });
  });

  describe("flagNearMissHint – Kurzform nur wenn verfügbar (#366-Regel)", () => {
    test("gesperrt: schlägt NUR die Langform vor, kein Kürzel", () => {
      const msg = flagNearMissHint("docker ps -all", NICHTS_FREI)!;
      expect(msg).toContain("<code>--all</code>");
      expect(msg).not.toContain("<code>-a</code>");   // -a darf noch nicht vorweggenommen werden
    });

    test("freigeschaltet: schlägt beide Formen vor", () => {
      const msg = flagNearMissHint("docker ps -all", nurFrei("docker-ps-all"))!;
      expect(msg).toContain("<code>-a</code>");
      expect(msg).toContain("<code>--all</code>");
    });

    test("im freischaltenden Lehr-Schritt (exemptId) wird die Kurzform genannt", () => {
      // Genau der q2-Fall: -a wird hier gelehrt, also darf der Hinweis -a nennen.
      const msg = flagNearMissHint("docker ps -all", NICHTS_FREI, "docker-ps-all")!;
      expect(msg).toContain("<code>-a</code>");
      expect(msg).toContain("<code>--all</code>");
    });

    test("gültige Eingabe → kein Hinweis", () => {
      expect(flagNearMissHint("docker ps -a", NICHTS_FREI, "docker-ps-all")).toBeUndefined();
      expect(flagNearMissHint("docker ps --all", NICHTS_FREI)).toBeUndefined();
    });
  });
});

/* #313: longFormsInInput – erkennt korrekt getippte LANGFORMEN (Grundlage des
 * Nutzungszählers „verdiente Abkürzung"). Kurzformen zählen bewusst nicht. */
describe("#313: longFormsInInput – Langform-Nutzung für den Zähler", () => {
  test("erkennt die Langform für den passenden Befehl", () => {
    expect(longFormsInInput("docker ps --all")).toEqual(["docker-ps-all"]);
    expect(longFormsInInput("kubectl get pods")).toEqual(["kubectl-pods"]);
    expect(longFormsInInput('git commit --message "x"')).toEqual(["git-commit-message"]);
  });

  test("Kurzform zählt NICHT (die wird verdient, nicht geübt)", () => {
    expect(longFormsInInput("docker ps -a")).toEqual([]);
    expect(longFormsInInput("kubectl get po")).toEqual([]);
  });

  test("befehls-genau: --filename nur für kubectl, --values nur für helm", () => {
    expect(longFormsInInput("kubectl apply --filename app.yaml")).toEqual(["kubectl-filename"]);
    expect(longFormsInInput("helm install r ./c --values v.yaml")).toEqual(["helm-values"]);
  });

  test("leere/fremde Eingabe oder reiner Befehl → nichts", () => {
    expect(longFormsInInput("")).toEqual([]);
    expect(longFormsInInput("docker ps")).toEqual([]);
  });
});

/* #379: Das Docker-Kapitel führt -d/-t „Langform-zuerst" ein – symmetrisch zu -a (#313).
 * Diese Flags werden NICHT mehr per Quest-Schritt (unlockAbbrev) freigeschaltet,
 * sondern durch wiederholtes Tippen der Langform VERDIENT. Der Wächter hält das fest,
 * damit ein versehentlich wieder eingefügter unlockAbbrev-Schritt sofort auffliegt
 * (und die docker-ps-all-Symmetrie erhalten bleibt). */
describe("#379: Docker-Flags -a/-d/-t sind nutzungs-verdient (kein unlockAbbrev-Schritt)", () => {
  const VERDIENT_PER_NUTZUNG = ["docker-ps-all", "docker-run-detach", "docker-build-tag"];

  function stepUnlockIds(): Set<string> {
    const ids = new Set<string>();
    for (const quest of KQContent.QUESTS) {
      for (const step of quest.steps) {
        if (step.unlockAbbrev) ids.add(step.unlockAbbrev);
      }
    }
    return ids;
  }

  test("keines dieser Flags wird per Quest-Schritt freigeschaltet", () => {
    const unlocked = stepUnlockIds();
    const fälschlichPerSchritt = VERDIENT_PER_NUTZUNG.filter(id => unlocked.has(id));
    assert.deepEqual(fälschlichPerSchritt, [], "Diese Docker-Flags sollen per Nutzung verdient werden, haben aber einen unlockAbbrev-Schritt:\n" + fälschlichPerSchritt.join("\n"));
  });

  test("jedes dieser Flags bleibt verdienbar: seine Langform steht in einer accept-Regex", () => {
    const idToLong = new Map(ABBREVS.map(a => [a.id, a.long] as const));
    const nichtVerdienbar = VERDIENT_PER_NUTZUNG.filter(id => {
      const long = idToLong.get(id);
      return !long || !appearsAnywhere(long);
    });
    assert.deepEqual(nichtVerdienbar, [], "Nutzungs-verdiente Flags, deren Langform NICHT im Content tippbar ist:\n" + nichtVerdienbar.join("\n"));
  });
});

/* #380: Das Kubernetes-Kapitel führt die kubectl-Kürzel „Langform-zuerst" ein –
 * symmetrisch zu Docker (#379). Die acht kubectl-Bausteine (Flags -n/-f sowie die
 * Ressourcen-Aliasse po/no/svc/secret/ing/netpol) werden NICHT mehr per
 * unlockAbbrev-Schritt freigeschaltet, sondern durch wiederholtes Tippen der
 * Langform VERDIENT. Diese Wächter halten das fest: kein Schritt schaltet sie frei,
 * jede Langform bleibt verdienbar, und – die stärkste Garantie – KEINE Musterlösung
 * im ganzen Spiel zeigt eine noch gesperrte kubectl-Kurzform (sonst widerspräche der
 * Auftrag „tippe das" dem Gating „das ist noch gesperrt, schreib die Langform"). */
describe("#380: kubectl-Kürzel sind nutzungs-verdient (kein unlockAbbrev, Langform-zuerst)", () => {
  const VERDIENT_PER_NUTZUNG = [
    "kubectl-namespace", "kubectl-filename", "kubectl-pods", "kubectl-nodes",
    "kubectl-services", "kubectl-ingress", "kubectl-netpol",
  ];

  function stepUnlockIds(): Set<string> {
    const ids = new Set<string>();
    for (const quest of KQContent.QUESTS) for (const step of quest.steps) if (step.unlockAbbrev) ids.add(step.unlockAbbrev);
    return ids;
  }

  test("keiner dieser Bausteine wird per Quest-Schritt freigeschaltet", () => {
    const unlocked = stepUnlockIds();
    const fälschlich = VERDIENT_PER_NUTZUNG.filter(id => unlocked.has(id));
    assert.deepEqual(fälschlich, [], "Diese kubectl-Bausteine sollen per Nutzung verdient werden, haben aber einen unlockAbbrev-Schritt:\n" + fälschlich.join("\n"));
  });

  test("jeder Baustein bleibt verdienbar: seine Langform steht in einer accept-Regex", () => {
    const idToLong = new Map(ABBREVS.map(a => [a.id, a.long] as const));
    const nichtVerdienbar = VERDIENT_PER_NUTZUNG.filter(id => {
      const long = idToLong.get(id);
      return !long || !appearsAnywhere(long);
    });
    assert.deepEqual(nichtVerdienbar, [], "Verdiente Bausteine, deren Langform NICHT im Content tippbar ist:\n" + nichtVerdienbar.join("\n"));
  });

  // Spielt jede Musterlösung gegen das Gating, in dem NUR die acht #380-Kürzel noch
  // gesperrt sind (alles andere gilt als freigeschaltet, damit git -m / helm -f #381
  // hier nicht stören). Trifft eine Lösung das Gating, zeigt sie eine gesperrte
  // kubectl-Kurzform statt der Langform → Fehler (genau das ist die Regression, die
  // #380 verhindert).
  test("KEINE Musterlösung (Quests/Drills/Karten) zeigt eine noch gesperrte kubectl-Kurzform", () => {
    const isUnlocked = (id: string) => !VERDIENT_PER_NUTZUNG.includes(id);
    const sim = new KQSim({});
    const norm = (s: string) => s.trim().replace(/\s+/g, " ");
    const items: { label: string; solution: string }[] = [];
    for (const c of KQContent.CMD_CARDS) items.push({ label: "Karte " + c.id, solution: c.solution });
    for (const [id, make] of Object.entries(KQContent.DRILLS)) items.push({ label: "Drill " + id, solution: make(sim).solution });
    for (const quest of KQContent.QUESTS) for (const step of quest.steps) {
      if (step.type === "teach") items.push({ label: `${quest.id}/${step.cmd.id}`, solution: step.cmd.solution });
      if (step.type === "terminal") for (const t of step.tasks) items.push({ label: `${quest.id}/${t.id}`, solution: t.solution });
    }
    const fehler: string[] = [];
    for (const it of items) {
      const hit = lockedAbbrevInInput(norm(it.solution), isUnlocked);
      if (hit) fehler.push(`${it.label}: „${it.solution}" nutzt gesperrte Kurzform „${hit.used}" (${hit.pair.id}) – schreib die Langform „${hit.pair.long}"`);
    }
    assert.deepEqual(fehler, [], "Musterlösungen mit gesperrter kubectl-Kurzform:\n" + fehler.join("\n"));
  });

  test("kubectl logs -f bleibt erlaubt – -f ist hier --follow, nicht die gesperrte --filename-Kurzform", () => {
    const isUnlocked = (id: string) => !VERDIENT_PER_NUTZUNG.includes(id); // --filename absichtlich gesperrt
    // apply -f wäre gesperrt (echte filename-Kurzform), logs -f nicht (das ist --follow).
    expect(lockedAbbrevInInput("kubectl apply -f deployment.yaml", isUnlocked)?.pair.id).toBe("kubectl-filename");
    expect(lockedAbbrevInInput("kubectl logs -f signalgeber-pod-xyz", isUnlocked)).toBeUndefined();
  });
});

/** Alle vom Spieler getippten Musterlösungen einsammeln (Karten + instanziierte
 *  Drills + Quest-Teach-/Terminal-Schritte) – dieselben Quellen wie der EQUIVS-Test
 *  in content.test.ts, hier fürs Gating-Audit der Langform-zuerst-Tickets. */
function allTaughtSolutions(): { label: string; solution: string }[] {
  const sim = new KQSim({});
  const items: { label: string; solution: string }[] = [];
  for (const c of KQContent.CMD_CARDS) items.push({ label: "Karte " + c.id, solution: c.solution });
  for (const [id, make] of Object.entries(KQContent.DRILLS)) items.push({ label: "Drill " + id, solution: make(sim).solution });
  for (const quest of KQContent.QUESTS) for (const step of quest.steps) {
    if (step.type === "teach") items.push({ label: `${quest.id}/${step.cmd.id}`, solution: step.cmd.solution });
    if (step.type === "terminal") for (const t of step.tasks) items.push({ label: `${quest.id}/${t.id}`, solution: t.solution });
  }
  return items;
}

/* #381: Abschluss der Langform-zuerst-Sequenz – die Helm/Git/ArgoCD-Kürzel werden
 * ebenfalls per Nutzung verdient (helm-values -f, helm-list ls, helm-dependency dep,
 * argocd-app-list ls, git-commit-message -m). Gleiche Wächter wie #379/#380. */
describe("#381: Helm/Git/ArgoCD-Kürzel sind nutzungs-verdient (kein unlockAbbrev, Langform-zuerst)", () => {
  const VERDIENT_PER_NUTZUNG = ["helm-values", "helm-list", "helm-dependency", "argocd-app-list", "git-commit-message"];

  test("keiner dieser Bausteine wird per Quest-Schritt freigeschaltet", () => {
    const unlocked = new Set<string>();
    for (const quest of KQContent.QUESTS) for (const step of quest.steps) if (step.unlockAbbrev) unlocked.add(step.unlockAbbrev);
    const fälschlich = VERDIENT_PER_NUTZUNG.filter(id => unlocked.has(id));
    assert.deepEqual(fälschlich, [], "Diese Bausteine sollen per Nutzung verdient werden, haben aber einen unlockAbbrev-Schritt:\n" + fälschlich.join("\n"));
  });

  test("jeder Baustein bleibt verdienbar: seine Langform steht in einer accept-Regex", () => {
    const idToLong = new Map(ABBREVS.map(a => [a.id, a.long] as const));
    const nichtVerdienbar = VERDIENT_PER_NUTZUNG.filter(id => { const long = idToLong.get(id); return !long || !appearsAnywhere(long); });
    assert.deepEqual(nichtVerdienbar, [], "Verdiente Bausteine, deren Langform NICHT im Content tippbar ist:\n" + nichtVerdienbar.join("\n"));
  });

  test("KEINE Musterlösung zeigt eine noch gesperrte helm/git/argocd-Kurzform", () => {
    const isUnlocked = (id: string) => !VERDIENT_PER_NUTZUNG.includes(id);
    const norm = (s: string) => s.trim().replace(/\s+/g, " ");
    const fehler: string[] = [];
    for (const it of allTaughtSolutions()) {
      const hit = lockedAbbrevInInput(norm(it.solution), isUnlocked);
      if (hit) fehler.push(`${it.label}: „${it.solution}" nutzt gesperrte Kurzform „${hit.used}" (${hit.pair.id}) – schreib die Langform „${hit.pair.long}"`);
    }
    assert.deepEqual(fehler, [], "Musterlösungen mit gesperrter Kurzform:\n" + fehler.join("\n"));
  });

  test("git commit --message ist jetzt im Sim gültig (nicht nur -m) – #381-Sim-Fix", () => {
    const sim = new KQSim({});
    sim.exec("git init");
    sim.files["seekarte.md"] = "x";
    sim.exec("git add seekarte.md");
    const viaLong = sim.exec('git commit --message "Lange Form"');
    expect(viaLong.error).toBeFalsy();
    // Gegenprobe: ohne Nachricht muss es weiterhin scheitern (Red-Green).
    sim.files["zweite.md"] = "y";
    sim.exec("git add zweite.md");
    expect(sim.exec("git commit --message").error).toBeTruthy();
  });
});

/* Gesamt-Garantie nach #379+#380+#381: Die „verdiente Abkürzung" ist jetzt
 * durchgängig nutzungs-basiert. KEIN Quest-Schritt nutzt mehr unlockAbbrev, und mit
 * NICHTS freigeschaltet ist KEINE Musterlösung im ganzen Spiel gegated – ein Spieler
 * mit frischem Stand kann also jede gelehrte Lösung wortwörtlich tippen. */
describe("Langform-zuerst durchgängig (Abschluss #379/#380/#381)", () => {
  test("kein einziger Quest-Schritt nutzt noch unlockAbbrev", () => {
    const übrig: string[] = [];
    for (const quest of KQContent.QUESTS) for (const step of quest.steps) if (step.unlockAbbrev) übrig.push(`${quest.id}: ${step.unlockAbbrev}`);
    assert.deepEqual(übrig, [], "Es gibt noch unlockAbbrev-Schritte (sollte nach #381 keine mehr geben):\n" + übrig.join("\n"));
  });

  test("mit NICHTS freigeschaltet ist KEINE Musterlösung gegated", () => {
    const nichtsFrei = () => false;
    const norm = (s: string) => s.trim().replace(/\s+/g, " ");
    const fehler: string[] = [];
    for (const it of allTaughtSolutions()) {
      const hit = lockedAbbrevInInput(norm(it.solution), nichtsFrei);
      if (hit) fehler.push(`${it.label}: „${it.solution}" → gesperrte Kurzform „${hit.used}" (${hit.pair.id})`);
    }
    assert.deepEqual(fehler, [], "Frischer Spieler kann diese Lösungen NICHT tippen (Kurzform gesperrt):\n" + fehler.join("\n"));
  });
});
