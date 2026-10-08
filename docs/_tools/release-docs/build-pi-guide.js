'use strict';
// Builds PI_INSTALL_GUIDE.docx: installing the web server on a Raspberry Pi, from a blank card to the first scan.
// The terminal text is taken from server/install.sh so the guide cannot drift from what the installer prints.
//
//   node docs/_tools/release-docs/build-pi-guide.js <release-package-dir>
const fs = require('fs');
const path = require('path');
const L = require('./docx-lib.js');
const { H1, H2, H3, P, note, warn, code, bullets, steps, table, picture, cover, toc, write } = L;
const { screens } = require('./screens.js');

const OUT = path.resolve(process.argv[2]);
const SHOTS = path.join(OUT, 'screenshots');
const V = require(path.join(L.REPO, 'package.json')).version;
const BUILD = process.env.BUILD_DATE || '2026-09-30';
const DOC = new Date().toISOString().slice(0, 10);
const byId = Object.fromEntries(screens.map(s => [s.id, s]));
const sh = fs.readFileSync(path.join(L.REPO, 'server', 'install.sh'), 'utf8');
const need = (text) => { if (!sh.includes(text)) throw new Error('install.sh no longer contains: ' + text); return text; };
let figure = 0;
const shot = (id, caption, annotated = true, o) => picture(path.join(SHOTS, `${id}_${annotated ? 'annotated' : 'clean'}.png`), `Figure ${++figure}. ${caption}`, o);
const W7 = [500, 1750, 1250, 2700, 1500, 1100, 1560];
const callouts = (id) => table(['#', 'Control name', 'Type', 'What it does', 'Inputs and limits', 'Default', 'Notes'], byId[id].controls.map((c, i) => [String(i + 1), `**${c.name}**`, c.type, c.does, c.inputs || '–', c.def || '–', c.notes || '–']), W7, { size: 16 });
const INSTALL = 'curl -fsSL https://raw.githubusercontent.com/AxialForge/medialedger/main/server/install.sh -o install.sh && sudo bash install.sh';

const body = [];
body.push(cover('Installing on a Raspberry Pi', 'From a blank card to the first scan, with every question the installer asks', V, { build: BUILD, doc: DOC }, [
  'This guide covers the web server edition of MediaLedger, which runs on a Raspberry Pi and is used from any browser on the home network.',
  'The Windows desktop application is installed from its own setup file and needs none of this.',
]));
body.push(toc());

// ---------------------------------------------------------------- 1
body.push(H1('1. Before you start'));
body.push(P('MediaLedger on a Pi does everything the desktop application does: it lists the media on your file server, measures every file, and shows what is missing, duplicated or worth upgrading. It runs all day on a few watts and every device in the house can open it.'));
body.push(H2('1.1 What you need'));
body.push(table(['Item', 'What to have'], [
  ['Raspberry Pi', 'A Pi 4B or Pi 5. A Pi 3 works on the 64-bit system but scans slowly.'],
  ['Storage for the Pi', 'A 32 GB microSD card (class A2) or a USB solid-state drive.'],
  ['Network', 'An Ethernet cable to the same network as the file server. Wi-Fi works but scans are slower.'],
  ['A computer', 'To prepare the card and to type the commands. Windows, macOS or Linux.'],
  ['The file server', 'Its address (for example `192.168.1.50`) and a user name and password that may read the media. A NAS, or a PC that shares folders.'],
  ['A password', 'For the MediaLedger site itself. At least 8 characters. You choose it during the installation.'],
  ['Time', 'About fifteen minutes, most of it waiting for the card to be written.'],
], [2400, 6960], { size: 18 }));
body.push(H2('1.2 What the installer puts on the Pi'));
body.push(table(['What', 'Where', 'Purpose'], [
  ['The application', '`/opt/medialedger`', 'The server and its web pages. Replaced by every update.'],
  ['Your data', '`/var/lib/medialedger`', 'The database, settings, accounts, backups and log. Never touched by an update.'],
  ['The shares', '`/mnt/medialedger/<share>`', 'Each share you connect appears here as a folder.'],
  ['Share sign-ins', '`/etc/medialedger-shares/`', 'One file per share, readable by root only.'],
  ['The service', '`medialedger.service`', 'Starts MediaLedger with the Pi, as a user with no shell and no administrator rights.'],
  ['The share helper', '`medialedger-share.path`', 'Lets the web application connect a share without the service being an administrator.'],
  ['The watchdog', '`medialedger-mount.timer`', 'Reconnects a share within a minute when the file server comes back.'],
  ['Programs', 'Node 22, ffmpeg, cifs-utils, smbclient, curl, openssl', 'Installed from the system package source.'],
], [2200, 3000, 4160], { size: 17 }));
body.push(note('Nothing on the file server is changed by the installation. MediaLedger only reads, unless you later switch on its renaming tools.'));

