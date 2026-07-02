/* ===== Inhalte: Drills (Zufalls-Übungen) =====
 * Dieses Barrel mergt die Drill-Gruppen aus src/content/drills/* zu DRILLS.
 * Das Freischalt-Mapping PRACTICE (NPC → Drill nach Quest) ist seit #521
 * Content-as-Data und lebt in content/data/practice.json (Loader:
 * content/loader/practice.ts) – die DRILLS bleiben Code, weil sie Funktionen sind.
 * Implementierungen und Helfer: src/content/drills/
 */
import type { Sim } from "../sim";
import type { DrillTask } from "./drills/shared";
import { DOCKER_DRILLS } from "./drills/docker";
import { KUBECTL_DRILLS } from "./drills/kubectl";
import { GIT_DRILLS } from "./drills/git";
import { HELM_DRILLS } from "./drills/helm";
import { TERRAFORM_DRILLS } from "./drills/terraform";
import { NETWORK_DRILLS } from "./drills/network";
import { GITOPS_DRILLS } from "./drills/gitops";
import { OBSERVABILITY_DRILLS } from "./drills/observability";
import { RBAC_DRILLS } from "./drills/rbac";
import { STORAGE_DRILLS } from "./drills/storage";
import { WERFT_DRILLS } from "./drills/werft";
export type { DrillTask } from "./drills/shared";

export const DRILLS: Record<string, (sim: Sim) => DrillTask> = {
  ...DOCKER_DRILLS,
  ...KUBECTL_DRILLS,
  ...GIT_DRILLS,
  ...HELM_DRILLS,
  ...TERRAFORM_DRILLS,
  ...NETWORK_DRILLS,
  ...GITOPS_DRILLS,
  ...OBSERVABILITY_DRILLS,
  ...RBAC_DRILLS,
  ...STORAGE_DRILLS,
  ...WERFT_DRILLS,
};
