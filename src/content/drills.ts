/* ===== Inhalte: Drills (Zufalls-Übungen) =====
 * Dieses Barrel mergt die Drill-Gruppen aus src/content/drills/* zu DRILLS
 * und definiert PRACTICE (NPC → freigeschaltete Drills).
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

/* Übungs-Pools pro NPC: freigeschaltet nach bestimmter Quest */
export const PRACTICE: Record<string, { drill: string; after: string }[]> = {
  bo:   [{ drill: "docker-pull", after: "docker-first-container" }, { drill: "docker-run", after: "docker-first-container" }, { drill: "docker-run-busybox", after: "docker-common-images" }, { drill: "docker-run-redis", after: "docker-common-images" }, { drill: "docker-run-postgres", after: "docker-common-images" }, { drill: "docker-ps", after: "docker-list-containers" }, { drill: "docker-stop", after: "docker-list-containers" }, { drill: "docker-ps-a", after: "docker-list-containers" }, { drill: "docker-run-named", after: "docker-run-options" }, { drill: "docker-build", after: "docker-build-image" }, { drill: "docker-tag", after: "docker-build-image" }, { drill: "docker-pull-version", after: "docker-registry" }, { drill: "docker-pull-registry", after: "docker-registry" }, { drill: "docker-run-rabbitmq", after: "docker-rabbitmq" }],
  ole:  [{ drill: "k-get-nodes", after: "k8s-first-deployment" }, { drill: "k-get-pods", after: "k8s-first-deployment" }, { drill: "k-describe", after: "k8s-inspect-pods" }, { drill: "k-get-pods-ns", after: "k8s-inspect-pods" }, { drill: "k-create", after: "k8s-service" }, { drill: "k-scale", after: "k8s-service" }, { drill: "k-delete-pod", after: "k8s-self-healing" }, { drill: "k-expose", after: "k8s-self-healing" }, { drill: "k-get-svc", after: "k8s-self-healing" }, { drill: "k-secret", after: "kraken-boss" }, { drill: "k-get-secrets", after: "kraken-boss" }],
  ada:  [{ drill: "k-apply", after: "k8s-apply-manifests" }, { drill: "git-status", after: "git-version-control" }, { drill: "git-add", after: "git-version-control" }, { drill: "git-commit", after: "git-version-control" }, { drill: "git-branch", after: "git-feature-branch" }, { drill: "git-checkout", after: "git-feature-branch" }, { drill: "git-add-all", after: "git-pipeline" }, { drill: "ci-status", after: "git-pipeline" }, { drill: "git-pull", after: "git-merge-branches" }, { drill: "git-resolve", after: "git-merge-branches" }, { drill: "k-secret-tls", after: "secrets-encrypted" }, { drill: "k-get-ingress", after: "secrets-encrypted" }, { drill: "k-nslookup", after: "dns-service-discovery" }, { drill: "k-nslookup-external", after: "dns-service-discovery" }],
  runa: [{ drill: "helm-install", after: "helm-release-install" }, { drill: "helm-list", after: "helm-release-install" }, { drill: "helm-upgrade", after: "helm-upgrade-rollback" }, { drill: "helm-rollback", after: "helm-upgrade-rollback" }, { drill: "helm-create", after: "helm-umbrella-chart" }, { drill: "helm-lint", after: "helm-umbrella-chart" }, { drill: "helm-package", after: "helm-umbrella-chart" }, { drill: "helm-install-local", after: "helm-umbrella-chart" }, { drill: "helm-upgrade-values", after: "helm-umbrella-chart" }, { drill: "helm-dep-update", after: "helm-umbrella-chart" }, { drill: "helm-template", after: "helm-templates" }],
  theo: [{ drill: "tf-plan", after: "terraform-intro" }, { drill: "tf-state", after: "terraform-state-destroy" }],
  saga: [{ drill: "tf-get", after: "terraform-modul" }, { drill: "tf-init-flotte", after: "terraform-remote-state" }, { drill: "tf-apply-flotte", after: "terraform-provider" }, { drill: "tf-output-read", after: "terraform-variablen-outputs" }, { drill: "tf-output-list", after: "terraform-variablen-outputs" }],
  juno: [{ drill: "k-logs", after: "k8s-debug-crashloop" }, { drill: "k-describe", after: "k8s-debug-imagepull" }, { drill: "k-rollout", after: "k8s-debug-crashloop" }, { drill: "k-apply-netpol", after: "network-policy" }, { drill: "k-get-netpol", after: "network-policy" }, { drill: "k-describe-netpol", after: "network-policy" }, { drill: "k-delete-netpol", after: "network-policy" }, { drill: "k-set-resources", after: "k8s-resource-limits" }],
  argo: [{ drill: "argo-apply", after: "gitops-self-sync" }, { drill: "argo-app-list", after: "gitops-self-sync" }, { drill: "argo-app-get", after: "gitops-self-sync" }, { drill: "argo-app-sync", after: "gitops-self-sync" }],
  lumi: [{ drill: "obs-top-pods", after: "observability-metrics" }, { drill: "obs-top-nodes", after: "observability-metrics" }, { drill: "obs-sm-apply", after: "observability-metrics" }, { drill: "obs-sm-get", after: "observability-metrics" }, { drill: "k-logs", after: "observability-logs" }, { drill: "obs-logs-previous", after: "observability-logs" }, { drill: "obs-alerts", after: "observability-alerts" }, { drill: "obs-pr-apply", after: "observability-alerts" }],
  vidar: [{ drill: "rbac-sa-create", after: "k8s-serviceaccount" }, { drill: "rbac-sa-get", after: "k8s-serviceaccount" }, { drill: "rbac-can-i", after: "k8s-rbac-role" }, { drill: "rbac-apply-role", after: "k8s-rbac-role" }, { drill: "rbac-apply-rolebinding", after: "k8s-rbac-role" }, { drill: "rbac-describe-role", after: "k8s-rbac-role" }, { drill: "rbac-apply-clusterrole", after: "k8s-rbac-clusterrole" }, { drill: "rbac-apply-clusterrolebinding", after: "k8s-rbac-clusterrole" }, { drill: "pod-security-enforce", after: "k8s-pod-security" }, { drill: "pod-security-harden", after: "k8s-pod-security" }],
  knut: [{ drill: "sts-apply", after: "storage-statefulset" }, { drill: "sts-get", after: "storage-statefulset" }, { drill: "sts-delete-pod", after: "storage-statefulset" }, { drill: "sc-apply", after: "storage-pvc" }, { drill: "pvc-apply", after: "storage-pvc" }, { drill: "pvc-get", after: "storage-pvc" }, { drill: "pv-get", after: "storage-pvc" }, { drill: "pvc-pending", after: "storage-pvc" }, { drill: "snap-apply", after: "storage-backup-restore" }, { drill: "snap-get", after: "storage-backup-restore" }, { drill: "snap-restore", after: "storage-backup-restore" }],
  greta: [{ drill: "werft-build", after: "werft-eigener-dienst" }, { drill: "werft-deploy-imagepull", after: "werft-eigener-dienst" }, { drill: "werft-rollout-heal", after: "werft-eigener-dienst" }, { drill: "werft-expose", after: "werft-eigener-dienst" }, { drill: "werft-curl", after: "werft-eigener-dienst" }],
};
