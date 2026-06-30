import type { Sim } from "../../sim";
import { pick, rnd, IMAGES, NAMES, BUILD_NAMES, ensureDockerfile } from "./shared";
import type { DrillTask } from "./shared";

export const DOCKER_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  "docker-pull": _sim => {
    const img = pick(IMAGES);
    return { text: "Lade das Image <code>" + img + "</code> aus der Registry.", accept: [new RegExp("^docker\\s+pull\\s+" + img + "(:\\S+)?$")], solution: "docker pull " + img, hint: "Muster: docker pull &lt;image&gt;", why: "pull holt ein fertiges Image aus der Registry auf deinen Rechner – Muster: docker pull &lt;image&gt;." };
  },
  "docker-pull-version": _sim => {
    const img = pick(IMAGES);
    const tag = pick(["1.0", "1.27", "7", "16", "3.19", "stable"]);
    return { text: "Hol das Image <code>" + img + "</code> in der Version <code>" + tag + "</code> (Tag hinter den Doppelpunkt).", accept: [new RegExp("^docker\\s+pull\\s+" + img + ":" + tag.replace(/\./g, "\\.") + "$")], solution: "docker pull " + img + ":" + tag, hint: "Muster: docker pull &lt;image&gt;:&lt;tag&gt; – also " + img + ":" + tag, why: "Der Teil hinter dem Doppelpunkt ist der Versions-Tag. Ohne Tag bekommst du :latest – nur ein Konventions-Name, NICHT automatisch die neueste Version. Eine feste Version festzunageln macht den Pull reproduzierbar." };
  },
  "docker-pull-registry": _sim => {
    const reg = pick(["ghcr.io", "registry.hafen.io", "harbor.kubernia.io"]);
    const ns = pick(["hafen", "kubernia", "lotsen"]);
    const img = pick(IMAGES);
    const tag = pick(["1.0", "2.1", "stable", "7"]);
    return { text: "Hol <code>" + img + ":" + tag + "</code> aus der Registry <code>" + reg + "</code>, Namespace <code>" + ns + "</code> – also <code>" + reg + "/" + ns + "/" + img + ":" + tag + "</code>.", accept: [new RegExp("^docker\\s+pull\\s+" + reg.replace(/\./g, "\\.") + "/" + ns + "/" + img + ":" + tag.replace(/\./g, "\\.") + "$")], solution: "docker pull " + reg + "/" + ns + "/" + img + ":" + tag, hint: "Muster: docker pull &lt;registry&gt;/&lt;namespace&gt;/&lt;image&gt;:&lt;tag&gt;", why: "Der volle Image-Name ist &lt;registry&gt;/&lt;repository&gt;:&lt;tag&gt;. docker pull " + img + " ist die Kurzform für docker.io/library/" + img + ":latest – ohne Registry-Präfix fragt Docker still Docker Hub. Eigene/private Registries (ghcr.io, Harbor) schreibst du vorne mit dran." };
  },
  "docker-run": _sim => {
    const img = pick(IMAGES);
    return { text: "Starte einen Container aus dem Image <code>" + img + "</code> (ohne Extras).", accept: [new RegExp("^docker\\s+run\\s+" + img + "(:\\S+)?$")], solution: "docker run " + img, hint: "Muster: docker run &lt;image&gt;", why: "run startet aus einem Image einen laufenden Container – Muster: docker run &lt;image&gt;." };
  },
  "docker-run-busybox": () => ({ text: "Starte die winzige Allzweck-Kiste <code>busybox</code> für einen schnellen Test.", accept: [/^docker\s+run\s+busybox(:\S+)?$/], solution: "docker run busybox", hint: "Muster: docker run &lt;image&gt; – das Image heißt busybox.", why: "BusyBox bündelt viele Mini-Werkzeuge (ls, cat, wget …) in einer federleichten Box – die Allzweck-Kiste zum schnellen Reinschauen/Testen. Muster: docker run &lt;image&gt;." }),
  "docker-run-redis": () => ({ text: "Starte den schnellen In-Memory-Cache <code>redis</code>.", accept: [/^docker\s+run\s+redis(:\S+)?$/], solution: "docker run redis", hint: "Muster: docker run &lt;image&gt; – das Image heißt redis.", why: "Redis ist ein In-Memory Key-Value-Store – ein blitzschnelles, aber flüchtiges Gedächtnis, typisch als Cache/Sessions. Muster: docker run &lt;image&gt;." }),
  "docker-run-postgres": () => ({ text: "Starte die relationale Datenbank <code>postgres</code>.", accept: [/^docker\s+run\s+postgres(:\S+)?$/], solution: "docker run postgres", hint: "Muster: docker run &lt;image&gt; – das Image heißt postgres.", why: "Postgres ist eine relationale Datenbank – Daten in Tabellen, dauerhaft gespeichert; der häufigste DB-Container, wenn Daten verlässlich bleiben müssen. Muster: docker run &lt;image&gt;." }),
  "docker-run-rabbitmq": () => ({ text: "Starte den Nachrichten-Verteiler <code>rabbitmq</code> (die Posthalle).", accept: [/^docker\s+run\s+rabbitmq(:\S+)?$/], solution: "docker run rabbitmq", hint: "Muster: docker run &lt;image&gt; – das Image heißt rabbitmq.", why: "RabbitMQ ist ein Message Broker – eine Posthalle: Dienste legen Nachrichten in eine Warteschlange (Queue), andere holen sie später ab. So kommunizieren Dienste entkoppelt/asynchron, ohne aufeinander zu warten. Muster: docker run &lt;image&gt;." }),
  "docker-run-named": sim => {
    const img = pick(IMAGES);
    let name = pick(NAMES);
    while (sim.docker.containers.some(c => c.name === name && c.running)) name = pick(NAMES) + rnd(2, 99);
    return { text: "Starte aus <code>" + img + "</code> einen Container im Hintergrund mit dem Namen <code>" + name + "</code>.", accept: [new RegExp("^docker\\s+run\\s+(?:(?:-d|--detach)\\s+--name\\s+" + name + "|--name\\s+" + name + "\\s+(?:-d|--detach))\\s+" + img + "(:\\S+)?$")], solution: "docker run --detach --name " + name + " " + img, hint: "Genau dieser Befehl, keine weiteren Optionen (die kommen später) – Muster: docker run --detach --name &lt;name&gt; &lt;image&gt; (statt --detach geht auch die Kurzform -d)", why: "Die Reihenfolge der Optionen ist frei (--detach --name oder --name --detach, beides gilt; statt --detach geht auch die Kurzform -d), nur: erst alle Optionen, dann das Image ganz zuletzt – und KEINE zusätzlichen Flags, hier zählt nur der gefragte Befehl. Muster: docker run --detach --name &lt;name&gt; &lt;image&gt;.", diag: (input: string): string | null => {
      const nameM = input.match(/--name\s+(\S+)/);
      if (!nameM) return null;
      const givenName = nameM[1];
      const parts = input.trim().split(/\s+/);
      const givenImg = parts[parts.length - 1];
      const baseGivenImg = givenImg.split(":")[0];
      const nameMismatch = givenName !== name;
      const imgMismatch = baseGivenImg !== img;
      if (nameMismatch && !imgMismatch) return "Der Name stimmt nicht – erwartet <code>" + name + "</code>, getippt <code>" + givenName + "</code>. Tippfehler?";
      if (imgMismatch && !nameMismatch) return "Das Image stimmt nicht – erwartet <code>" + img + "</code>, getippt <code>" + givenImg + "</code>. Tippfehler?";
      if (nameMismatch && imgMismatch) return "Name und Image stimmen nicht – erwartet <code>--name " + name + " " + img + "</code>.";
      return null;
    } };
  },
  "docker-ps": () => ({ text: "Zeig alle <b>laufenden</b> Container.", accept: [/^docker\s+ps$/], solution: "docker ps", hint: "ps wie process status – zwei Buchstaben nach docker.", why: "ps = process status (aus Unix): zeigt, was gerade läuft. Ohne -a nur die laufenden Container; mit -a kämen auch die gestoppten dazu." }),
  "docker-ps-a": () => ({ text: "Zeig <b>alle</b> Container – auch gestoppte.", accept: [/^docker\s+ps\s+(-a|--all)$/], solution: "docker ps --all", hint: "docker ps + die ausgeschriebene Flag für „alle“ (--all).", why: "Ohne --all siehst du nur laufende Container; --all zeigt auch die gestoppten." }),
  "docker-stop": sim => {
    let c = sim.docker.containers.find(c => c.running);
    if (!c) { const name = pick(NAMES); sim.exec("docker run -d --name " + name + " nginx"); c = sim.docker.containers.find(x => x.name === name)!; }
    return { text: "Stoppe den Container <code>" + c.name + "</code>.", accept: [new RegExp("^docker\\s+stop\\s+" + c.name + "$")], solution: "docker stop " + c.name, hint: "Muster: docker stop &lt;name&gt;", why: "stop hält einen laufenden Container an seinem Namen an – Muster: docker stop &lt;name&gt;." };
  },
  "docker-build": sim => {
    ensureDockerfile(sim);
    const name = pick(BUILD_NAMES);
    const tag = pick(["1.0", "2.0", "0.1", "dev", "stable"]);
    return { text: "Bau aus dem <code>Dockerfile</code> ein eigenes Image <code>" + name + ":" + tag + "</code> (Punkt am Ende!).", accept: [new RegExp("^docker\\s+build\\s+(?:-t|--tag)\\s+" + name + ":" + tag.replace(/\./g, "\\.") + "\\s+\\.$")], solution: "docker build --tag " + name + ":" + tag + " .", hint: "Muster: docker build --tag &lt;name&gt;:&lt;tag&gt; . (statt --tag geht auch die Kurzform -t)", why: "build schichtet aus dem Dockerfile ein Image – aber nicht im Terminal, sondern in der <b>Docker-Engine</b>, die deine Ordner nicht sieht. Der Punkt ist der <b>Build-Kontext</b>: der Ordner (<code>.</code> = der aktuelle), den du der Engine als Paket übergibst – die <b>Kiste mit Baumaterial</b> für die Werft. Docker sucht darin das Dockerfile; alles, was <code>COPY</code> holt, muss drin liegen. <code>--tag</code> vergibt den ganzen Namen <code>name:tag</code> (Kurzform <code>-t</code>, beides gilt) – der Teil hinter dem <code>:</code> ist der Versions-Tag, und <code>docker tag</code> ist nochmal ein eigener Befehl für einen nachträglichen Zweitnamen." };
  },
  "docker-tag": sim => {
    ensureDockerfile(sim);
    const name = pick(BUILD_NAMES);
    sim.exec("docker build -t " + name + ":1.0 .");
    const newTag = pick(["latest", "stable", "prod", "v2"]);
    return { text: "Gib deinem Image <code>" + name + ":1.0</code> zusätzlich das Etikett <code>" + name + ":" + newTag + "</code>.", accept: [new RegExp("^docker\\s+tag\\s+" + name + ":1\\.0\\s+" + name + ":" + newTag + "$")], solution: "docker tag " + name + ":1.0 " + name + ":" + newTag, hint: "Muster: docker tag &lt;quelle&gt; &lt;ziel&gt;", why: "tag hängt einem vorhandenen Image einen zweiten Namen an. Reihenfolge ist Quelle → Ziel – wie beim Umetikettieren: erst die vorhandene Kiste (" + name + ":1.0), dann das neue Schild (" + name + ":" + newTag + ")." };
  },
};

