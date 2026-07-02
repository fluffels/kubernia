/* Konsistenz-Tests für die Spielinhalte (Quests, Quiz, Drills, Karten).
 * Ausführen mit:  node --test test/
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { KQContent } from "../src/content";
import { validateContent, type ContentBundle } from "../src/content/validate";
import { KQAssets } from "../src/assets-data";
import { ARCHIPEL_NPC } from "../src/world/regions/archipel";
import { LIGHTHOUSE_NPC } from "../src/world/regions/lighthouse";
import { WAREHOUSE_NPC } from "../src/world/regions/warehouse";
import { WERFT_NPC } from "../src/world/regions/werft";
import { npcSpawnsForMap } from "../src/content/entities";
import { Sim as KQSim } from "../src/sim";
import { fmtCmd, CONTENT_HTML_TAGS } from "../src/hud/markup";
import type { TeachStep } from "../src/types";

/** Findet Befehls-Karten ohne nicht-leere Begründung (`explain`, #233) – sonst
 *  bliebe das Spaced-Repetition-Feedback bei „nur falsch ohne Warum". Als Helfer,
 *  um denselben Check Red-Green abzusichern. */
function cardsMissingExplain(cards: { id: string; explain?: string }[]): string[] {
  return cards.filter(c => !c.explain || !c.explain.trim()).map(c => c.id);
}

/** Findet Drills, deren generierte Aufgabe keine nicht-leere Begründung (`why`, #233)
 *  trägt. Jeder Drill wird gegen einen frischen Sim instanziiert (wie im Spiel). */
function drillsMissingWhy(drills: typeof KQContent.DRILLS): string[] {
  const out: string[] = [];
  for (const [id, make] of Object.entries(drills)) {
    const task = make(new KQSim({}));
    if (!task.why || !task.why.trim()) out.push(id);
  }
  return out;
}

/** Findet NPCs ohne Sprite-Asset (tex fehlt im Manifest) – das macht einen NPC
 *  „tot": Phaser fiele auf den grün-schwarzen Platzhalter zurück. Smalltalk ist
 *  bewusst NICHT universell Pflicht (z.B. Kralle führt direkt ins Quiz, ohne
 *  Smalltalk-Pfad). Als Helfer, um denselben Check Red-Green abzusichern. */
function npcSpriteProblems(npcs: Record<string, { tex?: string }>, assets: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [id, npc] of Object.entries(npcs)) {
    if (!npc.tex || !assets[npc.tex]) out.push(`${id}: Sprite-Asset fehlt (tex=${npc.tex})`);
  }
  return out;
}

test("Quiz-Karten: IDs eindeutig, correct-Index gültig, Erklärung vorhanden", () => {
  const seen = new Set();
  for (const q of KQContent.CRAB_QUIZ) {
    assert.ok(!seen.has(q.id), "doppelte ID: " + q.id);
    seen.add(q.id);
    assert.ok(q.correct >= 0 && q.correct < q.options.length, "correct-Index kaputt: " + q.id);
    assert.ok(q.explain, "Erklärung fehlt: " + q.id);
  }
});

test("#371 Wächter: jede CRAB_QUIZ-Karte ist über reviewId oder chapter im SR-Pool erreichbar", () => {
  // 10 RBAC-Karten warten auf Wachturm-Region #130
  const WARTEN_AUF_130 = new Set([
    "q-sa-1", "q-sa-2",
    "q-rbac-1", "q-rbac-2", "q-rbac-3", "q-rbac-4",
    "q-podsec-1", "q-podsec-2", "q-podsec-3", "q-podsec-4",
  ]);
  const reviewIds = new Set<string>();
  for (const q of KQContent.QUESTS) {
    for (const step of q.steps as { type: string; reviewId?: string }[]) {
      if (step.type === "choice" && step.reviewId) reviewIds.add(step.reviewId);
    }
  }
  const waisen = KQContent.CRAB_QUIZ
    .filter(c => !reviewIds.has(c.id))
    .filter(c => !c.chapter)
    .filter(c => !WARTEN_AUF_130.has(c.id))
    .map(c => c.id);
  assert.deepEqual(waisen, [], "Quiz-Karten ohne reviewId und ohne chapter:\n" + waisen.join(", "));
});

test("Befehls-Karten: Lösung matcht die eigene accept-Regex", () => {
  for (const card of KQContent.CMD_CARDS) {
    const norm = card.solution.trim().replace(/\s+/g, " ");
    assert.ok(card.accept.some(re => re.test(norm)), card.id + ": " + norm);
    assert.ok(KQContent.QUESTS.some(q => q.id === card.chapter), card.id + ": unbekannte Quest " + card.chapter);
  }
});

test("docker run: Flag-Reihenfolge ist frei – Drill & Karte akzeptieren -d/--name in beider Reihenfolge, lehnen Image-zuerst ab (#211)", () => {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  // Befehls-Karte c-ch1-4 (feste Werte webserver/nginx)
  const card = KQContent.CMD_CARDS.find(c => c.id === "c-ch1-4");
  assert.ok(card, "c-ch1-4 nicht gefunden");
  const cardOk = (s: string) => card!.accept.some(re => re.test(norm(s)));
  assert.ok(cardOk("docker run -d --name webserver nginx"), "Karte: -d vor --name muss gelten");
  assert.ok(cardOk("docker run --name webserver -d nginx"), "Karte: --name vor -d muss GENAUSO gelten");
  assert.ok(!cardOk("docker run nginx -d --name webserver"), "Karte: Image vor den Optionen muss scheitern");

  // Drill docker-run-named (zufälliger Name/Image) – über mehrere Ziehungen prüfen
  const make = KQContent.DRILLS["docker-run-named"];
  for (let i = 0; i < 40; i++) {
    const task = make(new KQSim({}));
    const m = norm(task.solution).match(/^docker run --detach --name (\S+) (\S+)$/);
    assert.ok(m, "unerwartete Musterlösung: " + task.solution);
    const [, name, img] = m!;
    const ok = (s: string) => task.accept.some(re => re.test(norm(s)));
    assert.ok(ok(`docker run -d --name ${name} ${img}`), "Drill: -d vor --name muss gelten (" + task.solution + ")");
    assert.ok(ok(`docker run --name ${name} -d ${img}`), "Drill: --name vor -d muss GENAUSO gelten (" + task.solution + ")");
    assert.ok(!ok(`docker run ${img} -d --name ${name}`), "Drill: Image vor den Optionen muss scheitern (" + task.solution + ")");
  }
});

test("#309 Wording-Leitlinie: jede Docker-Befehls-Quest nennt den Fachbegriff „Container“ im Lerntext (Metapher „Kiste“ allein reicht nicht)", () => {
  // Sammelt allen sichtbaren Lerntext einer Quest (Dialog-Zeilen + Teach-Intro/Text).
  const lernText = (q: (typeof KQContent.QUESTS)[number]): string =>
    q.steps
      .map(s => {
        if (s.type === "dialog") return s.lines.join(" ");
        if (s.type === "teach") return (s as TeachStep).cmd.intro + " " + (s as TeachStep).cmd.text;
        return "";
      })
      .join(" ");

  // Docker-Befehls-Quests = topic "docker" mit mindestens einem Teach-Schritt
  // (dort wird ein echter Befehl beigebracht – genau da muss der Fachbegriff fallen).
  const dockerLehrQuests = KQContent.QUESTS.filter(
    q => q.topic === "docker" && q.steps.some(s => s.type === "teach"),
  );
  assert.ok(dockerLehrQuests.length > 0, "keine Docker-Befehls-Quest gefunden – Filter kaputt?");
  for (const q of dockerLehrQuests) {
    assert.ok(
      /Container/.test(lernText(q)),
      `Quest ${q.id}: führt einen Docker-Befehl ein, nennt aber nirgends den Fachbegriff „Container“ (nur die Metapher) – #309-Leitlinie verletzt`,
    );
  }

  // Gezielt: die Profi-Lektion (--name/--detach) verknüpft Metapher und Fachwort
  // direkt im Lehr-Einstiegs-Dialog (#309 – das war die konkrete Lücke).
  const profi = KQContent.QUESTS.find(q => q.id === "docker-run-options");
  assert.ok(profi, "docker-run-options nicht gefunden");
  const introDialog = profi!.steps.find(s => s.type === "dialog");
  assert.ok(introDialog && introDialog.type === "dialog", "docker-run-options: Intro-Dialog fehlt");
  assert.ok(
    /Container/.test(introDialog.lines.join(" ")),
    "docker-run-options: der Lehr-Einstiegs-Dialog verknüpft „Kiste“ nicht mit dem Fachwort „Container“ (#309)",
  );
});

test("docker build: -t UND --tag gelten gleichwertig in Teach-Schritt, Karte & Drill; 'tag'-Bedeutungen entwirrt (#285)", () => {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");

  // 1) Befehls-Karte c-ch1-5 (feste Werte hafenwache:1.0)
  const card = KQContent.CMD_CARDS.find(c => c.id === "c-ch1-5");
  assert.ok(card, "c-ch1-5 nicht gefunden");
  const cardOk = (s: string) => card!.accept.some(re => re.test(norm(s)));
  assert.ok(cardOk("docker build -t hafenwache:1.0 ."), "Karte: -t muss gelten");
  assert.ok(cardOk("docker build --tag hafenwache:1.0 ."), "Karte: --tag muss GENAUSO gelten");
  assert.ok(!cardOk("docker build hafenwache:1.0 ."), "Karte: ohne -t/--tag muss scheitern");
  assert.ok(!cardOk("docker build -t hafenwache:1.0"), "Karte: ohne Build-Kontext (.) muss scheitern");

  // 2) Drill docker-build (zufälliger Name/Tag) – über viele Ziehungen
  const make = KQContent.DRILLS["docker-build"];
  for (let i = 0; i < 40; i++) {
    const task = make(new KQSim({}));
    const m = norm(task.solution).match(/^docker build --tag (\S+) \.$/);
    assert.ok(m, "unerwartete Musterlösung: " + task.solution);
    const nameTag = m![1];
    const ok = (s: string) => task.accept.some(re => re.test(norm(s)));
    assert.ok(ok(`docker build -t ${nameTag} .`), "Drill: -t muss gelten (" + task.solution + ")");
    assert.ok(ok(`docker build --tag ${nameTag} .`), "Drill: --tag muss GENAUSO gelten (" + task.solution + ")");
    assert.ok(!ok(`docker build ${nameTag} .`), "Drill: ohne -t/--tag muss scheitern (" + task.solution + ")");
  }

  // 3) Teach-Schritt t-build in docker-build-image (erster Tipp-Ort) akzeptiert beide Formen
  const buildQuest = KQContent.QUESTS.find(q => q.id === "docker-build-image");
  assert.ok(buildQuest, "docker-build-image nicht gefunden");
  const teach = buildQuest!.steps.find(
    (s): s is TeachStep => s.type === "teach" && s.cmd.id === "t-build",
  );
  assert.ok(teach, "Teach-Schritt t-build nicht gefunden");
  const teachOk = (s: string) => teach.cmd.accept.some((re: RegExp) => re.test(norm(s)));
  assert.ok(teachOk("docker build -t hafenwache:1.0 ."), "Teach: -t muss gelten");
  assert.ok(teachOk("docker build --tag hafenwache:1.0 ."), "Teach: --tag muss GENAUSO gelten");

  // 4) Neue Entwirr-Karte existiert, ist wohlgeformt und nennt alle drei 'tag'-Bedeutungen
  const flag = KQContent.CRAB_QUIZ.find((c) => c.id === "q-flag-build-t");
  assert.ok(flag, "Entwirr-Karte q-flag-build-t fehlt");
  assert.ok(Array.isArray(flag!.options) && flag!.options.length >= 2, "q-flag-build-t: zu wenige Optionen");
  assert.ok(flag!.correct >= 0 && flag!.correct < flag!.options.length, "q-flag-build-t: correct-Index außerhalb");
  assert.ok((flag!.options[flag!.correct] as string).trim().length > 0, "q-flag-build-t: richtige Option leer");
  assert.ok(/docker tag/.test(flag!.explain) && /--tag/.test(flag!.explain), "q-flag-build-t: explain entwirrt nicht -t/--tag vs docker tag");
});

