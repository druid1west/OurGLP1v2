#!/usr/bin/env bash
set -Eeuo pipefail

echo "▶ Building web assets for DEVELOPMENT"



echo "✅ Created .env.development.local with Pro override enabled"

# Build with development mode
npm run build -- --mode development

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
    echo "⚠️  Couldn't find versionCode in $APP_GRADLE"
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

# Open Android Studio for dev build
if command -v open >/dev/null 2>&1; then
  echo "▶ Opening Android project in Android Studio…"
  open -a "Android Studio" android || true
else
  echo "ℹ️  Open Android Studio manually and load the ./android folder."
fi

echo "✅ Dev prep done."
echo "⚠️  DEV BUILD - Pro override is ENABLED"
echo "ℹ️  In Android Studio: Build → Build Bundle(s) / APK(s) → Build APK for testing"