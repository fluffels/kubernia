{{/*
Vollständiger Chart-Name (max. 63 Zeichen, Kubernetes-Grenze für Label-Werte).
*/}}
{{- define "kubernia.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "kubernia.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Standard-Labels für alle Objekte dieses Charts.
*/}}
{{- define "kubernia.labels" -}}
helm.sh/chart: {{ include "kubernia.chart" . }}
{{ include "kubernia.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector-Labels (unveränderlich nach erstem Deployment).
*/}}
{{- define "kubernia.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kubernia.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Chart-Label im Format name-version.
*/}}
{{- define "kubernia.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}