test("Flag-Formen durchgängig: wo Kurz- UND Langform echtes CLI sind, akzeptieren ALLE Drills/Karten/Quest-Schritte beide (#286)", () => {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  const tokens = (s: string) => norm(s).split(" ");
  const hasTok = (s: string, t: string) => tokens(s).includes(t);
  // Tauscht das erste eigenständige Token a gegen b (oder b gegen a) im Befehl.
  const swap = (s: string, a: string, b: string): string | null => {
    const t = tokens(s);
    const ia = t.indexOf(a);
    if (ia >= 0) { t[ia] = b; return t.join(" "); }
    const ib = t.indexOf(b);
    if (ib >= 0) { t[ib] = a; return t.join(" "); }
    return null;
  };

  /** Echte (am CLI geprüfte) Kurz-/Langform-Paare, je mit Kontext-Bedingung, damit
   *  dasselbe Kürzel je Befehl die RICHTIGE Langform bekommt (-f = --filename bei
   *  kubectl, aber --values bei helm). KEINE erfundenen Formen: git checkout -b hat
   *  bewusst KEINEN Eintrag (kein --branch bei checkout). */
  const EQUIVS: { id: string; a: string; b: string; when: (sol: string) => boolean }[] = [
    { id: "docker ps -a/--all",       a: "-a", b: "--all",      when: s => /^docker ps\b/.test(s) },
    { id: "docker run -d/--detach",   a: "-d", b: "--detach",   when: s => /^docker run\b/.test(s) && (hasTok(s, "-d") || hasTok(s, "--detach")) },
    { id: "docker build -t/--tag",    a: "-t", b: "--tag",      when: s => /^docker build\b/.test(s) },
    { id: "kubectl -n/--namespace",   a: "-n", b: "--namespace", when: s => /^kubectl\b/.test(s) && (hasTok(s, "-n") || hasTok(s, "--namespace")) },
    { id: "kubectl apply/create/delete -f/--filename", a: "-f", b: "--filename", when: s => /^kubectl (apply|create|delete)\b/.test(s) && (hasTok(s, "-f") || hasTok(s, "--filename")) },
    { id: "helm install/upgrade -f/--values", a: "-f", b: "--values", when: s => /^helm (install|upgrade)\b/.test(s) && (hasTok(s, "-f") || hasTok(s, "--values")) },
    { id: "git commit -m/--message",  a: "-m", b: "--message",  when: s => /^git commit\b/.test(s) },
  ];

  // Alle Stellen mit (Lösung + accept-Regex) einsammeln: Karten, Drills (instanziiert),
  // Quest-Teach- und -Terminal-Schritte – exakt die Quellen, die der Spieler tippt.
  const items: { label: string; solution: string; accept: RegExp[] }[] = [];
  for (const c of KQContent.CMD_CARDS) items.push({ label: "Karte " + c.id, solution: c.solution, accept: c.accept });
  for (const [id, make] of Object.entries(KQContent.DRILLS)) {
    // mehrere Ziehungen, damit zufällige Namen/Tags abgedeckt sind
    for (let i = 0; i < 8; i++) { const t = make(new KQSim({})); items.push({ label: "Drill " + id, solution: t.solution, accept: t.accept }); }
  }
  for (const quest of KQContent.QUESTS) for (const step of quest.steps) {
    if (step.type === "teach") items.push({ label: `${quest.id}/${step.cmd.id}`, solution: step.cmd.solution, accept: step.cmd.accept });
    if (step.type === "terminal") for (const t of step.tasks) items.push({ label: `${quest.id}/${t.id}`, solution: t.solution, accept: t.accept });
  }

  const fehler: string[] = [];
  for (const it of items) {
    const sol = norm(it.solution);
    for (const eq of EQUIVS) {
      if (!eq.when(sol)) continue;
      const variante = swap(sol, eq.a, eq.b);
      if (!variante || variante === sol) continue;
      // Sowohl die Lösung selbst als auch ihre gleichwertige Form müssen gelten.
      if (!it.accept.some(re => re.test(sol))) fehler.push(`${it.label}: Lösung „${sol}" matcht eigene accept-Regex nicht`);
      if (!it.accept.some(re => re.test(variante))) fehler.push(`${it.label} [${eq.id}]: „${variante}" wird zu Unrecht abgelehnt (gleichwertig zu „${sol}")`);
    }
  }
  assert.deepEqual(fehler, [], "Zu enge accept-Regex – beide Flag-Formen müssen gelten:\n" + fehler.join("\n"));
});

test("Drills & Karten lehnen ungelehrte Extras ab (Supersets), erlaubte Varianten bleiben gültig (#253)", () => {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  const drillOk = (id: string, build: (sol: string) => string, mustPass: boolean) => {
    const make = KQContent.DRILLS[id];
    assert.ok(make, "Drill nicht gefunden: " + id);
    for (let i = 0; i < 30; i++) {
      const task = make(new KQSim({}));
      const sol = norm(task.solution);
      const input = norm(build(sol));
      const accepted = task.accept.some(re => re.test(input));
      assert.equal(accepted, mustPass,
        `${id}: „${input}" sollte ${mustPass ? "akzeptiert" : "ABGELEHNT"} werden (Lösung: ${sol})`);
    }
  };

  // 1) docker-run-named: -p (Port-Mapping, noch nicht gelehrt) als Extra → ablehnen.
  //    Beide Flag-Reihenfolgen ohne Extra bleiben gültig (didaktisch gewollt).
  drillOk("docker-run-named", sol => sol, true);                                  // Musterlösung gilt
  drillOk("docker-run-named", sol => sol.replace(/^(docker run )(--detach --name \S+)( \S+)$/, "$1$2 -p 8080:80$3"), false); // +Port → raus
  drillOk("docker-run-named", sol => sol.replace(/^(docker run )(--detach) (--name \S+)( \S+)$/, "$1$3 $2$4"), true);        // Reihenfolge --name --detach gilt

  // 2) k-expose: zusätzliches --type=NodePort (nicht gelehrt) → ablehnen.
  drillOk("k-expose", sol => sol, true);
  drillOk("k-expose", sol => sol + " --type=NodePort", false);

  // 3) k-secret-tls: zusätzliches --namespace (nicht gelehrt) → ablehnen; --cert/--key-Reihenfolge frei.
  drillOk("k-secret-tls", sol => sol, true);
  drillOk("k-secret-tls", sol => sol + " --namespace=prod", false);
  drillOk("k-secret-tls", sol => sol.replace(/(--cert\S+) (--key\S+)/, "$2 $1"), true);

  // 4) k-set-resources: zusätzliches --requests=cpu (nicht gelehrt) → ablehnen; --limits/--requests-Reihenfolge frei.
  drillOk("k-set-resources", sol => sol, true);
  drillOk("k-set-resources", sol => sol + " --requests=cpu=1", false);
  drillOk("k-set-resources", sol => sol.replace(/(--limits\S+) (--requests\S+)/, "$2 $1"), true);

  // Befehls-Karten mit denselben Mustern (feste Werte) – Supersets ebenfalls ablehnen.
  const cardOk = (id: string, input: string, mustPass: boolean) => {
    const card = KQContent.CMD_CARDS.find(c => c.id === id);
    assert.ok(card, "Karte nicht gefunden: " + id);
    assert.equal(card!.accept.some(re => re.test(norm(input))), mustPass,
      `${id}: „${input}" sollte ${mustPass ? "akzeptiert" : "ABGELEHNT"} werden`);
  };
  cardOk("c-ch1-4", "docker run -d --name webserver nginx", true);
  cardOk("c-ch1-4", "docker run -d --name webserver -p 8080:80 nginx", false);
  cardOk("c-ch3-3", "kubectl expose deployment shop --port=80", true);
  cardOk("c-ch3-3", "kubectl expose deployment shop --port=80 --type=NodePort", false);
  cardOk("c-res-1", "kubectl set resources deployment/kartograf --limits=memory=256Mi --requests=memory=128Mi", true);
  cardOk("c-res-1", "kubectl set resources deployment/kartograf --limits=memory=256Mi --requests=memory=128Mi --requests=cpu=1", false);
});

test("kein accept-Muster nutzt das Superset-anfällige `.*` (Regressionswächter #253)", () => {
  const lose: string[] = [];
  const pruefe = (label: string, res: RegExp[]) => {
    for (const re of res) if (re.source.includes(".*")) lose.push(`${label}: /${re.source}/`);
  };
  for (const card of KQContent.CMD_CARDS) pruefe("CMD " + card.id, card.accept);
  for (const [id, make] of Object.entries(KQContent.DRILLS)) pruefe("Drill " + id, make(new KQSim({})).accept);
  for (const quest of KQContent.QUESTS) {
    for (const step of quest.steps) {
      if (step.type === "teach") pruefe(`${quest.id}/${step.cmd.id}`, step.cmd.accept);
      if (step.type === "terminal") for (const t of step.tasks) pruefe(`${quest.id}/${t.id}`, t.accept);
    }
  }
  assert.deepEqual(lose, [], "accept-Muster mit `.*` (akzeptiert ungelehrte Extras):\n" + lose.join("\n"));
});

test("Befehls-Karten: jede trägt eine nicht-leere Begründung (explain, #233)", () => {
  const fehlend = cardsMissingExplain(KQContent.CMD_CARDS);
  assert.deepEqual(fehlend, [], "CMD-Karten ohne explain: " + fehlend.join(", "));
});

test("Red-Green: eine Befehls-Karte ohne explain wird gemeldet", () => {
  // Ein Check, der auch bei fehlender Begründung grün bliebe, wäre wertlos (#233).
  const fehlend = cardsMissingExplain([...KQContent.CMD_CARDS, { id: "c-leer", explain: "  " }]);
  assert.ok(fehlend.includes("c-leer"), "leere Begründung nicht gemeldet: " + fehlend.join(", "));
});

test("Drills: jede generierte Aufgabe trägt eine nicht-leere Begründung (why, #233)", () => {
  const fehlend = drillsMissingWhy(KQContent.DRILLS);
  assert.deepEqual(fehlend, [], "Drills ohne why: " + fehlend.join(", "));
});

test("Red-Green: ein Drill ohne why wird gemeldet", () => {
  const kaputt = { ...KQContent.DRILLS, "drill-leer": (_sim: KQSim) => ({ text: "x", accept: [/^x$/], solution: "x", hint: "x", why: "" }) };
  const fehlend = drillsMissingWhy(kaputt as typeof KQContent.DRILLS);
  assert.ok(fehlend.includes("drill-leer"), "Drill ohne why nicht gemeldet: " + fehlend.join(", "));
});

test("Quests: NPCs existieren, Choices haben genau richtige Antworten, reviewIds gültig", () => {
  for (const quest of KQContent.QUESTS) {
    assert.ok(KQContent.NPCS[quest.giver as keyof typeof KQContent.NPCS], quest.id + ": unbekannter Questgeber");
    for (const step of quest.steps) {
      if (step.type === "dialog" || step.type === "choice") {
        assert.ok(KQContent.NPCS[step.npc as keyof typeof KQContent.NPCS], quest.id + ": unbekannter NPC " + step.npc);
      }
      if (step.type === "choice") {
        assert.equal(step.options.filter((o) => o.ok).length, 1, quest.id + ": Choice braucht genau eine richtige Antwort");
        if (step.reviewId) {
          assert.ok(KQContent.CRAB_QUIZ.some(q => q.id === step.reviewId), quest.id + ": unbekannte reviewId " + step.reviewId);
        }
      }
      if (step.type === "teach") {
        assert.ok(step.cmd.hint && step.cmd.solution && step.cmd.intro, quest.id + ": teach-Schritt unvollständig");
      }
      if (step.type === "drill") {
        for (const d of step.pool) assert.ok(KQContent.DRILLS[d], quest.id + ": unbekannter Drill " + d);
      }
    }
  }
});

test("Übungs-Pools: verweisen auf existierende Drills und Quests", () => {
  for (const [npcId, pool] of Object.entries(KQContent.PRACTICE)) {
    assert.ok(KQContent.NPCS[npcId as keyof typeof KQContent.NPCS], "unbekannter NPC: " + npcId);
    for (const p of pool) {
      assert.ok(KQContent.DRILLS[p.drill], npcId + ": unbekannter Drill " + p.drill);
      assert.ok(KQContent.QUESTS.some(q => q.id === p.after), npcId + ": unbekannte Quest " + p.after);
    }
  }
});

test("Teach-Schritte mit Pflicht-Flag zeigen es im Panel (intro+text), nicht nur im hint (#29)", () => {
  // Befehle, deren Pflicht-Flag man nicht erraten kann, müssen es dauerhaft sichtbar
  // im Aufgaben-Panel führen (intro oder text) – der hint ist erst auf Anforderung sichtbar.
  const muss: Record<string, string> = {
    "t-create": "--image",   // kubectl create deployment <name> --image=<image>
    "t-scale": "--replicas", // kubectl scale deployment <name> --replicas=<zahl>
  };
  const gefunden = new Set<string>();
  for (const quest of KQContent.QUESTS) {
    for (const step of quest.steps) {
      if (step.type !== "teach") continue;
      const flag = muss[step.cmd.id];
      if (!flag) continue;
      gefunden.add(step.cmd.id);
      const panel = step.cmd.intro + " " + step.cmd.text;
      assert.ok(panel.includes(flag), step.cmd.id + ": " + flag + " fehlt im Panel (intro+text)");
    }
  }
  for (const id of Object.keys(muss)) {
    assert.ok(gefunden.has(id), "Teach-Schritt nicht gefunden: " + id);
  }
});

test("Stapel-Spiel hat genug Übungsrunden (#218) mit je 3+ Schichten", () => {
  // #218: spürbar mehr als das alte Minimum von 2 Runden, damit das Muster
  // durch Wiederholung sitzt.
  assert.ok(KQContent.STACK_ROUNDS.length >= 5, `nur ${KQContent.STACK_ROUNDS.length} Runden`);
  for (const r of KQContent.STACK_ROUNDS) assert.ok(r.layers.length >= 3, r.name);
});