// ---------------------------------------------------------------- 2
body.push(H1('2. Prepare the Raspberry Pi'));
body.push(H2('2.1 Write the card'));
body.push(...steps([
  'Download **Raspberry Pi Imager** from raspberrypi.com and start it.',
  '**Choose device**: your board.',
  '**Choose OS**: Raspberry Pi OS (other), then **Raspberry Pi OS Lite (64-bit)**. The 64-bit version is required. Lite has no desktop, which is never needed.',
  '**Choose storage**: the card or drive.',
  'Press **Next**, then **Edit settings**. On **General** set a hostname (for example `medialedger`), a user name and password for the Pi, and the time zone. Set Wi-Fi only if no cable is used.',
  'On **Services** tick **Enable SSH** with password authentication.',
  'Save, write the card, put it in the Pi, connect the network cable and the power.',
]));
body.push(H2('2.2 Connect to the Pi'));
body.push(P('Wait about a minute after power-on. On Windows open **Terminal** (or PowerShell) and type, with the hostname and user name you chose:'));
body.push(...code('ssh joe@medialedger.local'));
body.push(P('Answer `yes` to the question about the host key the first time, then type the password of the Pi. Nothing is shown while a password is typed.'));
body.push(table(['If this happens', 'Do this'], [
  ['`Could not resolve hostname medialedger.local`', 'Use the address instead. Find it in the router\'s list of devices and type `ssh joe@192.168.1.60` with that address.'],
  ['`Connection refused`', 'SSH was not enabled when the card was written. Write the card again with **Enable SSH** ticked.'],
  ['You prefer PuTTY', 'Type the hostname or address in **Host Name**, leave the port at 22, press **Open**.'],
], [3600, 5760], { size: 17 }));
body.push(P('Check that the system is 64-bit and note the address of the Pi:'));
body.push(...code('uname -m; hostname -I'));
body.push(P('The first line must say `aarch64`. The second is the address you will open in a browser.'));

// ---------------------------------------------------------------- 3
body.push(H1('3. Run the installer'));
body.push(P('One command downloads the installer and starts it:'));
body.push(...code(INSTALL));
body.push(P('It begins by saying what it will ask:'));
body.push(...code(['  MediaLedger for Raspberry Pi: installation', '  ------------------------------------------', '  ' + need('This takes about five minutes and asks three things:'), '    ' + need('1. where your media lives (the file server\'s address, a username and a password),'), '    ' + need('2. which of its shares to use,'), '    ' + need('3. a password for the MediaLedger site.')].join('\n')));
body.push(P('Then it works through five stages. Each stage prints a line starting with `==>`.'));
body.push(table(['Stage', 'What happens', 'What you do'], [
  ['`==> Packages`', 'Installs Node 22, ffmpeg and the tools for network shares. The slowest stage on a new card.', 'Wait.'],
  ['`==> Service user and data folder`', 'Creates the user `medialedger` and the folder for your data.', 'Nothing.'],
  ['`==> Application at /opt/medialedger`', 'Downloads the newest release, checks its checksum and unpacks it.', 'Nothing.'],
  ['`==> Network shares`', 'Asks for the file server and connects the shares you pick.', 'Answer the questions in 3.1.'],
  ['`==> Web password`', 'Asks for the password of the MediaLedger site.', 'Answer the question in 3.2.'],
], [3000, 4160, 2200], { size: 17 }));

