#!/usr/bin/env bash
set -euo pipefail

if ! command -v crontab &>/dev/null; then
  echo "▶ Installing cron..."
  sudo apt-get update -qq
  sudo apt-get install -y cron
fi

if ! crontab -l 2>/dev/null | grep -q "backup-artifacts"; then
  echo "▶ Configuring crontab..."
  (crontab -l 2>/dev/null; printf '@reboot sleep 10 && bash /workspaces/CBLAeroApp/scripts/backup-artifacts.sh >> /tmp/backup.log 2>&1\n0 * * * * bash /workspaces/CBLAeroApp/scripts/backup-artifacts.sh >> /tmp/backup.log 2>&1\n') | crontab -
fi

sudo service cron start 2>/dev/null || true
echo "✅ cron ready"