test("Stapel-Spiel steigert die Schwierigkeit (#218): Schichtzahl nie absteigend", () => {
  // Anfänger sollen mit wenigen Schichten starten und sich steigern – die Runden
  // sind nach Schichtzahl aufsteigend (oder gleich) sortiert.
  const counts = KQContent.STACK_ROUNDS.map((r) => r.layers.length);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] >= counts[i - 1], `Runde ${i + 1} (${counts[i]}) leichter als die davor (${counts[i - 1]})`);
  }
  // erste Runde ist die einfachste (genau das geforderte Minimum von 3 Schichten)
  assert.equal(counts[0], 3, "erste Runde sollte mit 3 Schichten am leichtesten sein");
});

test("Stapel-Spiel: jede Runde erklärt Cache/Build konkret (#218)", () => {
  // „Cache und Build nicht nur im Merksatz nennen": jede Runde trägt einen eigenen,
  // nichtleeren Cache/Build-Tipp, der nach geschaffter Runde gezeigt wird.
  for (const r of KQContent.STACK_ROUNDS) {
    assert.ok(r.cacheTip && r.cacheTip.trim().length > 0, `Runde „${r.name}" ohne cacheTip`);
    assert.ok(/cache|build/i.test(r.cacheTip), `cacheTip von „${r.name}" nennt weder Cache noch Build`);
  }
});

test("jeder NPC hat ein Sprite-Asset (tex im Manifest)", () => {
  const problems = npcSpriteProblems(KQContent.NPCS, KQAssets);
  assert.deepEqual(problems, [], "NPCs ohne Sprite-Asset:\n" + problems.join("\n"));
});

test("der GitOps-Insel-NPC (#93) ist in der Registry verdrahtet, mit Sprite + Smalltalk", () => {
  // archipel.ts reserviert den Standplatz mit fester id – die MUSS einem NPC der
  // Registry entsprechen, sonst rendert die Insel eine Figur ohne Daten.
  const npc = (KQContent.NPCS as Record<string, { tex?: string }>)[ARCHIPEL_NPC.id];
  assert.ok(npc, "Insel-NPC-Id '" + ARCHIPEL_NPC.id + "' fehlt in NPCS");
  assert.ok(npc.tex && KQAssets[npc.tex], "Insel-NPC ohne Sprite-Asset");
  // Bis #94 die erste Quest einhängt, ist Smalltalk das, was Argo zu sagen hat.
  const lines = (KQContent.SMALLTALK as Record<string, string[]>)[ARCHIPEL_NPC.id];
  assert.ok(Array.isArray(lines) && lines.length > 0, "Insel-NPC ohne Smalltalk");
});

test("der Monitoring-Leuchtturm-NPC (#112) ist in der Registry verdrahtet, mit Sprite + Smalltalk", () => {
  // lighthouse.ts reserviert den Standplatz mit fester id – die MUSS einem NPC der
  // Registry entsprechen, sonst rendert die Klippe eine Figur ohne Daten.
  const npc = (KQContent.NPCS as Record<string, { tex?: string }>)[LIGHTHOUSE_NPC.id];
  assert.ok(npc, "Leuchtturm-NPC-Id '" + LIGHTHOUSE_NPC.id + "' fehlt in NPCS");
  assert.ok(npc.tex && KQAssets[npc.tex], "Leuchtturm-NPC ohne Sprite-Asset");
  const lines = (KQContent.SMALLTALK as Record<string, string[]>)[LIGHTHOUSE_NPC.id];
  assert.ok(Array.isArray(lines) && lines.length > 0, "Leuchtturm-NPC ohne Smalltalk");
});

test("der Lagerhallen-Viertel-NPC Knut (#125) ist in der Registry verdrahtet, mit Sprite + Smalltalk", () => {
  // warehouse.ts reserviert den Standplatz mit fester id – die MUSS einem NPC der
  // Registry entsprechen, sonst rendert der Kai eine Figur ohne Daten.
  const npc = (KQContent.NPCS as Record<string, { name?: string; tex?: string }>)[WAREHOUSE_NPC.id];
  assert.ok(npc, "Lager-NPC-Id '" + WAREHOUSE_NPC.id + "' fehlt in NPCS");
  assert.equal(npc.name, "Knut", "der Lager-NPC heißt Knut");
  assert.ok(npc.tex && KQAssets[npc.tex], "Lager-NPC ohne Sprite-Asset");
  const lines = (KQContent.SMALLTALK as Record<string, string[]>)[WAREHOUSE_NPC.id];
  assert.ok(Array.isArray(lines) && lines.length > 0, "Lager-NPC ohne Smalltalk");
});

test("der Heimat-Werft-NPC Greta (#166) ist in der Registry verdrahtet, mit Sprite + Smalltalk", () => {
  // werft.ts (#165) hat den Hof-Platz WERFT_NPC begehbar reserviert; #166 setzt Greta dorthin.
  // Der Spawn MUSS exakt auf der reservierten Kachel sitzen, sonst war die Reservierung umsonst.
  const greta = (KQContent.NPCS as Record<string, { name?: string; tex?: string }>).greta;
  assert.ok(greta, "Werft-NPC-Id 'greta' fehlt in NPCS");
  assert.equal(greta.name, "Greta", "der Werft-NPC heißt Greta");
  assert.ok(greta.tex && KQAssets[greta.tex], "Werft-NPC ohne Sprite-Asset");
  const lines = (KQContent.SMALLTALK as Record<string, string[]>).greta;
  assert.ok(Array.isArray(lines) && lines.length > 0, "Werft-NPC ohne Smalltalk");
  // Greta steht in der Werft-Karte – und genau auf dem in #165 reservierten Standplatz.
  const spawn = npcSpawnsForMap("werft").find(s => s.id === "greta");
  assert.ok(spawn, "Greta hat keinen Standplatz auf der Werft-Karte");
  assert.equal(spawn!.x, WERFT_NPC.x, "Greta steht nicht auf der reservierten WERFT_NPC-Spalte");
  assert.equal(spawn!.y, WERFT_NPC.y, "Greta steht nicht auf der reservierten WERFT_NPC-Reihe");
});

test("Red-Green: ein NPC mit fehlendem Sprite-Asset wird gemeldet", () => {
  // Ein Check, der auch bei fehlendem Sprite grün bliebe, wäre wertlos.
  const npcs = { ...KQContent.NPCS, geist: { name: "Geist", title: "?", sprite: 0, tex: "char_gibtsnicht" } };
  const problems = npcSpriteProblems(npcs as Record<string, { tex?: string }>, KQAssets);
  assert.ok(problems.some(p => p.includes("geist") && p.includes("Sprite-Asset")), "fehlendes Sprite-Asset nicht gemeldet:\n" + problems.join("\n"));
});

test("Ränge: aufsteigende XP-Schwellen", () => {
  for (let i = 1; i < KQContent.RANKS.length; i++) {
    assert.ok(KQContent.RANKS[i].xp > KQContent.RANKS[i - 1].xp);
  }
});

/* ===== Zentrale Schema-Validierung (#81) =====
 * Der Validator (src/content/validate.ts) prüft das ganze Inhalts-Bündel auf
 * strukturelle & referenzielle Konsistenz. Hier wird er einmal gegen die echten
 * Inhalte gefahren (muss sauber sein) und mit absichtlich kaputten Referenzen
 * Red-Green abgesichert: ein Validator, der auch bei kaputtem Inhalt grün bleibt,
 * wäre wertlos. */

test("Schema-Validierung: die echten Inhalte sind konsistent (keine Fehler)", () => {
  const errors = validateContent(KQContent);
  assert.deepEqual(errors, [], "validateContent meldet Probleme:\n" + errors.join("\n"));
});

test("Red-Green: kaputte Quest-Referenz (unbekannter Questgeber) macht den Check rot", () => {
  // Akzeptanzkriterium #81: eine absichtlich kaputte Quest-Referenz MUSS gemeldet werden.
  const kaputt: ContentBundle = {
    ...KQContent,
    QUESTS: [
      ...KQContent.QUESTS,
      { id: "q-bad", title: "Geister-Quest", giver: "niemand", topic: "docker", rewardXp: 1, rewardCoins: 1, steps: [] },
    ],
  };
  const errors = validateContent(kaputt);
  assert.ok(errors.some(e => e.includes("q-bad") && e.includes("niemand")), "kaputter Questgeber wurde NICHT gemeldet – Validator ohne Zähne:\n" + errors.join("\n"));
});

test("Red-Green: Quest mit unbekanntem Thema macht den Check rot (#327)", () => {
  // Eine Quest mit einem topic, das nicht in der Taxonomie steht, würde ungruppiert
  // durchs Logbuch-Accordion rutschen – das MUSS gemeldet werden.
  const kaputt: ContentBundle = {
    ...KQContent,
    QUESTS: [
      ...KQContent.QUESTS,
      { id: "q-thema-weg", title: "Themenlos", giver: "ole", topic: "gibt-es-nicht", rewardXp: 1, rewardCoins: 1, steps: [] },
    ],
  };
  const errors = validateContent(kaputt);
  assert.ok(
    errors.some(e => e.includes("q-thema-weg") && e.includes("gibt-es-nicht")),
    "unbekanntes Quest-Thema wurde NICHT gemeldet:\n" + errors.join("\n"),
  );
});

test("Red-Green: totes Thema ohne jede Quest macht den Check rot (#327)", () => {
  // Ein Thema in der Taxonomie, das keine Quest benutzt, wäre eine leere
  // Accordion-Sektion (Tippfehler im topic oder verwaistes Thema) – muss auffallen.
  const kaputt: ContentBundle = {
    ...KQContent,
    QUEST_TOPICS: [...KQContent.QUEST_TOPICS, { id: "totes-thema", label: "Niemandsland" }],
  };
  const errors = validateContent(kaputt);
  assert.ok(
    errors.some(e => e.includes("totes-thema") && e.includes("keine einzige Quest")),
    "totes Thema wurde NICHT gemeldet:\n" + errors.join("\n"),
  );
});

test("Red-Green: Quest mit unbekannter Voraussetzung (requires) macht den Check rot (#410)", () => {
  const kaputt: ContentBundle = {
    ...KQContent,
    QUESTS: [
      ...KQContent.QUESTS,
      { id: "q-req-weg", title: "Voraussetzungslos", giver: "ole", topic: "docker", requires: ["gibt-es-nicht"], rewardXp: 1, rewardCoins: 1, steps: [] },
    ],
  };
  const errors = validateContent(kaputt);
  assert.ok(
    errors.some(e => e.includes("q-req-weg") && e.includes("gibt-es-nicht")),
    "unbekannte Voraussetzung wurde NICHT gemeldet:\n" + errors.join("\n"),
  );
});

test("Red-Green: Quest, die sich selbst voraussetzt, macht den Check rot (#410)", () => {
  const kaputt: ContentBundle = {
    ...KQContent,
    QUESTS: [
      ...KQContent.QUESTS,
      { id: "q-selbst", title: "Selbstbezug", giver: "ole", topic: "docker", requires: ["q-selbst"], rewardXp: 1, rewardCoins: 1, steps: [] },
    ],
  };
  const errors = validateContent(kaputt);
  assert.ok(
    errors.some(e => e.includes("q-selbst") && e.includes("selbst")),
    "Selbst-Voraussetzung wurde NICHT gemeldet:\n" + errors.join("\n"),
  );
});

test("Red-Green: ein Voraussetzungs-Zyklus (A→B→A) macht den Check rot (#410)", () => {
  const kaputt: ContentBundle = {
    ...KQContent,
    QUESTS: [
      ...KQContent.QUESTS,
      { id: "q-cycle-a", title: "A", giver: "ole", topic: "docker", requires: ["q-cycle-b"], rewardXp: 1, rewardCoins: 1, steps: [] },
      { id: "q-cycle-b", title: "B", giver: "ole", topic: "docker", requires: ["q-cycle-a"], rewardXp: 1, rewardCoins: 1, steps: [] },
    ],
  };
  const errors = validateContent(kaputt);
  assert.ok(
    errors.some(e => e.includes("Zyklus")),
    "Voraussetzungs-Zyklus wurde NICHT gemeldet:\n" + errors.join("\n"),
  );
});

test("Voraussetzungen: eine gültige requires-Kette (kein Zyklus) ist sauber (#410)", () => {
  // Positiv-Gegenprobe zum Zyklen-Check: A→B, B→C ist eine gültige Kette, KEIN Zyklus.
  const ok: ContentBundle = {
    ...KQContent,
    QUESTS: [
      ...KQContent.QUESTS,
      { id: "q-chain-c", title: "C", giver: "ole", topic: "docker", rewardXp: 1, rewardCoins: 1, steps: [] },
      { id: "q-chain-b", title: "B", giver: "ole", topic: "docker", requires: ["q-chain-c"], rewardXp: 1, rewardCoins: 1, steps: [] },
      { id: "q-chain-a", title: "A", giver: "ole", topic: "docker", requires: ["q-chain-b"], rewardXp: 1, rewardCoins: 1, steps: [] },
    ],
  };
  const errors = validateContent(ok);
  assert.ok(!errors.some(e => e.includes("Zyklus")), "gültige Kette fälschlich als Zyklus gemeldet:\n" + errors.join("\n"));
});