body.push(H2('3.1 The file server questions'));
body.push(...code([need('Address of the file server, for example 192.168.1.50 (Enter to skip and do it later in the browser): ') + '192.168.1.50', 'Username on 192.168.1.50: media', 'Password: ', '', 'Shares on 192.168.1.50:', '    1) Media', '    2) Backups', '    3) Photos', need('Which ones hold your media? Numbers separated by spaces, or \'all\': ') + '1', '   connected: Media  ->  /mnt/medialedger/Media   (Anime Movies TV Shows )', need('Connect shares from another server too? [y/N] ') + 'n'].join('\n')));
body.push(table(['Question', 'What to type', 'Notes'], [
  ['Address of the file server', 'The IP address or name of the NAS or PC, for example `192.168.1.50`.', 'No slashes and no share name: only the server. Press Enter with nothing typed to skip this stage and connect shares later in the browser.'],
  ['Username', 'An account on the file server.', 'It needs permission to read the media. Renaming later also needs permission to write.'],
  ['Password', 'The password of that account.', 'Nothing is shown while you type.'],
  ['Which ones hold your media?', 'The numbers from the list, separated by spaces, or `all`.', 'Pick only the shares with media. More can be added later.'],
  ['Connect shares from another server too?', '`y` to repeat the questions for another server, Enter for no.', ''],
], [2700, 3300, 3360], { size: 17 }));
body.push(P('Each share is connected under `/mnt/medialedger/` in a folder named after it, and the line `connected:` shows the first few things found inside, which is a quick check that it is the right share.'));
body.push(table(['The installer says', 'Meaning and what to do'], [
  ['`' + need('gave no shares back. Check the address, the username and the password, and that file sharing (SMB) is on.') + '`', 'The server did not answer, refused the sign-in, or does not share files. The questions are asked again.'],
  ['`could not connect <share>`', 'The share was listed but could not be connected, with the reason on the line above: usually the account may list the share but not open it.'],
  ['`Skipped.`', 'You pressed Enter at the address. Nothing is connected; do it later from the welcome guide or with `sudo medialedger-setup`.'],
], [4200, 5160], { size: 17 }));
body.push(note('The sign-in for each share is stored in `/etc/medialedger-shares/`, readable by root only, so the share reconnects after a restart. It is not stored in MediaLedger\'s settings and is not shown anywhere again.'));

body.push(H2('3.2 The web password'));
body.push(...code(['==> Web password', need('This is the password for the account \'admin\' on the MediaLedger site (at least 8 characters).'), 'New password for user "admin": '].join('\n')));
body.push(P('This is the password you will type in the browser, with the user name `admin`. It has nothing to do with the password of the Pi or of the file server.'));

body.push(H2('3.3 The end of the installation'));
body.push(...code(['==> MediaLedger is running', '  Open it in a browser:   http://medialedger.local:8080  or  http://192.168.1.60:8080', '  Sign in as:             admin   (the password you just chose)', '', '  Shares connected:', '    /mnt/medialedger/Media   <-   //192.168.1.50/Media', '  Useful commands:', '    sudo medialedger-setup            this guide again (more shares, password)', '    sudo medialedger-update           install the latest release', '    sudo medialedger --set-password   reset the admin password', '    journalctl -u medialedger -f      watch the log'].join('\n')));
need('MediaLedger is running'); need('Open it in a browser:');
body.push(P('Leave the terminal open or close it; MediaLedger keeps running either way and starts by itself whenever the Pi starts.'));

