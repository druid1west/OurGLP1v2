#!/usr/bin/env bash
set -Eeuo pipefail

echo "▶ Building web assets"
npm run -s build

# --- optional runtime config for Android build (mirrors iOS) ---
APP_SENTRY_DSN="${APP_SENTRY_DSN:-}"
APP_SENTRY_ENV="${APP_SENTRY_ENV:-production}"
APP_SENTRY_RELEASE="${APP_SENTRY_RELEASE:-}"
APP_SENTRY_DIST="${APP_SENTRY_DIST:-}"

if [[ -z "${APP_SENTRY_RELEASE}" ]]; then
  PKG_VER="$(node -p "require('./package.json').version" 2>/dev/null || echo '0.0.0')"
  GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
  APP_SENTRY_RELEASE="ourglp1@${PKG_VER}+${GIT_SHA}"
  APP_SENTRY_DIST="${APP_SENTRY_DIST:-$GIT_SHA}"
fi

mkdir -p dist
if [[ -n "${APP_SENTRY_DSN}" ]]; then
  SENTRY_DSN_JS="\"${APP_SENTRY_DSN}\""
else
  SENTRY_DSN_JS="null"
fi

cat > dist/config.js <<EOF
// Auto-generated at build time. Used by sentry.ts (runtime takes precedence over Vite env).
window.__APP_CONFIG__ = {
  SENTRY_DSN: ${SENTRY_DSN_JS},
  SENTRY_ENV: "${APP_SENTRY_ENV}",
  SENTRY_RELEASE: "${APP_SENTRY_RELEASE}",
  SENTRY_DIST: "${APP_SENTRY_DIST}"
};
EOF

echo "ℹ️  Wrote dist/config.js (env=${APP_SENTRY_ENV}, hasDSN=$([[ -n "${APP_SENTRY_DSN}" ]] && echo yes || echo no))"

echo "▶ Syncing Capacitor (android)"
npx cap sync android

APP_GRADLE="android/app/build.gradle"

# --- Bump versionCode automatically ---
if [[ -f "$APP_GRADLE" ]]; then
  CUR=$(awk '/versionCode[[:space:]]+[0-9]+/ {print $2; exit}' "$APP_GRADLE" || echo "")
  if [[ -n "${CUR}" ]]; then
    NEXT=$((CUR+1))
    /usr/bin/sed -i '' "s/versionCode[[:space:]][0-9][0-9]*/versionCode ${NEXT}/" "$APP_GRADLE"
    echo "▶ Bumped versionCode: ${CUR} → ${NEXT}"
  else
    echo "⚠️  Couldn’t find versionCode in $APP_GRADLE"
  fi
else
  echo "❌ $APP_GRADLE not found"
  exit 1
fi

# --- Optionally set versionName from package.json (skip if KEEP_VERSION_NAME=1) ---
if [[ "${KEEP_VERSION_NAME:-0}" != "1" ]]; then
  PKG_VER="$(node -p "require('./package.json').version" 2>/dev/null || echo '')"
  if [[ -n "$PKG_VER" ]]; then
    OLD=$(awk -F\" '/versionName[[:space:]]+\"/ {print $2; exit}' "$APP_GRADLE" || true)
    /usr/bin/sed -i '' "s/versionName[[:space:]]\"[^\"]*\"/versionName \"${PKG_VER}\"/" "$APP_GRADLE"
    echo "▶ Set versionName: ${OLD:-<none>} → ${PKG_VER}"
  else
    echo "⚠️  package.json version missing; leaving versionName unchanged"
  fi
else
  echo "⏭️  KEEP_VERSION_NAME=1 → leaving versionName unchanged"
fi

# Open Android Studio for signed build
if command -v open >/dev/null 2>&1; then
  echo "▶ Opening Android project in Android Studio…"
  open -a "Android Studio" android || true
else
  echo "ℹ️  Open Android Studio manually and load the ./android folder."
fi

echo "✅ Android prep done. In Android Studio: Build → Generate Signed Bundle/APK…"