test("Red-Green: unbekannter Drill in einem Übungs-Pool macht den Check rot", () => {
  const kaputt: ContentBundle = {
    ...KQContent,
    PRACTICE: { ...KQContent.PRACTICE, ole: [{ drill: "gibt-es-nicht", after: "k8s-first-deployment" }] },
  };
  const errors = validateContent(kaputt);
  assert.ok(errors.some(e => e.includes("gibt-es-nicht")), "unbekannter Drill wurde NICHT gemeldet:\n" + errors.join("\n"));
});

test("Red-Green: CMD-Karte mit unbekanntem chapter und nicht matchender Lösung wird gemeldet", () => {
  const kaputt: ContentBundle = {
    ...KQContent,
    CMD_CARDS: [
      ...KQContent.CMD_CARDS,
      { id: "c-bad", chapter: "q-existiert-nicht", q: "?", accept: [/^kubectl get pods$/], solution: "ganz was anderes", explain: "Erklärung" },
    ],
  };
  const errors = validateContent(kaputt);
  assert.ok(errors.some(e => e.includes("c-bad") && e.includes("q-existiert-nicht")), "unbekanntes chapter nicht gemeldet:\n" + errors.join("\n"));
  assert.ok(errors.some(e => e.includes("c-bad") && e.includes("accept")), "nicht matchende Musterlösung nicht gemeldet:\n" + errors.join("\n"));
});

test("Red-Green: Quiz-Karte mit unbekanntem introducedIn wird gemeldet (#412)", () => {
  const kaputt: ContentBundle = {
    ...KQContent,
    CRAB_QUIZ: [
      ...KQContent.CRAB_QUIZ,
      { id: "q-bad-intro", chapter: "k8s-first-deployment", introducedIn: "q-existiert-nicht", q: "?", options: ["a", "b"], correct: 0, explain: "e" },
    ],
  };
  const errors = validateContent(kaputt);
  assert.ok(errors.some(e => e.includes("q-bad-intro") && e.includes("q-existiert-nicht") && e.includes("introducedIn")),
    "unbekanntes introducedIn nicht gemeldet:\n" + errors.join("\n"));
});

/** #311: Findet in einem Anzeige-Text „Platzhalter-artige" `<token>`, die `fmtCmd` NICHT
 *  sichtbar macht und die darum beim innerHTML-Rendern unsichtbar/kaputt blieben. Seit #311
 *  ist ein `<token>` die offizielle Platzhalter-Schreibweise – `fmtCmd` zeichnet sie als
 *  sichtbares Badge aus. Diese Invariante ersetzt die früheren Einzel-Wächter #320/#458
 *  (die bare Platzhalter nur verboten statt dargestellt hatten). Übrig bleiben dürfen nur
 *  echte HTML-Tags (`CONTENT_HTML_TAGS`); wörtliche spitze Klammern gehören als `&lt;…&gt;`
 *  in die Daten (die matchen hier nicht und rendern korrekt als Text). Die Suchform ist
 *  BEWUSST breiter als fmtCmds Wortklasse (erlaubt z.B. `_`/`.`), um genau die Token zu
 *  fangen, die fmtCmd (eng definiert) übersieht und die dann unsichtbar würden. */
function invisiblePlaceholders(text: string): string[] {
  const rendered = fmtCmd(text);   // erst rendern: erkannte Platzhalter sind danach Badges
  const out: string[] = [];
  const tokenish = /<([A-Za-zÄÖÜäöüß][^<>\s/]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tokenish.exec(rendered)) !== null) {
    if (!CONTENT_HTML_TAGS.has(m[1].toLowerCase())) out.push(m[0]);
  }
  return out;
}

/** Sammelt alle Anzeige-Textfelder eines Content-Bereichs mit Label für die Wächter. */
function scanFields(pairs: [string, string][]): string[] {
  const out: string[] = [];
  for (const [label, text] of pairs) for (const bad of invisiblePlaceholders(text)) out.push(`${label}: ${bad}`);
  return out;
}

test("Drills: why/hint enthalten keine unsichtbaren Platzhalter (fmtCmd macht <token> sichtbar, #311/#320)", () => {
  const pairs: [string, string][] = [];
  for (const [id, make] of Object.entries(KQContent.DRILLS)) {
    const task = make(new KQSim({}));
    pairs.push([`${id}.hint`, task.hint], [`${id}.why`, task.why ?? ""]);
  }
  const problems = scanFields(pairs);
  assert.deepEqual(problems, [], "Drill-Felder mit Platzhaltern, die fmtCmd nicht sichtbar macht (werden im Browser unsichtbar):\n" + problems.join("\n"));
});

test("Quiz: q/options/explain enthalten keine unsichtbaren Platzhalter (#311/#458)", () => {
  const pairs: [string, string][] = [];
  for (const c of KQContent.CRAB_QUIZ) {
    pairs.push([`${c.id}.q`, c.q], [`${c.id}.explain`, c.explain]);
    c.options.forEach((o, i) => pairs.push([`${c.id}.options[${i}]`, o]));
  }
  const problems = scanFields(pairs);
  assert.deepEqual(problems, [], "Quiz-Felder mit Platzhaltern, die fmtCmd nicht sichtbar macht:\n" + problems.join("\n"));
});

test("Red-Green: ein Platzhalter, den fmtCmd NICHT erkennt (z.B. mit Unterstrich), wird als unsichtbar gemeldet (#311)", () => {
  // `<pod_name>` fällt aus fmtCmds Wortklasse (kein `_`) → würde im Browser unsichtbar.
  assert.ok(invisiblePlaceholders("kubectl logs <pod_name>").length > 0, "unerkannter Platzhalter nicht gemeldet");
  // Gegenprobe: der offizielle, mit Bindestrich geschriebene Platzhalter ist sichtbar → NICHT gemeldet.
  assert.deepEqual(invisiblePlaceholders("kubectl logs <pod-name>"), [], "korrekter Platzhalter darf nicht gemeldet werden");
});

test("docker-run-named: diag benennt falschen Namen gezielt, nicht Reihenfolge (#321)", () => {
  const make = KQContent.DRILLS["docker-run-named"];
  let tested = false;
  for (let i = 0; i < 60; i++) {
    const task = make(new KQSim({}));
    assert.ok("diag" in task, "docker-run-named muss ein diag-Feld haben (#321)");
    const m = task.solution.match(/^docker run --detach --name (\S+) (\S+)$/);
    if (!m) continue;
    const [, name, img] = m;
    const norm = (s: string) => s.trim().replace(/\s+/g, " ");

    // Musterlösung → diag schweigt (null)
    assert.equal(task.diag!(norm(task.solution)), null, "Musterlösung darf keinen diag auslösen");

    // Name falsch → diag nennt den richtigen Namen
    const diagBadName = task.diag!(norm(`docker run --detach --name x${name} ${img}`));
    assert.ok(diagBadName, "Namen-Tippfehler → diag muss nicht-null sein");
    assert.ok(diagBadName!.includes(name), `diag muss erwarteten Namen '${name}' nennen, war: ${diagBadName}`);
    assert.ok(!diagBadName!.includes("Reihenfolge"), `diag darf nicht Reihenfolge erwähnen bei Name-Tippfehler, war: ${diagBadName}`);

    // Kein --name → Strukturfehler, diag gibt null zurück (why greift)
    assert.equal(task.diag!(norm(`docker run --detach ${img}`)), null, "kein --name → diag muss null sein");

    tested = true;
    break;
  }
  assert.ok(tested, "Keine gültige docker-run-named-Instanz gefunden");
});

test("docker-run-named: diag benennt falsches Image gezielt (#321)", () => {
  const make = KQContent.DRILLS["docker-run-named"];
  let tested = false;
  for (let i = 0; i < 60; i++) {
    const task = make(new KQSim({}));
    const m = task.solution.match(/^docker run --detach --name (\S+) (\S+)$/);
    if (!m) continue;
    const [, name, img] = m;
    const norm = (s: string) => s.trim().replace(/\s+/g, " ");

    // Image falsch → diag nennt das richtige Image
    const diagBadImg = task.diag!(norm(`docker run --detach --name ${name} wrong-image`));
    assert.ok(diagBadImg, "Image-Tippfehler → diag muss nicht-null sein");
    assert.ok(diagBadImg!.includes(img), `diag muss erwartetes Image '${img}' nennen, war: ${diagBadImg}`);

    tested = true;
    break;
  }
  assert.ok(tested, "Keine gültige docker-run-named-Instanz gefunden");
});

/* ===== GitOps-Archipel: False-Positive-Schutz (#101) =====
 * Die accept-Regexes der GitOps-Quests (gitops-self-sync–gitops-app-of-apps) müssen falsche Eingaben
 * zuverlässig ablehnen – ein zu breiter Regex würde das Lernziel aushebeln. */

function gitopsTask(questId: string, taskId: string) {
  const q = KQContent.QUESTS.find(x => x.id === questId);
  assert.ok(q, "Quest " + questId + " nicht gefunden");
  for (const step of q!.steps) {
    if (step.type === "terminal") {
      const t = step.tasks.find(t => t.id === taskId);
      if (t) return t;
    } else if (step.type === "teach" && step.cmd.id === taskId) {
      return step.cmd;
    }
  }
  throw new Error(questId + "/" + taskId + " nicht gefunden");
}

function accepts(task: { accept: RegExp[] }, input: string): boolean {
  const norm = input.trim().replace(/\s+/g, " ");
  return task.accept.some(re => re.test(norm));
}

test("#101 gitops-self-sync: argocd app list akzeptiert 'ls'-Alias, lehnt falschen Subcommand ab", () => {
  const task = gitopsTask("gitops-self-sync", "t-argo-list");
  assert.ok(accepts(task, "argocd app list"), "argocd app list muss gelten");
  assert.ok(accepts(task, "argocd app ls"),   "argocd app ls (Alias) muss GENAUSO gelten");
  assert.ok(!accepts(task, "argocd app get hafen-lager"), "'get' statt 'list' muss scheitern");
  assert.ok(!accepts(task, "kubectl get pods"),           "kubectl-Befehl muss scheitern");
  assert.ok(!accepts(task, "argocd app list hafen-lager"), "extra Argument muss scheitern");
});

test("#101 gitops-self-sync: argocd app get hafen-lager lehnt falschen/fehlenden App-Namen ab", () => {
  const task = gitopsTask("gitops-self-sync", "t-argo-get");
  assert.ok(accepts(task, "argocd app get hafen-lager"), "korrekte Eingabe muss gelten");
  assert.ok(!accepts(task, "argocd app get"),              "fehlender Name muss scheitern");
  assert.ok(!accepts(task, "argocd app get hafen-funk"),   "falscher App-Name muss scheitern");
});

test("#101 gitops-self-sync: argocd app sync hafen-lager lehnt falschen/fehlenden App-Namen ab", () => {
  const task = gitopsTask("gitops-self-sync", "t-argo-sync");
  assert.ok(accepts(task, "argocd app sync hafen-lager"), "korrekte Eingabe muss gelten");
  assert.ok(!accepts(task, "argocd app sync"),             "fehlender Name muss scheitern");
  assert.ok(!accepts(task, "argocd app sync hafen-flotte"), "falscher App-Name muss scheitern");
});

test("#101 gitops-self-sync: kubectl apply -f application.yaml akzeptiert --filename, lehnt falsche Datei ab", () => {
  const task = gitopsTask("gitops-self-sync", "t-argo-apply");
  assert.ok(accepts(task, "kubectl apply -f application.yaml"),         "kurze Form -f muss gelten");
  assert.ok(accepts(task, "kubectl apply --filename application.yaml"), "--filename muss GENAUSO gelten");
  assert.ok(!accepts(task, "kubectl apply application.yaml"),           "ohne -f/--filename muss scheitern");
  assert.ok(!accepts(task, "kubectl apply -f app.yaml"),                "falscher Dateiname muss scheitern");
});

test("#101 gitops-drift-detection: kubectl apply -f application-selfheal.yaml lehnt die alte Datei ab", () => {
  const task = gitopsTask("gitops-drift-detection", "t-sh-apply");
  assert.ok(accepts(task, "kubectl apply -f application-selfheal.yaml"), "korrekte Eingabe muss gelten");
  assert.ok(!accepts(task, "kubectl apply -f application.yaml"),         "alte Datei (ohne -selfheal) muss scheitern");
});

test("#101 gitops-drift-detection: kubectl scale auf 0 lehnt andere --replicas-Werte ab", () => {
  const task = gitopsTask("gitops-drift-detection", "t-sh-scale");
  assert.ok(accepts(task, "kubectl scale deployment hafen-lager --replicas=0"),   "--replicas=0 muss gelten");
  assert.ok(accepts(task, "kubectl scale deployment/hafen-lager --replicas=0"),   "deployment/-Schreibweise muss gelten");
  assert.ok(!accepts(task, "kubectl scale deployment hafen-lager --replicas=1"),  "replicas=1 (falscher Wert) muss scheitern");
  assert.ok(!accepts(task, "kubectl scale hafen-lager --replicas=0"),             "ohne 'deployment' muss scheitern");
});

