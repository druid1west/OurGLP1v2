#!/bin/bash

# Configuration
REMOTE_USER="parisder"
REMOTE_HOST="app.ourglp1.com"
REMOTE_DIR="/var/www/Paris-Clinic/GLP1/frontend/build"
LOCAL_BUILD_DIR="./dist"

echo "🚧 Building React app..."
npm run build || { echo "❌ Build failed"; exit 1; }

echo "📦 Uploading build files to server..."
rsync -avz --no-times --no-perms --delete "$LOCAL_BUILD_DIR/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR" || { echo "❌ Upload failed"; exit 1; }

echo "🔄 Reloading Nginx on server..."
ssh "$REMOTE_USER@$REMOTE_HOST" "sudo systemctl reload nginx" || { echo "❌ Nginx reload failed"; exit 1; }

echo "✅ Deployment complete!"
