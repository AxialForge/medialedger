#!/usr/bin/env bash
# MediaLedger web server installer for Raspberry Pi OS (64-bit) and other Debian-family systems.
#
#   sudo bash install.sh              install or upgrade to the latest release
#   sudo bash install.sh --branch=main  track main instead of the latest tag
#
# What it does, idempotently:
#   1. installs Node 22 (NodeSource), ffmpeg, cifs-utils, git
#   2. creates the `medialedger` system user and /var/lib/medialedger
#   3. clones or updates /opt/medialedger at the latest release tag
#   4. mounts the NAS share at /mnt/media via fstab (asks once for credentials)
#   5. installs a systemd service on port 8080 and the `medialedger` / `medialedger-update` commands
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
for a in "$@"; do case "$a" in --branch=*) BRANCH="${a#--branch=}";; --share=*) SHARE="${a#--share=}";; --port=*) PORT="${a#--port=}";; esac; done

[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Packages"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
fi
apt-get install -y nodejs ffmpeg cifs-utils git >/dev/null
echo "node $(node -v), $(ffprobe -version | head -1 | cut -d' ' -f1-3)"

say "Service user and data folder"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 0750 "$DATA_DIR"

say "Application at $APP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then git clone -q "$REPO" "$APP_DIR"; fi
git -C "$APP_DIR" fetch -q --tags origin
if [[ -z "$BRANCH" ]]; then
  BRANCH="$(git -C "$APP_DIR" tag -l 'v*' --sort=-v:refname | head -1)"
  [[ -n "$BRANCH" ]] || BRANCH=main
fi
git -C "$APP_DIR" checkout -q "$BRANCH"
[[ "$BRANCH" == v* ]] || git -C "$APP_DIR" pull -q --ff-only origin "$BRANCH" || true
echo "version $(node -p "require('$APP_DIR/package.json').version") ($BRANCH)"
chown -R root:root "$APP_DIR"

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
exec sudo -u $SVC_USER MEDIALEDGER_PASSWORD="\${MEDIALEDGER_PASSWORD:-}" /usr/bin/node $APP_DIR/src/server/server.js --data=$DATA_DIR --port=$PORT "\$@"
EOF
cat > /usr/local/bin/medialedger-update <<EOF
#!/usr/bin/env bash
# Pull the latest release tag and restart the service.
set -e
git -C $APP_DIR fetch -q --tags origin
T="\$(git -C $APP_DIR tag -l 'v*' --sort=-v:refname | head -1)"
git -C $APP_DIR checkout -q "\$T"
systemctl restart medialedger
echo "MediaLedger now at \$T"
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
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q medialedger

if ! grep -q passwordHash "$DATA_DIR/web.json" 2>/dev/null; then
  say "Web password"
  /usr/local/bin/medialedger --set-password
fi

systemctl restart medialedger
sleep 2
systemctl --no-pager --lines=3 status medialedger || true
IP="$(hostname -I | awk '{print $1}')"
say "Done. Open http://$(hostname).local:$PORT  or  http://$IP:$PORT"
echo "Logs: journalctl -u medialedger -f     Update: sudo medialedger-update     Password: sudo medialedger --set-password"