/* ===== Lagerhallen-Viertel: Phase-7-Übungs-Drills (#142) =====
 * Stateful-Workload-Drills bei Knut: StatefulSet, PVC/PV/StorageClass, Backup/Restore,
 * plus der Negativfall „PVC bleibt Pending". Über die generischen Drill-Tests hinaus
 * (why/accept/keine-Supersets) sichern diese die FACHLICHE Mechanik ab (Red-Green). */

test("#142 PRACTICE.knut deckt die drei Storage-Quests mit existierenden Drills", () => {
  const pool = KQContent.PRACTICE.knut;
  assert.ok(pool && pool.length > 0, "Knut hat keinen Übungs-Pool");
  const questIds = new Set(KQContent.QUESTS.map(q => q.id));
  for (const p of pool) {
    assert.ok(KQContent.DRILLS[p.drill], "unbekannter Drill im Knut-Pool: " + p.drill);
    assert.ok(questIds.has(p.after), "unbekannte after-Quest im Knut-Pool: " + p.after);
  }
  const after = new Set(pool.map(p => p.after));
  for (const q of ["storage-statefulset", "storage-pvc", "storage-backup-restore"]) {
    assert.ok(after.has(q), "Knut-Pool deckt die Quest nicht ab: " + q);
  }
});

/* ===== Expeditions-Flotte (Phase 9): Übungs-Pool & Drills (#154/#157) =====
 * Analog zum Knut-Pool oben: der Saga-Pool muss die vier Flotte-Quests mit
 * existierenden, gestaffelten Drills abdecken; die fachlichen Drill-Tests darunter
 * sichern (Red-Green), dass die Drill-Szenarien wirklich das Lehrbild aufbauen. */

test("#154 PRACTICE.saga deckt die vier Flotte-Quests mit existierenden Drills (gestaffelt)", () => {
  const pool = KQContent.PRACTICE.saga;
  assert.ok(pool && pool.length > 0, "Saga hat keinen Übungs-Pool");
  const questIds = new Set(KQContent.QUESTS.map(q => q.id));
  for (const p of pool) {
    assert.ok(KQContent.DRILLS[p.drill], "unbekannter Drill im Saga-Pool: " + p.drill);
    assert.ok(questIds.has(p.after), "unbekannte after-Quest im Saga-Pool: " + p.after);
  }
  // Jeder Phase-9-Quest schaltet mindestens einen Übungs-Drill frei.
  const after = new Set(pool.map(p => p.after));
  for (const q of ["terraform-modul", "terraform-remote-state", "terraform-provider", "terraform-variablen-outputs"]) {
    assert.ok(after.has(q), "Saga-Pool deckt die Quest nicht ab: " + q);
  }
  // Die fünf Phase-9-Drills sind alle eingehängt.
  const drills = new Set(pool.map(p => p.drill));
  for (const d of ["tf-get", "tf-init-flotte", "tf-apply-flotte", "tf-output-read", "tf-output-list"]) {
    assert.ok(drills.has(d), "Saga-Pool enthält den Drill nicht: " + d);
  }
});

test("#154 tf-get-Drill stellt zwei noch ungeholte Module bereit (Modul-Lehrbild)", () => {
  const sim = new KQSim({});
  const task = KQContent.DRILLS["tf-get"](sim);
  assert.equal(sim.tf.modules.length, 2, "der Drill stellt zwei Modul-Aufrufe bereit");
  assert.ok(sim.tf.modules.every(m => m.fetched === false), "vor dem Holen ist kein Modul geholt");
  // Die Musterlösung holt die Module wirklich.
  sim.exec(task.solution);
  assert.ok(sim.tf.modules.every(m => m.fetched === true), "terraform get holt die Module");
});

test("#154 tf-apply-flotte-Drill richtet ein initialisiertes Multi-Cloud-Projekt ein (zwei Provider)", () => {
  const sim = new KQSim({});
  const task = KQContent.DRILLS["tf-apply-flotte"](sim);
  assert.equal(sim.tf.providers.length, 2, "Multi-Cloud: zwei Provider deklariert");
  assert.equal(sim.tf.initialized, true, "der Drill setzt ein bereits initialisiertes Projekt voraus");
  assert.equal(sim.tf.applied, false, "vor dem Apply ist noch nichts gebaut");
  // apply baut beide Inseln – je eine pro Anbieter.
  sim.exec(task.solution);
  assert.equal(sim.tf.applied, true, "terraform apply baut die Vorposten");
  const list = sim.exec("terraform state list").output!.split("\n").sort();
  assert.deepEqual(list, ["nordwind_insel.ost", "passat_insel.west"], "beide Anbieter-Inseln im State");
});

test("#154 tf-output-list-Drill verbirgt den sensiblen Wert in der Übersicht, gezielt bleibt er roh", () => {
  const sim = new KQSim({});
  const task = KQContent.DRILLS["tf-output-list"](sim);
  const list = sim.exec(task.solution).output!;
  assert.match(list, /anleger_adresse = "nordkai\.flotte\.local"/, "offene Outputs stehen im Klartext");
  assert.match(list, /lager_schluessel = <sensitive>/, "das Geheimnis ist in der Übersicht verborgen");
  assert.doesNotMatch(list, /werft-geheim/, "der Klartext des Geheimnisses taucht in der Übersicht NICHT auf");
  // Gezielt abgefragt gibt Terraform den Rohwert heraus – auch den sensiblen.
  assert.equal(sim.exec("terraform output lager_schluessel").output, "werft-geheim");
});

test("#155 die acht vertiefenden Flotte-Quiz-Karten existieren und hängen an ihrer Quest (chapter)", () => {
  const questIds = new Set(KQContent.QUESTS.map(q => q.id));
  const deepening = KQContent.CRAB_QUIZ.filter(c => /^q-flotte-.*-(3|4)$/.test(c.id));
  assert.equal(deepening.length, 8, "es gibt acht vertiefende Karten (zwei je Phase-9-Quest)");
  for (const card of deepening) {
    assert.ok(card.chapter, card.id + ": vertiefende Karte braucht ein chapter (SR-Pool nach Quest-Abschluss)");
    assert.ok(questIds.has(card.chapter!), card.id + ": chapter zeigt auf eine unbekannte Quest: " + card.chapter);
  }
  // Genau zwei je Flotte-Quest.
  for (const q of ["terraform-modul", "terraform-remote-state", "terraform-provider", "terraform-variablen-outputs"]) {
    assert.equal(deepening.filter(c => c.chapter === q).length, 2, "zwei vertiefende Karten für " + q);
  }
});

test("#265 CRD/Operator-Lernkarten existieren, sind sauber und hängen an einer Quest", () => {
  const questIds = new Set(KQContent.QUESTS.map(q => q.id));
  const platform = KQContent.CRAB_QUIZ.filter(c => /^q-platform-/.test(c.id));
  assert.ok(platform.length >= 4, "es gibt mindestens vier Plattform-Lernkarten (CRD/Operator/Reconcile)");
  // Das Grundkonzept muss benannt sein: CRD und Operator je mindestens einmal.
  const texte = platform.map(c => c.q + " " + c.options.join(" ") + " " + c.explain).join("\n");
  assert.match(texte, /CustomResourceDefinition|\bCRD\b/, "eine Karte muss die CRD erklären");
  assert.match(texte, /Operator/, "eine Karte muss den Operator erklären");
  assert.match(texte, /Reconcile|Self-Heal/i, "die Reconcile-/Self-Heal-Idee muss vorkommen");
  for (const card of platform) {
    assert.ok(card.chapter, card.id + ": Lernkarte braucht ein chapter (SR-Pool nach Quest-Abschluss)");
    assert.ok(questIds.has(card.chapter!), card.id + ": chapter zeigt auf eine unbekannte Quest: " + card.chapter);
  }
});

test("#268 Gateway-API-Quiz-Karten hängen an der Netzwerk-Vertiefung und decken GatewayClass/Gateway/HTTPRoute + Abgrenzung zu Ingress ab", () => {
  const questIds = new Set(KQContent.QUESTS.map(q => q.id));
  const cards = KQContent.CRAB_QUIZ.filter(c => /^q-gateway-/.test(c.id));
  assert.ok(cards.length >= 4, "mindestens vier Gateway-API-Karten erwartet, gefunden: " + cards.length);
  for (const card of cards) {
    // SR-Pool erst, wenn der Spieler Ingress/DNS schon kennt (#371-Erreichbarkeit über chapter).
    assert.equal(card.chapter, "dns-service-discovery", card.id + ": chapter soll die Netzwerk-Vertiefungsquest sein");
    assert.ok(questIds.has(card.chapter!), card.id + ": chapter zeigt auf eine unbekannte Quest: " + card.chapter);
    assert.ok(card.correct >= 0 && card.correct < card.options.length, card.id + ": correct außerhalb der Optionen");
    assert.ok(card.explain.trim().length > 0, card.id + ": Erklärung ist Pflicht");
  }
  // Die vom Ticket geforderten Konzepte tauchen irgendwo im Quiz auf.
  const blob = cards.map(c => c.q + " " + c.options.join(" ") + " " + c.explain).join(" ").toLowerCase();
  for (const begriff of ["gatewayclass", "httproute", "gateway", "ingress", "rollentrennung"]) {
    assert.ok(blob.includes(begriff), "Gateway-API-Quiz erwähnt „" + begriff + "“ nicht");
  }
});

test("#281 Keycloak-Vertiefungskarten decken Realm/Client, Rolle/Gruppe, Mapper und IDP-als-Code ab und hängen an der Keycloak-Quest", () => {
  const questIds = new Set(KQContent.QUESTS.map(q => q.id));
  const cards = KQContent.CRAB_QUIZ.filter(c => /^q-keycloak-/.test(c.id));
  assert.ok(cards.length >= 4, "mindestens vier Keycloak-Karten erwartet, gefunden: " + cards.length);
  for (const card of cards) {
    // SR-Pool erst, wenn der Spieler Keycloak (kraken-boss) kennt – und Terraform-als-Code ist da längst eingeführt.
    assert.equal(card.chapter, "kraken-boss", card.id + ": chapter soll die Keycloak-Quest sein");
    assert.ok(questIds.has(card.chapter!), card.id + ": chapter zeigt auf eine unbekannte Quest: " + card.chapter);
    assert.ok(card.correct >= 0 && card.correct < card.options.length, card.id + ": correct außerhalb der Optionen");
    assert.ok(card.explain.trim().length > 0, card.id + ": Erklärung ist Pflicht");
  }
  // Die vom Ticket geforderten Konzepte tauchen irgendwo im Quiz auf.
  const blob = cards.map(c => c.q + " " + c.options.join(" ") + " " + c.explain).join(" ").toLowerCase();
  for (const begriff of ["realm", "client", "rolle", "gruppe", "mapper", "token", "keycloak_*", "terraform"]) {
    assert.ok(blob.includes(begriff), "Keycloak-Quiz erwähnt „" + begriff + "“ nicht");
  }
});

test("#282 GitLab-CI-Vertiefungskarten decken extends/Templates, rules, manuelle Freigabe, environment und CI-Variablen ab und hängen an der Pipeline-Quest", () => {
  const questIds = new Set(KQContent.QUESTS.map(q => q.id));
  // Die neuen Vertiefungskarten (q-ci-4 aufwärts) – q-ci-1..3 sind das Grundwissen aus der Quest selbst.
  const cards = KQContent.CRAB_QUIZ.filter(c => /^q-ci-(4|5|6|7|8)$/.test(c.id));
  assert.ok(cards.length >= 5, "mindestens fünf CI-Vertiefungskarten erwartet, gefunden: " + cards.length);
  for (const card of cards) {
    // SR-Pool erst, wenn der Spieler die Pipeline-Passage (git-pipeline) gespielt hat – dort wird .gitlab-ci.yml eingeführt.
    assert.equal(card.chapter, "git-pipeline", card.id + ": chapter soll die Pipeline-Quest sein");
    assert.ok(questIds.has(card.chapter!), card.id + ": chapter zeigt auf eine unbekannte Quest: " + card.chapter);
    assert.ok(card.correct >= 0 && card.correct < card.options.length, card.id + ": correct außerhalb der Optionen");
    assert.ok(card.explain.trim().length > 0, card.id + ": Erklärung ist Pflicht");
  }
  // Die vom Ticket geforderten Konzepte tauchen irgendwo im Quiz auf.
  const blob = cards.map(c => c.q + " " + c.options.join(" ") + " " + c.explain).join(" ").toLowerCase();
  for (const begriff of ["extends", "vorlage", "rules", "manuell", "freigabe", "environment", "dev/qs/prod", "ci-variablen", "secret"]) {
    assert.ok(blob.includes(begriff), "CI-Quiz erwähnt „" + begriff + "“ nicht");
  }
});

