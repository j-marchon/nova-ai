<p align="center">
  <img src="public/logo.png" alt="Nova" width="96" />
</p>

<h1 align="center">Nova</h1>

<p align="center">
  <b>AI chat and roleplay — your providers, your device, your story.</b>
</p>

<p align="center">
  <a href="https://github.com/j-marchon/nova-releases/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/j-marchon/nova-releases?label=release&color=blue"></a>
  <a href="https://github.com/j-marchon/nova-releases/releases/latest"><img alt="Downloads" src="https://img.shields.io/github/downloads/j-marchon/nova-releases/total?label=downloads&color=brightgreen"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="https://ko-fi.com/bjmar"><img alt="Support on Ko-fi" src="https://img.shields.io/badge/Ko--fi-support%20Nova-FF5E5B?logo=ko-fi&logoColor=white"></a>
</p>

---

Nova is a roleplay chat app that connects to your own AI providers (OpenRouter, Google Gemini, a local server, or Nova Bridge) and keeps every character, chat and setting on the device. It runs three ways from one codebase: **the browser**, an **Android app** (Capacitor) and a **desktop shell** (Electron for Windows and Linux).

## ✨ Features

| | |
|---|---|
| 🎭 **Roleplay chat** | One-on-one, groups (Nova Scope) and whole worlds (Universes) with a World sheet |
| 🔌 **Bring your own provider** | OpenRouter, Google AI Studio, Gemini Web (via Nova Bridge), local/self-hosted, or any OpenAI-compatible endpoint |
| 🌉 **Nova Bridge** | A local gateway that lets Nova use a Gemini account's models with no API key — runs as its own desktop app or alongside the desktop shell |
| 🃏 **SillyTavern compatible** | Import and export character cards (PNG & JSON), presets, lorebooks, and chat files |
| 🤖 **AI Card Studio** | Describe a character and the AI writes the full card — with structured interviews to flesh out the details |
| 📝 **Advanced character editor** | Structured fields for appearance, story, speech, personality, goals, fears, quirks and limits, or free-form text |
| 🧠 **Story memory** | Scene tracker, story summary, and recall (RAG) keep the model aware of what has happened |
| 🎨 **Skins** | The look is a costume: skins change colours, fonts, backgrounds and animations without changing what the app does |
| 📞 **In-chat phone** | The persona's phone with social apps, messages, a gallery, and a bank — all driven by the story |
| 🔒 **Fully local** | Everything stays on the device and works offline once installed; no CDN, no telemetry, no account required |
| 💾 **Backup & sync** | Full backups (with optional skins); sync between devices over your local network |

## 📥 Download

Get the latest version from the [**Releases**](https://github.com/j-marchon/nova-releases/releases/latest) page:

| Platform | File | Notes |
|---|---|---|
| **Android** | `Nova-x.x.x.apk` | Install directly; no Play Store needed |
| **Windows** | `Nova-x.x.x-setup.exe` | Installer (per-user, no admin) |
| **Windows** | `Nova-x.x.x-portable.exe` | No install; runs from anywhere |
| **Linux** | `Nova-x.x.x-x86_64.AppImage` | Any distribution; `chmod +x` and run |
| **Linux** | `Nova-x.x.x-amd64.deb` | Debian / Ubuntu / Mint; adds a menu entry |
| **Browser** | — | Clone and `npm run dev`, or use a hosted build |

## 🚀 Quick Start

### From the browser (development)

```bash
git clone https://github.com/j-marchon/nova-releases.git
cd nova-releases
npm ci
npm run dev
```

Open `http://localhost:5173` and set up a provider in **Settings → Providers**.

### Desktop build

```bash
npm run build:desktop          # builds the web app then packages it
# or target one platform:
npm run build && node desktop/build-desktop.mjs --linux
npm run build && node desktop/build-desktop.mjs --win
```

Outputs land in `out/`.

### Android

The Android app is a Capacitor wrapper around the same web build. Open `mobile/android/` in Android Studio, sync, and build. See the Capacitor docs for details.

### Nova Bridge

Nova Bridge is a local gateway that lets Nova use a Gemini account's models. Start it alongside the app:

```bash
./bridgeStart.sh
```

Or on Windows:

```cmd
bridgeStart.cmd
```

## 📂 Project Structure

```
src/              Web app (React 19 + Vite + Tailwind)
  ├─ components/  UI components, phone, motion, skins
  ├─ lib/         Core logic: API, cards, chat, memory, TTS, macros, ...
  ├─ pages/       Chat, Create, History, Settings
  ├─ skins/       Skin engine, scene layers, skin store
  └─ prompts/     Card Studio writing prompts
bridge/           Nova Bridge gateway and its Electron window
desktop/          Desktop shell (Electron) and packager
mobile/android/   Capacitor Android app
tests/            Unit, component and Electron tests
public/           Static assets, icons, scenes
```

## 🧪 Testing

```bash
npm test                # unit and component tests (Vitest)
npm run test:layout     # Electron layout tests
npm run test:bridge-ui  # Bridge UI tests
```

## 🛠️ Tech Stack

- **Frontend:** React 19, Vite 5, Tailwind CSS 4, GSAP
- **Desktop:** Electron 43, electron-builder
- **Mobile:** Capacitor 8 (Android)
- **Testing:** Vitest, jsdom, fake-indexeddb
- **Speech:** Web Speech API with engine detection and diagnostics
- **AI:** OpenRouter, Google AI Studio, Gemini Web (via Bridge), OpenAI-compatible endpoints

## 🤝 Contributing

Nova is open source. Contributions, bug reports and feature requests are welcome — open an issue or a pull request.

## 📜 License

[MIT](LICENSE)

## 💬 Links

- [Releases](https://github.com/j-marchon/nova-releases/releases)
- [Ko-fi (support Nova)](https://ko-fi.com/bjmar)
