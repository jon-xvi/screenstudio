# ScreenStudio

A desktop screen recorder and editor for presenting Figma prototypes and tutorials. Built with Electron.

**[Download for Windows](https://github.com/jon-xvi/screenstudio/releases/latest/download/ScreenStudio-Setup.exe)** · [Website](https://jon-xvi.github.io/screenstudio/) · [All releases](https://github.com/jon-xvi/screenstudio/releases)

> The installer isn't code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Choose **More info → Run anyway**.

- **Record** a full screen, custom area or window, with camera, microphone and system audio. Pause and resume.
- **Auto-zoom** from recorded clicks, with cursor highlight and click ripples.
- **Edit** on a canvas and timeline with a contextual inspector: backgrounds, frame, camera layouts, trim, undo/redo.
- **Export** MP4 or GIF with presets (YouTube, Shorts/TikTok, LinkedIn, Presentation).

Everything stays on your computer: no account, no uploads, no tracking. Recordings are saved to `Documents/ScreenStudio Recordings`.

## Run from source

```bash
npm install
npm start
```

Requires Windows 10/11 and Node 20+.

## Build the installer

```bash
npm run dist     # → dist/ScreenStudio-Setup.exe
```

To publish a new version: bump `version` in `package.json`, run `npm run dist`, then create a GitHub release whose asset is `dist/ScreenStudio-Setup.exe` (keep that file name so the website's "latest" download link keeps working).

The app icon is generated from the brand mark with `npm run icon`. The download site lives in `docs/` and is served by GitHub Pages; `docs/tokens.css` is a copy of `renderer/tokens.css`, so re-copy it after changing the tokens.

## Design

See [DESIGN.md](DESIGN.md) for the product architecture, tokens and component rules. Visual QA harness: `node dev/server.js` then open `http://localhost:5177/launcher.html`.

## Licence

ScreenStudio is [ISC](LICENSE). It bundles FFmpeg (GPL) and other third-party software; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Status

Early work in progress. Export renders in real time. Settings, captions and annotations are not built yet.
