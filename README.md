# ScreenStudio

A desktop screen recorder and editor for presenting Figma prototypes and tutorials. Built with Electron.

- **Record** a full screen, custom area or window, with camera, microphone and system audio. Pause and resume.
- **Auto-zoom** from recorded clicks, with cursor highlight and click ripples.
- **Edit** on a canvas and timeline with a contextual inspector: backgrounds, frame, camera layouts, trim, undo/redo.
- **Export** MP4 or GIF with presets (YouTube, Shorts/TikTok, LinkedIn, Presentation).

## Run

```bash
npm install
npm start
```

Requires Windows 10/11 and Node 20+. Recordings are saved to `Documents/ScreenStudio Recordings`.

## Design

See [DESIGN.md](DESIGN.md) for the product architecture, tokens and component rules. Visual QA harness: `node dev/server.js` then open `http://localhost:5177/launcher.html`.

## Status

Early work in progress. Export renders in real time. Settings, captions and annotations are not built yet.
