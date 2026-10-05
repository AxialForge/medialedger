# MediaLedger documentation

| Document | What it covers |
|---|---|
| [MediaLedger-User-Manual.pdf](MediaLedger-User-Manual.pdf) | **The user manual.** Arranged by what you are trying to do: a task finder, eight parts from first scan to running the Pi server, a strip on every chapter saying where it is and who can open it, a glossary. 97 pages. |
| [RASPBERRY-PI.md](RASPBERRY-PI.md) | The Raspberry Pi guide on its own: requirements, OS flashing, the installer, command reference, daily use, updating, security, moving the desktop database over, System tab, troubleshooting, file locations, uninstall. Shipped as the README inside `medialedger-server.tar.gz`. |
| [screenshots/](screenshots/) | Current screenshots of every screen, used by the README. Regenerate with `electron . --screenshots=<dir>` (desktop) and `electron . --url=http://<pi>:8080 --screenshots=<dir>` (web build). |
| [../CHANGELOG.md](../CHANGELOG.md) | Release history. |
| [../CLAUDE.md](../CLAUDE.md) | Architecture, non-negotiables and gotchas for anyone changing the code. |
| [../server/install.sh](../server/install.sh) | The Pi installer, readable top to bottom. |

## Quick links

- Install on Windows: download `medialedger-<version>-setup.exe` from [Releases](https://github.com/AxialForge/medialedger/releases).
- Install on a Raspberry Pi: `curl -fsSL https://raw.githubusercontent.com/AxialForge/medialedger/main/server/install.sh -o install.sh && sudo bash install.sh`
- Update the Pi: `sudo medialedger-update`
