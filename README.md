<div align="center">

# Distopic Client

**One desktop app for your self-hosted Distopic servers and the official Discord.**

[![License: MIT](https://img.shields.io/badge/license-MIT-7b61ff.svg)](LICENSE)
![Electron](https://img.shields.io/badge/Electron-45-47848f?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)

**English** · [Português (Brasil)](README.pt-BR.md)

[Download](#download) · [Features](#features) · [Screenshots](#screenshots) · [Build from source](#build-from-source) · [How Discord works here](#how-the-discord-tab-works) · [Server](https://github.com/GustavoHSCruz/distopic-server)

<img src="docs/screenshots/chat-and-voice.png" alt="Distopic client: channel list with voice, chat and member list" width="860">

</div>

## Download

| Platform | File |
| --- | --- |
| **Windows 10/11** (x64) | [Distopic-Setup-x64.exe](https://github.com/GustavoHSCruz/distopic-client/releases/latest/download/Distopic-Setup-x64.exe) |
| **Linux** (x64) | [Distopic-x86_64.AppImage](https://github.com/GustavoHSCruz/distopic-client/releases/latest/download/Distopic-x86_64.AppImage) |

**Windows:** run the installer. It installs for your user only, so no admin
rights are needed, and it creates Start menu and desktop shortcuts. The
installer is not code-signed yet, so Windows SmartScreen may show *"Windows
protected your PC"*. Click **More info → Run anyway**.

**Linux:** `chmod +x Distopic-x86_64.AppImage` and run it. AppImages need FUSE 2
(`libfuse2`), which most distributions ship.

### Updates

The app checks for new versions on launch and every few hours, and **always
asks before updating**. A banner offers *Update* or *Later*. The one exception
is a critical security fix: then the update downloads by itself and the app
asks you to restart before continuing. See [SECURITY.md](SECURITY.md).

## Features

- **Discord and Distopic side by side.** The **DC** button opens the official
  Discord web app in a persistent, isolated view. Your Distopic servers sit in
  the same sidebar, and switching between them is one click.
- **Many instances at once.** Connect to any number of
  [Distopic servers](https://github.com/GustavoHSCruz/distopic-server). Their
  servers show up together in the sidebar.
- **Text chat.** History with infinite scroll, replies, edits, `@mentions` with
  autocomplete, Markdown, drag-and-drop and paste-to-upload, image previews, and
  typing indicators.
- **Voice.** Voice activity detection with a sensitivity meter, or push-to-talk.
  Mute and deafen, input and output device selection, speaking rings, and server
  mute and disconnect for moderators.
- **Moderation.** Role editor, per-channel permission overwrites
  (allow/inherit/deny), invites, kick, ban and ban list.
- **Friends and DMs.** Friend requests, presence, direct messages.
- **Discord import wizard.** Choose the channels, history, roles and options,
  then watch the import progress live.
- **Sign in with Discord.** Uses the official OAuth2 in your browser and pulls
  your username, name and avatar.
- **Notifications** for mentions and DMs, plus unread badges, including Discord's
  own unread count.

> The interface is currently in Portuguese (pt-BR); localization is on the
> [roadmap](#roadmap). The screenshots below show the English labels planned for it.

## Screenshots

| | |
| :---: | :---: |
| <img src="docs/screenshots/chat-and-voice.png" alt="Chat and voice" width="420"><br>**Chat and voice channels** | <img src="docs/screenshots/member-card.png" alt="Member card" width="420"><br>**Member card with roles and moderation** |
| <img src="docs/screenshots/roles.png" alt="Role editor" width="420"><br>**Role editor** | <img src="docs/screenshots/channel-permissions.png" alt="Channel permissions" width="420"><br>**Per-channel permissions** |
| <img src="docs/screenshots/discord-import.png" alt="Discord import" width="420"><br>**Import from Discord: pick what comes over** | <img src="docs/screenshots/sign-in.png" alt="Sign in" width="420"><br>**Sign in with Discord or a local account** |
| <img src="docs/screenshots/direct-messages.png" alt="Direct messages" width="420"><br>**Direct messages** | <img src="docs/screenshots/friends.png" alt="Friends" width="420"><br>**Friends and requests** |

## Build from source

Requires Node.js 22.13 or newer.

```bash
git clone https://github.com/GustavoHSCruz/distopic-client.git
cd distopic-client
npm install
npm run dev        # development with hot reload
```

To run a production build locally, or to package installers:

```bash
npm run build && npm start
npm run dist:linux     # dist/Distopic-x86_64.AppImage
npm run dist:win       # dist/Distopic-Setup-x64.exe (needs Windows or Wine; CI builds it on Windows)
```

Releases are built by [GitHub Actions](.github/workflows/release.yml) when a
GitHub release is published.

## First launch

1. Choose **Conectar a um servidor Distopic** (Connect to a Distopic server) and type the server address, for
   example `192.168.0.10` or `chat.example.com`. Without a port, the client
   uses `8787`.
2. Sign in with Discord (if the server enables it) or create a local account.
3. Create a server with **+**, or join one with an invite code.

**Joining someone's community?** The client is all you need: no server
install. Only the person hosting the community runs
[distopic-server](https://github.com/GustavoHSCruz/distopic-server), once,
with a single `docker compose up`.

## How the Discord tab works

The client does **not** reimplement Discord or call its private user API, which
would violate Discord's Terms and put your account at risk. Instead it loads
`https://discord.com/app` in a dedicated Electron view:

- **Separate session.** It uses its own persistent partition (`persist:discord`),
  so the Discord login, cookies and storage stay apart from your Distopic
  accounts.
- **Plain Chrome identity.** It presents a standard Chrome user agent, the same
  approach as [Vesktop](https://github.com/Vencord/Vesktop).
- **Unread badge.** The count is read from the page title.
- **External links** open in your system browser.
- **Permissions.** Microphone, notifications and screen sharing (through the
  PipeWire portal on Linux) are allowed.

Voice, video, Nitro and everything else in that tab behave exactly like the web
version of Discord.

## Project layout

```
src/main/            Electron main process: window, Discord view, permissions
src/preload/         minimal bridge (show/hide Discord, unread badge)
src/renderer/        React app
  src/client.ts      accounts, gateways, event handling, navigation
  src/store.ts       app state (immer + useSyncExternalStore)
  src/voice.ts       mediasoup-client session, VAD / push-to-talk gating
  src/components/    UI
packages/protocol/   wire contract, vendored from distopic-server
```

The protocol is owned by the server repository. After pulling server changes,
run:

```bash
npm run sync:protocol -- ../distopic-server/packages/protocol/src
```

## Roadmap

- [ ] English UI and localization
- [ ] Global push-to-talk hotkey (works when the window is unfocused)
- [x] Windows installer and Linux AppImage with in-app updates
- [ ] Code-signed Windows builds, macOS
- [ ] Video and screen sharing in Distopic voice channels
- [ ] Custom avatars and server icons

## Contributing

Issues and pull requests are welcome. Before opening a PR, run:

```bash
npm run typecheck
npm run build
```

## License

[MIT](LICENSE) © Gustavo Cruz

Distopic is not affiliated with or endorsed by Discord Inc. "Discord" is a
trademark of Discord Inc.
