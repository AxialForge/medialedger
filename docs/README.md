# MediaLedger documentation

| Document | What it covers |
|---|---|
| [MediaLedger-Manual.docx](MediaLedger-Manual.docx) | The user manual for the Windows desktop app and the Raspberry Pi web server: every tab, every dialog, step-by-step procedures, settings and CSV references, the naming engine, Plex, System and Security tabs, the Pi chapter with requirements and commands, troubleshooting, glossary. Regenerate with `node tools/build-manual.js <screenshots> <out.docx>`. |
| [RASPBERRY-PI.md](RASPBERRY-PI.md) | The Raspberry Pi guide on its own: requirements, OS flashing, the installer, command reference, daily use, updating, security, moving the desktop database over, System tab, troubleshooting, file locations, uninstall. Shipped as the README inside `medialedger-server.tar.gz`. |
| [screenshots/](screenshots/) | Current screenshots of every screen, used by the README and the manual. Regenerate with `electron . --screenshots=<dir>` (desktop) and `electron . --url=http://<pi>:8080 --screenshots=<dir>` (web build). |
| [../CHANGELOG.md](../CHANGELOG.md) | Release history. |
| [../CLAUDE.md](../CLAUDE.md) | Architecture, non-negotiables and gotchas for anyone changing the code. |
| [../server/install.sh](../server/install.sh) | The Pi installer, readable top to bottom. |

## Quick links

- Install on Windows: download `medialedger-<version>-setup.exe` from [Releases](https://github.com/AxialForge/medialedger/releases).
- Install on a Raspberry Pi: `curl -fsSL https://raw.githubusercontent.com/AxialForge/medialedger/main/server/install.sh -o install.sh && sudo bash install.sh`
- Update the Pi: `sudo medialedger-update`
