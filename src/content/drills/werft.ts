import type { Sim } from "../../sim";
import { ensureDockerfile, ensureBarePodAdmission, freeWerftName } from "./shared";
import type { DrillTask } from "./shared";

export const WERFT_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  "werft-build": sim => {
    ensureDockerfile(sim);
    const name = freeWerftName(sim);
    return { text: "Bau aus dem <code>Dockerfile</code> dein <b>eigenes</b> Image <code>" + name + ":1.0</code> (Punkt am Ende!).", accept: [new RegExp("^docker\\s+build\\s+(?:-t|--tag)\\s+" + name + ":1\\.0\\s+\\.$")], solution: "docker build --tag " + name + ":1.0 .", hint: "Muster: docker build --tag &lt;name&gt;:&lt;tag&gt; . (die Kurzform -t verdienst du dir durch Nutzung)", why: "Anders als <code>docker pull</code> (ein fremdes Image holen) schichtet <code>docker build</code> aus deinem Dockerfile dein eigenes Image. Der Punkt am Ende ist der Build-Kontext (der aktuelle Ordner mit dem Bauplan), <code>--tag</code> vergibt den Namen &lt;name&gt;:&lt;tag&gt;. Muster: docker build --tag &lt;name&gt;:&lt;tag&gt; ." };
  },
  "werft-deploy-imagepull": sim => {
    ensureBarePodAdmission(sim);
    ensureDockerfile(sim);
    const name = freeWerftName(sim);
    const file = "werft-deploy.yaml";
    sim.files[file] = "# Deployment für deinen eigenen Dienst\nkind: Deployment\n…";
    sim.applyEffects[file] = { deployment: { name, image: name + ":1.0", replicas: 1, containerPort: 8080, requireBuiltImage: true } };
    return { text: "Roll dein Deployment <code>" + name + "</code> aus: wende die <code>werft-deploy.yaml</code> an. Das Image ist noch nicht gebaut – schau danach mit <code>kubectl get pods</code>, der Pod landet im <b>ImagePullBackOff</b>.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+werft-deploy\.yaml$/], solution: "kubectl apply --filename werft-deploy.yaml", hint: "kubectl apply --filename &lt;datei&gt; (die Kurzform -f verdienst du dir durch Nutzung)", why: "Der Cluster startet, was im Manifest steht – auch wenn es das Image noch gar nicht gibt. Dann sucht der kubelet ein Image, das nie vom Stapel lief: <b>ImagePullBackOff</b>. Kein fremdes Image fehlt, DEINS fehlt. Heilung: erst <code>docker build</code>, dann <code>kubectl rollout restart</code>. Muster: kubectl apply --filename &lt;datei&gt;." };
  },
  "werft-rollout-heal": sim => {
    const name = freeWerftName(sim);
    sim.mergeScenario({
      dockerImages: [name + ":1.0"],
      deployments: [{ name, image: name + ":1.0", replicas: 1, containerPort: 8080, broken: { type: "imagepull", badImage: name + ":1.0", needsBuild: true } }],
    });
    return { text: "Dein Image <code>" + name + ":1.0</code> ist gebaut, aber der Pod von <code>" + name + "</code> hängt noch im alten <b>ImagePullBackOff</b>. Zieh den Cluster neu: <code>kubectl rollout restart deployment " + name + "</code>.", accept: [new RegExp("^kubectl\\s+rollout\\s+restart\\s+deployment[\\/\\s]" + name + "$")], solution: "kubectl rollout restart deployment " + name, hint: "Muster: kubectl rollout restart deployment &lt;name&gt;", why: "Nach dem <code>docker build</code> liegt dein Image lokal, aber der Pod steckt noch im Fehlversuch. <code>rollout restart</code> ersetzt die Pods rollierend – die frischen finden das gebaute Image und laufen. Muster: kubectl rollout restart deployment &lt;name&gt;." };
  },
  "werft-expose": sim => {
    const name = freeWerftName(sim);
    sim.mergeScenario({
      dockerImages: [name + ":1.0"],
      deployments: [{ name, image: name + ":1.0", replicas: 1, containerPort: 8080 }],
    });
    const file = "werft-service.yaml";
    sim.files[file] = "# Service für deinen eigenen Dienst\nkind: Service\n…";
    sim.applyEffects[file] = { service: { name, port: 80, targetPort: 8080 } };
    return { text: "Dein Dienst <code>" + name + "</code> läuft, ist aber noch nicht erreichbar. Leg den Service davor: wende die <code>werft-service.yaml</code> an (Port 80 → targetPort 8080).", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+werft-service\.yaml$/], solution: "kubectl apply --filename werft-service.yaml", hint: "kubectl apply --filename &lt;datei&gt; (die Kurzform -f verdienst du dir durch Nutzung)", why: "Ein laufender Pod allein ist noch nicht erreichbar. Der Service ist die feste Adresse davor: er nimmt Anfragen auf <code>port</code> 80 an und leitet sie auf <code>targetPort</code> 8080 – genau dahin, wo dein Container lauscht. Stimmt der targetPort nicht mit dem containerPort überein, läuft die Anfrage ins Leere. Muster: kubectl apply --filename &lt;datei&gt;." };
  },
  "werft-curl": sim => {
    const name = freeWerftName(sim);
    sim.mergeScenario({
      dockerImages: [name + ":1.0"],
      deployments: [{ name, image: name + ":1.0", replicas: 1, containerPort: 8080 }],
      services: [{ name, type: "ClusterIP", clusterIP: "10.96.0.50", port: 80, targetPort: 8080, created: 0 }],
    });
    return { text: "Mach den Klopftest an deinem eigenen Dienst: <code>curl http://" + name + "</code>. Läuft alles, kommt eine <b>200 OK</b> zurück.", accept: [new RegExp("^curl\\s+(?:http:\\/\\/)?" + name + "(?::80)?\\/?$")], solution: "curl http://" + name, hint: "curl http://&lt;service-name&gt; – der Name ist „" + name + "“.", why: "<code>curl</code> ist der Klopftest: er fragt einen Service ab und zeigt, ob wirklich etwas antwortet. Über Port 80 leitet der Service auf deinen Container (8080) – kommt <b>200 OK</b> zurück, schwimmt dein Dienst. Muster: curl http://&lt;service-name&gt;." };
  },
};
