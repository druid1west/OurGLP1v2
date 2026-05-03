#!/bin/bash

echo "🔧 Building React App for Production..."
npm run build || { echo "❌ Build failed. Aborting."; exit 1; }

echo "🧹 Cleaning old iOS assets..."
mkdir -p ios/App/public
rm -rf ios/App/public/* || echo "⚠️ No existing iOS public folder to clean."

echo "📁 Copying assets to iOS platform..."
cp -r dist/* ios/App/public/ || { echo "❌ Failed to copy web assets. Aborting."; exit 1; }

echo "🔄 Syncing Capacitor plugins..."
npx cap sync ios || { echo "❌ Capacitor sync failed. Aborting."; exit 1; }

echo "🧼 Cleaning Xcode DerivedData cache..."
rm -rf ~/Library/Developer/Xcode/DerivedData/* || echo "⚠️ Could not clean DerivedData"

echo "📦 Reinstalling CocoaPods..."
cd ios/App && pod install || { echo "⚠️ pod install failed (check CocoaPods install)"; exit 1; }
cd ../..

echo "🔍 Verifying iOS config..."
if [ ! -f "ios/App/App/Info.plist" ]; then
  echo "❌ Info.plist missing. iOS project might be misconfigured."
  exit 1
fi

echo "📁 Ensuring entitlements and biometrics permissions..."
grep -q 'NSFaceIDUsageDescription' ios/App/App/Info.plist || {
  echo "⚠️ Missing Face ID usage description. Add NSFaceIDUsageDescription to Info.plist manually."
}

echo "🚀 Opening in Xcode..."
open ios/App/App.xcworkspace
