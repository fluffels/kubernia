/* ===== KubeQuest – docker-Befehle (sim/docker.ts) =====
 * Schritt 2/7 des sim.ts-Datei-Splits (#373, aus Epic #346, ADR 0004).
 *
 * Hier liegt die komplette `docker`-Befehlsfamilie (pull/build/tag/images/run/ps/
 * stop/rm) plus die docker-eigene Tippfehler-Hilfe (`checkImageTypo` + die Liste
 * bekannter Images). Aus `sim.ts` ausgelagert als freie Funktionen, die die Sim-
 * Instanz als `DockerHost` bekommen – so bleibt der Cluster-Zustand in EINER Hand
 * (die `Sim`-Klasse), die docker-Logik aber in einer eigenen, testbaren Datei.
 * Aufgerufen aus dem `exec`-Dispatch in `sim.ts` per `dockerCommand(this, …)`.
 *
 * **Aufbau (Schnitt #545, aus #502):** `dockerCommand` war ein 140-Zeilen-Dispatcher
 * (complexity 65) mit substanzieller Inline-Logik je Unterbefehl. Jetzt ist jeder
 * Unterbefehl eine eigene kohäsive Funktion (`dockerPull`/`dockerBuild`/…), und
 * `dockerCommand` ist ein dünner Dispatcher über die Daten-Tabelle
 * `DOCKER_SUBCOMMANDS` (Alias→Handler) – gespiegelt zum helm-/kubectl-Schnitt
 * (#544/#543). Ein neuer Unterbefehl ist ein neuer Handler + ein Tabellen-Eintrag;
 * der Dispatcher wächst nicht mehr mit dem Befehlssatz (Stardew-Scope).
 *
 * Phaser-frei (pure Domäne): die geteilten Ausgabe-/ID-Helfer kommen aus ./util,
 * die Domänentypen aus ./state – kein Rückimport nach sim.ts (kein Zyklus).
 */
import type { Container } from "./state";
import { randSuffix, table, flagValue, suggest } from "./util";
import { hashStr, hashHex } from "../core/rng";

// Bekannte Container-Images – Grundlage für die „Meintest du …?"-Tippfehlerhilfe.
// Enthält alle im Spiel benutzten plus echte Tools, die man als DevOps kennt.
export const KNOWN_IMAGES = [
  // Hafen-eigenes Platzhalter-Image (#363): der generische Beispiel-Dienst, mit dem die
  // erste Docker-Quest einsteigt – spielweltbezogen statt „nginx", bevor echte Tool-Namen
  // (redis/postgres/…) eingeführt sind. Als bekanntes Image gelistet → keine Tippfehlerhilfe.
  "lotsen-dienst",
  "nginx", "redis", "httpd", "busybox", "postgres", "rabbitmq",
  "mysql", "mariadb", "mongo", "memcached", "node", "python", "golang",
  "alpine", "ubuntu", "debian", "traefik", "envoy", "haproxy", "vault",
  "keycloak", "grafana", "prometheus", "wordpress", "nextcloud",
];

/** Was die docker-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt).
 *  Bewusst ein schmales Interface statt der ganzen `Sim`-Klasse – es dokumentiert
 *  die Kopplung und vermeidet einen Import-Zyklus docker ↔ sim. */
export interface DockerHost {
  docker: { pulled: string[]; containers: Container[] };
  files: Record<string, string>;
  clock: number;
  _err(msg: string, tip?: string): string;
  _age(created: number): string;
}

/** Prüft ein Docker-Image auf Tippfehler. Gibt eine Fehlermeldung zurück oder null (alles ok). */
export function checkImageTypo(sim: DockerHost, img: string): string | null {
  const bare = (img.split(":")[0].split("/").pop() || "").toLowerCase();
  if (KNOWN_IMAGES.includes(bare)) return null;
  const guess = suggest(bare, KNOWN_IMAGES);
  if (guess) {
    return sim._err('⚠️ Das Image "' + bare + '" kennt die Registry nicht.',
      "Tippfehler? Meintest du \"" + guess + "\"? (So entsteht im echten Cluster ein ImagePullBackOff!)");
  }
  return null; // unbekannt, aber kein klarer Tippfehler -> zum Ausprobieren erlauben
}

