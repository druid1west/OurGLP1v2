#!/usr/bin/env bash
set -Eeuo pipefail

# Usage:
#   scripts/android-push.sh quick          # build -> copy -> installDebug -> launch (NO version bump)
#   scripts/android-push.sh quick --no-build
#   scripts/android-push.sh release        # build -> sync -> bump versionCode -> set versionName -> open Android Studio
#
# Env:
#   APP_ID=com.ourglp1.app                # your package id (for relaunch)
#   KEEP_VERSION_NAME=1                   # in release mode: do NOT overwrite versionName from package.json

CMD="${1:-quick}"
SHIFTED_ARGS=("${@:2}")

# ---- Config ---------------------------------------------------------------
APP_ID="${APP_ID:-com.ourglp1.app}"
APP_GRADLE="android/app/build.gradle"

say()   { echo -e "▶ $*"; }
warn()  { echo -e "⚠️  $*" >&2; }
err()   { echo -e "❌ $*" >&2; exit 1; }

need()  { command -v "$1" >/dev/null 2>&1 || err "Missing command: $1"; }

relaunch_app() {
  say "Relaunching ${APP_ID}"
  adb shell am force-stop "${APP_ID}" 2>/dev/null || true
  adb shell am start -n "${APP_ID}/.MainActivity" || warn "Could not start activity"
}

bump_version_code() {
  [[ -f "$APP_GRADLE" ]] || err "$APP_GRADLE not found"
  local CUR
  CUR=$(awk '/versionCode[[:space:]]+[0-9]+/ {print $2; exit}' "$APP_GRADLE" || true)
  if [[ -n "${CUR}" ]]; then
    local NEXT=$((CUR+1))
    # macOS/BSD sed requires empty string after -i; GNU sed ignores it
    if sed --version >/dev/null 2>&1; then
      sed -i "s/versionCode[[:space:]][0-9][0-9]*/versionCode ${NEXT}/" "$APP_GRADLE"
    else
      /usr/bin/sed -i '' "s/versionCode[[:space:]][0-9][0-9]*/versionCode ${NEXT}/" "$APP_GRADLE"
    fi
    say "Bumped versionCode: ${CUR} → ${NEXT}"
  else
    warn "Couldn’t find versionCode in $APP_GRADLE"
  fi
}

set_version_name_from_pkg() {
  [[ "${KEEP_VERSION_NAME:-0}" == "1" ]] && { say "KEEP_VERSION_NAME=1 → leaving versionName unchanged"; return; }
  local PKG_VER
  PKG_VER="$(node -p "require('./package.json').version" 2>/dev/null || echo '')"
  if [[ -z "$PKG_VER" ]]; then
    warn "package.json version missing; leaving versionName unchanged"
    return
  fi
  local OLD
  OLD=$(awk -F\" '/versionName[[:space:]]+\"/ {print $2; exit}' "$APP_GRADLE" || true)
  if sed --version >/dev/null 2>&1; then
    sed -i "s/versionName[[:space:]]\"[^\"]*\"/versionName \"${PKG_VER}\"/" "$APP_GRADLE"
  else
    /usr/bin/sed -i '' "s/versionName[[:space:]]\"[^\"]*\"/versionName \"${PKG_VER}\"/" "$APP_GRADLE"
  fi
  say "Set versionName: ${OLD:-<none>} → ${PKG_VER}"
}

do_build() {
  say "Building web assets"
  npm run -s build
}

case "$CMD" in
  quick)
    BUILD=1
    for a in "${SHIFTED_ARGS[@]}"; do
      [[ "$a" == "--no-build" ]] && BUILD=0
    done

    need npx
    need adb

    [[ $BUILD -eq 1 ]] && do_build || say "Skipping web build ( --no-build )"

    say "Copying web assets → android"
    npx cap copy android

    say "Installing debug (no version bump)"
    (cd android && ./gradlew installDebug)

    relaunch_app
    say "Done (quick)."
    ;;

  release)
    need npx

    do_build

    say "Syncing Capacitor (android)"
    npx cap sync android

    bump_version_code
    set_version_name_from_pkg

    if command -v open >/dev/null 2>&1; then
      say "Opening Android project in Android Studio…"
      open -a "Android Studio" android || true
    else
      say "Open Android Studio manually and load ./android"
    fi

    echo "✅ Release prep complete. In Android Studio: Build → Generate Signed Bundle/APK…"
    ;;

  *)
    err "Unknown command: $CMD
Usage:
  $0 quick [--no-build]
  $0 release
Env:
  APP_ID, KEEP_VERSION_NAME"
    ;;
esac