// ---------------------------------------------------------------- 4
body.push(H1('4. First sign-in and the welcome guide'));
body.push(P('On any computer or phone on the same network, open the address the installer printed, for example `http://medialedger.local:8080`. If the name does not open, use the address with numbers.'));
body.push(note('The pictures in this chapter were taken on a test system with a fictional library. Where a picture shows a path beginning with `C:\\`, a Raspberry Pi shows one beginning with `/mnt/medialedger/`.'));
body.push(...shot('00_sign_in', 'The sign-in dialog. User name admin, and the web password from step 3.2.', true, { maxH: 380 }));
body.push(callouts('00_sign_in'));
body.push(H2('4.1 The welcome guide'));
body.push(P('A new installation opens the welcome guide instead of an empty Dashboard. The share you connected during the installation is already listed in step 1.'));
body.push(...shot('49_welcome_guide', 'The welcome guide, with one share connected and the three folders filled in.'));
body.push(callouts('49_welcome_guide'));
body.push(H3('What to do on this page'));
body.push(...steps(byId['49_welcome_guide'].workflow));
body.push(H3('Good to know'));
body.push(...bullets([...byId['49_welcome_guide'].features, ...byId['49_welcome_guide'].edge]));
body.push(H2('4.2 Choosing a folder'));
body.push(P('**Browse** opens the folder browser. It shows the folders on the Pi, starting inside the first connected share. Click a folder to open it; press **Use this folder** when the folder that holds the series (or the movies) is the one named at the top.'));
body.push(...shot('46_folder_browser', 'The folder browser, with a button for the connected share.', true, { maxH: 420 }));
body.push(callouts('46_folder_browser'));
body.push(warn('Pick the folder that *contains* the series folders, not one series. For TV that is the folder whose contents are one folder per show.'));
body.push(H2('4.3 Connecting a share from the browser'));
body.push(P('If you skipped the file server questions, or want another share, **Connect a network share** in step 1 of the guide (and under Settings, Library, and in the folder browser) does the same thing as the installer.'));
body.push(...shot('46b_connect_share', 'The connect dialog after Find shares: one share already connected, one ticked.', true, { maxH: 460 }));
body.push(callouts('46b_connect_share'));
body.push(H3('Messages and what they mean'));
body.push(table(['Message', 'Meaning and what to do'], byId['46b_connect_share'].errors.map(([m, d]) => [`\`${m}\``, d]), [3900, 5460], { size: 17 }));
body.push(H2('4.4 The first scan'));
body.push(P('**Start the first scan** in step 4 of the guide lists every file and measures each with ffprobe. A bar in the sidebar shows progress and the file being read. The first scan of a large library can take hours (UNVERIFIED: the time depends on the file server and has not been measured for this release); later scans only read what changed and take minutes.'));

// ---------------------------------------------------------------- 5
body.push(H1('5. Living with it'));
body.push(H2('5.1 What you see when you sign in over SSH'));
body.push(P('Every sign-in to the Pi shows a few lines about MediaLedger:'));
body.push(...code(['  MediaLedger ' + V + ': active    http://192.168.1.60:8080', '    share /mnt/medialedger/Media                 connected', '  Setup guide: sudo medialedger-setup    Update: sudo medialedger-update    Log: journalctl -u medialedger -f'].join('\n')));
body.push(table(['It says', 'Meaning'], [
  ['`active`', 'The service is running.'],
  ['`inactive` or `failed`', 'It is not. Run `systemctl status medialedger` to see why.'],
  ['`connected`', 'That share is mounted and readable.'],
  ['`NOT CONNECTED`', 'The file server is off or unreachable. The watchdog retries every minute.'],
  ['`No network share is connected yet`', 'No share was ever connected. Run `sudo medialedger-setup`.'],
], [3600, 5760], { size: 17 }));
body.push(P('To silence these lines, delete `/etc/profile.d/medialedger-welcome.sh`.'));
body.push(H2('5.2 Commands'));
body.push(table(['Command', 'What it does'], [
  ['`sudo medialedger-setup`', 'The installer\'s questions again: connect more shares, set the password if none is set, show the addresses.'],
  ['`sudo medialedger-update`', 'Downloads the newest release, checks it, installs it and restarts. Data is untouched.'],
  ['`sudo medialedger --set-password`', 'Sets or resets the password of `admin` and signs everyone out.'],
  ['`systemctl status medialedger`', 'Is it running, since when, and its last log lines.'],
  ['`journalctl -u medialedger -f`', 'Follow the log. Ctrl+C stops following.'],
  ['`sudo systemctl restart medialedger`', 'Restart the service.'],
  ['`ls /mnt/medialedger`', 'The connected shares.'],
  ['`sudo bash install.sh`', 'Run the installer again: repairs the service and the commands, upgrades, keeps data.'],
  ['`sudo bash install.sh --auto-update`', 'Add a nightly update at about 04:30. `--no-auto-update` removes it.'],
  ['`sudo bash install.sh --update-only --port=9000`', 'Move the site to another port.'],
], [3900, 5460], { size: 17 }));
body.push(H2('5.3 Updating'));
body.push(P('The About page shows when a newer release exists. On the Pi, run `sudo medialedger-update`. An update replaces `/opt/medialedger` only; the database, settings, accounts and shares are kept.'));
body.push(warn('Updating a server installed before version 2.4: after `sudo medialedger-update`, run `sudo bash /opt/medialedger/server/install.sh` once. That adds the share helper, which the update alone cannot install. An existing share at `/mnt/media` is kept exactly as it is.'));
body.push(H2('5.4 Adding or changing shares later'));
body.push(...bullets([
  '**In the browser**: Settings, Library, Network shares, **Connect a network share**. Remove a share with **Remove** beside it.',
  '**Over SSH**: `sudo medialedger-setup`.',
  '**A changed password on the file server**: remove the share and connect it again with the new password.',
]));

