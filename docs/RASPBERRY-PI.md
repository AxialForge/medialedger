# MediaLedger on a Raspberry Pi

MediaLedger runs as a small always-on website on a Raspberry Pi and does
everything the Windows desktop app does: it inventories the Plex share with
ffprobe, tracks changes between scans, keeps your manual fixes, exports CSVs,
reviews duplicates and quality, drives the movie naming engine, talks to Plex,
and now also watches the Pi's own health. You open it from any browser on your
LAN. Nothing leaves the LAN unless you turn that on yourself.

This guide is the complete procedure, from an empty microSD card to a running,
locked-down service, followed by daily use, updating, security, moving your
desktop database over, and troubleshooting.

---

## Requirements at a glance

| | |
|---|---|
| Board | Raspberry Pi 4B or 5 recommended; Pi 3 works on 64-bit OS but scans slowly |
| OS | **Raspberry Pi OS Lite (64-bit)**, Trixie or newer. 32-bit is not supported |
| Card | 32 GB A2 microSD or a USB SSD |
| Network | Ethernet to the same LAN as the NAS |
| Installed by the script | Node 22 (NodeSource), ffmpeg, cifs-utils, curl, openssl |
| You need to know | the NAS share username and password; a web password of your choosing (8+ characters) |
| Ports | 8080 on the Pi, LAN only |

## The whole thing in four commands

On your PC, after flashing the card with SSH enabled:

```bash
ssh medialedger.local
```

On the Pi:

```bash
curl -fsSL https://raw.githubusercontent.com/AxialForge/medialedger/main/server/install.sh -o install.sh && sudo bash install.sh
```

Answer the share username, share password and web password prompts. Then open
`http://medialedger.local:8080`, sign in, set the roots under Settings, press
Scan now. Later:

```bash
sudo medialedger-update
```

```bash
sudo medialedger --set-password
```

## Command reference

| Command (on the Pi) | Does |
|---|---|
| `sudo medialedger-update` | download, verify and install the newest release, restart. Data untouched |
| `sudo medialedger --set-password` | set or reset the web password; signs everyone out |
| `systemctl status medialedger` | running? since when? last log lines |
| `journalctl -u medialedger -f` | follow the log live |
| `journalctl -u medialedger -n 50 --no-pager` | last 50 log lines |
| `sudo systemctl restart medialedger` | restart (also `stop`, `start`) |
| `ls /mnt/media` | is the share mounted |
| `sudo mount /mnt/media` | re-mount after a NAS reboot |
| `sudo rm /etc/medialedger-cifs.cred` + rerun installer | change share credentials |
| `sudo bash install.sh` | rerun: repairs service, mount and commands, keeps data |
| `sudo bash install.sh --https` | add a self-signed certificate and serve HTTPS |
| `vcgencmd measure_temp` | chip temperature from the shell |

Everything below is the long form.

---

## 1. Hardware

| Part | Minimum | Recommended |
|---|---|---|
| Board | Raspberry Pi 3 (64-bit OS) | **Raspberry Pi 4B or 5**, any RAM size |
| Storage | 16 GB microSD, A1 class | 32 GB **A2** microSD, or a USB SSD |
| Network | Wi-Fi | **Ethernet**. Scan speed is network-bound |
| Power | The official supply for the board | Same. Under-voltage shows up on the System tab |

The Pi 4B has gigabit Ethernet, so the first full scan runs at close to PC
speed. A Pi 3 has 100 Mbit Ethernet and its first scan of a 25,000-file library
takes hours instead of half an hour. Incremental rescans stay fast on every
board because they only stat files.

A cheap card wears out under the scan log and database writes. If you have a
USB SSD, boot from it.

## 2. Operating system

Install **Raspberry Pi OS Lite (64-bit)**, the Trixie release or newer, with
Raspberry Pi Imager:

1. Choose device → your board.
2. Choose OS → **Raspberry Pi OS (other)** → **Raspberry Pi OS Lite (64-bit)**.
   Lite has no desktop, which you will never see anyway. 64-bit is required:
   Node 22's built-in SQLite has proper arm64 builds and no 32-bit ones.
