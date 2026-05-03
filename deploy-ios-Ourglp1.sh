#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Building React App for Production..."
npm run build

IOS_ROOT="ios/App"
XCODEPROJ="$IOS_ROOT/App.xcodeproj"
XCWORK="$IOS_ROOT/App.xcworkspace"
PUBLIC_DIR="$IOS_ROOT/App/public"
PODFILE="$IOS_ROOT/Podfile"

echo "🧹 Cleaning old iOS web assets..."
mkdir -p "$PUBLIC_DIR"
rm -rf "$PUBLIC_DIR"/* || true

# --- optional runtime config for iOS build (matches server deploy) ---
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
if [[ -n "${APP_SENTRY_DSN}" ]]; then SENTRY_DSN_JS="\"${APP_SENTRY_DSN}\""; else SENTRY_DSN_JS="null"; fi
cat > dist/config.js <<EOF
window.__APP_CONFIG__ = {
  SENTRY_DSN: ${SENTRY_DSN_JS},
  SENTRY_ENV: "${APP_SENTRY_ENV}",
  SENTRY_RELEASE: "${APP_SENTRY_RELEASE}",
  SENTRY_DIST: "${APP_SENTRY_DIST}"
};
EOF

echo "📁 Copying web assets…"
cp -R dist/* "$PUBLIC_DIR/"

echo "🕵️  Detecting iOS target from Xcode project…"
TARGET_NAME="$(xcodebuild -list -project "$XCODEPROJ" 2>/dev/null | awk '/Targets:/{flag=1;next}/^$/{flag=0}flag' | head -n1 | sed 's/^[[:space:]]*//')"
if [[ -z "${TARGET_NAME:-}" ]]; then
  echo "❌ Could not detect target from $XCODEPROJ"; exit 1
fi
echo "➡️  Detected target: $TARGET_NAME"

echo "🔧 Ensuring Podfile uses correct target…"
if grep -q "target 'App'" "$PODFILE"; then
  sed -i '' "s/target 'App'/target '$TARGET_NAME'/g" "$PODFILE"
  echo "✅ Podfile patched to target '$TARGET_NAME'"
fi

echo "🔄 Capacitor sync (ios)…"
npx cap sync ios
# (if you don't need plugin/Pod changes each time, use: npx cap copy ios)

PLIST="ios/App/App/Info.plist"
# Clean up any conflicting keys from the Launch Screens UI
plutil -remove UILaunchStoryboardName "$PLIST" 2>/dev/null || true
plutil -remove UIDefaultLaunchScreen "$PLIST" 2>/dev/null || true
plutil -remove UILaunchScreenDefinitions "$PLIST" 2>/dev/null || true
plutil -remove UIURLToLaunchScreenAssociations "$PLIST" 2>/dev/null || true

# Set the iOS 14+ launch screen (imageset name must match Assets.xcassets)
plutil -replace UILaunchScreen -json '{"UIImageName":"Splash"}' "$PLIST"

# Modern devices are 64-bit; avoid legacy armv7 requirement
plutil -replace UIRequiredDeviceCapabilities -json '["arm64"]' "$PLIST"


echo "🧼 Cleaning Xcode DerivedData (best-effort)…"
rm -rf ~/Library/Developer/Xcode/DerivedData/* || true

echo "📦 pod install…"
( cd "$IOS_ROOT" && pod install )

echo "🔍 Verifying Info.plist…"
if [[ ! -f "$IOS_ROOT/App/Info.plist" ]]; then
  echo "❌ Info.plist missing at $IOS_ROOT/App/Info.plist"; exit 1
fi

echo "🚀 Opening in Xcode…"
open "$XCWORK"

