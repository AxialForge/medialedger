#!/usr/bin/env bash
# MediaLedger web server installer for Raspberry Pi OS (64-bit) and other Debian-family systems.
#
#   sudo bash install.sh              install or upgrade to the latest release
#   sudo bash install.sh --branch=main  track main instead of the latest release
#   sudo bash install.sh --https        also create a self-signed certificate (serves TLS)
#   sudo bash install.sh --port=80 --domain=medialedger.home
#                                       serve on the default web port under your own internal name (see docs/RASPBERRY-PI.md, Custom domain)
#   sudo bash install.sh --update-only  used by medialedger-update
#
# What it does, idempotently:
#   1. installs Node 22 (NodeSource), ffmpeg, cifs-utils, curl, openssl
#   2. creates the `medialedger` system user and /var/lib/medialedger
#   3. downloads the verified server-only release package into /opt/medialedger (--branch=<git branch> for development)
#   4. mounts the NAS share at /mnt/media via fstab (asks once for credentials)
#   5. installs a systemd service on port 8080, a one-minute mount watchdog timer, and the `medialedger` / `medialedger-update` commands
#   6. asks for the web password if none is set
set -euo pipefail

REPO="https://github.com/AxialForge/medialedger.git"
APP_DIR="/opt/medialedger"
DATA_DIR="/var/lib/medialedger"
SVC_USER="medialedger"
MOUNT="/mnt/media"
SHARE="//192.168.1.204/Apocrypha_Media_Pool"
CREDS="/etc/medialedger-cifs.cred"
PORT="${MEDIALEDGER_PORT:-8080}"
BRANCH=""
UPDATE_ONLY=0; HTTPS=0; DOMAIN=""
for a in "$@"; do case "$a" in --branch=*) BRANCH="${a#--branch=}";; --share=*) SHARE="${a#--share=}";; --port=*) PORT="${a#--port=}";; --domain=*) DOMAIN="${a#--domain=}";; --update-only) UPDATE_ONLY=1;; --https) HTTPS=1;; esac; done
[[ -n "$DOMAIN" ]] && echo "$DOMAIN" > /etc/medialedger-domain 2>/dev/null || true
[[ -z "$DOMAIN" && -f /etc/medialedger-domain ]] && DOMAIN="$(cat /etc/medialedger-domain)"

