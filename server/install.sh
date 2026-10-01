#!/usr/bin/env bash
# MediaLedger web server installer for Raspberry Pi OS (64-bit) and other Debian-family systems.
#
#   sudo bash install.sh              install or upgrade to the latest release
#   sudo bash install.sh --branch=main  track main instead of the latest release
#   sudo bash install.sh --https        also create a self-signed certificate (serves TLS)
#   sudo bash install.sh --port=80 --domain=medialedger.home
#                                       serve on the default web port under your own internal name (see docs/RASPBERRY-PI.md, Custom domain)
#   sudo bash install.sh --update-only  used by medialedger-update
#   sudo bash install.sh --setup        the guided setup again: connect shares, set the password (also: sudo medialedger-setup)
#   sudo bash install.sh --share=//nas/Share
#                                       mount one share at /mnt/media without being asked (how installs before 2.4 worked)
#
# What it does, idempotently:
#   1. installs Node 22 (NodeSource), ffmpeg, cifs-utils, smbclient, curl, openssl
#   2. creates the `medialedger` system user and /var/lib/medialedger
#   3. downloads the verified server-only release package into /opt/medialedger (--branch=<git branch> for development)
#   4. asks for the file server's address and sign-in, lists its shares, and mounts the ones you pick under /mnt/medialedger/
#      (the same thing the web app's "Connect a network share" does; an install that already has /mnt/media keeps it)
#   5. installs a systemd service on port 8080, a one-minute mount watchdog timer, the share helper, a sign-in banner,
#      and the `medialedger` / `medialedger-update` / `medialedger-setup` commands
#   6. asks for the web password if none is set
set -euo pipefail

REPO="https://github.com/AxialForge/medialedger.git"
APP_DIR="/opt/medialedger"
DATA_DIR="/var/lib/medialedger"
SVC_USER="medialedger"
MOUNT="/mnt/media"            # the single share of installs before 2.4; kept when present
SHARE=""
CREDS="/etc/medialedger-cifs.cred"
SHARE_BASE="/mnt/medialedger" # shares connected by the guided setup or from the web app
SHARE_CREDS="/etc/medialedger-shares"
PORT="${MEDIALEDGER_PORT:-8080}"
BRANCH=""
UPDATE_ONLY=0; HTTPS=0; DOMAIN=""; AUTO_UPDATE=0; SETUP_ONLY=0
for a in "$@"; do case "$a" in --setup) SETUP_ONLY=1;; esac; done
for a in "$@"; do case "$a" in --branch=*) BRANCH="${a#--branch=}";; --share=*) SHARE="${a#--share=}";; --port=*) PORT="${a#--port=}"; PORT_SET=1;; --domain=*) DOMAIN="${a#--domain=}";; --update-only) UPDATE_ONLY=1;; --https) HTTPS=1;; --auto-update) AUTO_UPDATE=1;; --no-auto-update) AUTO_UPDATE=-1;; esac; done
[[ -n "$DOMAIN" ]] && echo "$DOMAIN" > /etc/medialedger-domain 2>/dev/null || true
[[ -z "$DOMAIN" && -f /etc/medialedger-domain ]] && DOMAIN="$(cat /etc/medialedger-domain)"

