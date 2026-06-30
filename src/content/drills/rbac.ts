import type { Sim } from "../../sim";
import { pick, rnd, SA_NAMES, ROLE_NAMES, CLUSTERROLE_NAMES, CANI_PAIRS, ensureRole, ROLE_YAML, ROLEBINDING_YAML, CLUSTERROLE_YAML, CLUSTERROLEBINDING_YAML, POD_SECURITY_YAML } from "./shared";
import type { DrillTask } from "./shared";

export const RBAC_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  "rbac-sa-create": sim => {
    let name = pick(SA_NAMES);
    while (sim.serviceAccounts.some(s => s.name === name)) name = pick(SA_NAMES) + rnd(2, 99);
    return { text: "Stell einen eigenen Dienst-Ausweis aus: einen <b>ServiceAccount</b> namens <code>" + name + "</code>.", accept: [new RegExp("^kubectl\\s+create\\s+(serviceaccount|sa)\\s+" + name + "$")], solution: "kubectl create serviceaccount " + name, hint: "Muster: kubectl create serviceaccount &lt;name&gt;", why: "Ein ServiceAccount ist die Identität, unter der ein Pod ans Cluster-API klopft – statt der allmächtigen default-SA bekommt jeder Dienst seinen eigenen, knappen Ausweis (Least Privilege). Muster: kubectl create serviceaccount &lt;name&gt;." };
  },
  "rbac-sa-get": () => ({ text: "Kontrolliere, welche <b>ServiceAccounts</b> (Ausweise) im Namespace ausliegen.", accept: [/^kubectl\s+get\s+(serviceaccounts|serviceaccount|sa)$/], solution: "kubectl get serviceaccounts", hint: "kubectl get serviceaccounts (Kurzform sa geht auch).", why: "Gleiches get-Muster wie sonst: kubectl get serviceaccounts listet die Ausweise des Namespaces – die default-SA ist immer dabei, eigene kommen dazu." }),
  "rbac-can-i": _sim => {
    const [verb, res] = pick(CANI_PAIRS);
    return { text: "Frag das Tor – ohne zu raten: Darf der ServiceAccount <code>wachdienst</code> <b>" + verb + "</b> auf <b>" + res + "</b>? Nutz <code>--as</code>.", accept: [new RegExp("^kubectl\\s+auth\\s+can-i\\s+" + verb + "\\s+" + res + "\\s+--as=system:serviceaccount:default:wachdienst$")], solution: "kubectl auth can-i " + verb + " " + res + " --as=system:serviceaccount:default:wachdienst", hint: "Muster: kubectl auth can-i &lt;verb&gt; &lt;ressource&gt; --as=system:serviceaccount:default:&lt;sa&gt;", why: "auth can-i beantwortet eine Rechte-Frage verbindlich mit yes/no, statt sie zu erraten; --as stellt die Frage aus Sicht eines anderen Subjekts (hier der SA wachdienst, geschrieben als system:serviceaccount:&lt;ns&gt;:&lt;name&gt;). Muster: kubectl auth can-i &lt;verb&gt; &lt;ressource&gt; --as=&lt;subjekt&gt;." };
  },
  "rbac-apply-role": sim => {
    let name = pick(ROLE_NAMES);
    while (sim.roles.some(r => !r.cluster && r.name === name)) name = pick(ROLE_NAMES) + rnd(2, 99);
    const file = "role.yaml";
    sim.files[file] = ROLE_YAML;
    sim.applyEffects[file] = { role: { name, rules: [{ verbs: ["get", "list", "watch"], resources: ["pods"] }] } };
    return { text: "Leg die <b>Schlüsselliste</b> an: wende die Role-Karte <code>role.yaml</code> deklarativ an.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+role\.yaml$/], solution: "kubectl apply --filename role.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Eine Role bündelt erlaubte Verben × Ressourcen in EINEM Namespace – allein bewirkt sie nichts, sie ist die Liste, noch nicht der Schlüssel in einer Hand. Angewandt wird sie wie jedes Manifest: kubectl apply --filename &lt;datei&gt;." };
  },
  "rbac-apply-rolebinding": sim => {
    let name = pick(ROLE_NAMES) + "-binden";
    while (sim.roleBindings.some(b => !b.cluster && b.name === name)) name = "binden-" + rnd(2, 999);
    const file = "rolebinding.yaml";
    sim.files[file] = ROLEBINDING_YAML;
    sim.applyEffects[file] = { roleBinding: { name, roleRef: { kind: "Role", name: "pod-leser" }, subjects: [{ kind: "ServiceAccount", name: "wachdienst", namespace: "default" }] } };
    return { text: "Übergib den <b>Schlüssel</b>: wende die RoleBinding-Karte <code>rolebinding.yaml</code> an – erst sie macht aus der Role ein echtes Recht.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+rolebinding\.yaml$/], solution: "kubectl apply --filename rolebinding.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Das RoleBinding ist die Übergabe: es klebt die Role (das WAS) an ein Subjekt (das WER, z.B. einen ServiceAccount). Ohne Binding liegt die Role nur folgenlos herum. Angewandt: kubectl apply --filename &lt;datei&gt;." };
  },
  "rbac-describe-role": sim => {
    const name = pick(ROLE_NAMES);
    ensureRole(sim, name, false);
    return { text: "Sieh die Schlüsselliste im Klartext: beschreibe die Role <code>" + name + "</code> (Resources & Verbs).", accept: [new RegExp("^kubectl\\s+describe\\s+role\\s+" + name + "$")], solution: "kubectl describe role " + name, hint: "Muster: kubectl describe role &lt;name&gt;", why: "describe role zeigt die PolicyRule im Klartext – welche Resources mit welchen Verbs erlaubt sind. So prüfst du, ob eine Role wirklich nur so viel kann wie nötig (Least Privilege). Muster: kubectl describe role &lt;name&gt;." };
  },
  "rbac-apply-clusterrole": sim => {
    let name = pick(CLUSTERROLE_NAMES);
    while (sim.roles.some(r => r.cluster && r.name === name)) name = pick(CLUSTERROLE_NAMES) + rnd(2, 99);
    const file = "clusterrole.yaml";
    sim.files[file] = CLUSTERROLE_YAML;
    sim.applyEffects[file] = { role: { name, cluster: true, rules: [{ verbs: ["get", "list", "watch"], resources: ["nodes"] }] } };
    return { text: "Leg eine <b>cluster-weite</b> Schlüsselliste an: wende <code>clusterrole.yaml</code> an (für nicht-namespaced Dinge wie Nodes).", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+clusterrole\.yaml$/], solution: "kubectl apply --filename clusterrole.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Eine ClusterRole ist wie eine Role, aber OHNE Namespace-Grenze – nur sie kann cluster-weite Ressourcen wie nodes abdecken. Angewandt wie jedes Manifest: kubectl apply --filename &lt;datei&gt;." };
  },
  "rbac-apply-clusterrolebinding": sim => {
    let name = pick(CLUSTERROLE_NAMES) + "-binden";
    while (sim.roleBindings.some(b => b.cluster && b.name === name)) name = "rundblick-" + rnd(2, 999);
    const file = "clusterrolebinding.yaml";
    sim.files[file] = CLUSTERROLEBINDING_YAML;
    sim.applyEffects[file] = { roleBinding: { name, cluster: true, roleRef: { kind: "ClusterRole", name: "knoten-spaeher" }, subjects: [{ kind: "ServiceAccount", name: "wachdienst", namespace: "default" }] } };
    return { text: "Übergib den <b>Rundblick</b> cluster-weit: wende <code>clusterrolebinding.yaml</code> an.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+clusterrolebinding\.yaml$/], solution: "kubectl apply --filename clusterrolebinding.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Ein ClusterRoleBinding übergibt eine ClusterRole cluster-weit an ein Subjekt – es kann nur eine ClusterRole binden (keine Role). Erst danach gilt das Recht über alle Namespaces. Angewandt: kubectl apply --filename &lt;datei&gt;." };
  },
  "pod-security-enforce": sim => {
    sim.podSecurity = "privileged";
    return { text: "Schalt das Tor scharf: setz im Namespace <code>default</code> die strengste Pod-Security-Stufe (<b>restricted</b>) durch – per Namespace-Label.", accept: [/^kubectl\s+label\s+(?:namespace|ns)\s+default\s+pod-security\.kubernetes\.io\/enforce=restricted$/], solution: "kubectl label namespace default pod-security.kubernetes.io/enforce=restricted", hint: "kubectl label namespace default pod-security.kubernetes.io/enforce=restricted", why: "Die Pod-Security-Stufe setzt du als Namespace-Label pod-security.kubernetes.io/enforce=&lt;stufe&gt;. restricted verlangt von jedem NEU ausgerollten Pod: non-root und keine Rechte-Eskalation – ein ungehärteter wird am Tor abgewiesen. So schrumpft der Schaden, falls doch mal einer reinkommt." };
  },
  "pod-security-harden": sim => {
    let name = pick(["spaehposten", "wachposten", "torwaechter", "zinnenwache"]);
    while (sim.deployments.some(d => d.name === name)) name = name + rnd(2, 99);
    const file = "spaehposten.yaml";
    sim.files[file] = POD_SECURITY_YAML;
    sim.applyEffects[file] = { deployment: { name, image: "nginx", replicas: 1, securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true } } };
    return { text: "Roll einen <b>gehärteten</b> Posten aus: wende <code>spaehposten.yaml</code> an – mit securityContext kommt er auch unter <code>restricted</code> durchs Tor.", accept: [/^kubectl\s+apply\s+(?:-f|--filename)\s+spaehposten\.yaml$/], solution: "kubectl apply --filename spaehposten.yaml", hint: "kubectl apply --filename &lt;datei&gt;", why: "Der securityContext im Manifest (runAsNonRoot, allowPrivilegeEscalation: false, readOnlyRootFilesystem) härtet den Pod – genau das verlangt die restricted-Stufe, darum wird er zugelassen, während ein roher Pod abgewiesen würde. Angewandt: kubectl apply --filename &lt;datei&gt;." };
  },
};
