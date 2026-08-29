{{/*
Expand the name of the chart.
*/}}
{{- define "platform-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name. Truncated at 63 characters because some Kubernetes
name fields are limited to that by DNS label rules.
*/}}
{{- define "platform-api.fullname" -}}
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

{{- define "platform-api.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Labels applied to every object. app.kubernetes.io/* are the standard set that
kubectl, dashboards and most tooling already understand.
*/}}
{{- define "platform-api.labels" -}}
helm.sh/chart: {{ include "platform-api.chart" . }}
{{ include "platform-api.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: platform
{{- end }}

{{/*
Selector labels. Deliberately minimal and never version-dependent: a Deployment's
selector is immutable, so anything that changes per release must stay out of it.
*/}}
{{- define "platform-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "platform-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "platform-api.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "platform-api.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Fully qualified image reference.

Fails the render rather than shipping something ambiguous: an unset repository
would otherwise produce ":<tag>", and an unset tag would resolve to "latest",
which makes rollbacks unreliable. Both are supplied by the CD workflow.
*/}}
{{- define "platform-api.image" -}}
{{- $repository := .Values.image.repository | default "" -}}
{{- $tag := .Values.image.tag | default "" -}}
{{- if not $repository -}}
{{- fail "image.repository must be set, e.g. --set image.repository=<acr-login-server>/platform-api" -}}
{{- end -}}
{{- if not $tag -}}
{{- fail "image.tag must be set to an immutable tag (the CD workflow passes the short git SHA)" -}}
{{- end -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end }}