/** Ein docker-Unterbefehl-Handler: bekommt Host + Tokens, gibt die Ausgabe.
 *  Handler, die `t` nicht brauchen, lassen den Parameter weg – dank struktureller
 *  Kompatibilität bleiben sie zur Tabelle zuweisbar. */
type DockerHandler = (sim: DockerHost, t: string[]) => string;

/** `docker pull <image>` – zieht ein Image (Registry/Tag zerlegt, #449). */
function dockerPull(sim: DockerHost, t: string[]): string {
  const img = t[2];
  if (!img) return sim._err("docker pull: Welches Image denn?", "z.B. 'docker pull lotsen-dienst'");
  const typo = checkImageTypo(sim, img);
  if (typo) return typo;
  // Image-Name zerlegen: <registry>/<repository>:<tag>. Ohne Tag → :latest (mit dem
  // bekannten "Using default tag: latest"-Hinweis). Ein Pfad mit "/" trägt eine
  // explizite Registry/Namespace; Docker Hub stellt offiziellen Images intern nur
  // "library/" voran. So spiegelt die Ausgabe die wirklich gezogene Version & Quelle
  // wider (#449 – Registry/Tag-Quest), statt immer "latest" zu behaupten.
  const hasTag = img.includes(":");
  const repo = img.split(":")[0];
  const tag = hasTag ? img.split(":")[1] : "latest";
  const full = repo + ":" + tag;
  const hasRegistry = repo.includes("/");
  const fromRef = hasRegistry ? repo : "library/" + repo;
  const canonical = hasRegistry ? full : "docker.io/library/" + full;
  if (!sim.docker.pulled.includes(full)) sim.docker.pulled.push(full);
  return [
    ...(hasTag ? [] : ["Using default tag: latest"]),
    tag + ": Pulling from " + fromRef,
    "a2abf6c4d29d: Pull complete",
    "f3409a9a9e73: Pull complete",
    "Status: Downloaded newer image for " + full,
    canonical,
  ].join("\n");
}

/** `docker build -t <name[:tag]> <kontext>` – baut aus dem Dockerfile ein eigenes Image. */
function dockerBuild(sim: DockerHost, t: string[]): string {
  const tagSpec = flagValue(t, "-t") || flagValue(t, "--tag");
  if (!tagSpec) return sim._err("docker build: Ohne -t bekommt dein Image keinen Namen.", "Muster: docker build -t <name>:<tag> .");
  // Build-Kontext = das positionale Argument (PATH | URL | -) hinter den Optionen.
  // Fehlt es, bricht echtes Docker mit "requires exactly 1 argument" ab – kein falscher Erfolg.
  const valueFlags = new Set(["-t", "--tag", "-f", "--file"]);
  let hasContext = false;
  for (let i = 2; i < t.length; i++) {
    const tok = t[i];
    if (tok.startsWith("-")) {
      // Wert-Flag ohne "="-Form frisst das nächste Token als seinen Wert.
      if (!tok.includes("=") && valueFlags.has(tok)) i++;
      continue;
    }
    hasContext = true;
  }
  if (!hasContext) {
    return sim._err('"docker build" requires exactly 1 argument.',
      "Am Ende fehlt der Build-Kontext-Punkt '.' – er sagt: der Bauplan (Dockerfile) liegt HIER im aktuellen Ordner. Muster: docker build -t <name>:<tag> .");
  }
  if (!sim.files["Dockerfile"]) {
    return sim._err("ERROR: failed to read dockerfile: open Dockerfile: no such file or directory",
      "docker build liest den Bauplan aus einer Datei namens 'Dockerfile' im aktuellen Ordner. Schau mit 'ls', ob sie da ist.");
  }
  const full = tagSpec.includes(":") ? tagSpec : tagSpec + ":latest";
  const base = (sim.files["Dockerfile"].match(/^\s*FROM\s+(\S+)/m) || [])[1] || "scratch";
  const copyLines = (sim.files["Dockerfile"].match(/^\s*(COPY|ADD|RUN)\b/gim) || []).length;
  const total = 3 + copyLines; // load definition + FROM + (COPY/ADD/RUN…) + export
  if (!sim.docker.pulled.includes(full)) sim.docker.pulled.push(full);
  return [
    "[+] Building 2.4s (" + total + "/" + total + ") FINISHED",
    " => [internal] load build definition from Dockerfile",
    " => [internal] load metadata for " + base,
    " => [1/" + Math.max(1, copyLines + 1) + "] FROM " + base,
    copyLines ? " => [2/" + (copyLines + 1) + "] COPY/RUN-Schritte aus dem Dockerfile" : " => (keine weiteren Schichten)",
    " => exporting to image",
    " => => naming to docker.io/library/" + full,
    "Successfully built " + randSuffix(12),
    "Successfully tagged " + full,
  ].join("\n");
}