[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
# Questions are asked on the terminal even when the script itself arrives on a pipe.
TTY=""; if [[ -t 0 ]]; then TTY=/dev/stdin; elif [[ -r /dev/tty ]] && (: </dev/tty) 2>/dev/null; then TTY=/dev/tty; fi
ask() { local __v; read -r -p "$1" __v <"$TTY" || __v=""; printf -v "$2" '%s' "$__v"; }
ask_secret() { local __v; read -r -s -p "$1" __v <"$TTY" || __v=""; echo; printf -v "$2" '%s' "$__v"; }
# An admin account exists when web.json has a user with role admin (1.1+) or the pre-1.1 passwordHash (migrated on first start).
has_admin() { node -e "const s=require(process.argv[1]);process.exit((s.passwordHash||Object.values(s.users||{}).some(u=>u.role==='admin'))?0:1)" "$DATA_DIR/web.json" 2>/dev/null; }

# ---- guided setup: which file server, which shares ------------------------------------------------------------
# One share through the root helper, exactly as the web app asks for it. Values travel in the environment, never
# through a command line or a shell string.
connect_share() { # host share user pass -> prints the mount point
  local id file out; id="$(head -c8 /dev/urandom | od -An -tx1 | tr -d ' \n')"; file="$DATA_DIR/shares/request-$id.json"; out="$DATA_DIR/shares/result-$id.json"
  ML_HOST="$1" ML_SHARE="$2" ML_USER="$3" ML_PASS="$4" ML_FILE="$file" node -e "
    const h=require('$APP_DIR/server/share-helper.js'),e=process.env;
    require('fs').writeFileSync(e.ML_FILE, JSON.stringify({op:'add',name:h.mountName(e.ML_SHARE),host:e.ML_HOST,share:e.ML_SHARE,user:e.ML_USER,pass:e.ML_PASS}),{mode:0o600});"
  chown "$SVC_USER:$SVC_USER" "$file"
  node "$APP_DIR/server/share-helper.js" --dir="$DATA_DIR/shares" --owner="$SVC_USER" >/dev/null
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));require('fs').unlinkSync(process.argv[1]);if(r.ok){console.log(r.mount)}else{console.error('   '+r.error);process.exit(1)}" "$out"
}
guided_shares() {
  [[ -n "$TTY" ]] || { echo "No terminal to ask on: connect the shares later with 'sudo medialedger-setup' or in the web app (Settings, Library, Connect a network share)."; return 0; }
  cat <<'TXT'
MediaLedger reads your media from a file server on your network (a NAS, or a PC that shares folders).
You need three things: the server's address, and a username and password that may read the media.
TXT
  local host user pass pick n i found=() chosen=() mnt
  while true; do
    echo; ask "Address of the file server, for example 192.168.1.50 (Enter to skip and do it later in the browser): " host
    [[ -n "$host" ]] || { echo "Skipped. In the web app: Settings, Library, Connect a network share. Or here: sudo medialedger-setup"; return 0; }
    ask "Username on $host: " user
    ask_secret "Password: " pass
    mapfile -t found < <(USER="$user" PASSWD="$pass" LC_ALL=C smbclient -g -m SMB3 -L "//$host" -U "$user" 2>/dev/null | awk -F'|' '$1=="Disk" && $2 !~ /\$$/ {print $2}') || true
    if [[ ${#found[@]} -eq 0 ]]; then echo "   $host gave no shares back. Check the address, the username and the password, and that file sharing (SMB) is on."; continue; fi
    echo; echo "Shares on $host:"
    for i in "${!found[@]}"; do printf '   %2d) %s\n' "$((i + 1))" "${found[$i]}"; done
    ask "Which ones hold your media? Numbers separated by spaces, or 'all': " pick
    chosen=(); if [[ "$pick" == "all" ]]; then chosen=("${found[@]}"); else for n in $pick; do [[ "$n" =~ ^[0-9]+$ ]] && (( n >= 1 && n <= ${#found[@]} )) && chosen+=("${found[$((n - 1))]}"); done; fi
    [[ ${#chosen[@]} -gt 0 ]] || { echo "   Nothing picked."; continue; }
    for n in "${chosen[@]}"; do
      if mnt="$(connect_share "$host" "$n" "$user" "$pass")"; then echo "   connected: $n  ->  $mnt   ($(ls "$mnt" 2>/dev/null | head -6 | tr '\n' ' '))"; else echo "   could not connect $n"; fi
    done
    ask "Connect shares from another server too? [y/N] " pick; [[ "$pick" =~ ^[Yy] ]] || break
  done
}
addresses() { # the ways to open the site, best first
  local ip proto=http sfx; ip="$(hostname -I | awk '{print $1}')"; [[ -f "$DATA_DIR/tls/cert.pem" ]] && proto=https
  sfx=":$PORT"; { [[ $proto == http && $PORT == 80 ]] || [[ $proto == https && $PORT == 443 ]]; } && sfx=""
  echo "${DOMAIN:+$proto://$DOMAIN$sfx  or  }$proto://$(hostname).local$sfx  or  $proto://$ip$sfx"
}
finish() {
  if ! has_admin; then
    say "Web password"
    echo "This is the password for the account 'admin' on the MediaLedger site (at least 8 characters)."
    /usr/local/bin/medialedger --set-password
  fi
  systemctl restart medialedger; sleep 2
  systemctl --no-pager --lines=3 status medialedger || true
  say "MediaLedger is running"
  local ML_SHARES; ML_SHARES="$(awk '$3=="cifs"{print "    " $2 "   <-   " $1}' /etc/fstab)"; [[ -n "$ML_SHARES" ]] || ML_SHARES="    none yet: sudo medialedger-setup, or in the web app under Settings, Library"
  cat <<TXT
  Open it in a browser:   $(addresses)
  Sign in as:             admin   (the password you just chose)

  The site opens a short guide on first use: it finds the folders for TV, Anime and Movies on the
  shares you connected, checks they can be read, and starts the first scan.

  Shares connected:
$ML_SHARES
  Useful commands:
    sudo medialedger-setup            this guide again (more shares, password)
    sudo medialedger-update           install the latest release
    sudo medialedger --set-password   reset the admin password
    journalctl -u medialedger -f      watch the log
TXT
  [[ -n "$DOMAIN" ]] && echo "  Remember: $DOMAIN must point at $(hostname -I | awk '{print $1}') in your router's local DNS (UniFi: Settings, Routing, DNS, Create Entry, A record)."
  return 0
}

if [[ $SETUP_ONLY -eq 1 ]]; then
  [[ -f "$APP_DIR/server/share-helper.js" && -f /etc/systemd/system/medialedger-share.path ]] || { echo "MediaLedger 2.4 or later is not installed yet. Run: sudo bash install.sh"; exit 1; }
  PORT="$(sed -n 's/.*--port=\([0-9]*\).*/\1/p' /etc/systemd/system/medialedger.service | head -1)"; PORT="${PORT:-8080}"
  say "MediaLedger setup"; guided_shares; finish; exit 0
fi

if [[ $UPDATE_ONLY -eq 0 ]]; then
cat <<'TXT'

  MediaLedger for Raspberry Pi: installation
  ------------------------------------------
  This takes about five minutes and asks three things:
    1. where your media lives (the file server's address, a username and a password),
    2. which of its shares to use,
    3. a password for the MediaLedger site.
  Nothing on the file server is changed. Running this again later is safe: it upgrades and keeps your data.
TXT
fi

say "Packages"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
fi
apt-get install -y nodejs ffmpeg cifs-utils smbclient curl openssl >/dev/null
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

if [[ $UPDATE_ONLY -eq 1 ]]; then
  # A --port with --update-only rewrites just the ExecStart line so the service moves without a full reinstall.
  if [[ -n "${PORT_SET:-}" && -f /etc/systemd/system/medialedger.service ]]; then sed -i "s|--port=[0-9]*|--port=$PORT|" /etc/systemd/system/medialedger.service; systemctl daemon-reload; echo "Service port set to $PORT"; fi
  systemctl restart medialedger; echo "MediaLedger updated to $(node -p "require('$APP_DIR/package.json').version")"
  [[ -f /etc/systemd/system/medialedger-share.path ]] || echo "New in 2.4: connect network shares from the web app. Run once to add it:  sudo bash $APP_DIR/server/install.sh"
  exit 0
fi

say "Network shares"
UID_N="$(id -u "$SVC_USER")"; GID_N="$(id -g "$SVC_USER")"
install -d -m 0755 "$SHARE_BASE"; install -d -m 0700 "$SHARE_CREDS"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 0700 "$DATA_DIR/shares"
# The share helper: the web service drops a request file, systemd starts the helper as root (see server/share-helper.js).
cat > /etc/systemd/system/medialedger-share.path <<EOF
[Unit]
Description=Watch for MediaLedger share requests

[Path]
PathExistsGlob=$DATA_DIR/shares/request-*.json

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/medialedger-share.service <<EOF
[Unit]
Description=Connect or remove a network share for MediaLedger

[Service]
Type=oneshot
ExecStart=/usr/bin/node $APP_DIR/server/share-helper.js --dir=$DATA_DIR/shares --owner=$SVC_USER
EOF
systemctl daemon-reload
systemctl enable -q --now medialedger-share.path

if [[ -n "$SHARE" || -f "$CREDS" ]] || grep -qF " $MOUNT cifs " /etc/fstab; then
  # The single share at /mnt/media: given with --share=, or already there from an install before 2.4.
  [[ -n "$SHARE" ]] || SHARE="$(awk -v m="$MOUNT" '$2==m && $3=="cifs"{print $1}' /etc/fstab | head -1)"
  if [[ -n "$SHARE" ]]; then
    install -d "$MOUNT"
    if [[ ! -f "$CREDS" ]]; then
      [[ -n "$TTY" ]] || { echo "No terminal to ask for the share password on."; exit 1; }
      ask "Share username for $SHARE: " SU
      ask_secret "Share password: " SP
      (umask 077; printf 'username=%s\npassword=%s\n' "$SU" "$SP" > "$CREDS"); chmod 600 "$CREDS"
    fi
    FSTAB_LINE="$SHARE $MOUNT cifs credentials=$CREDS,uid=$UID_N,gid=$GID_N,file_mode=0664,dir_mode=0775,vers=3.0,iocharset=utf8,_netdev,nofail,x-systemd.automount 0 0"
    if grep -qF " $MOUNT cifs " /etc/fstab; then sed -i "\| $MOUNT cifs |c\\$FSTAB_LINE" /etc/fstab; else echo "$FSTAB_LINE" >> /etc/fstab; fi
    systemctl daemon-reload
    mountpoint -q "$MOUNT" && umount "$MOUNT" || true
    mount "$MOUNT" && echo "mounted: $(ls "$MOUNT" | tr '\n' ' ')" || { echo "Mount failed. Check $CREDS and: dmesg | tail"; exit 1; }
  fi
elif grep -qE "^[^#]+ $SHARE_BASE/[^ ]+ cifs " /etc/fstab; then
  echo "already connected:"; awk '$3=="cifs"{print "  " $2 "  <-  " $1}' /etc/fstab
else
  guided_shares
fi

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
cat > /usr/local/bin/medialedger-setup <<EOF
#!/usr/bin/env bash
# The guided setup again: connect more shares, set the admin password, show the addresses.
[[ \$EUID -eq 0 ]] || { echo "Run with sudo: sudo medialedger-setup"; exit 1; }
exec bash $APP_DIR/server/install.sh --setup "\$@"
EOF
chmod 755 /usr/local/bin/medialedger /usr/local/bin/medialedger-update /usr/local/bin/medialedger-setup
# A few lines at sign-in (SSH or console): is it running, where is it, what is connected, what to type.
cat > /etc/profile.d/medialedger-welcome.sh <<EOF
# MediaLedger: status at sign-in. Remove this file to silence it.
case \$- in *i*) ;; *) return 0 2>/dev/null || exit 0;; esac
if command -v systemctl >/dev/null 2>&1 && [ -f /etc/systemd/system/medialedger.service ]; then
  _ml_state="\$(systemctl is-active medialedger 2>/dev/null)"; _ml_ver="\$(sed -n 's/.*"version": *"\\([^"]*\\)".*/\\1/p' $APP_DIR/package.json 2>/dev/null | head -1)"
  printf '\\n  MediaLedger %s: %s    http://%s:$PORT\\n' "\$_ml_ver" "\$_ml_state" "\$(hostname -I 2>/dev/null | awk '{print \$1}')"
  awk '\$3=="cifs"{print \$2}' /etc/fstab 2>/dev/null | while read -r _m; do
    if [ "\$(findmnt -n -o FSTYPE --target "\$_m" 2>/dev/null)" = "cifs" ]; then printf '    share %-38s connected\\n' "\$_m"; else printf '    share %-38s NOT CONNECTED\\n' "\$_m"; fi
  done
  grep -q ' cifs ' /etc/fstab 2>/dev/null || printf '    No network share is connected yet. Run: sudo medialedger-setup\\n'
  printf '  Setup guide: sudo medialedger-setup    Update: sudo medialedger-update    Log: journalctl -u medialedger -f\\n\\n'
  unset _ml_state _ml_ver
fi
EOF
chmod 644 /etc/profile.d/medialedger-welcome.sh

# Optional: update every night at 04:30 (sudo bash install.sh --auto-update; --no-auto-update removes it).
if [[ $AUTO_UPDATE -eq 1 ]]; then
cat > /etc/systemd/system/medialedger-update.service <<EOF
[Unit]
Description=Update MediaLedger to the latest release
[Service]
Type=oneshot
ExecStart=/usr/local/bin/medialedger-update
EOF
cat > /etc/systemd/system/medialedger-update.timer <<EOF
[Unit]
Description=Nightly MediaLedger update
[Timer]
OnCalendar=*-*-* 04:30:00
RandomizedDelaySec=900
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload; systemctl enable --now medialedger-update.timer >/dev/null; echo "Nightly auto-update enabled (04:30)."
elif [[ $AUTO_UPDATE -eq -1 ]]; then
systemctl disable --now medialedger-update.timer >/dev/null 2>&1 || true; rm -f /etc/systemd/system/medialedger-update.timer /etc/systemd/system/medialedger-update.service; systemctl daemon-reload; echo "Nightly auto-update removed."
fi

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
cat > /usr/local/sbin/medialedger-mount-check <<'EOF'
#!/usr/bin/env bash
# Re-mount every MediaLedger share that is not mounted while its server answers. Runs from medialedger-mount.timer every minute.
awk '$3=="cifs" && $4 ~ /credentials=\/etc\/medialedger/ {print $1 "\t" $2}' /etc/fstab | while IFS=$'\t' read -r SRC MNT; do
  MNT="$(printf '%b' "$MNT")"
  # With x-systemd.automount the armed trap already counts as a mountpoint, so ask for the filesystem type instead.
  [[ "$(findmnt -n -o FSTYPE --target "$MNT" 2>/dev/null)" == "cifs" ]] && continue
  # Touching the folder lets the automount try first; only mount by hand if that did not do it.
  ls "$MNT" >/dev/null 2>&1; [[ "$(findmnt -n -o FSTYPE --target "$MNT" 2>/dev/null)" == "cifs" ]] && continue
  HOST="$(printf '%s' "$SRC" | sed -E 's#^//([^/]+)/.*#\1#')"
  if [[ -n "$HOST" ]] && ! timeout 3 bash -c "exec 3<>/dev/tcp/$HOST/445" 2>/dev/null; then continue; fi
  mount "$MNT" && logger -t medialedger "re-mounted $MNT"
done
exit 0
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

finish
