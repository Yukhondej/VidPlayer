# VidPlayer

VidPlayer is a Windows video player with frame-by-frame navigation, trimming, and cropping. You can preview your selection and export a clip from the same window.

## Install

Download the Windows x64 MSI from the [Releases page](https://github.com/Yukhondej/VidPlayer/releases) and run it. If no release is listed yet, the installer has not been uploaded there.

The installer registers VidPlayer for common video files, including MP4, MKV, MOV, AVI, and WebM. To open a file from Explorer, right-click it and select **Open with > VidPlayer**. If VidPlayer is not shown, select **Choose another app**. You can also choose to always use VidPlayer for that file type.

## Use

1. Open a video from Explorer, or launch VidPlayer and enter the full path to a video file.
2. Play or pause with **Space**. Use **,** and **.** to move one frame at a time.
3. Drag the **In** and **Out** handles on the timeline to choose a section.
4. Select **Edit** to crop the video by dragging the corners, then select **Done** to preview the crop.
5. Select **Export** or press **Ctrl+S** to save the result. Right-click **Export** to choose between lossless and precise export. Cropped clips use precise export automatically.

Exporting requires [FFmpeg](https://ffmpeg.org/download.html) to be installed and available on your `PATH`, or its executable path set in `VID_PLAYER_FFMPEG_PATH`. Playback does not require a separate FFmpeg installation. If you export a crop with odd pixel dimensions, the MP4 uses H.264 4:4:4, which some players cannot decode.

## Build from source

This project uses Tauri 2, Rust, and vanilla JavaScript. On Windows, install the Tauri prerequisites and run `npm ci` in this directory. The native `libmpv-2.dll` and `libmpv-wrapper.dll` files are not tracked in Git; supply matching copies under `src-tauri/lib/x86_64` for an x64 build or `src-tauri/lib/aarch64` for an ARM64 build.

```powershell
npm run dev:x64
npm run build:x64
```

Use `dev:arm64` and `build:arm64` for Windows ARM64. The build script checks the DLL architecture and stages the matching files before building the MSI. Installers are written under `src-tauri/target/<target>/release/bundle/msi/`.

Run the frontend checks with `node --test scripts/player-controls.test.cjs` and the Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --lib`.
