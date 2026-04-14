#!/usr/bin/env bash
set -euo pipefail
if ! command -v cron &>/dev/null; then
  sudo apt-get install -y cron
fi
if ! crontab -l 2>/dev/null | grep -q "backup-artifacts"; then
  (crontab -l 2>/dev/null; printf '@reboot sleep 10 && bash /workspaces/CBLAeroApp/scripts/backup-artifacts.sh >> /tmp/backup.log 2>&1\n0 * * * * bash /workspaces/CBLAeroApp/scripts/backup-artifacts.sh >> /tmp/backup.log 2>&1\n') | crontab -
fi
sudo service cron start 2>/dev/null || true
echo "✅ cron ready"