3. Choose storage → your card or SSD.
4. In the customisation step:
   - **General**: hostname `medialedger`, your username and password, time zone,
     Wi-Fi only if you are not using Ethernet.
   - **Services**: enable SSH.
5. Write, boot the Pi, wait a minute, then from your PC:

```bash
ssh medialedger.local
```

Confirm it is 64-bit and note the address:

```bash
uname -m; hostname -I
```

You want `aarch64` on the first line.

## 3. Install

One command. Run it on the Pi:

```bash
curl -fsSL https://raw.githubusercontent.com/AxialForge/medialedger/main/server/install.sh -o install.sh && sudo bash install.sh
```

The installer is idempotent, so you can rerun it any time. It:

1. installs Node 22 from NodeSource, ffmpeg, cifs-utils and curl;
2. creates a `medialedger` system user with no shell and `/var/lib/medialedger`
   as its data folder;
3. downloads the latest **server-only release package** from GitHub Releases
   (`medialedger-server.tar.gz`), verifies its SHA-256 and unpacks it to
   `/opt/medialedger`. This package contains only the core, the web UI and the
   server. It has no Electron, no Windows installer and no dependencies;
4. asks once for the **NAS share username and password**, stores them in
   `/etc/medialedger-cifs.cred` (root-only) and mounts
   `//192.168.1.204/Apocrypha_Media_Pool` at `/mnt/media` through fstab, so the
   mount returns after reboots;
5. installs a hardened systemd service on port 8080 and the commands
   `medialedger` and `medialedger-update`;
6. asks for the **web password** (at least 8 characters) if none is set yet.

At the end it prints the address. Open it from your PC:

```
http://medialedger.local:8080
```

or `http://192.168.1.203:8080` with the address from step 2 if `.local` names
do not resolve on your network.

Options: `--share=//host/share` to use a different share, `--port=9000` for a
different port, `--branch=main` to run from the git main branch instead of a
release.

## 4. First run

1. Sign in with the web password.
2. Open **Settings**. The roots default to `/mnt/media/Movies`,
   `/mnt/media/Anime` and `/mnt/media/TV_Shows`. Add the web videos root
   (`/mnt/media/Web_Shos`) and the adult root
   (`/mnt/media/Plex_Media/Adult Anime`) if you use them. Paths are typed, not
   browsed, because a browser cannot open a folder picker on the server.
3. Press **Scan now**. The Pi has its own empty database, so this first scan
   probes every file. Close the browser if you like; the scan continues on the
   Pi and the sidebar shows progress when you come back.
4. When it finishes, open **System** to see the load the scan put on the board.

Or skip the first full scan entirely by copying your desktop database over;
see section 8.

## 5. Daily use

| Task | How |
|---|---|
| Open the app | `http://medialedger.local:8080` from any browser on the LAN |
| Scheduled scans | Settings → Schedule. The in-app schedule runs on the Pi because the Pi is always on. The Windows Task Scheduler section does nothing here |
| Follow the log | `journalctl -u medialedger -f` |
| Restart the service | `sudo systemctl restart medialedger` |
| Stop / start | `sudo systemctl stop medialedger` / `start` |
| Sign out everywhere | Security tab → Sign out other sessions, or change the password |

Differences from the desktop app: folder paths are typed rather than picked,
"open folder" buttons do nothing in a browser, and updates come from
`medialedger-update` instead of the in-app updater. Everything else is the
same code.

## 6. Updating

```bash
sudo medialedger-update
```

Downloads the newest release package, verifies it, swaps it into
`/opt/medialedger` and restarts the service. Your database and settings live
in `/var/lib/medialedger` and are never touched. Database schema upgrades run
on start with a backup taken first, exactly as on the desktop.

## 7. Security

The web server is built to be safe on a home LAN by default and to let you
tighten it further from the **Security** tab.

**Always on**

- One password, hashed with scrypt, stored in `/var/lib/medialedger/web.json`
  with mode 0600. It is never logged.
- Sessions are HttpOnly, SameSite=Strict cookies that last 30 days. Cookies
  never reach JavaScript, and a page on another site cannot use them.
