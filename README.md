# Tauri + Vanilla

This template should help get you started developing with Tauri in vanilla HTML, CSS and Javascript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Windows builds

Native libmpv DLLs are stored separately under `src-tauri/lib/x86_64` and
`src-tauri/lib/aarch64`. Use the architecture-specific scripts so the matching
DLLs are validated and staged before Tauri builds the installer:

The DLLs are not tracked by Git. Keep a separate copy of both architecture
folders and restore them under `src-tauri/lib` when setting up another checkout.

```powershell
npm run tauri dev
npm run dev:x64
npm run dev:arm64
npm run build:x64
npm run build:arm64
```

Unqualified `npm run tauri -- dev` and `build` commands default to x64. Every
targeted development or build command validates and stages its matching DLLs.

## Open videos from Windows Explorer

New Windows installers register VidPlayer for common video formats, including
MP4, MKV, MOV, AVI, and WebM. Install the rebuilt application, then right-click
a video and choose **Open with > VidPlayer**. Use **Choose another app** and
the option to always use VidPlayer to make it the default for that extension.
Repeat for other extensions as needed.

The selected video loads after the playback engine starts. Each launch opens
its own window, preserving videos and trim selections in existing windows.
Launching without a file still shows the normal path-entry screen. Associations
are registered by the installer, not by `tauri dev` or a standalone executable.

## Crop editing

**Ctrl+S** opens the same export flow as the Export button, including from normal
view or while an input is focused. It requires a loaded video and ignores
repeated requests while an export dialog or export is already running.

In **Edit**, drag any corner to crop. The crop snaps to source-video pixels.
Right-click the top-left or bottom-right corner to enter X/Y coordinates.
Coordinates use the original video boundary: a full 1920x1080 video runs from
(0, 0) to (1920, 1080). White
horizontal and vertical dimensions sit 20 screen pixels outside the original
video and show the selected width and height in source pixels.

Zoom with the cursor inside the selection to enlarge the video underneath the
crop frame. The frame stays in place to the nearest source pixel. Zooming out
stops at the original video bounds. Zooming outside the selection scales the
video and selection together. Dragging inside the selection moves the video
beneath the fixed crop; dragging outside moves both. Touchscreens support
one-finger dragging and two-finger pinch zoom with the same inside/outside
behavior, based on the gesture's starting point or pinch midpoint.

Zoom/pan requests are coalesced per animation frame with one native request in
flight. The overlay follows the crop/view snapshot acknowledged by playback;
late renderer bounds cannot move it to a different zoom. Dimension SVG elements
are reused, and small wheel deltas accumulate before pixel snapping.

**Done** previews only the selected region. Re-entering Edit restores the
original video and the crop selection. Cropped exports automatically use
precise H.264/AAC encoding in MP4, using the same integer crop coordinates as
the preview. Exact odd dimensions use 4:4:4 video rather than rounding or
padding the image; playback requires a decoder that supports H.264 4:4:4.
FFmpeg must be on PATH or configured with `VID_PLAYER_FFMPEG_PATH`.

Checks:

```powershell
node --test scripts/player-controls.test.cjs
cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --offline --lib
# Integration check requiring FFmpeg and FFprobe:
cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --offline --lib ffmpeg_exports_exact_odd_crop -- --ignored
```
