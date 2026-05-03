#!/usr/bin/env bash
set -euo pipefail

# ========= Config (override via env if needed) =========
IOS_ROOT="${IOS_ROOT:-ios/App}"
XCODEPROJ="$IOS_ROOT/App.xcodeproj"
XCWORK="$IOS_ROOT/App.xcworkspace"
PUBLIC_DIR="$IOS_ROOT/App/public"
PODFILE="$IOS_ROOT/Podfile"
PLIST="$IOS_ROOT/App/Info.plist"

# Optional Sentry runtime config (matches your existing flow)
APP_SENTRY_DSN="${APP_SENTRY_DSN:-}"
APP_SENTRY_ENV="${APP_SENTRY_ENV:-production}"
APP_SENTRY_RELEASE="${APP_SENTRY_RELEASE:-}"
APP_SENTRY_DIST="${APP_SENTRY_DIST:-}"

# ========= Preflight checks =========
echo "✅ Preflight: Node/NPM"
node -v
npm -v

echo "✅ Preflight: TypeScript compile (no emit)"
npx tsc -p tsconfig.app.json --noEmit

echo "✅ Preflight: ESLint"
# If you don't have eslint configured, set SKIP_ESLINT=1
if [[ "${SKIP_ESLINT:-0}" != "1" ]]; then
  npx eslint "src/**/*.{ts,tsx,js,jsx}"
else
  echo "⏭️  SKIP_ESLINT=1 → Skipping ESLint"
fi

echo "✅ Preflight: Verify Capacitor & plugin installed"
npx cap --version >/dev/null
node -e "require.resolve('@capgo/capacitor-social-login')" \
  || { echo "❌ Missing @capgo/capacitor-social-login. Run: npm i @capgo/capacitor-social-login"; exit 1; }

echo "✅ Preflight: Capacitor doctor"
npx cap doctor || true

# Try to detect API base from common locations (adjust to your project)
API_BASE_GUESS="$(node -e "try{const pkg=require('./package.json'); console.log(pkg.appConfig?.apiBase||'')}catch{}" || true)"
if [[ -z "${API_BASE_GUESS}" ]]; then
  API_BASE_GUESS="$(grep -R \"https\?://\" -n src 2>/dev/null | head -n1 | awk -F: '{print $3}' || true)"
fi

if [[ -n "${API_BASE_GUESS}" ]]; then
  echo "ℹ️  Detected API base candidate: ${API_BASE_GUESS}"
  if [[ "${API_BASE_GUESS}" == http://localhost* || "${API_BASE_GUESS}" == https://localhost* || "${API_BASE_GUESS}" == http://127.* || "${API_BASE_GUESS}" == http://0.0.0.0* ]]; then
    echo "⚠️  API appears to be localhost — real iPhones cannot reach it. Use an HTTPS tunnel/domain."
  fi
else
  echo "ℹ️  Could not auto-detect API base. Ensure your app points to an HTTPS endpoint reachable from device."
fi

# ========= Build web bundle =========
echo "🔧 Building React App for Production..."
npm run build

# ========= Prepare runtime config (Sentry) =========
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

# ========= Install web assets into iOS bundle =========
echo "🧹 Cleaning old iOS web assets..."
mkdir -p "$PUBLIC_DIR"
rm -rf "$PUBLIC_DIR"/* || true

echo "📁 Copying web assets…"
cp -R dist/* "$PUBLIC_DIR/"

# ========= Target detection and Podfile sanity =========
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

# ========= Capacitor sync / CocoaPods =========
echo "🔄 Capacitor sync (ios)…"
npx cap sync ios

echo "🧼 Cleaning Xcode DerivedData (best-effort)…"
rm -rf ~/Library/Developer/Xcode/DerivedData/* || true

echo "📦 pod install…"
( cd "$IOS_ROOT" && pod install )

# ========= Info.plist adjustments =========
if [[ ! -f "$PLIST" ]]; then
  echo "❌ Info.plist missing at $PLIST"; exit 1
fi

# Clean legacy launch screen conflicts
plutil -remove UILaunchStoryboardName "$PLIST" 2>/dev/null || true
plutil -remove UIDefaultLaunchScreen "$PLIST" 2>/dev/null || true
plutil -remove UILaunchScreenDefinitions "$PLIST" 2>/dev/null || true
plutil -remove UIURLToLaunchScreenAssociations "$PLIST" 2>/dev/null || true

# Set iOS 14+ launch screen (imageset must exist in Assets.xcassets)
plutil -replace UILaunchScreen -json '{"UIImageName":"Splash"}' "$PLIST"

# Modern devices are 64-bit; avoid legacy armv7 requirement
plutil -replace UIRequiredDeviceCapabilities -json '["arm64"]' "$PLIST"

# ========= Gentle checks: URL Types for Google (optional) =========
# This only warns; doesn’t fail the build
if /usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes" "$PLIST" >/dev/null 2>&1; then
  echo "✅ Info.plist has CFBundleURLTypes (good for Google Sign-In)"
else
  echo "ℹ️  Info.plist missing CFBundleURLTypes. If using Google Sign-In, add reversed iOS client ID as a URL scheme."
fi

# ========= Final guidance echoes =========
echo ""
echo "📋 Manual checks in Xcode (once per project/target):"
echo "  - Enable 'Sign In with Apple' capability in Signing & Capabilities"
echo "  - If using Google Sign-In: add URL Type with reversed iOS client ID"
echo "  - Ensure Bundle ID matches an App ID with the Apple capability enabled (Apple Developer portal)"
echo "  - Use an HTTPS backend reachable from device (tunnel/domain)"
echo ""

echo "🚀 Opening in Xcode…"
open "$XCWORK"