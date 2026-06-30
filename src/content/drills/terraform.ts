import type { Sim } from "../../sim";
import { pick, TF_FLOTTE_OUTPUTS, ensureTfOutputs } from "./shared";
import type { DrillTask } from "./shared";

export const TERRAFORM_DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  "tf-plan": sim => {
    if (!sim.tf.initialized) sim.tf.initialized = true;
    return { text: "Zeig, was Terraform tun WÜRDE – ohne es zu tun.", accept: [/^terraform\s+plan$/], solution: "terraform plan", hint: "Die Generalprobe.", why: "plan ist die Generalprobe: es zeigt, was sich ändern würde – ohne es wirklich zu tun. Erst plan lesen, dann apply." };
  },
  "tf-state": sim => {
    if (!sim.tf.applied) { sim.tf.initialized = true; sim.exec("terraform apply"); }
    return { text: "Wirf einen Blick in Terraforms Gedächtnis.", accept: [/^terraform\s+state\s+list$/], solution: "terraform state list", hint: "terraform state …", why: "Der State ist Terraforms Gedächtnis; state list zeigt, welche Ressourcen es bereits verwaltet." };
  },
  "tf-get": sim => {
    sim.mergeScenario({
      tfModules: [
        { name: "nordanleger", source: "./modules/anleger", resources: ["hafen_kai.kai", "hafen_poller.poller"] },
        { name: "suedanleger", source: "./modules/anleger", resources: ["hafen_kai.kai", "hafen_poller.poller"] },
      ],
      tfResources: [],
    });
    return { text: "Hol die wiederverwendbaren <b>Bausteine</b> (Module) ins Projekt.", accept: [/^terraform\s+get$/], solution: "terraform get", hint: "terraform &lt;unterbefehl&gt; – der Befehl, der die Module herunterlädt.", why: "Ein Modul ist ein wiederverwendbarer Baustein, den du mit verschiedenen Werten mehrfach aufrufst. terraform get lädt die in den module-Blöcken referenzierten Bausteine ins Projekt (terraform init macht das mit). Muster: terraform get." };
  },
  "tf-init-flotte": sim => {
    sim.mergeScenario({
      tfProviders: [{ name: "nordwind", source: "kubequest/nordwind", version: "1.4.0" }],
      tfBackend: { type: "s3", name: "flotten-lager", locking: true },
      tfResources: [{ addr: "hafen_leuchtfeuer.einfahrt", desc: 'name = "einfahrt-nord"' }],
    });
    return { text: "Mach das Projekt startklar: <b>Provider-Plugins laden und das Remote-Backend (Flotten-Lager) einrichten</b>.", accept: [/^terraform\s+init$/], solution: "terraform init", hint: "Der allererste Befehl jedes Terraform-Projekts.", why: "terraform init ist der erste Schritt: es lädt die deklarierten Provider-Plugins herunter UND richtet das konfigurierte Remote-Backend ein, in dem der geteilte State liegt. Erst danach gehen plan/apply. Muster: terraform init." };
  },
  "tf-apply-flotte": sim => {
    sim.mergeScenario({
      tfProviders: [
        { name: "nordwind", source: "kubequest/nordwind", version: "1.4.0" },
        { name: "passat", source: "kubequest/passat", version: "0.9.2" },
      ],
      tfModules: [], tfBackend: null,
      tfResources: [
        { addr: "nordwind_insel.ost", desc: 'name = "ost-vorposten"', provider: "nordwind" },
        { addr: "passat_insel.west", desc: 'name = "west-vorposten"', provider: "passat" },
      ],
    });
    sim.tf.initialized = true;
    return { text: "Bau die Vorposten bei <b>beiden Anbietern</b>: eine Insel bei nordwind, eine bei passat (Multi-Cloud).", accept: [/^terraform\s+apply(\s+-auto-approve)?$/], solution: "terraform apply", hint: "Nach init/plan kommt der Bau-Befehl.", why: "terraform apply setzt den Plan um und baut die Ressourcen wirklich – hier je eine Insel pro Anbieter, aus EINER Konfig und EINEM Lauf. Genau so verwaltet man später AWS/Azure/GCP nebeneinander. Muster: terraform apply." };
  },
  "tf-output-read": sim => {
    ensureTfOutputs(sim);
    const o = pick(TF_FLOTTE_OUTPUTS);
    return { text: "Lies den deklarierten Output <code>" + o.name + "</code> gezielt aus.", accept: [new RegExp("^terraform\\s+output\\s+" + o.name + "$")], solution: "terraform output " + o.name, hint: "Muster: terraform output &lt;output-name&gt;", why: "Outputs sind die sauberen Rückgaben einer Konfiguration. terraform output &lt;name&gt; gibt einen einzelnen Wert gezielt (roh) aus – praktisch, um z.B. eine erzeugte Adresse weiterzuverwenden. Muster: terraform output &lt;name&gt;." };
  },
  "tf-output-list": sim => {
    ensureTfOutputs(sim);
    return { text: "Verschaff dir den Überblick: zeig <b>alle</b> Outputs auf einmal.", accept: [/^terraform\s+output$/], solution: "terraform output", hint: "terraform output ganz ohne Namen listet alle deklarierten Outputs.", why: "terraform output ohne Namen listet alle deklarierten Outputs. Als sensitive markierte Werte erscheinen dabei nur als &lt;sensitive&gt; – Geheimnisse landen so nicht versehentlich im Log; gezielt (mit Namen) bekommt man sie bei Bedarf trotzdem heraus." };
  },
};
