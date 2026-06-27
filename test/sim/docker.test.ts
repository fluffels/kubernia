/* Unit-Tests: docker-Befehlsfamilie (sim/docker.ts) – Teil des sim.test.ts-Splits (#383).
 * Fahren wie gehabt über sim.exec("…"); gemeinsame Fixtures in ./helpers. */
import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { KQSim, freshSim } from "./helpers";

let sim: KQSim;
beforeEach(() => { sim = freshSim(); });

test("docker: Tippfehler im Image-Namen wird mit Vorschlag abgefangen", () => {
  const r = sim.exec("docker run busyboy");
  assert.ok(r.error, "Vertipper muss als Fehler gelten");
  assert.match(r.output!, /busybox/, "Vorschlag 'busybox' wird angeboten");
  assert.equal(sim.docker.containers.length, 0, "kein Container aus kaputtem Image");
  // korrekte Schreibweise geht durch
  assert.ok(!sim.exec("docker run busybox").error);
  // unbekanntes, aber nicht-tippfehler-Image bleibt erlaubt (Ausprobieren)
  assert.ok(!sim.exec("docker pull mein-eigenes-image").error);
});

test("docker: pull, run, ps, stop, ps -a", () => {
  assert.match(sim.exec("docker pull nginx").output!, /Downloaded newer image/);
  sim.exec("docker run -d --name web nginx");
  assert.match(sim.exec("docker ps").output!, /web/);
  sim.exec("docker stop web");
  assert.doesNotMatch(sim.exec("docker ps").output!, /\bweb\b/);
  assert.match(sim.exec("docker ps -a").output!, /Exited/);
});

test("docker pull: ohne Tag → :latest, mit dem 'default tag'-Hinweis (#449)", () => {
  const out = sim.exec("docker pull nginx").output!;
  assert.match(out, /Using default tag: latest/, "ohne Tag weist Docker auf den Default :latest hin");
  assert.match(out, /latest: Pulling from library\/nginx/);
  assert.match(out, /docker\.io\/library\/nginx:latest/, "kanonischer Name mit Hub-Präfix");
  assert.ok(sim.docker.pulled.includes("nginx:latest"), "nginx:latest liegt lokal bereit");
});

test("docker pull: expliziter Versions-Tag wird wirklich gezogen – KEIN falsches 'latest' (#449)", () => {
  const out = sim.exec("docker pull nginx:1.27").output!;
  assert.doesNotMatch(out, /Using default tag/, "bei explizitem Tag KEIN default-tag-Hinweis");
  assert.doesNotMatch(out, /\blatest\b/, "die Ausgabe behauptet nicht fälschlich 'latest'");
  assert.match(out, /1\.27: Pulling from library\/nginx/);
  assert.match(out, /docker\.io\/library\/nginx:1\.27/);
  assert.ok(sim.docker.pulled.includes("nginx:1.27"), "nginx:1.27 liegt lokal bereit");
  assert.ok(!sim.docker.pulled.includes("nginx:latest"), "ohne expliziten latest-Pull entsteht kein latest-Eintrag");
});

