#!/bin/bash

# Commit hash with good iOS files
COMMIT_HASH="376bd00"

echo "📦 Restoring iOS native files from commit $COMMIT_HASH..."

# List of essential iOS files to restore
FILES=(
  "ios/App/App.xcodeproj/project.pbxproj"
  "ios/App/App.xcworkspace/contents.xcworkspacedata"
  "ios/App/App/Info.plist"
  "ios/App/App/App.entitlements"
  "ios/App/App/AppDelegate.swift"
  "ios/App/App/LaunchScreen.storyboard"
  "ios/App/App/Assets.xcassets"
)

# Restore each file or folder
for file in "${FILES[@]}"; do
  echo "🔄 Restoring $file..."
  git checkout $COMMIT_HASH -- "$file"
done

echo "✅ Done! All required iOS files restored from commit $COMMIT_HASH"
echo "💡 Now run:"
echo "   npx cap sync ios"
echo "   npx cap open ios"


