# ScreenStudio — product & design system

Build order (never skip ahead): architecture → IA → flows → principles → tokens → components → shell → screens → interactions → states → motion → accessibility → visual QA → implementation → polish.
Source of truth for visuals: `renderer/tokens.css` (tokens) and `renderer/components.css` (components). Icons: `renderer/ui.js`.

---

## 1. Product architecture

Two environments with separate mental models.

| | Capture environment | Editing environment |
|---|---|---|
| When | before / during recording | after recording |
| Window | **Recorder** (compact, fixed size) + **HUD** (floating bar) | **Editor** (resizable workspace) |
| Goal | decide what to record, start fast, stay out of the way | refine, preview, export |
| Density | low, guided, one primary action | high, contextual, canvas-dominant |
| Chrome | calm; becomes invisible while recording | darker stage around the canvas so video never blends into chrome |

```
Launch → Recorder (Record | Recordings) → Setup → Countdown → Recording (HUD) → Processing → Editor → Export
```

## 2. Information architecture

```
Application
├── Recorder window
│   ├── Record        mode (Screen · Area · Window) · inputs (Camera · Mic · System audio) · summary · Start
│   └── Recordings    recent recordings · open · show in folder · delete · empty state
├── HUD               timer · state · pause · stop · mic/camera status
├── Editor
│   ├── Tool rail     Canvas · Zoom · Cursor · Camera
│   ├── Canvas        preview, fit / zoom, selection
│   ├── Timeline      Video · Camera · Zoom · Cursor tracks
│   └── Inspector     contextual (see §7)
└── Export            preset → advanced (format, resolution, fps, quality)
```
Deferred (documented, not exposed until built): Settings, Captions, Annotations, Audio mixer, Spotlight, Device frame, per-time camera layouts.

## 3. User flows

1. **First run:** Recorder → Record tab → pick mode → Start → countdown → record → stop → processing steps → Editor opens with zooms already generated.
2. **Edit:** select thing on timeline/canvas/rail → inspector shows that thing's properties → preview → Export.
3. **Re-open:** Recordings tab → card → Editor (state restored).
4. **Error:** capture blocked / ffmpeg failed → inline alert with retry; never a blank screen.

## 4. Design principles & direction

Professional · minimal · precise · calm · fast · desktop-native.
Hierarchy comes from **spacing, type, contrast, grouping, alignment** — not decoration.
Do: borders and surface steps for depth; one primary action per view; progressive disclosure; consistent geometry.
Don't: gradients in chrome, pill-everything, random radii/shadows, many accent colours, decorative empty space.
Recorded content is the only colour on screen (neutral chrome; red means recording/destructive).

## 5. Tokens (`tokens.css`)

Semantic only — feature CSS never uses raw values. Light and dark are both complete; the OS theme is followed until the user toggles.

- **Background** `primary · secondary · tertiary · elevated · canvas`
- **Surface** `default · hover · active · selected · disabled`
- **Border** `subtle · default · strong · focus`
- **Text** `primary · secondary · tertiary · disabled · inverse`
- **Brand** `primary · primary-hover · primary-active · on-primary` — **white on dark, black on light**
- **Status** `success · warning · error · info` (+ `-bg` tints)
- **Type** display 28/34 · h1 22/28 · h2 18/24 · h3 15/20 · body-lg 15/22 · body 13/20 · body-sm 12/16 · label 12/16 · caption 11/16 · micro 10/12. One typeface (Segoe UI Variable → system).
- **Space** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 (`--space-1…16`)
- **Radius** none 0 · sm 4 · md 6 (controls) · lg 10 (panels, cards) · xl 14 (dialogs) · full
- **Elevation** none · sm · md · lg — only for things that float (menus, dialogs, HUD, toasts)
- **Motion** fast 120ms · normal 180ms · slow 240ms; one easing; all collapse to ~0 under `prefers-reduced-motion`
- **Control height** sm 28 · md 32 · lg 40 (minimum practical hit area 28)

## 6. Component library (`components.css`, built once, reused)

Buttons (primary, secondary, tertiary, destructive, icon, split) · inputs (text, select, number, slider, toggle, checkbox, segmented) · tabs · tooltip · toast · alert · confirm dialog · progress/spinner · empty state · panel section (collapsible) · field row · list item · recording card · badge · kbd.
Editor-only (`editor.css`): timeline track/clip/zoom block/playhead, canvas controls, inspector, rail.
Icons: one inline sprite, 24px grid, 1.75 stroke, round caps (`ui.js`). Use `<i data-icon="play"></i>`.

## 7. Editor shell

```
┌────────────────────────────────────────────────────────────┐
│ App bar: ‹ project · undo redo · theme · folder · Export ▾ │
├──┬──────────────────────────────────────────────┬──────────┤
│R │                  Canvas                      │          │
│a │               (dominant)                     │Inspector │
│i ├──────────────────────────────────────────────┤(contextual)
│l │ Transport                                    │          │
│  │ Timeline: Video · Camera · Zoom · Cursor     │          │
└──┴──────────────────────────────────────────────┴──────────┘
```
Why: canvas gets the most area and the darkest surround; timeline sits directly under it (eye travel); inspector on the right where properties are read after selecting (left-to-right flow); rail is narrow because tool switching is rare.

**Inspector is contextual.** Nothing selected → *Project* (canvas size, background, frame). Selecting an object shows only its properties:

| Selection | Sections |
|---|---|
| Project | Canvas · Background · Frame |
| Video clip | Trim · Source info |
| Zoom (none) | Auto-zoom · Defaults · list |
| Zoom block | Timing · Scale · Focus · Motion · actions |
| Cursor | Appearance · Interaction · Motion (advanced collapsed) |
| Camera | Layout · Size & position · Style |

## 8. Interactions

States for every control: default · hover · focus-visible · pressed · selected · disabled · loading. Async: loading → processing → complete → failed → retry.

Shortcuts (Ctrl on Windows/Linux, Cmd on macOS):

| Key | Action |
|---|---|
| Space | play / pause |
| ← / → | step 0.1s (Shift = 1s) |
| S | split selected zoom at playhead |
| Delete | delete selection |
| Ctrl+D | duplicate zoom |
| Ctrl+Z / Ctrl+Shift+Z | undo / redo |
| Ctrl+S | save |
| R | open recorder |
| Ctrl+Shift+R | stop recording (global) |
| Ctrl+Shift+P | pause / resume (global) |

Recording states: Preparing → Countdown → Recording ⇄ Paused → Stopping → Processing → Completed | Error.

## 9. Motion
120/180/240ms only, one easing. Used for hover, panel/selection changes, dialogs, toasts, progress. Never blocks work.

## 10. Accessibility
Visible focus ring everywhere (`--border-focus`), labels on every icon button, tooltips on icon-only controls, 28px minimum hit area, state never colour-only (selected also changes fill/weight/aria), `prefers-reduced-motion`, dialogs trap focus and close on Esc.

## 11. Desktop sizes
Designed for 1280×720 up to 2560×1440. Below ~1360px the inspector narrows and the timeline shortens; the canvas always takes the remaining space.

## 12. Visual QA checklist
Alignment on the 4px grid · spacing from scale · type from tokens · semantic colours only · radii from scale · one icon system · all states present · one obvious primary action · density neither sparse nor cramped · same interaction behaves the same everywhere.

## 13. Review gate before new features
Does it look like a professional desktop app? Is the hierarchy intentional? Can a first-timer start? Can an expert move fast? Are advanced controls hidden? Any panel or control that isn't earning its place? Anywhere that still feels like a prototype? **Fix before adding features.**
