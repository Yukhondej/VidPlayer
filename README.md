# VidPlayer

A minimal Windows video player with frame-by-frame navigation, trimming, and cropping. You can preview your selection and export a clip from the same window.

## Install

Download the Windows x64 MSI from the [latest release](https://github.com/Yukhondej/VidPlayer/releases/latest) and run it.

The installer registers VidPlayer for common video files, including MP4, MKV, MOV, AVI, and WebM. To open a file from Explorer, right-click it and select **Open with > VidPlayer**. To make it your default, open **Windows Settings > Apps > Default apps**, choose **VidPlayer**, and assign the video extensions you want. Windows keeps control of each default choice.

## Use

1. Open a video from Explorer, or launch VidPlayer and enter the full path to a video file.
2. Play or pause with **Space**. Use **,** and **.** to move one frame at a time.
3. Drag the **In** and **Out** handles on the timeline to choose a section.
4. Select **Edit** to crop the video by dragging the corners, then select **Done** to preview the crop.
5. Select **Export** or press **Ctrl+S** to save the result. Right-click **Export** to choose between lossless and precise export. Cropped clips use precise export automatically.

VidPlayer remembers your backward and forward skip intervals, window size, and last export folder between launches. Right-click either skip button to change its interval. Settings are stored in your Windows app configuration folder and survive app updates; they do not include video files or trim selections.

The Windows installer includes FFmpeg, so exporting does not require a separate FFmpeg installation. If you export a crop with odd pixel dimensions, the MP4 uses H.264 4:4:4, which some players cannot decode.

## Build from source

This project uses Tauri 2, Rust, and vanilla JavaScript. On Windows, install the Tauri prerequisites and run `npm ci` in this directory. Native binaries are not tracked in Git. Supply matching `libmpv-2.dll`, `libmpv-wrapper.dll`, and `ffmpeg.exe` files under `src-tauri/lib/x86_64` for an x64 build or `src-tauri/lib/aarch64` for an ARM64 build. The FFmpeg binary must include the `libx264` encoder for precise and cropped exports.

```powershell
npm run dev:x64
npm run build:x64
```

Use `dev:arm64` and `build:arm64` for Windows ARM64. The build script checks the DLL architecture and stages the matching files before building the MSI. The version 1.0 x64 installer is `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/VidPlayer_1.0_x64.msi`. Later `.0` patch releases follow the same major.minor filename format; nonzero patch versions retain the patch number.

Set `VID_PLAYER_FFMPEG_PATH` to an executable path to use a different FFmpeg build during development. It takes precedence over the bundled copy. See [Third-party notices](THIRD_PARTY_NOTICES.md) for the bundled FFmpeg build and its source and license information.

Run the frontend checks with `node --test scripts/player-controls.test.cjs` and the Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --lib`.
