#!/usr/bin/env bash
set -euo pipefail

# ===== Config =====
REMOTE_USER="parisder"
REMOTE_HOST="app.ourglp1.com"              # web host (unchanged)
REMOTE_SSH_HOST="${REMOTE_SSH_HOST:-100.123.9.96}"  # VPN IP for SSH/rsync
REMOTE_DIR="/var/www/Paris-Clinic/GLP1/frontend/build"
LOCAL_BUILD_DIR="./dist"

# Optional toggles
RELOAD_NGINX="${RELOAD_NGINX:-0}"
SSH_OPTS="${SSH_OPTS:-}"                   # e.g. "-i ~/.ssh/id_rsa -p 22 -o StrictHostKeyChecking=yes"

# Runtime config
APP_SENTRY_DSN="${APP_SENTRY_DSN:-}"
APP_SENTRY_ENV="${APP_SENTRY_ENV:-production}"
APP_SENTRY_RELEASE="${APP_SENTRY_RELEASE:-}"
APP_SENTRY_DIST="${APP_SENTRY_DIST:-}"

# Optional sourcemap upload env:
SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN:-}"
SENTRY_ORG="${SENTRY_ORG:-}"
SENTRY_PROJECT="${SENTRY_PROJECT:-}"

# Derive a release if not provided
if [[ -z "${APP_SENTRY_RELEASE}" ]]; then
  PKG_VER="$(node -p "require('./package.json').version" 2>/dev/null || echo '0.0.0')"
  GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
  APP_SENTRY_RELEASE="ourglp1@${PKG_VER}+${GIT_SHA}"
  APP_SENTRY_DIST="${APP_SENTRY_DIST:-$GIT_SHA}"
fi

echo "🚧 Building web bundle…"
npm run build

echo "📝 Generating runtime /config.js …"
mkdir -p "${LOCAL_BUILD_DIR}"
if [[ -n "${APP_SENTRY_DSN}" ]]; then
  SENTRY_DSN_JS="\"${APP_SENTRY_DSN}\""
else
  SENTRY_DSN_JS="null"
fi
cat > "${LOCAL_BUILD_DIR}/config.js" <<EOF
window.__APP_CONFIG__ = {
  SENTRY_DSN: ${SENTRY_DSN_JS},
  SENTRY_ENV: "${APP_SENTRY_ENV}",
  SENTRY_RELEASE: "${APP_SENTRY_RELEASE}",
  SENTRY_DIST: "${APP_SENTRY_DIST}"
};
EOF

# --- Optional: Sentry sourcemaps ---
if [[ -n "${SENTRY_AUTH_TOKEN}" && -n "${SENTRY_ORG}" && -n "${SENTRY_PROJECT}" ]]; then
  echo "🧭 Uploading sourcemaps to Sentry release: ${APP_SENTRY_RELEASE} (dist: ${APP_SENTRY_DIST})"
  export SENTRY_AUTH_TOKEN SENTRY_ORG SENTRY_PROJECT
  npx --yes @sentry/cli releases new "${APP_SENTRY_RELEASE}"
  npx --yes @sentry/cli releases set-commits --auto "${APP_SENTRY_RELEASE}" || true
  npx --yes @sentry/cli releases files "${APP_SENTRY_RELEASE}" upload-sourcemaps \
    "${LOCAL_BUILD_DIR}/assets" \
    --url-prefix "~/assets" \
    --rewrite \
    ${APP_SENTRY_DIST:+--dist "$APP_SENTRY_DIST"}
  npx --yes @sentry/cli releases finalize "${APP_SENTRY_RELEASE}"

  echo "🧹 Removing local *.map after upload…"
  find "${LOCAL_BUILD_DIR}/assets" -type f -name "*.map" -delete || true
else
  echo "ℹ️  Skipping sourcemap upload (set SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT to enable)."
fi

echo "📂 Ensuring remote directory exists on server…"
ssh ${SSH_OPTS} "${REMOTE_USER}@${REMOTE_SSH_HOST}" "mkdir -p '${REMOTE_DIR}'"

echo "📦 Uploading build files to server…"
rsync -avz --no-times --no-perms --delete \
  --exclude '.DS_Store' \
  -e "ssh ${SSH_OPTS}" \
  "${LOCAL_BUILD_DIR}/" \
  "${REMOTE_USER}@${REMOTE_SSH_HOST}:${REMOTE_DIR}"

if [[ "${RELOAD_NGINX}" == "1" ]]; then
  echo "🔍 Validating Nginx config, then reload…"
  ssh ${SSH_OPTS} -t "${REMOTE_USER}@${REMOTE_SSH_HOST}" "sudo nginx -t && sudo systemctl reload nginx"
else
  echo "🚫 Skipping Nginx reload (set RELOAD_NGINX=1 to enable)."
fi

echo "✅ Deployment complete!
   Release: ${APP_SENTRY_RELEASE}
   Dist:    ${APP_SENTRY_DIST}
   Env:     ${APP_SENTRY_ENV}"