test("#466 Cluster-Bootstrapping-Vertiefungskarten decken Control-Plane/Worker, die vier Komponenten, kubeadm init/join und manuell-vs-Code ab und hängen am Aufbau-Capstone", () => {
  const questIds = new Set(KQContent.QUESTS.map(q => q.id));
  const cards = KQContent.CRAB_QUIZ.filter(c => /^q-bootstrap-/.test(c.id));
  assert.ok(cards.length >= 5, "mindestens fünf Bootstrapping-Karten erwartet, gefunden: " + cards.length);
  for (const card of cards) {
    // SR-Pool erst, wenn der Spieler den Aufbau-Bogen bis zum Code-Capstone gespielt hat (dort ist auch Terraform-als-Cluster eingeführt).
    assert.equal(card.chapter, "aufbau-cluster-als-code", card.id + ": chapter soll die Aufbau-Capstone-Quest sein");
    assert.ok(questIds.has(card.chapter!), card.id + ": chapter zeigt auf eine unbekannte Quest: " + card.chapter);
    assert.ok(card.correct >= 0 && card.correct < card.options.length, card.id + ": correct außerhalb der Optionen");
    assert.ok(card.explain.trim().length > 0, card.id + ": Erklärung ist Pflicht");
  }
  // Die vom Ticket geforderten Konzepte tauchen irgendwo im Quiz auf.
  const blob = cards.map(c => c.q + " " + c.options.join(" ") + " " + c.explain).join(" ").toLowerCase();
  for (const begriff of ["control-plane", "worker", "kube-apiserver", "etcd", "scheduler", "controller-manager", "kubeadm init", "kubeadm join", "token", "terraform", "deklarativ", "reproduzierbar"]) {
    assert.ok(blob.includes(begriff), "Bootstrapping-Quiz erwähnt „" + begriff + "“ nicht");
  }
});

test("#328 Sandbox-Vertiefungskarten decken Sandbox/ephemer, Namespace, kind/minikube, Preview und test-vor-Prod ab und hängen am GitOps-Finale", () => {
  const questIds = new Set(KQContent.QUESTS.map(q => q.id));
  const cards = KQContent.CRAB_QUIZ.filter(c => /^q-sandbox-/.test(c.id));
  assert.ok(cards.length >= 5, "mindestens fünf Sandbox-Karten erwartet, gefunden: " + cards.length);
  for (const card of cards) {
    // SR-Pool erst nach dem GitOps-Bogen – dort sind Namespaces, Preview/Prod und GitOps bekannt (Preview-Umgebungen sind GitOps-nativ).
    assert.equal(card.chapter, "gitops-app-of-apps", card.id + ": chapter soll die GitOps-Finale-Quest sein");
    assert.ok(questIds.has(card.chapter!), card.id + ": chapter zeigt auf eine unbekannte Quest: " + card.chapter);
    assert.ok(card.correct >= 0 && card.correct < card.options.length, card.id + ": correct außerhalb der Optionen");
    assert.ok(card.explain.trim().length > 0, card.id + ": Erklärung ist Pflicht");
  }
  // Die vom Ticket geforderten Konzepte tauchen irgendwo im Quiz auf.
  const blob = cards.map(c => c.q + " " + c.options.join(" ") + " " + c.explain).join(" ").toLowerCase();
  for (const begriff of ["sandbox", "ephemer", "wegwerf", "namespace", "kubectl -n", "kind", "minikube", "preview", "prod", "reproduzierbar"]) {
    assert.ok(blob.includes(begriff), "Sandbox-Quiz erwähnt „" + begriff + "“ nicht");
  }
});

test("#142 pvc-pending erzeugt einen wirklich auf Pending hängenden PVC (Negativfall)", () => {
  const sim = new KQSim({});
  KQContent.DRILLS["pvc-pending"](sim);
  const pending = sim.pvcs.filter(p => p.status === "Pending");
  assert.ok(pending.length >= 1, "pvc-pending muss ein Pending-PVC hinterlassen");
  // Genau das Lehrbild: kein Volume gebunden, weil die StorageClass fehlt.
  assert.ok(pending.some(p => p.volume === ""), "ein Pending-PVC darf kein gebundenes Volume haben");
});

test("#142 Red-Green: ein PVC mit existierender StorageClass wird NICHT Pending", () => {
  // Beweist, dass der Pending-Test echt ist: derselbe Mechanismus mit gültiger
  // StorageClass bindet sofort (Bound), wäre also nicht fälschlich „Pending".
  const sim = new KQSim({});
  KQContent.DRILLS["pvc-apply"](sim);
  sim.exec("kubectl apply --filename pvc.yaml");
  assert.ok(sim.pvcs.some(p => p.status === "Bound"), "pvc-apply muss ein Bound-PVC erzeugen");
});

test("#142 snap-apply erzeugt einen readyToUse-Snapshot der Quelle", () => {
  const sim = new KQSim({});
  const task = KQContent.DRILLS["snap-apply"](sim);
  const before = sim.volumeSnapshots.length;
  sim.exec(task.solution);
  assert.equal(sim.volumeSnapshots.length, before + 1, "snap-apply muss genau einen Snapshot anlegen");
  assert.ok(sim.volumeSnapshots.every(v => v.readyToUse), "der angelegte Snapshot muss readyToUse sein");
});

test("#142 snap-restore holt die gesicherten Daten zurück (dataSource)", () => {
  const sim = new KQSim({});
  const task = KQContent.DRILLS["snap-restore"](sim);
  sim.exec(task.solution);
  assert.ok(sim.pvcs.some(p => p.data === "stammkundenverzeichnis"),
    "Restore muss ein PVC mit dem gesicherten Volume-Inhalt erzeugen");
});

test("#142 sts-delete-pod trifft -0, der Pod kehrt namensgleich zurück (stabile Identität)", () => {
  const sim = new KQSim({});
  const task = KQContent.DRILLS["sts-delete-pod"](sim);
  const m = task.solution.match(/^kubectl delete pod (\S+)$/);
  assert.ok(m, "Lösung muss 'kubectl delete pod <name>' sein, war: " + task.solution);
  const podName = m![1];
  assert.ok(podName.endsWith("-0"), "der Drill muss den Ordinal-0-Pod adressieren, war: " + podName);
  sim.exec(task.solution);
  const sts = sim.statefulSets.find(s => s.pods.some(p => p.name === podName));
  assert.ok(sts, "nach dem Löschen muss der StatefulSet-Pod namensgleich zurück sein: " + podName);
});

test("#101 gitops-app-of-apps: argocd app get hafen-flotte lehnt anderen App-Namen ab", () => {
  const task = gitopsTask("gitops-app-of-apps", "t-aoa-get");
  assert.ok(accepts(task, "argocd app get hafen-flotte"),    "korrekte Eingabe muss gelten");
  assert.ok(!accepts(task, "argocd app get hafen-lager"),    "hafen-lager (falsche App) muss scheitern");
  assert.ok(!accepts(task, "argocd app get hafen-flotte2"),  "ähnlicher Name muss scheitern");
});

test("#101 gitops-app-of-apps: kubectl apply -f app-of-apps.yaml lehnt andere yaml-Datei ab", () => {
  const task = gitopsTask("gitops-app-of-apps", "t-aoa-apply");
  assert.ok(accepts(task, "kubectl apply -f app-of-apps.yaml"),         "korrekte Eingabe muss gelten");
  assert.ok(!accepts(task, "kubectl apply -f application.yaml"),         "falsche Datei muss scheitern");
  assert.ok(!accepts(task, "kubectl apply -f app-of-apps"),              "ohne .yaml-Endung muss scheitern");
});

test("#101 GitOps-Quests (gitops-argocd-intro–gitops-app-of-apps): Belohnungen gesetzt und ansteigend", () => {
  const ids = ["gitops-argocd-intro", "gitops-self-sync", "gitops-drift-detection", "gitops-app-of-apps"];
  const quests = ids.map(id => {
    const q = KQContent.QUESTS.find(x => x.id === id);
    assert.ok(q, id + " fehlt in QUESTS");
    return q!;
  });
  for (const q of quests) {
    assert.ok(q.rewardXp > 0, q.id + ": rewardXp muss > 0 sein");
    assert.ok(q.rewardCoins > 0, q.id + ": rewardCoins muss > 0 sein");
  }
  // Letzte Quest bringt mehr als erste
  assert.ok(quests[3].rewardXp > quests[0].rewardXp, "gitops-app-of-apps muss mehr XP bringen als gitops-argocd-intro");
});

/* ===== Monitoring-Leuchtturm: False-Positive-Schutz (#120) =====
 * Die accept-Regexes der Observability-Quests (observability-metrics–observability-alerts) müssen falsche Eingaben
 * zuverlässig ablehnen – ein zu breiter Regex würde das Lernziel aushebeln. */

function obsTask(questId: string, taskId: string) {
  const q = KQContent.QUESTS.find(x => x.id === questId);
  assert.ok(q, "Quest " + questId + " nicht gefunden");
  for (const step of q!.steps) {
    if (step.type === "terminal") {
      const t = step.tasks.find(t => t.id === taskId);
      if (t) return t;
    } else if (step.type === "teach" && step.cmd.id === taskId) {
      return step.cmd;
    }
  }
  throw new Error(questId + "/" + taskId + " nicht gefunden");
}

test("#120 observability-metrics: kubectl top pods akzeptiert po-Kürzel, lehnt 'kubectl top' ohne Ressource und 'get pods' ab", () => {
  const task = obsTask("observability-metrics", "t-top-pods");
  assert.ok(accepts(task, "kubectl top pods"),  "kubectl top pods muss gelten");
  assert.ok(accepts(task, "kubectl top pod"),   "kubectl top pod muss gelten");
  assert.ok(accepts(task, "kubectl top po"),    "kubectl top po (Kurzform) muss gelten");
  assert.ok(!accepts(task, "kubectl top"),      "'kubectl top' ohne Ressource muss scheitern");
  assert.ok(!accepts(task, "kubectl get pods"), "'get pods' statt 'top pods' muss scheitern");
  assert.ok(!accepts(task, "kubectl top nodes"),"'top nodes' statt 'top pods' muss scheitern");
});

test("#120 observability-metrics: kubectl top nodes lehnt 'top pods' und bloßes 'top' ab", () => {
  const task = obsTask("observability-metrics", "t-top-nodes");
  assert.ok(accepts(task, "kubectl top nodes"), "kubectl top nodes muss gelten");
  assert.ok(accepts(task, "kubectl top node"),  "kubectl top node muss gelten");
  assert.ok(accepts(task, "kubectl top no"),    "kubectl top no (Kurzform) muss gelten");
  assert.ok(!accepts(task, "kubectl top pods"), "'top pods' statt 'top nodes' muss scheitern");
  assert.ok(!accepts(task, "kubectl top"),      "bloßes 'kubectl top' muss scheitern");
});

test("#120 observability-metrics: kubectl apply -f servicemonitor.yaml lehnt falsche Datei und fehlendes -f ab", () => {
  const task = obsTask("observability-metrics", "t-sm-apply");
  assert.ok(accepts(task, "kubectl apply -f servicemonitor.yaml"),         "kurze Form -f muss gelten");
  assert.ok(accepts(task, "kubectl apply --filename servicemonitor.yaml"), "--filename muss gelten");
  assert.ok(!accepts(task, "kubectl apply servicemonitor.yaml"),           "ohne -f/--filename muss scheitern");
  assert.ok(!accepts(task, "kubectl apply -f grafanadatasource.yaml"),     "falsche Datei muss scheitern");
  assert.ok(!accepts(task, "kubectl apply -f servicemonitor"),             "ohne .yaml-Endung muss scheitern");
});

test("#120 observability-metrics: kubectl get servicemonitors akzeptiert Kurzform smon, lehnt andere Ressourcen ab", () => {
  const task = obsTask("observability-metrics", "t-sm-get");
  assert.ok(accepts(task, "kubectl get servicemonitors"),  "kubectl get servicemonitors muss gelten");
  assert.ok(accepts(task, "kubectl get servicemonitor"),   "kubectl get servicemonitor (Singular) muss gelten");
  assert.ok(accepts(task, "kubectl get smon"),             "kubectl get smon (Kurzform) muss gelten");
  assert.ok(!accepts(task, "kubectl get pods"),            "'get pods' muss scheitern");
  assert.ok(!accepts(task, "kubectl describe servicemonitors"), "'describe' statt 'get' muss scheitern");
});

test("#120 observability-alerts: kubectl get alerts akzeptiert nur 'alerts' (Plural), lehnt Singular und anderen Verb ab", () => {
  const taskFiring   = obsTask("observability-alerts", "t-alerts-get");
  const taskResolved = obsTask("observability-alerts", "t-alerts-resolved");
  for (const task of [taskFiring, taskResolved]) {
    assert.ok(accepts(task, "kubectl get alerts"),          "kubectl get alerts muss gelten");
    assert.ok(!accepts(task, "kubectl get alert"),          "'alert' (Singular) muss scheitern");
    assert.ok(!accepts(task, "kubectl describe alerts"),    "'describe' statt 'get' muss scheitern");
    assert.ok(!accepts(task, "kubectl get all"),            "'get all' statt 'get alerts' muss scheitern");
  }
});

