# Third-party notices

ViewBox is released under the ISC license (see `LICENSE`). It bundles the following third-party software.

## FFmpeg (with x264) — GPL v3

ViewBox includes an unmodified FFmpeg 6.1.1 binary (`resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe`), built with `--enable-gpl --enable-version3 --enable-libx264`, distributed via the [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) npm package. ViewBox runs it as a separate program to convert and export video; it is not linked into ViewBox.

- FFmpeg is licensed under the GNU General Public License, version 3 or later. Run `ffmpeg.exe -L` for the full licence text, or read it at https://www.gnu.org/licenses/gpl-3.0.html.
- x264 is licensed under the GNU General Public License, version 2 or later.
- Corresponding source code: FFmpeg — https://ffmpeg.org/download.html and https://github.com/FFmpeg/FFmpeg (tag `n6.1.1`); x264 — https://code.videolan.org/videolan/x264; the build used — https://www.gyan.dev/ffmpeg/builds/.
- You may replace the bundled `ffmpeg.exe` with your own build of FFmpeg.

## Electron and Chromium — MIT and others

ViewBox is built on [Electron](https://www.electronjs.org/) (MIT). Chromium and its dependencies are covered by their own licences, listed in `LICENSES.chromium.html` in the application folder.

## uiohook-napi / libuiohook — MIT / LGPL v3

Click tracking uses [`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) (MIT), which includes [libuiohook](https://github.com/kwhat/libuiohook) (LGPL v3). Source for libuiohook is available at the link above.

---
This notice is provided in good faith and is not legal advice.