[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Packages"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
fi
apt-get install -y nodejs ffmpeg cifs-utils curl openssl >/dev/null
echo "node $(node -v), $(ffprobe -version | head -1 | cut -d' ' -f1-3)"

say "Service user and data folder"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 0750 "$DATA_DIR"
# video group: lets the service read the firmware throttling flags and core voltage (vcgencmd) for the System tab
getent group video >/dev/null && usermod -aG video "$SVC_USER"

say "Application at $APP_DIR"
# fetch_release: download the server-only package from the latest GitHub Release, verify SHA-256, swap into APP_DIR.
fetch_release() {
  local base="https://github.com/AxialForge/medialedger/releases/latest/download" tmp; tmp="$(mktemp -d)"
  curl -fsSL "$base/medialedger-server.tar.gz" -o "$tmp/pkg.tar.gz"
  curl -fsSL "$base/medialedger-server.tar.gz.sha256" -o "$tmp/pkg.sha256"
  (cd "$tmp" && sed 's/medialedger-server.tar.gz/pkg.tar.gz/' pkg.sha256 | sha256sum -c --quiet -) || { echo "Checksum mismatch; refusing to install."; rm -rf "$tmp"; exit 1; }
  tar -xzf "$tmp/pkg.tar.gz" -C "$tmp"
  rm -rf "$APP_DIR.new"; mv "$tmp/medialedger-server" "$APP_DIR.new"; rm -rf "$tmp"
  rm -rf "$APP_DIR.old"; [[ -d "$APP_DIR" ]] && mv "$APP_DIR" "$APP_DIR.old"; mv "$APP_DIR.new" "$APP_DIR"; rm -rf "$APP_DIR.old"
}
if [[ -n "$BRANCH" ]]; then
  # Developer path: track a git branch instead of releases.
  if [[ ! -d "$APP_DIR/.git" ]]; then rm -rf "$APP_DIR"; git clone -q "$REPO" "$APP_DIR"; fi
  git -C "$APP_DIR" fetch -q origin && git -C "$APP_DIR" checkout -q "$BRANCH" && git -C "$APP_DIR" pull -q --ff-only origin "$BRANCH" || true
else
  fetch_release
fi
echo "version $(node -p "require('$APP_DIR/package.json').version")${BRANCH:+ ($BRANCH)}"
chown -R root:root "$APP_DIR"

if [[ $UPDATE_ONLY -eq 1 ]]; then systemctl restart medialedger; echo "MediaLedger updated to $(node -p "require('$APP_DIR/package.json').version")"; exit 0; fi

say "NAS share at $MOUNT"
install -d "$MOUNT"
if [[ ! -f "$CREDS" ]]; then
  read -r -p "Share username for $SHARE: " SU
  read -r -s -p "Share password: " SP; echo
  umask 077; printf 'username=%s\npassword=%s\n' "$SU" "$SP" > "$CREDS"; chmod 600 "$CREDS"
fi
UID_N="$(id -u "$SVC_USER")"; GID_N="$(id -g "$SVC_USER")"
FSTAB_LINE="$SHARE $MOUNT cifs credentials=$CREDS,uid=$UID_N,gid=$GID_N,file_mode=0664,dir_mode=0775,vers=3.0,iocharset=utf8,_netdev,nofail,x-systemd.automount 0 0"
if grep -qF " $MOUNT cifs " /etc/fstab; then sed -i "\| $MOUNT cifs |c\\$FSTAB_LINE" /etc/fstab; else echo "$FSTAB_LINE" >> /etc/fstab; fi
systemctl daemon-reload
mountpoint -q "$MOUNT" && umount "$MOUNT" || true
mount "$MOUNT" && echo "mounted: $(ls "$MOUNT" | tr '\n' ' ')" || { echo "Mount failed. Check $CREDS and: dmesg | tail"; exit 1; }

say "Commands and service"
cat > /usr/local/bin/medialedger <<EOF
#!/usr/bin/env bash
# medialedger --set-password   (or any server flag); runs as the service user against its data folder
exec sudo -u $SVC_USER MEDIALEDGER_PASSWORD="\${MEDIALEDGER_PASSWORD:-}" NODE_OPTIONS=--disable-warning=ExperimentalWarning /usr/bin/node $APP_DIR/src/server/server.js --data=$DATA_DIR --port=$PORT "\$@"
EOF
cat > /usr/local/bin/medialedger-update <<EOF
#!/usr/bin/env bash
# Install the latest release package (verified) and restart the service. Data in $DATA_DIR is untouched.
set -e
if [[ -d $APP_DIR/.git ]]; then git -C $APP_DIR pull -q --ff-only; else
  curl -fsSL https://raw.githubusercontent.com/AxialForge/medialedger/main/server/install.sh -o /tmp/ml-install.sh && bash /tmp/ml-install.sh --update-only; exit \$?
fi
systemctl restart medialedger
echo "MediaLedger now at \$(node -p "require('$APP_DIR/package.json').version")"
EOF
chmod 755 /usr/local/bin/medialedger /usr/local/bin/medialedger-update

cat > /etc/systemd/system/medialedger.service <<EOF
[Unit]
Description=MediaLedger web server
After=network-online.target remote-fs.target
Wants=network-online.target

[Service]
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/src/server/server.js --data=$DATA_DIR --port=$PORT
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--disable-warning=ExperimentalWarning
# Lets the unprivileged service listen on port 80/443 when installed with --port=80 (no root, no capabilities beyond this one).
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
# Mount watchdog: the service has no privileges, so a root timer re-mounts the share if it drops (NAS reboot, Pi moved, network blip).
cat > /usr/local/sbin/medialedger-mount-check <<EOF
#!/usr/bin/env bash
# Re-mount $MOUNT if it is not mounted and the NAS answers. Runs from medialedger-mount.timer every minute.
mountpoint -q "$MOUNT" && exit 0
HOST="\$(awk '\$2=="$MOUNT"{print \$1}' /etc/fstab | sed -E 's#^//([^/]+)/.*#\\1#')"
if [[ -n "\$HOST" ]] && ! timeout 3 bash -c "exec 3<>/dev/tcp/\$HOST/445" 2>/dev/null; then exit 0; fi
mount "$MOUNT" && logger -t medialedger "re-mounted $MOUNT"
EOF
chmod 755 /usr/local/sbin/medialedger-mount-check
cat > /etc/systemd/system/medialedger-mount.service <<EOF
[Unit]
Description=Re-mount the MediaLedger share if it dropped
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/medialedger-mount-check
EOF
cat > /etc/systemd/system/medialedger-mount.timer <<EOF
[Unit]
Description=Check the MediaLedger share mount every minute

[Timer]
OnBootSec=45s
OnUnitActiveSec=60s
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable -q medialedger
systemctl enable -q --now medialedger-mount.timer

if [[ $HTTPS -eq 1 && ! -f "$DATA_DIR/tls/cert.pem" ]]; then
  say "Self-signed certificate"
  install -d -o "$SVC_USER" -g "$SVC_USER" -m 0700 "$DATA_DIR/tls"
  SAN="DNS:$(hostname).local,IP:$(hostname -I | awk '{print $1}')"; [[ -n "$DOMAIN" ]] && SAN="DNS:$DOMAIN,$SAN"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=${DOMAIN:-$(hostname).local}" -addext "subjectAltName=$SAN" -keyout "$DATA_DIR/tls/key.pem" -out "$DATA_DIR/tls/cert.pem" 2>/dev/null
  chown "$SVC_USER:$SVC_USER" "$DATA_DIR/tls/"*.pem; chmod 600 "$DATA_DIR/tls/"*.pem
fi

if ! grep -q passwordHash "$DATA_DIR/web.json" 2>/dev/null; then
  say "Web password"
  /usr/local/bin/medialedger --set-password
fi

systemctl restart medialedger
sleep 2
systemctl --no-pager --lines=3 status medialedger || true
IP="$(hostname -I | awk '{print $1}')"
PROTO=http; [[ -f "$DATA_DIR/tls/cert.pem" ]] && PROTO=https
PORTSFX=":$PORT"; { [[ $PROTO == http && $PORT == 80 ]] || [[ $PROTO == https && $PORT == 443 ]]; } && PORTSFX=""
say "Done. Open ${DOMAIN:+$PROTO://$DOMAIN$PORTSFX  or  }$PROTO://$(hostname).local$PORTSFX  or  $PROTO://$IP$PORTSFX"
[[ -n "$DOMAIN" ]] && echo "Remember: $DOMAIN must point at $IP in your router's local DNS (UniFi: Settings → Routing → DNS → Create Entry, A record)."
echo "Logs: journalctl -u medialedger -f     Update: sudo medialedger-update     Password: sudo medialedger --set-password"
