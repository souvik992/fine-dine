#!/bin/bash
# Installs (or repairs) the DinePOS Cloud on a fresh Ubuntu 24.04 server (AWS EC2, Oracle, any VPS), in one go:
#   curl -fsSL https://raw.githubusercontent.com/souvik992/fine-dine/main/cloud/hub/deploy/install.sh | sudo bash
# The same as the cloud-init files next to it, for a server that was started without them. Safe to run again: it keeps
# the admin key, the settings and the data, and updates the hub. Ports 80 and 443 must be open to the internet.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Run it with sudo." >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
say() { printf '\n==> %s\n' "$*"; }

say "Packages (git, curl, sqlite3)"
apt-get update -q
apt-get install -y -q git curl sqlite3 debian-keyring debian-archive-keyring apt-transport-https gnupg ca-certificates

if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  say "Node 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -q nodejs
fi

if ! command -v aws >/dev/null && command -v snap >/dev/null; then
  say "AWS CLI (off-server backups to S3)"
  snap install aws-cli --classic || echo "AWS CLI not installed: backups stay on this server."
fi

if ! command -v caddy >/dev/null; then
  say "Caddy (HTTPS)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

say "Settings"
NEW_KEY=""
if [ ! -f /etc/dinepos-cloud.env ]; then
  NEW_KEY=$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')
  cat > /etc/dinepos-cloud.env <<EOF
HUB_ADMIN_KEY=$NEW_KEY
HUB_HOST=127.0.0.1
HUB_PORT=4900
HUB_DATA_DIR=/var/lib/dinepos-cloud
# Set to your own domain (e.g. hub.example.in) once its DNS points at this server, then run dinepos-cloud-domain.
HUB_DOMAIN=
# Off-server backups: an S3 bucket name (the server needs an IAM role that may write to it). Empty: backups stay here.
HUB_S3_BUCKET=
# Alerts (hosted outlet down, backup failed): a Slack, Discord or Google Chat webhook address. Empty: no alerts.
HUB_ALERT_WEBHOOK=
EOF
  chmod 600 /etc/dinepos-cloud.env
fi

cat > /etc/systemd/system/dinepos-cloud.service <<'EOF'
[Unit]
Description=DinePOS Cloud (fine dine)
After=network-online.target
Wants=network-online.target

[Service]
User=dineposcloud
EnvironmentFile=/etc/dinepos-cloud.env
Environment=NODE_ENV=production
WorkingDirectory=/opt/dinepos/cloud/hub
ExecStart=/usr/bin/node src/main.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/dinepos-cloud

[Install]
WantedBy=multi-user.target
EOF

# Points Caddy at HUB_DOMAIN, or <public-ip>.sslip.io when it is empty, and sets HUB_PUBLIC_URL to match.
cat > /usr/local/bin/dinepos-cloud-domain <<'SCRIPT'
#!/bin/bash
set -euo pipefail
. /etc/dinepos-cloud.env
domain="${HUB_DOMAIN:-}"
if [ -z "$domain" ]; then
  ip=$(curl -fsS https://api.ipify.org)
  domain="${ip//./-}.sslip.io"
fi
cat > /etc/caddy/Caddyfile <<EOF
# P6-02: each outlet's device address <store>.$domain gets its own certificate on demand, only for stores the
# cloud knows (it answers /v1/tls-ask).
{
  on_demand_tls {
    ask http://127.0.0.1:4900/v1/tls-ask
  }
}
$domain {
  encode gzip
  reverse_proxy 127.0.0.1:4900 {
    flush_interval -1
  }
}
*.$domain {
  tls {
    on_demand
  }
  encode gzip
  reverse_proxy 127.0.0.1:4900 {
    flush_interval -1
  }
}
EOF
sed -i '/^HUB_PUBLIC_URL=/d' /etc/dinepos-cloud.env
echo "HUB_PUBLIC_URL=https://$domain" >> /etc/dinepos-cloud.env
systemctl restart dinepos-cloud
systemctl reload caddy || systemctl restart caddy
echo "Hub address: https://$domain  (admin page: https://$domain/admin)"
SCRIPT
chmod 755 /usr/local/bin/dinepos-cloud-domain

# Downloads the latest hub from GitHub and restarts it.
cat > /usr/local/bin/dinepos-cloud-update <<'SCRIPT'
#!/bin/bash
set -euo pipefail
git -C /opt/dinepos fetch --depth 1 origin main
git -C /opt/dinepos reset --hard origin/main
git -C /opt/dinepos submodule update --init --depth 1  # vendor/saas-portal: the licensing module
systemctl restart dinepos-cloud
echo "Hub updated to $(git -C /opt/dinepos log -1 --format='%h %s')"
SCRIPT
chmod 755 /usr/local/bin/dinepos-cloud-update

# Daily copy of the hub database, last 14 days kept.
# Every hour: the cloud's database and each hosted outlet's newest backup, kept 14 days here, and copied to S3 when
# HUB_S3_BUCKET is set (deploy/backup.sh in the repository, so updates reach it).
rm -f /etc/cron.daily/dinepos-cloud-backup
cat > /etc/cron.hourly/dinepos-cloud-backup <<'SCRIPT'
#!/bin/bash
exec /bin/bash /opt/dinepos/cloud/hub/deploy/backup.sh
SCRIPT
chmod 755 /etc/cron.hourly/dinepos-cloud-backup

say "The hub"
id dineposcloud >/dev/null 2>&1 || useradd --system --home /var/lib/dinepos-cloud --shell /usr/sbin/nologin dineposcloud
install -d -o dineposcloud -g dineposcloud -m 0750 /var/lib/dinepos-cloud
if [ -d /opt/dinepos/.git ]; then
  git -C /opt/dinepos fetch --depth 1 origin main
  git -C /opt/dinepos reset --hard origin/main
  git -C /opt/dinepos submodule update --init --depth 1  # vendor/saas-portal: the licensing module
else
  git clone --depth 1 --recurse-submodules --shallow-submodules https://github.com/souvik992/fine-dine.git /opt/dinepos
fi
systemctl daemon-reload
systemctl enable dinepos-cloud
systemctl enable caddy

say "Address and HTTPS"
/usr/local/bin/dinepos-cloud-domain
sleep 2
if systemctl is-active --quiet dinepos-cloud; then echo "The hub is running."; else echo "The hub did not start: see journalctl -u dinepos-cloud -n 50"; fi

if [ -n "$NEW_KEY" ]; then
  printf '\n  Admin key (save it now; it is also in /etc/dinepos-cloud.env):\n    %s\n' "$NEW_KEY"
else
  printf '\n  Admin key: unchanged (sudo grep HUB_ADMIN_KEY /etc/dinepos-cloud.env shows it).\n'
fi
printf '  The first visit to the admin page can take a minute while the HTTPS certificate is made.\n\n'