/** `docker tag <quelle> <ziel>` – hängt einem vorhandenen Image einen zweiten Namen an. */
function dockerTag(sim: DockerHost, t: string[]): string {
  const src = t[2], dst = t[3];
  if (!src || !dst || src.startsWith("-") || dst.startsWith("-")) {
    return sim._err("docker tag: Quelle und Ziel fehlen.", "Muster: docker tag <quelle>[:tag] <ziel>[:tag]");
  }
  const srcFull = src.includes(":") ? src : src + ":latest";
  if (!sim.docker.pulled.includes(srcFull) && !sim.docker.pulled.includes(src)) {
    return sim._err("Error response from daemon: No such image: " + src,
      "Das Quell-Image gibt es (noch) nicht. Mit 'docker images' siehst du, was da ist – oder erst 'docker build -t " + src + " .'.");
  }
  const dstFull = dst.includes(":") ? dst : dst + ":latest";
  if (!sim.docker.pulled.includes(dstFull)) sim.docker.pulled.push(dstFull);
  return ""; // echtes 'docker tag' ist still (kein Output)
}

/** `docker images` – gelistete Images (ID/Größe deterministisch aus dem Namen, #492). */
function dockerImages(sim: DockerHost): string {
  if (sim.docker.pulled.length === 0) return "REPOSITORY   TAG   IMAGE ID   CREATED   SIZE";
  return table(
    ["REPOSITORY", "TAG", "IMAGE ID", "SIZE"],
    sim.docker.pulled.map(img => {
      const [repo, tag] = img.split(":");
      // Image-ID/-Größe deterministisch aus dem Image-Namen (#492): `docker images`
      // ist ein Lesebefehl und zeigt jetzt stabil dieselben Werte, statt bei jedem
      // Aufruf neu zu würfeln (und den globalen RNG-Strom zu perturbieren).
      return [repo, tag || "latest", hashHex(img, 12), (20 + (hashStr(img) % 150)) + "MB"];
    })
  );
}

/** Zerlegt die `docker run`-Argumente (#545): Optionen stehen VOR dem Image; sobald das
 *  Image gelesen ist, gehört alles Weitere zum Container-Befehl – ein Flag danach setzt
 *  `flagAfterImage` (falsche Reihenfolge, Issue #17). Als eigener Parser gehalten, damit
 *  `dockerRun` unter dem Komplexitäts-Budget bleibt. */
function parseRunArgs(t: string[]): { name: string | null; image: string | null; flagAfterImage: boolean } {
  let name: string | null = null, image: string | null = null, flagAfterImage = false;
  for (let i = 2; i < t.length; i++) {
    if (image) {                                   // alles nach dem Image = Container-Befehl
      if (t[i].startsWith("-")) flagAfterImage = true;
      continue;
    }
    if (t[i] === "--name") { name = t[i + 1]; i++; }
    else if (t[i] === "-d" || t[i] === "--detach") { /* ok */ }
    else if (t[i] === "-p" || t[i] === "--publish") { i++; }
    else if (!t[i].startsWith("-")) image = t[i];
  }
  return { name, image, flagAfterImage };
}