// ---------------------------------------------------------------- 6
body.push(H1('6. Optional extras'));
body.push(H2('6.1 A name instead of an address'));
body.push(P('`http://medialedger.local:8080` works on most networks without any setup. For a name of your own with no port number, such as `https://medialedger.home`, put the reverse proxy Caddy in front. Caddy answers on the normal web ports for every service on the Pi and hands each name to the right one.'));
body.push(...steps([
  'Install Caddy: `sudo apt-get install -y caddy`.',
  'Edit `/etc/caddy/Caddyfile` and add a block for the name:',
]));
body.push(...code('medialedger.home {\n    tls internal\n    reverse_proxy localhost:8080\n}'));
body.push(...steps([
  'Reload Caddy: `sudo systemctl reload caddy`.',
  'In the router\'s local DNS, add a record pointing `medialedger.home` at the address of the Pi. On a UniFi gateway: Settings, Routing, DNS, Create Entry, type A.',
  'Open `https://medialedger.home`. The browser warns once about the certificate, because Caddy made it itself; accept it, or install Caddy\'s root certificate on the device.',
]));
body.push(note('MediaLedger notices that Caddy serves HTTPS in front of it. On the Security page the HTTPS line turns green and the button for the built-in certificate is not offered.'));
body.push(H2('6.2 The family portal from outside the home'));
body.push(P('The family portal is a second, read-only site for people you invite. It listens on port 8090 on the Pi itself. Tailscale Funnel gives it a public address without opening a port on the router:'));
body.push(...steps([
  'Install Tailscale on the Pi and sign in: `curl -fsSL https://tailscale.com/install.sh | sh` then `sudo tailscale up`.',
  'In the Tailscale admin console, switch on HTTPS certificates and allow Funnel for the Pi.',
  'In MediaLedger open **Family portal**, tick **Portal on**, and press **Save**.',
  'On the Pi: `sudo tailscale funnel --bg 8090`. It prints the public address.',
  'Paste that address into **Public address** on the Family portal page and press **Save**. Invites made after that carry it.',
]));
body.push(P('The User Manual, chapters 6 and 8, describes the portal pages and the owner\'s sign-in at `/admin`.'));
body.push(H2('6.3 Bringing the database from the desktop application'));
body.push(P('The database is the same on both. Copying it carries over every fix, match, rating and the change log, and skips the first long scan.'));
body.push(...steps(['On the Windows PC close MediaLedger and copy the database to the Pi:']));
body.push(...code('scp "%APPDATA%\\MediaLedger\\medialedger.db" joe@medialedger.local:/tmp/medialedger.db'));
body.push(...steps(['On the Pi, put it in place:']));
body.push(...code('sudo systemctl stop medialedger && sudo mv /tmp/medialedger.db /var/lib/medialedger/medialedger.db && sudo chown medialedger:medialedger /var/lib/medialedger/medialedger.db && sudo systemctl start medialedger'));
body.push(...steps(['Open Settings, Library. Give each root the same type as on the desktop and its folder under `/mnt/medialedger/`, save, and run a scan. Files are matched by their path inside each root, so nothing is measured again.']));
body.push(warn('Do not copy `settings.json`: it holds Windows paths.'));