test("#120 observability-alerts: kubectl scale deployment rechenknecht --replicas=0 lehnt anderen Replicas-Wert und fehlendes Deployment ab", () => {
  const task = obsTask("observability-alerts", "t-scale-zero");
  assert.ok(accepts(task, "kubectl scale deployment rechenknecht --replicas=0"),  "--replicas=0 muss gelten");
  assert.ok(accepts(task, "kubectl scale deployment rechenknecht --replicas 0"),  "--replicas 0 (Leerzeichen) muss gelten");
  assert.ok(!accepts(task, "kubectl scale deployment rechenknecht --replicas=1"), "replicas=1 (falscher Wert) muss scheitern");
  assert.ok(!accepts(task, "kubectl scale deployment rechenknecht --replicas=10"),"replicas=10 muss scheitern");
  assert.ok(!accepts(task, "kubectl scale rechenknecht --replicas=0"),            "ohne 'deployment' muss scheitern");
  assert.ok(!accepts(task, "kubectl scale deployment dampfwinde --replicas=0"),   "falscher Deployment-Name muss scheitern");
});

test("#120 observability-logs: kubectl logs akzeptiert Pod-Präfix signalgeber, lehnt -f-Variante als Basis-Log ab", () => {
  const taskBasic = obsTask("observability-logs", "t-logs-basic");
  assert.ok(accepts(taskBasic, "kubectl logs signalgeber"),         "exakter Deployment-Name muss gelten");
  assert.ok(accepts(taskBasic, "kubectl logs signalgeber-abc12"),   "voller Pod-Name muss gelten");
  assert.ok(!accepts(taskBasic, "kubectl logs -f signalgeber"),     "'-f signalgeber' passt nicht zum Basis-Log-Schritt");
  assert.ok(!accepts(taskBasic, "kubectl log signalgeber"),         "Tippfehler 'log' statt 'logs' muss scheitern");
});

test("#120 observability-logs: kubectl logs -f verlangt explizit -f oder --follow, lehnt bloßes 'logs' ab", () => {
  const taskFollow = obsTask("observability-logs", "t-logs-follow");
  assert.ok(accepts(taskFollow, "kubectl logs -f signalgeber"),          "'-f' vor Pod-Name muss gelten");
  assert.ok(accepts(taskFollow, "kubectl logs signalgeber -f"),          "'-f' nach Pod-Name muss gelten");
  assert.ok(accepts(taskFollow, "kubectl logs --follow signalgeber"),    "'--follow' muss gelten");
  assert.ok(!accepts(taskFollow, "kubectl logs signalgeber"),            "ohne -f/-follow muss scheitern");
});

test("#120 Phase-5-Quests (observability-metrics–observability-alerts): Belohnungen gesetzt und ansteigend", () => {
  const ids = ["observability-metrics", "observability-grafana", "observability-logs", "observability-alerts"];
  const quests = ids.map(id => {
    const q = KQContent.QUESTS.find(x => x.id === id);
    assert.ok(q, id + " fehlt in QUESTS");
    return q!;
  });
  for (const q of quests) {
    assert.ok(q.rewardXp > 0,    q.id + ": rewardXp muss > 0 sein");
    assert.ok(q.rewardCoins > 0, q.id + ": rewardCoins muss > 0 sein");
    assert.ok(q.giver === "lumi", q.id + ": Giver muss 'lumi' sein");
  }
  assert.ok(quests[3].rewardXp >= quests[0].rewardXp, "observability-alerts soll mindestens so viel XP bringen wie observability-metrics");
});

/* ===== Wachturm-Quartier: False-Positive-Schutz (#139, Phase 6: RBAC/ServiceAccounts/Pod-Security) =====
 * Die accept-Regexes der Vidar-Quests (k8s-serviceaccount–k8s-pod-security) müssen falsche Eingaben
 * zuverlässig ablehnen – ein zu breiter Regex würde das Lernziel (Least Privilege: genau DIESE
 * Identität / DIESE Datei / DIESE Stufe) aushebeln. Spiegelt die #101/#120-Blöcke für die neue Region.
 * Die negativen `!accepts(...)`-Zeilen sind die Red-Green-Absicherung: würde der Regex aufgeweicht,
 * würden sie sofort rot. */

function secTask(questId: string, taskId: string) {
  const q = KQContent.QUESTS.find(x => x.id === questId);
  assert.ok(q, "Quest " + questId + " nicht gefunden");
  for (const step of q!.steps) {
    if (step.type === "terminal") {
      const t = step.tasks.find(t => t.id === taskId);
      if (t) return t;
    } else if (step.type === "teach" && step.cmd.id === taskId) {
      return step.cmd;
    }
  }
  throw new Error(questId + "/" + taskId + " nicht gefunden");
}

test("#139 k8s-serviceaccount: create serviceaccount akzeptiert sa-Alias + genau 'wachdienst', lehnt fremden/fehlenden Namen ab", () => {
  const task = secTask("k8s-serviceaccount", "t-sa-create");
  assert.ok(accepts(task, "kubectl create serviceaccount wachdienst"), "Langform muss gelten");
  assert.ok(accepts(task, "kubectl create sa wachdienst"),             "sa-Alias muss GENAUSO gelten");
  assert.ok(!accepts(task, "kubectl create serviceaccount wachposten"), "fremder SA-Name muss scheitern");
  assert.ok(!accepts(task, "kubectl create serviceaccount"),            "fehlender Name muss scheitern");
  assert.ok(!accepts(task, "kubectl create role wachdienst"),           "'role' statt 'serviceaccount' muss scheitern");
});

test("#139 k8s-rbac-role: auth can-i hängt an genau der wachdienst-SA, --as ist Pflicht, das verb ist fix", () => {
  const cant = secTask("k8s-rbac-role", "t-rb-cant");
  assert.ok(accepts(cant, "kubectl auth can-i get pods --as=system:serviceaccount:default:wachdienst"), "korrekte Gegenprobe muss gelten");
  assert.ok(!accepts(cant, "kubectl auth can-i get pods"), "ohne --as (Admin-Frage) verfehlt das Lernziel → scheitern");
  assert.ok(!accepts(cant, "kubectl auth can-i get pods --as=system:serviceaccount:default:andere"), "fremde SA muss scheitern");
  assert.ok(!accepts(cant, "kubectl auth can-i list pods --as=system:serviceaccount:default:wachdienst"), "anderes verb (list statt get) muss scheitern");

  const cantDel = secTask("k8s-rbac-role", "t-rb-cant-delete");
  assert.ok(accepts(cantDel, "kubectl auth can-i delete pods --as=system:serviceaccount:default:wachdienst"), "delete-Probe muss gelten");
  assert.ok(!accepts(cantDel, "kubectl auth can-i get pods --as=system:serviceaccount:default:wachdienst"), "get statt delete verfehlt diesen Schritt → scheitern");
});

test("#139 k8s-rbac-clusterrole: auth can-i prüft genau 'list nodes' für die wachdienst-SA", () => {
  const can = secTask("k8s-rbac-clusterrole", "t-cr-can");
  assert.ok(accepts(can, "kubectl auth can-i list nodes --as=system:serviceaccount:default:wachdienst"), "korrekte Probe muss gelten");
  assert.ok(!accepts(can, "kubectl auth can-i list pods --as=system:serviceaccount:default:wachdienst"),  "pods statt nodes muss scheitern");
  assert.ok(!accepts(can, "kubectl auth can-i get nodes --as=system:serviceaccount:default:wachdienst"),   "get statt list (anderes verb dieses Schritts) muss scheitern");
  assert.ok(!accepts(can, "kubectl auth can-i list nodes"),                                                "ohne --as muss scheitern");
});

test("#139 k8s-pod-security: enforce-Label akzeptiert ns-Alias + nur 'restricted', lehnt andere Stufen/Modi ab", () => {
  const task = secTask("k8s-pod-security", "t-ps-enforce");
  assert.ok(accepts(task, "kubectl label namespace default pod-security.kubernetes.io/enforce=restricted"), "Langform muss gelten");
  assert.ok(accepts(task, "kubectl label ns default pod-security.kubernetes.io/enforce=restricted"),         "ns-Alias muss GENAUSO gelten");
  assert.ok(!accepts(task, "kubectl label namespace default pod-security.kubernetes.io/enforce=baseline"),   "baseline (zu lasche Stufe) verfehlt diesen Schritt → scheitern");
  assert.ok(!accepts(task, "kubectl label namespace default pod-security.kubernetes.io/enforce=privileged"), "privileged muss scheitern");
  assert.ok(!accepts(task, "kubectl label namespace default pod-security.kubernetes.io/warn=restricted"),     "warn statt enforce muss scheitern");
});

test("#139 k8s-pod-security: roh- und gehärtetes Manifest sind nicht vertauschbar (genau die richtige Datei)", () => {
  const roh = secTask("k8s-pod-security", "t-ps-apply-roh");
  assert.ok(accepts(roh, "kubectl apply -f spaehposten-roh.yaml"),         "roh: -f muss gelten");
  assert.ok(accepts(roh, "kubectl apply --filename spaehposten-roh.yaml"), "roh: --filename muss GENAUSO gelten");
  assert.ok(!accepts(roh, "kubectl apply -f spaehposten.yaml"),            "roh-Schritt darf die gehärtete Datei NICHT akzeptieren");

  const safe = secTask("k8s-pod-security", "t-ps-apply-safe");
  assert.ok(accepts(safe, "kubectl apply -f spaehposten.yaml"),            "safe: -f muss gelten");
  assert.ok(!accepts(safe, "kubectl apply -f spaehposten-roh.yaml"),       "safe-Schritt darf die rohe Datei NICHT akzeptieren");
});

test("#139 Wachturm-Quests (k8s-serviceaccount–k8s-pod-security): von Vidar, Thema 'security', Belohnungen gesetzt und ansteigend", () => {
  const ids = ["k8s-serviceaccount", "k8s-rbac-role", "k8s-rbac-clusterrole", "k8s-pod-security"];
  const quests = ids.map(id => {
    const q = KQContent.QUESTS.find(x => x.id === id);
    assert.ok(q, id + " fehlt in QUESTS");
    return q!;
  });
  for (const q of quests) {
    assert.equal(q.giver, "vidar",    q.id + ": Giver muss 'vidar' sein");
    assert.equal(q.topic, "security", q.id + ": Thema muss 'security' sein");
    assert.ok(q.rewardXp > 0,    q.id + ": rewardXp muss > 0 sein");
    assert.ok(q.rewardCoins > 0, q.id + ": rewardCoins muss > 0 sein");
  }
  for (let i = 1; i < quests.length; i++) {
    assert.ok(quests[i].rewardXp > quests[i - 1].rewardXp,       quests[i].id + ": XP muss über der Vorquest liegen");
    assert.ok(quests[i].rewardCoins > quests[i - 1].rewardCoins, quests[i].id + ": Dublonen müssen über der Vorquest liegen");
  }
});

/* ===== Wording-Wächter: verbannte spielwelt-interne Metaphern (#447) =====
 * Lernende sollen den echten Fachbegriff (Registry) sehen, nicht eine Metapher,
 * die nur einmal im Spiel auftaucht. Der Wächter sammelt ALLE spielersichtbaren
 * Quest-Texte und stellt sicher, dass „Kisten-Supermarkt" nicht zurückkehrt. */

/** Sammelt alle vom Spieler gelesenen Texte einer Quest-Liste (Titel, Dialoge,
 *  Choices, Teach-/Terminal-Panels samt Hints, Drill-Intros). */
function playerVisibleQuestText(quests: typeof KQContent.QUESTS): string[] {
  const out: string[] = [];
  for (const quest of quests) {
    out.push(quest.title);
    for (const step of quest.steps) {
      if ("brief" in step && step.brief) out.push(step.brief);
      if (step.type === "dialog") out.push(...step.lines);
      else if (step.type === "choice") {
        out.push(step.q);
        for (const o of step.options) out.push(o.t, o.reply);
      } else if (step.type === "teach") out.push(step.cmd.intro, step.cmd.text, step.cmd.hint);
      else if (step.type === "terminal") for (const t of step.tasks) out.push(t.text, t.hint);
      else if (step.type === "drill") out.push(step.intro);
    }
  }
  return out;
}

test("#447 Wording: kein 'Kisten-Supermarkt' (spielwelt-interne Metapher) mehr in spielersichtbaren Quest-Texten", () => {
  const treffer = playerVisibleQuestText(KQContent.QUESTS).filter(t => /Kisten-Supermarkt/i.test(t));
  assert.deepEqual(treffer, [], "verbannte Metapher 'Kisten-Supermarkt' gefunden – bitte 'Registry' verwenden:\n" + treffer.join("\n"));
});

test("#447 Red-Green: der Wording-Wächter findet 'Kisten-Supermarkt' in einem eingeschleusten Dialog", () => {
  // Ein Wächter, der den verbannten Begriff nicht fände, wäre wertlos – eingeschleuster
  // Dialog beweist, dass der Text-Sammler genau die spielersichtbaren Zeilen erfasst.
  const kaputt = [
    ...KQContent.QUESTS,
    {
      id: "q-wording-probe", title: "Probe", giver: "bo", topic: "docker", rewardXp: 1, rewardCoins: 1,
      steps: [{ type: "dialog", npc: "bo", lines: ["Baupläne liegen im Kisten-Supermarkt."] }],
    },
  ] as typeof KQContent.QUESTS;
  const treffer = playerVisibleQuestText(kaputt).filter(t => /Kisten-Supermarkt/i.test(t));
  assert.ok(treffer.length >= 1, "der Wächter müsste den eingeschleusten Begriff finden");
});

