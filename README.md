# VidPlayer

A minimal Windows video player with frame-by-frame navigation, trimming, and cropping. You can preview your selection and export a clip from the same window.

## Install

Download the Windows x64 MSI from the [latest release](https://github.com/Yukhondej/VidPlayer/releases/latest) and run it.

Supports common video files, including MP4, MKV, MOV, AVI, and WebM. To open a file from Explorer, right click and select **Open with > VidPlayer**. To make it default, open **Windows Settings > Apps > Default apps**, choose **VidPlayer**, and assign the video extensions you want.

## Use

- Open a video from Explorer, or launch VidPlayer and enter the full path to a video file.
- Play or pause with **Space**. Use **,** and **.** to move one frame at a time. The UI icons also works, right click to set time.
- Drag the **In** and **Out** handles on the timeline to choose a section. Right click to enter exact timestamp.
- Select **Edit** to crop the video by dragging the corners, then select **Done** to preview the crop.
- Select **Export** or press **Ctrl+S** to save the result. Right-click **Export** to choose between lossless and precise export.

The Windows installer includes FFmpeg, so exporting does not require a separate FFmpeg installation.

## Build from source

This project uses Tauri 2, Rust, and vanilla JavaScript. On Windows, install the Tauri prerequisites and run `npm ci` in this directory. Supply matching `libmpv-2.dll`, `libmpv-wrapper.dll`, and `ffmpeg.exe` files under `src-tauri/lib/x86_64` for an x64 build or `src-tauri/lib/aarch64` for an ARM64 build. The FFmpeg binary must include the `libx264` encoder for precise and cropped exports.

```powershell
npm run dev:x64
npm run build:x64
```

Use `dev:arm64` and `build:arm64` for Windows ARM64. The build script checks the DLL architecture and stages the matching files before building the MSI. The version 1.0 x64 installer is `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/VidPlayer_1.0_x64.msi`. Later `.0` patch releases follow the same major.minor filename format; nonzero patch versions retain the patch number.

Set `VID_PLAYER_FFMPEG_PATH` to an executable path to use a different FFmpeg build during development. It takes precedence over the bundled copy. See [Third-party notices](THIRD_PARTY_NOTICES.md) for the bundled FFmpeg build and its source and license information.

Run the frontend checks with `node --test scripts/player-controls.test.cjs` and the Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --lib`.
