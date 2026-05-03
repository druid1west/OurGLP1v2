#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Building React App for DEVELOPMENT..."



echo "✅ Created .env.development.local with Pro override enabled"

# Build with development mode
npm run build -- --mode development

IOS_ROOT="ios/App"
XCODEPROJ="$IOS_ROOT/App.xcodeproj"
XCWORK="$IOS_ROOT/App.xcworkspace"
PUBLIC_DIR="$IOS_ROOT/App/public"
PODFILE="$IOS_ROOT/Podfile"

echo "🧹 Cleaning old iOS web assets..."
mkdir -p "$PUBLIC_DIR"
rm -rf "$PUBLIC_DIR"/* || true

# Dev runtime config (no Sentry or minimal Sentry for dev)
APP_SENTRY_ENV="development"
mkdir -p dist
cat > dist/config.js <<EOF
window.__APP_CONFIG__ = {
  SENTRY_DSN: null,
  SENTRY_ENV: "development",
  SENTRY_RELEASE: "dev-build",
  SENTRY_DIST: "local"
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

PLIST="ios/App/App/Info.plist"
plutil -remove UILaunchStoryboardName "$PLIST" 2>/dev/null || true
plutil -remove UIDefaultLaunchScreen "$PLIST" 2>/dev/null || true
plutil -remove UILaunchScreenDefinitions "$PLIST" 2>/dev/null || true
plutil -remove UIURLToLaunchScreenAssociations "$PLIST" 2>/dev/null || true
plutil -replace UILaunchScreen -json '{"UIImageName":"Splash"}' "$PLIST"
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
echo "⚠️  DEV BUILD - Pro override is ENABLED"
open "$XCWORK"