test("docker pull: aus einer expliziten Registry/Namespace – ohne falsches library/-Präfix (#449)", () => {
  const out = sim.exec("docker pull ghcr.io/hafen/leuchtfeuer:2.1").output!;
  assert.match(out, /2\.1: Pulling from ghcr\.io\/hafen\/leuchtfeuer/, "Quelle ist die genannte Registry, nicht 'library/'");
  assert.doesNotMatch(out, /library\//, "ein expliziter Registry-Pfad bekommt KEIN Docker-Hub-library-Präfix");
  assert.match(out, /Downloaded newer image for ghcr\.io\/hafen\/leuchtfeuer:2\.1/);
  assert.ok(sim.docker.pulled.includes("ghcr.io/hafen/leuchtfeuer:2.1"), "das Registry-Image liegt lokal bereit");
});

test("docker build: baut aus dem Dockerfile ein eigenes, getaggtes Image (#66)", () => {
  sim.files["Dockerfile"] = "FROM nginx:1.27\nCOPY site/ /usr/share/nginx/html\nEXPOSE 80";
  const r = sim.exec("docker build -t hafenwache:1.0 .");
  assert.ok(!r.error, "build mit Dockerfile muss durchgehen");
  assert.match(r.output!, /Successfully tagged hafenwache:1\.0/);
  assert.match(r.output!, /FROM nginx:1\.27/, "die Basis-Schicht aus dem Dockerfile taucht im Build-Log auf");
  assert.ok(sim.docker.pulled.includes("hafenwache:1.0"), "das gebaute Image liegt jetzt lokal bereit");
  // ohne :tag wird :latest angenommen, das Image ist startbar
  assert.ok(!sim.exec("docker run -d --name wache hafenwache:1.0").error, "aus dem selbst gebauten Image lässt sich ein Container starten");
});

test("docker build: ohne Dockerfile UND ohne -t klare Fehler – kein Phantom-Image (#66)", () => {
  // kein Dockerfile vorhanden
  const ohneFile = sim.exec("docker build -t app:1.0 .");
  assert.ok(ohneFile.error, "ohne Dockerfile muss build scheitern");
  assert.match(ohneFile.output!, /no such file|Dockerfile/i);
  assert.equal(sim.docker.pulled.length, 0, "kein Image darf ohne Bauplan entstehen");
  // Dockerfile da, aber -t vergessen
  sim.files["Dockerfile"] = "FROM nginx:1.27";
  const ohneTag = sim.exec("docker build .");
  assert.ok(ohneTag.error, "ohne -t (Name) muss build scheitern");
  assert.equal(sim.docker.pulled.length, 0, "auch hier darf kein Image entstehen");
});

test("docker build: ohne Build-Kontext-Punkt '.' scheitert realistisch + erklärt den Punkt (#220)", () => {
  sim.files["Dockerfile"] = "FROM nginx:1.27";
  // -t und Name sind korrekt, aber der abschließende '.' (Build-Kontext) fehlt –
  // echtes Docker bricht hier mit "requires exactly 1 argument" ab, statt falschen Erfolg zu melden.
  const ohnePunkt = sim.exec("docker build -t hafenwache:1.0");
  assert.ok(ohnePunkt.error, "ohne Build-Kontext darf der Build NICHT als Erfolg gelten");
  assert.doesNotMatch(ohnePunkt.output!, /Successfully (built|tagged)/, "kein falscher Erfolg im Terminal");
  assert.match(ohnePunkt.output!, /requires exactly 1 argument/, "realistische Docker-Fehlermeldung");
  assert.match(ohnePunkt.output!, /Kontext|Punkt|aktuellen Ordner/i, "der Hinweis erklärt den fehlenden Kontext-Punkt");
  assert.equal(sim.docker.pulled.length, 0, "ohne Kontext darf kein Image entstehen");
  // Gegenprobe: derselbe Befehl MIT Punkt geht glatt durch
  const mitPunkt = sim.exec("docker build -t hafenwache:1.0 .");
  assert.ok(!mitPunkt.error, "mit Build-Kontext '.' muss der Build durchgehen");
  assert.match(mitPunkt.output!, /Successfully tagged hafenwache:1\.0/);
});

test("docker tag: zweiter Name fürs Image; unbekannte Quelle scheitert (#66)", () => {
  sim.files["Dockerfile"] = "FROM nginx:1.27";
  sim.exec("docker build -t hafenwache:1.0 .");
  // Negativfall zuerst: taggen, was es nicht gibt
  const fehlt = sim.exec("docker tag gibtsnicht:9.9 hafenwache:latest");
  assert.ok(fehlt.error, "Quell-Image existiert nicht -> Fehler");
  assert.match(fehlt.output!, /No such image/);
  assert.ok(!sim.docker.pulled.includes("hafenwache:latest"), "kein Ziel-Tag aus kaputtem tag");
  // jetzt korrekt taggen
  const ok = sim.exec("docker tag hafenwache:1.0 hafenwache:latest");
  assert.ok(!ok.error, "vorhandenes Image bekommt zweiten Namen");
  assert.ok(sim.docker.pulled.includes("hafenwache:latest"), "das zweite Etikett ist jetzt da");
  assert.ok(sim.docker.pulled.includes("hafenwache:1.0"), "das Original-Etikett bleibt erhalten");
});

test("docker run: Flags nach dem Image gelten nicht (echte Reihenfolge: Optionen VOR dem Image)", () => {
  // Häufiger Anfängerfehler: --name/-d hinter das Image gesetzt
  const r = sim.exec("docker run nginx --name webserver -d");
  assert.ok(r.error, "Flags nach dem Image müssen abgelehnt werden");
  assert.ok(!sim.docker.containers.some(c => c.name === "webserver"), "es darf KEIN Container 'webserver' angelegt werden");
  // korrekte Reihenfolge legt den Hintergrund-Container an
  assert.ok(!sim.exec("docker run -d --name webserver nginx").error, "korrekte Reihenfolge geht durch");
  const c = sim.docker.containers.find(c => c.name === "webserver");
  assert.ok(c && c.running, "webserver läuft im Hintergrund");
  // ein echter Container-Befehl nach dem Image ist erlaubt (kein Flag)
  assert.ok(!sim.exec("docker run --name echo-test nginx echo hallo").error, "Befehl nach dem Image ist ok");
});