- The API accepts JSON only, refuses cross-origin requests, and every response
  carries a strict Content-Security-Policy, `X-Frame-Options: DENY`,
  `nosniff` and `no-referrer`.
- After 8 failed sign-ins in 15 minutes from one address, that address is
  locked out for 15 minutes.
- **LAN-only**: connections from outside private address ranges (10/8,
  172.16/12, 192.168/16, link-local, IPv6 ULA) are refused. Do not port-forward
  the Pi; if you need remote access, use a VPN into your LAN (WireGuard,
  Tailscale) and this rule still works.
- **Re-authentication for dangerous actions**: a live movie rename, an undo,
  a TV/anime rename, purging missing files and every change on the Security tab
  ask for the password again unless you entered it within the last 5 minutes.
- Every sign-in, failure, lockout, re-authentication, sensitive action and
  setting change is written to `/var/lib/medialedger/security.log` and shown
  on the Security tab.
- The service runs as the `medialedger` user with no shell, `NoNewPrivileges`,
  `ProtectSystem=full`, `ProtectHome` and a private `/tmp`. It can write only
  to its data folder and the share.

**Accounts and roles**

Sign-in is username + password. The installer's `--set-password` creates or
resets the account named `admin`. From Security → Users an admin adds more:

| Role | Can | Cannot |
|---|---|---|
| admin | everything | |
| standard | see every library and review page, rate titles, file requests, show adult content for their own session, change their own password | settings, system, security, scans, fixes, renames, exports |
| guest (no account) | library statistics and lists, file a request | anything else; adult content is never shown |

Guest access is off by default; turn it on under Security → Options when you
want people on the LAN to browse without an account. Two-factor codes apply to
admin sign-ins only.

**Optional, from the Security tab**

- **Two-factor codes** (TOTP). Press *Set up 2FA*, add the secret to Google
  Authenticator, Aegis, Bitwarden, 1Password or any TOTP app (type the secret
  or paste the `otpauth://` link), enter the 6-digit code to confirm. From then
  on sign-in needs password + code.
- **Idle sign-out**: end sessions after N idle minutes.
- **Change password**: signs out every other session.
- **Sessions**: see every signed-in browser with its address and last activity;
  revoke any of them.

**HTTPS (optional)**

Plain HTTP on a trusted LAN is normal for home services. If you want TLS, give
the server a certificate. A self-signed one takes one command on the Pi:

```bash
sudo mkdir -p /var/lib/medialedger/tls && sudo openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=medialedger.local" -keyout /var/lib/medialedger/tls/key.pem -out /var/lib/medialedger/tls/cert.pem && sudo chown -R medialedger:medialedger /var/lib/medialedger/tls && sudo chmod 600 /var/lib/medialedger/tls/*.pem && sudo systemctl restart medialedger
```

The server switches to `https://medialedger.local:8080` on restart. Browsers
warn once about the self-signed certificate; accept it for this host. The
Security tab shows HTTPS as active and cookies gain the `Secure` flag.

## 7b. Plex webhook

With Plex Pass, Plex can tell MediaLedger about events instead of waiting for
a sync. On the Pi's Settings → Plex → **Webhook**, tick Enabled and copy the
URL (it contains a random key). In Plex Web: Settings → Webhooks → Add
webhook → paste. From then on:

| Plex event | MediaLedger |
|---|---|
| something added to a library | a scan is queued two minutes later (batches several additions into one scan) |
| an episode or movie watched past 90 % | play count and last-viewed on the linked file update immediately |
| a rating set in Plex | the Plex rating on the linked file or show updates immediately |

The last events appear under the switch. *New key* invalidates the old URL;
update it in Plex afterwards. Plex must be able to reach the Pi on the LAN;
the LAN-only rule allows it because Plex runs on the NAS.

## 8. Moving your desktop database to the Pi

The database format is identical on both sides, and stored paths are relative
to each root, so a database made on Windows works on the Pi unchanged. This
carries over every manual fix, keep decision, series match, rating and the
whole change log, and skips the first full scan.

On the Windows PC, close MediaLedger, then copy the database to the Pi:

```bash
scp "%APPDATA%\MediaLedger\medialedger.db" joe@medialedger.local:/tmp/medialedger.db
```

