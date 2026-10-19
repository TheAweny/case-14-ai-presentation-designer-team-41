#!/bin/bash
# I install the reviewed receiver as root; CI cannot replace these files.
set -euo pipefail
if [ "$EUID" -ne 0 ] || [ "$#" -ne 1 ]; then
  echo 'Usage: sudo bash infra/deploy/install.sh /path/to/cd-public-key' >&2
  exit 1
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install -d -m 755 /usr/local/lib/lct
install -m 755 "$script_dir/deploy.py" /usr/local/lib/lct/deploy.py
install -m 644 "$script_dir/compose.yaml" /usr/local/lib/lct/compose.yaml
install -m 644 "$script_dir/compose.docs.yaml" /usr/local/lib/lct/compose.docs.yaml
install -m 644 "$script_dir/../searxng/settings.yml" /usr/local/lib/lct/search.yml
install -m 644 "$script_dir/lct-backup.service" /etc/systemd/system/lct-backup.service
install -m 644 "$script_dir/lct-backup.timer" /etc/systemd/system/lct-backup.timer
systemctl daemon-reload
systemctl enable --now lct-backup.timer
key="$(cat "$1")"
if [[ ! "$key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]]; then
  echo 'Expected an ed25519 public key' >&2
  exit 1
fi
printf 'restrict,command="sudo -n /usr/local/lib/lct/deploy.py" %s\n' "$key" \
  > /home/lct-deploy/.ssh/authorized_keys
chown root:root /home/lct-deploy/.ssh/authorized_keys
chmod 600 /home/lct-deploy/.ssh/authorized_keys
# I keep the entire SSH directory root-owned so the deploy user cannot replace its forced command.
chown root:root /home/lct-deploy /home/lct-deploy/.ssh
chmod 755 /home/lct-deploy
chmod 755 /home/lct-deploy/.ssh
chmod 644 /home/lct-deploy/.ssh/authorized_keys
printf 'lct-deploy ALL=(root) NOPASSWD: /usr/local/lib/lct/deploy.py ""\n' \
  > /etc/sudoers.d/lct-deploy
chmod 440 /etc/sudoers.d/lct-deploy
visudo -cf /etc/sudoers.d/lct-deploy