// ---------------------------------------------------------------- 7
body.push(H1('7. When something goes wrong'));
body.push(table(['What you see', 'What to check'], [
  ['The page does not open', '`systemctl status medialedger` on the Pi. Is the computer on the same network? With **LAN only** on, other networks are refused.'],
  ['The name does not open but the address does', 'The computer uses a DNS server that does not know local names, which a VPN often causes. Use the address, or add the name to the computer\'s hosts file.'],
  ['A library folder shows "not reachable"', 'Settings, Library shows a status for each root and each share. The watchdog reconnects a dropped share within a minute once the file server answers. To force it: `sudo mount /mnt/medialedger/<share>`.'],
  ['"The share helper did not answer"', '`sudo systemctl status medialedger-share.path`. If it does not exist, run `sudo bash /opt/medialedger/server/install.sh`.'],
  ['"The server refused the username or password"', 'The account or password is wrong for that file server, or the account may not use that share.'],
  ['The folder browser shows no folders', 'The line under the list says how many files the folder holds. A folder with files and no sub-folders may be the right one: press **Use this folder**.'],
  ['The scan is slow', 'Use a cable. The System page shows network speed during a scan.'],
  ['"Too many failed attempts"', 'That address is locked out for fifteen minutes. Wait, or restart the service.'],
  ['Forgot the web password', '`sudo medialedger --set-password`'],
  ['Lost the two-factor device', 'Stop the service, set `"totp": {"enabled": false}` in `/var/lib/medialedger/web.json`, start it again.'],
  ['The Pi runs hot during scans', 'Add a heatsink or a fan, or lower **Parallel ffprobe processes** in Settings.'],
], [3300, 6060], { size: 17 }));
body.push(H2('7.1 Removing MediaLedger'));
body.push(...code('sudo systemctl disable --now medialedger medialedger-share.path medialedger-mount.timer && sudo rm -f /etc/systemd/system/medialedger*.service /etc/systemd/system/medialedger*.timer /etc/systemd/system/medialedger-share.path /usr/local/bin/medialedger* /usr/local/sbin/medialedger-mount-check /etc/profile.d/medialedger-welcome.sh && sudo rm -rf /opt/medialedger && sudo systemctl daemon-reload'));
body.push(P('That leaves your data and the shares. To remove those too, delete the lines for `/mnt/medialedger/` from `/etc/fstab`, then:'));
body.push(...code('sudo rm -rf /var/lib/medialedger /etc/medialedger-shares'));
body.push(H2('7.2 What has and has not been tested'));
body.push(table(['Part', 'Status'], [
  ['The installer\'s questions, the sign-in lines and the watchdog script', 'Run on a Linux test system with a stand-in for the file server.'],
  ['The share helper\'s checks and what it writes', 'Covered by automated tests with a stand-in for the system.'],
  ['Connecting a real share on a Raspberry Pi with version ' + V, 'UNVERIFIED at the time of writing. The first installation on a Pi is the test.'],
  ['The web pages in this guide', 'Captured from the running application, with fictional data.'],
], [5200, 4160], { size: 17 }));

write(path.join(OUT, 'PI_INSTALL_GUIDE.docx'), body, { title: `MediaLedger ${V} Raspberry Pi Installation Guide`, header: `MediaLedger ${V} · Installing on a Raspberry Pi` });