On the Pi:

```bash
sudo systemctl stop medialedger && sudo mv /tmp/medialedger.db /var/lib/medialedger/medialedger.db && sudo chown medialedger:medialedger /var/lib/medialedger/medialedger.db && sudo systemctl start medialedger
```

Then open Settings, make sure the root ids match the desktop (movies, anime,
tv, plus any you added) with the `/mnt/media/...` paths, and run a scan. The
scan finds every file already known, re-links it by relative path and probes
nothing.

Do not copy `settings.json`: it holds Windows paths. Set the roots by hand.

## 9. The System tab

Refreshes every 15 seconds and keeps an hour of history in memory:

- **Health**: one verdict from temperature, throttling, memory, disks and root
  reachability, with the reasons listed.
- **SoC temperature, clock and core voltage** with the firmware's throttling
  flags. "Under-voltage has occurred" means the power supply or cable is weak.
- **CPU** per core, **memory** and swap, the **data disk** and free space on
  every root, and **network** throughput, which shows the share reads during a
  scan.

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| Page does not load | `systemctl status medialedger`; `journalctl -u medialedger -n 50`. Is the PC on the same LAN? LAN-only refuses other ranges |
| "Sign in required" loops | Cookies blocked for the site, or the Pi clock is far off. `timedatectl` |
| "Too many failed attempts" | 15-minute lockout for that address. Wait, or restart the service |
| Roots show "not reachable" | Settings → Library roots shows a status per root and diagnostics (NAS answering? share mounted?). The watchdog timer re-mounts a dropped share within a minute once the NAS answers; to force it: `sudo mount /mnt/media`. Wrong credentials → `sudo rm /etc/medialedger-cifs.cred` and rerun the installer. Watchdog log: `journalctl -t medialedger` |
| Scan is slow | Ethernet, not Wi-Fi. Check System → Network during a scan; a Pi 3 tops out near 11 MB/s |
| Files probed but no captions/languages | `ffprobe -version` on the Pi; the apt build supports everything the Windows build does |
| Renames fail with "root is not writable" | The mount is `file_mode=0664,dir_mode=0775` owned by `medialedger`; check the NAS user has write permission |
| Forgot the web password | `sudo medialedger --set-password` |
| Lost the 2FA device | `sudo systemctl stop medialedger`, edit `/var/lib/medialedger/web.json` and set `"totp": {"enabled": false}`, start again |
| Temperature above 80 °C during scans | Add a heatsink or fan, or lower *Probe concurrency* in Settings |

## 11. File locations

| Path | Contents |
|---|---|
| `/opt/medialedger` | the application (replaced on update) |
| `/var/lib/medialedger/medialedger.db` | the database |
| `/var/lib/medialedger/settings.json` | settings (roots, schedule, Plex, …) |
| `/var/lib/medialedger/web.json` | password hash, sessions, 2FA, options (0600) |
| `/var/lib/medialedger/security.log` | audit log |
| `/var/lib/medialedger/medialedger.log` | application log |
| `/var/lib/medialedger/exports/` | CSV exports |
| `/var/lib/medialedger/backups/` | pre-migration database backups |
| `/var/lib/medialedger/tls/` | optional cert.pem + key.pem |
| `/etc/medialedger-cifs.cred` | NAS share credentials (root, 0600) |
| `/etc/systemd/system/medialedger.service` | the service |
| `/etc/systemd/system/medialedger-mount.timer` + `.service`, `/usr/local/sbin/medialedger-mount-check` | the mount watchdog (every minute: not mounted and NAS answers → mount) |
| `/mnt/media` | the share |

## 12. Uninstall

```bash
sudo systemctl disable --now medialedger && sudo rm -f /etc/systemd/system/medialedger.service /usr/local/bin/medialedger /usr/local/bin/medialedger-update && sudo umount /mnt/media; sudo sed -i '\| /mnt/media cifs |d' /etc/fstab && sudo rm -rf /opt/medialedger && sudo systemctl daemon-reload
```

Add `sudo rm -rf /var/lib/medialedger /etc/medialedger-cifs.cred` only if you
also want the database, settings and share credentials gone.