test("#462 Control-Plane-Quest: korrekt eingehängt + lehrt apiserver/etcd/scheduler/controller-manager", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "aufbau-control-plane");
  assert.ok(quest, "Quest aufbau-control-plane fehlt");
  assert.equal(quest!.topic, "cluster-aufbau", "gehört in den Aufbau-Bogen");
  assert.equal(quest!.giver, "ole", "Hafenmeister Ole führt den Aufbau-Bogen");

  // Folgt direkt der Sturm-Quest in der Reihenfolge (Cluster ist dort bare metal geworden).
  const ids = KQContent.QUESTS.map(q => q.id);
  assert.equal(ids[ids.indexOf("aufbau-sturm") + 1], "aufbau-control-plane", "kommt direkt nach dem Sturm");

  // Die teach-Schritte: kubeadm init (Control-Plane hoch) und der get-nodes-Beweis.
  const teachCmds = quest!.steps.filter((s): s is TeachStep => s.type === "teach").map(s => s.cmd);
  const init = teachCmds.find(c => c.id === "t-kubeadm-init");
  assert.ok(init, "kubeadm-init-Schritt fehlt");
  assert.ok(init!.accept.some(re => re.test("kubeadm init")), "kubeadm init wird akzeptiert");
  assert.ok(teachCmds.some(c => c.accept.some(re => re.test("kubectl get nodes"))), "Beweis-Schritt 'kubectl get nodes' fehlt");

  // Alle vier Control-Plane-Komponenten kommen im Lehrtext vor.
  const text = playerVisibleQuestText([quest!]).join(" ").toLowerCase();
  for (const teil of ["apiserver", "etcd", "scheduler", "controller-manager", "control-plane", "worker"]) {
    assert.ok(text.includes(teil), "Lehrtext nennt '" + teil + "' nicht");
  }
});

test("#462 kubeadm-init-check wird durch das Hochziehen der Control-Plane erfüllt (Red-Green)", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "aufbau-control-plane")!;
  const initStep = quest.steps.find((s): s is TeachStep => s.type === "teach" && s.cmd.id === "t-kubeadm-init")!;
  const check = initStep.cmd.check;
  assert.ok(check, "kubeadm-init braucht einen check auf controlPlane.up");

  const sim = new KQSim({});
  sim.mergeScenario({ bareMetal: true }); // wie nach dem Sturm
  assert.equal(check!(sim), false, "vor dem init ist die Control-Plane down → check falsch");
  sim.exec("kubeadm init");
  assert.equal(check!(sim), true, "nach dem init ist die Control-Plane oben → check erfüllt");
});

test("#463 Worker-Join-Quest: korrekt eingehängt + lehrt kubelet/Token/mehrere Knoten", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "aufbau-worker-join");
  assert.ok(quest, "Quest aufbau-worker-join fehlt");
  assert.equal(quest!.topic, "cluster-aufbau", "gehört in den Aufbau-Bogen");
  assert.equal(quest!.giver, "ole", "Hafenmeister Ole führt den Aufbau-Bogen");

  // Folgt direkt der Control-Plane-Quest (dort wurde die Brücke hochgezogen).
  const ids = KQContent.QUESTS.map(q => q.id);
  assert.equal(ids[ids.indexOf("aufbau-control-plane") + 1], "aufbau-worker-join", "kommt direkt nach der Control-Plane");

  // Zwei kubeadm-join-Schritte (Node für Node) + ein get-nodes-Beweis.
  const teachCmds = quest!.steps.filter((s): s is TeachStep => s.type === "teach").map(s => s.cmd);
  const joins = teachCmds.filter(c => c.accept.some(re => re.test("kubeadm join abcdef.0123456789abcdef")));
  assert.equal(joins.length, 2, "es gibt zwei kubeadm-join-Schritte (Node für Node)");
  assert.ok(teachCmds.some(c => c.accept.some(re => re.test("kubectl get nodes"))), "Beweis-Schritt 'kubectl get nodes' fehlt");

  // Lernbegriffe im Quest-Text.
  const text = playerVisibleQuestText([quest!]).join(" ").toLowerCase();
  for (const teil of ["kubelet", "token", "kapazität", "ausfallsicherheit", "worker"]) {
    assert.ok(text.includes(teil), "Lehrtext nennt '" + teil + "' nicht");
  }
});

test("#463 join-Checks füllen den Cluster Knoten für Knoten (Red-Green)", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "aufbau-worker-join")!;
  const scenario = quest.steps.find(s => s.scenario)?.scenario;
  assert.ok(scenario, "die Quest braucht ein Bootstrap-Szenario mit fixem Join-Token");

  const sim = new KQSim({});
  sim.mergeScenario(scenario!); // Control-Plane up, fixer Token, 1 Control-Plane-Knoten
  const join1 = quest.steps.find((s): s is TeachStep => s.type === "teach" && s.cmd.id === "t-join-1")!;
  const join2 = quest.steps.find((s): s is TeachStep => s.type === "teach" && s.cmd.id === "t-join-2")!;
  const getNodes = quest.steps.find((s): s is TeachStep => s.type === "teach" && s.cmd.id === "t-join-nodes")!;

  // Vor dem ersten Join: kein Worker, alle drei Checks falsch.
  assert.equal(join1.cmd.check!(sim), false, "vor Join 1: noch kein Worker");
  assert.equal(getNodes.cmd.check!(sim), false, "vor Join 1: erst 1 Knoten (< 3)");

  assert.ok(!sim.exec(join1.cmd.solution).error, "Join 1 läuft fehlerfrei (Token passt)");
  assert.equal(join1.cmd.check!(sim), true, "nach Join 1: ein Worker ist da");
  assert.equal(join2.cmd.check!(sim), false, "nach Join 1: erst 1 Worker (< 2)");

  assert.ok(!sim.exec(join2.cmd.solution).error, "Join 2 läuft fehlerfrei");
  assert.equal(join2.cmd.check!(sim), true, "nach Join 2: zwei Worker");
  assert.equal(getNodes.cmd.check!(sim), true, "nach beiden Joins: drei Knoten (Control-Plane + 2 Worker)");

  // Negativprobe: ein falscher Token wird abgewiesen (Erreichbarkeits-/Auth-Schutz).
  assert.ok(sim.exec("kubeadm join falsch.tokenxxxxxxxxxx").error, "falscher Token scheitert");
});

test("#464 Dienste-Quest: korrekt eingehängt + bringt Workloads per apply zurück", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "aufbau-dienste");
  assert.ok(quest, "Quest aufbau-dienste fehlt");
  assert.equal(quest!.topic, "cluster-aufbau", "gehört in den Aufbau-Bogen");
  assert.equal(quest!.giver, "ole", "Hafenmeister Ole führt den Aufbau-Bogen");

  // Folgt direkt der Worker-Join-Quest (dort wurden die Knoten angeschlossen) und schließt den Bogen.
  const ids = KQContent.QUESTS.map(q => q.id);
  assert.equal(ids[ids.indexOf("aufbau-worker-join") + 1], "aufbau-dienste", "kommt direkt nach den Workern");

  // Zwei apply-Schritte (Deployment + Service) – die vertraute Mechanik, kein neues Sim.
  const teachCmds = quest!.steps.filter((s): s is TeachStep => s.type === "teach").map(s => s.cmd);
  assert.ok(teachCmds.some(c => c.accept.some(re => re.test("kubectl apply --filename deployment.yaml"))), "apply-Deployment-Schritt fehlt");
  assert.ok(teachCmds.some(c => c.accept.some(re => re.test("kubectl apply --filename service.yaml"))), "apply-Service-Schritt fehlt");

  // Lernbegriffe im Quest-Text (Bogen-Schluss: Reihenfolge + Service als feste Adresse).
  const text = playerVisibleQuestText([quest!]).join(" ").toLowerCase();
  for (const teil of ["service", "deployment", "control-plane", "worker", "dienst"]) {
    assert.ok(text.includes(teil), "Lehrtext nennt '" + teil + "' nicht");
  }
});

test("#464 apply-Checks bringen Deployment + Service Pod für Pod zurück (Red-Green)", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "aufbau-dienste")!;
  const scenario = quest.steps.find(s => s.scenario)?.scenario;
  assert.ok(scenario, "die Quest braucht ein Szenario mit fertig gebautem Cluster + geretteten Manifesten");

  const sim = new KQSim({});
  sim.mergeScenario(scenario!); // Control-Plane up, 3 Knoten, Manifeste an Land, keine Workloads
  const applyDeploy = quest.steps.find((s): s is TeachStep => s.type === "teach" && s.cmd.id === "t-dienste-apply-deploy")!;
  const applySvc = quest.steps.find((s): s is TeachStep => s.type === "teach" && s.cmd.id === "t-dienste-apply-svc")!;

  // Vor dem apply: leerer Cluster, beide Checks falsch.
  assert.equal(applyDeploy.cmd.check!(sim), false, "vor apply: noch kein Funkdienst-Deployment");
  assert.equal(applySvc.cmd.check!(sim), false, "vor apply: noch kein Service");

  assert.ok(!sim.exec(applyDeploy.cmd.solution).error, "apply Deployment läuft fehlerfrei");
  assert.equal(applyDeploy.cmd.check!(sim), true, "nach apply: Deployment ist da und heil (Pods laufen auf den Workern)");
  assert.equal(applySvc.cmd.check!(sim), false, "nach Deployment-apply: Service fehlt noch");

  assert.ok(!sim.exec(applySvc.cmd.solution).error, "apply Service läuft fehlerfrei");
  assert.equal(applySvc.cmd.check!(sim), true, "nach apply: Deployment heil UND Service da");
});

test("#465 Capstone-Quest: korrekt eingehängt + lehrt Cluster als Code (Terraform)", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "aufbau-cluster-als-code");
  assert.ok(quest, "Quest aufbau-cluster-als-code fehlt");
  assert.equal(quest!.topic, "cluster-aufbau", "gehört in den Aufbau-Bogen");
  assert.equal(quest!.giver, "ole", "Hafenmeister Ole führt den Aufbau-Bogen");

  // Folgt direkt der Dienste-Quest und ist der Abschluss des Bogens (letzte Quest).
  const ids = KQContent.QUESTS.map(q => q.id);
  assert.equal(ids[ids.indexOf("aufbau-dienste") + 1], "aufbau-cluster-als-code", "kommt direkt nach der Dienste-Quest");

  // Der ganze Terraform-Zyklus init→plan→apply + der get-nodes-Beweis.
  const teachCmds = quest!.steps.filter((s): s is TeachStep => s.type === "teach").map(s => s.cmd);
  assert.ok(teachCmds.some(c => c.accept.some(re => re.test("terraform init"))), "terraform-init-Schritt fehlt");
  assert.ok(teachCmds.some(c => c.accept.some(re => re.test("terraform apply"))), "terraform-apply-Schritt fehlt");
  assert.ok(teachCmds.some(c => c.accept.some(re => re.test("kubectl get nodes"))), "Beweis-Schritt 'kubectl get nodes' fehlt");

  // Lernbegriffe im Quest-Text (Kontrast manuell ↔ als Code).
  const text = playerVisibleQuestText([quest!]).join(" ").toLowerCase();
  for (const teil of ["terraform", "code", "kubeadm", "reproduzierbar", "control-plane"]) {
    assert.ok(text.includes(teil), "Lehrtext nennt '" + teil + "' nicht");
  }
});

test("#465 terraform apply provisioniert den ganzen Cluster aus Code (Red-Green)", () => {
  const quest = KQContent.QUESTS.find(q => q.id === "aufbau-cluster-als-code")!;
  const scenario = quest.steps.find(s => s.scenario)?.scenario;
  assert.ok(scenario, "die Quest braucht ein bare-metal-Szenario mit der Cluster-.tf-Config");

  const sim = new KQSim({});
  sim.mergeScenario(scenario!); // bare metal + tfResources (hafen_cluster + 3 hafen_worker)
  const apply = quest.steps.find((s): s is TeachStep => s.type === "teach" && s.cmd.id === "t-code-apply")!;
  const nodes = quest.steps.find((s): s is TeachStep => s.type === "teach" && s.cmd.id === "t-code-nodes")!;

  // Vor dem apply: bare metal, beide Checks falsch, kubectl scheitert (connection refused).
  assert.equal(apply.cmd.check!(sim), false, "vor apply: nichts gebaut, Control-Plane down");
  assert.equal(nodes.cmd.check!(sim), false, "vor apply: weniger als 4 Knoten");
  assert.ok(sim.exec("kubectl get nodes").error, "vor apply: kubectl connection refused");

  sim.exec("terraform init");
  assert.ok(!sim.exec(apply.cmd.solution).error, "terraform apply läuft fehlerfrei");
  assert.equal(apply.cmd.check!(sim), true, "nach apply: tf applied UND Control-Plane up");
  assert.equal(nodes.cmd.check!(sim), true, "nach apply: 4 Knoten (Control-Plane + 3 Worker)");
  assert.ok(!sim.exec("kubectl get nodes").error, "nach apply antwortet der Cluster wieder");
});