/** `docker run [-d] [--name X] [-p a:b] IMAGE [BEFEHL ...]` – startet einen Container. */
function dockerRun(sim: DockerHost, t: string[]): string {
  const { image, flagAfterImage, name: parsedName } = parseRunArgs(t);
  let name = parsedName;
  if (!image) return sim._err("docker run: Es fehlt das Image.", "z.B. 'docker run -d --name lotse lotsen-dienst'");
  if (flagAfterImage) return sim._err("docker run: Optionen wie -d/--name müssen VOR das Image.", "Alles nach dem Image ist der Container-Befehl. Muster: docker run [-d] [--name <name>] <image>");
  const typo = checkImageTypo(sim, image);
  if (typo) return typo;
  if (!name) name = image.split(":")[0] + "-" + randSuffix(4);
  if (sim.docker.containers.some(c => c.name === name && c.running)) {
    return sim._err('docker: Container-Name "' + name + '" wird schon benutzt.', "Nimm einen anderen Namen oder stoppe den alten Container.");
  }
  const full = image.includes(":") ? image : image + ":latest";
  if (!sim.docker.pulled.includes(full)) sim.docker.pulled.push(full);
  sim.docker.containers.push({ name, image: full, running: true, created: sim.clock, id: randSuffix(12) });
  return randSuffix(64);
}

/** `docker ps [-a]` – laufende (mit -a: auch gestoppte) Container listen. */
function dockerPs(sim: DockerHost, t: string[]): string {
  const all = t.includes("-a") || t.includes("--all");
  const list = sim.docker.containers.filter(c => all || c.running);
  if (list.length === 0) return "CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES" + (all ? "" : "\n💡 Keine laufenden Container. Mit 'docker ps --all' siehst du auch gestoppte.");
  return table(
    ["CONTAINER ID", "IMAGE", "STATUS", "NAMES"],
    list.map(c => [c.id, c.image, c.running ? "Up " + sim._age(c.created) : "Exited (0) " + sim._age(c.created) + " ago", c.name])
  );
}

/** `docker stop <name|id>` – hält einen laufenden Container an. */
function dockerStop(sim: DockerHost, t: string[]): string {
  const name = t[2];
  if (!name) return sim._err("docker stop: Welcher Container?", "Den Namen siehst du mit 'docker ps' in der Spalte NAMES.");
  const c = sim.docker.containers.find(c => c.name === name || c.id === name);
  if (!c) return sim._err("Error: No such container: " + name, "Mit 'docker ps' siehst du alle laufenden Container.");
  c.running = false;
  return name;
}

/** `docker rm <name|id>` – löscht einen (gestoppten) Container. */
function dockerRm(sim: DockerHost, t: string[]): string {
  const name = t[2];
  if (!name) return sim._err("docker rm: Welcher Container?");
  const idx = sim.docker.containers.findIndex(c => c.name === name || c.id === name);
  if (idx === -1) return sim._err("Error: No such container: " + name);
  if (sim.docker.containers[idx].running) return sim._err("Error: Container läuft noch.", "Erst 'docker stop " + name + "', dann löschen.");
  sim.docker.containers.splice(idx, 1);
  return name;
}

/** Alias → Handler. Ein neuer Unterbefehl ist ein Eintrag hier + eine Funktion oben –
 *  der Dispatcher (`dockerCommand`) bleibt dünn und wächst nicht mit dem Befehlssatz. */
const DOCKER_SUBCOMMANDS: Record<string, DockerHandler> = {
  pull: dockerPull,
  build: dockerBuild,
  tag: dockerTag,
  images: dockerImages,
  run: dockerRun,
  ps: dockerPs,
  stop: dockerStop,
  rm: dockerRm,
};

/** Dünner `docker`-Dispatcher: wählt den Unterbefehl-Handler aus `DOCKER_SUBCOMMANDS`.
 *  pull | build -t <name> . | tag <quelle> <ziel> | images | run | ps [-a] | stop | rm. */
export function dockerCommand(sim: DockerHost, t: string[], _raw?: string): string {
  const sub = t[1];
  if (!sub) return sim._err("docker: Unterbefehl fehlt.", "Probier z.B. 'docker ps'.");
  const handler = DOCKER_SUBCOMMANDS[sub];
  if (!handler) return sim._err("docker: unbekannter Unterbefehl '" + sub + "'", "Tippe 'help' für alle Befehle.");
  return handler(sim, t);
}
