/* Konsistenz-Tests für die Spielinhalte (Quests, Quiz, Drills, Karten).
 * Ausführen mit:  node --test test/
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { KQContent } from "../src/content";
import { validateContent, type ContentBundle } from "../src/content/validate";
import { KQAssets } from "../src/assets-data";
import { ARCHIPEL_NPC } from "../src/archipel";
import { LIGHTHOUSE_NPC } from "../src/lighthouse";
import { WAREHOUSE_NPC } from "../src/warehouse";
import { Sim as KQSim } from "../src/sim";
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

test("Stapel-Spiel hat mindestens 2 Runden mit je 3+ Schichten", () => {
  assert.ok(KQContent.STACK_ROUNDS.length >= 2);
  for (const r of KQContent.STACK_ROUNDS) assert.ok(r.layers.length >= 3, r.name);
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
      { id: "c-bad", chapter: "q-existiert-nicht", q: "?", accept: [/^kubectl get pods$/], solution: "ganz was anderes" },
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

/** Findet Drills, deren `why`- oder `hint`-Text bare HTML-Platzhalter enthält
 *  (z.B. `<name>`, `<image>`), die im Browser via innerHTML unsichtbar werden.
 *  Erlaubt: echte HTML-Elemente wie <code>, <b>. (#320) */
function drillsWithRawHtmlPlaceholders(drills: typeof KQContent.DRILLS): string[] {
  const SAFE_TAGS = new Set(["code", "b", "i", "em", "strong", "br", "span", "div"]);
  const bareTag = /<([a-zA-Z][a-zA-Z0-9äöüÄÖÜ\-/]*)>/g;
  const out: string[] = [];
  for (const [id, make] of Object.entries(drills)) {
    const task = make(new KQSim({}));
    for (const field of ["why", "hint"] as const) {
      bareTag.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = bareTag.exec(task[field])) !== null) {
        if (!SAFE_TAGS.has(m[1].toLowerCase())) {
          out.push(`${id}.${field}: ${m[0]}`);
          break;
        }
      }
    }
  }
  return out;
}

test("Drills: why/hint enthalten keine rohen HTML-Platzhalter, die innerHTML verschluckt (#320)", () => {
  const problems = drillsWithRawHtmlPlaceholders(KQContent.DRILLS);
  assert.deepEqual(problems, [], "Drill-Felder mit unescapten <placeholder>-Tags (werden im Browser unsichtbar):\n" + problems.join("\n"));
});

test("Red-Green: ein Drill mit roh-HTML-Platzhalter in why wird gemeldet", () => {
  const kaputt = {
    ...KQContent.DRILLS,
    "drill-roh": (_sim: KQSim) => ({ text: "x", accept: [/^x$/], solution: "x", hint: "x", why: "Muster: docker run <name> <image>." }),
  };
  const problems = drillsWithRawHtmlPlaceholders(kaputt as typeof KQContent.DRILLS);
  assert.ok(problems.some(p => p.includes("drill-roh")), "roher Platzhalter nicht erkannt: " + problems.join(", "));
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
