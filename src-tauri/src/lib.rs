use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager, path::BaseDirectory};
use tauri_plugin_libmpv::MpvExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    skip_back_seconds: u32,
    skip_forward_seconds: u32,
    window_width: u32,
    window_height: u32,
    last_export_folder: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            skip_back_seconds: 5,
            skip_forward_seconds: 5,
            window_width: 900,
            window_height: 600,
            last_export_folder: String::new(),
        }
    }
}

impl Settings {
    fn validated(mut self) -> Self {
        self.skip_back_seconds = self.skip_back_seconds.clamp(1, 3600);
        self.skip_forward_seconds = self.skip_forward_seconds.clamp(1, 3600);
        self.window_width = self.window_width.clamp(700, 7680);
        self.window_height = self.window_height.clamp(400, 4320);
        if !self.last_export_folder.is_empty() && !Path::new(&self.last_export_folder).is_dir() {
            self.last_export_folder.clear();
        }
        self
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir()
        .map(|directory| directory.join("settings.json"))
        .map_err(|error| format!("Could not find the settings directory: {error}"))
}

fn read_settings(app: &tauri::AppHandle) -> Settings {
    settings_path(app).ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .unwrap_or_default()
        .validated()
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Settings {
    read_settings(&app)
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    std::fs::create_dir_all(path.parent().ok_or("Invalid settings path.")?)
        .map_err(|error| format!("Could not create the settings directory: {error}"))?;
    let data = serde_json::to_vec_pretty(&settings.validated())
        .map_err(|error| format!("Could not encode settings: {error}"))?;
    std::fs::write(path, data).map_err(|error| format!("Could not save settings: {error}"))
}

#[tauri::command]
async fn set_video_view(app: tauri::AppHandle, zoom: f64, pan_x: f64, pan_y: f64) -> Result<(), String> {
    if ![zoom, pan_x, pan_y].iter().all(|value| value.is_finite()) {
        return Err("Invalid video view.".to_string());
    }
    // Apply the complete view without three webview round trips in between.
    tauri::async_runtime::spawn_blocking(move || {
        for (name, value) in [("video-zoom", zoom), ("video-pan-x", pan_x), ("video-pan-y", pan_y)] {
            app.mpv().set_property(name, &serde_json::json!(value), "main")
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[derive(Serialize)]
struct ExportResult {
    output_path: String,
    replaced_source: bool,
}

#[derive(Clone, Serialize)]
struct ExportProgress {
    fraction: f64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CropRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    source_width: u32,
    source_height: u32,
}

impl CropRect {
    fn filter(&self) -> Result<String, String> {
        if self.width == 0 || self.height == 0
            || self.x.checked_add(self.width).is_none_or(|end| end > self.source_width)
            || self.y.checked_add(self.height).is_none_or(|end| end > self.source_height) {
            return Err("Crop must be a nonempty rectangle inside the source video.".into());
        }
        // Convert chroma before cropping so odd offsets and dimensions remain exact.
        Ok(format!("format=yuv444p,crop={}:{}:{}:{}:exact=1", self.width, self.height, self.x, self.y))
    }
}

fn encoding_args(crop: Option<&CropRect>) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    if let Some(crop) = crop {
        args.extend(["-vf".into(), crop.filter()?, "-pix_fmt".into(), "yuv444p".into()]);
    }
    args.extend(["-c:v", "libx264", "-c:a", "aac", "-progress", "pipe:1", "-nostats"].map(String::from));
    Ok(args)
}

fn normalize_output_path(input_path: &Path, selected_path: &str) -> Result<PathBuf, String> {
    let selected = PathBuf::from(selected_path);
    let parent = selected.parent().ok_or_else(|| "Choose a folder for the export.".to_string())?;
    let stem = selected.file_stem().ok_or_else(|| "Choose a file name for the export.".to_string())?.to_string_lossy();
    let extension = selected.extension().or_else(|| input_path.extension());
    Ok(match extension {
        Some(extension) => parent.join(format!("{stem}.{}", extension.to_string_lossy())),
        None => parent.join(stem.as_ref()),
    })
}

fn paths_match(first: &Path, second: &Path) -> bool {
    let first = std::fs::canonicalize(first).unwrap_or_else(|_| first.to_path_buf());
    let second = std::fs::canonicalize(second).unwrap_or_else(|_| second.to_path_buf());
    first.to_string_lossy().eq_ignore_ascii_case(&second.to_string_lossy())
}

fn keep_both_path(output: &Path) -> Result<PathBuf, String> {
    let parent = output.parent().ok_or_else(|| "The export path does not have a parent folder.".to_string())?;
    let stem = output.file_stem().ok_or_else(|| "The export path does not have a file name.".to_string())?.to_string_lossy();
    let extension = output.extension().map(|value| value.to_string_lossy());
    for index in 1..10_000 {
        let name = match &extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not find an available Keep both file name.".to_string())
}

fn trimmed_duration(in_time: f64, out_time: f64, frame_duration: f64) -> Result<f64, String> {
    if !in_time.is_finite() || !out_time.is_finite() || !frame_duration.is_finite() || in_time < 0.0 || out_time < in_time || frame_duration <= 0.0 {
        return Err("Choose a valid inclusive in/out range before exporting.".to_string());
    }
    Ok((out_time - in_time) + frame_duration)
}

#[tauri::command]
fn startup_video_path() -> Option<String> {
    // Windows passes the associated file as one argument, including spaces.
    // Keep it as data; the existing loader validates it before opening.
    std::env::args_os()
        .skip(1)
        .find(|argument| !argument.to_string_lossy().starts_with('-'))
        .map(|argument| PathBuf::from(argument).to_string_lossy().into_owned())
}

#[tauri::command]
fn validate_video_path(path: String) -> Result<(), String> {
    if Path::new(&path).is_file() {
        Ok(())
    } else {
        Err("No file exists at that path.".to_string())
    }
}

fn ffmpeg_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(override_path) = std::env::var_os("VID_PLAYER_FFMPEG_PATH") {
        return Ok(PathBuf::from(override_path));
    }

    let bundled = app.path().resolve("lib/ffmpeg.exe", BaseDirectory::Resource)
        .map_err(|error| format!("Could not locate bundled FFmpeg: {error}"))?;
    if bundled.is_file() {
        Ok(bundled)
    } else {
        Err(format!("Bundled FFmpeg is missing: {}", bundled.display()))
    }
}

#[tauri::command]
async fn export_clip(
    app: tauri::AppHandle,
    input_path: String,
    output_path: String,
    collision_action: String,
    mode: String,
    in_time: f64,
    out_time: f64,
    frame_duration: f64,
    crop: Option<CropRect>,
) -> Result<ExportResult, String> {
    if mode != "lossless" && mode != "precise" {
        return Err("Unknown export mode.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let input = PathBuf::from(&input_path);
        if !input.is_file() {
            return Err("The source video no longer exists at that path.".to_string());
        }

        let requested_output = normalize_output_path(&input, &output_path)?;
        let replaces_source = paths_match(&input, &requested_output);
        let output_exists = requested_output.exists();
        if collision_action == "ask" {
            if replaces_source { return Err("SOURCE_COLLISION".to_string()); }
            if output_exists { return Err("OUTPUT_EXISTS".to_string()); }
        }
        let output = if collision_action == "keep-both" && (replaces_source || output_exists) {
            keep_both_path(&requested_output)?
        } else {
            requested_output
        };

        let encoding = mode == "precise" || crop.is_some();
        let duration = trimmed_duration(in_time, out_time, frame_duration)?;
        let in_argument = format!("{in_time:.6}");
        let duration_argument = format!("{duration:.6}");
        let mut command = Command::new(ffmpeg_path(&app)?);
        command.args(["-y", "-ss", &in_argument, "-i", &input_path, "-t", &duration_argument]);
        if !encoding {
            command.args(["-c", "copy", "-avoid_negative_ts", "make_zero"]);
        } else {
            command.args(encoding_args(crop.as_ref())?);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command
            .arg(&output)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Could not start bundled FFmpeg. {error}"))?;

        let stderr = child.stderr.take().ok_or_else(|| "Could not capture FFmpeg errors.".to_string())?;
        let stderr_reader = std::thread::spawn(move || {
            let mut stderr = stderr;
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        });

        if encoding {
            let stdout = child.stdout.take().ok_or_else(|| "Could not read FFmpeg progress.".to_string())?;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(value) = line.strip_prefix("out_time_us=") {
                    if let Ok(microseconds) = value.parse::<f64>() {
                        let fraction = (microseconds / (duration * 1_000_000.0)).clamp(0.0, 1.0);
                        let _ = app.emit("export-progress", ExportProgress { fraction });
                    }
                }
            }
        }

        let status = child.wait().map_err(|error| format!("Could not wait for FFmpeg: {error}"))?;
        let stderr = stderr_reader.join().unwrap_or_default();
        if !status.success() {
            let detail: String = stderr.chars().rev().take(1_500).collect::<String>().chars().rev().collect();
            return Err(format!("FFmpeg failed: {detail}"));
        }
        if encoding {
            let _ = app.emit("export-progress", ExportProgress { fraction: 1.0 });
        }

        Ok(ExportResult {
            output_path: output.to_string_lossy().into_owned(),
            replaced_source: replaces_source && collision_action == "replace",
        })
    })
    .await
    .map_err(|error| format!("The FFmpeg task ended unexpectedly: {error}"))?
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let settings = read_settings(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_size(tauri::LogicalSize::new(settings.window_width, settings.window_height));
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_libmpv::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, startup_video_path, set_video_view, validate_video_path, export_clip, load_settings, save_settings])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod crop_tests {
    use super::*;

    #[test]
    fn exact_crop_validates_bounds_and_preserves_odd_pixels() {
        let mut crop = CropRect { x: 101, y: 53, width: 701, height: 501, source_width: 1920, source_height: 1080 };
        assert_eq!(crop.filter().unwrap(), "format=yuv444p,crop=701:501:101:53:exact=1");
        crop.width = 0;
        assert!(crop.filter().is_err());
        crop.width = 1920;
        assert!(crop.filter().is_err());
        crop.x = u32::MAX;
        assert!(crop.filter().is_err());
    }

    // Run explicitly with an installed FFmpeg; exercises the production arguments.
    #[test]
    #[ignore = "requires FFmpeg and FFprobe on PATH"]
    fn ffmpeg_exports_exact_odd_crop() {
        let output = std::env::temp_dir().join(format!("vidplayer-crop-test-{}.mkv", std::process::id()));
        let crop = CropRect { x: 11, y: 7, width: 101, height: 73, source_width: 160, source_height: 120 };
        let result = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=1", "-frames:v", "1"])
            .args(encoding_args(Some(&crop)).unwrap()).args(["-crf", "0"]).arg(&output).output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        let probe = Command::new("ffprobe").args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0"])
            .arg(&output).output().unwrap();
        assert!(probe.status.success());
        assert_eq!(String::from_utf8_lossy(&probe.stdout).trim(), "101,73");
        let decoded = Command::new("ffmpeg").args(["-v", "error", "-i"]).arg(&output)
            .args(["-frames:v", "1", "-pix_fmt", "yuv444p", "-f", "rawvideo", "pipe:1"]).output().unwrap();
        let expected = Command::new("ffmpeg")
            .args(["-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=1", "-vf", &crop.filter().unwrap(),
                "-frames:v", "1", "-pix_fmt", "yuv444p", "-f", "rawvideo", "pipe:1"]).output().unwrap();
        let _ = std::fs::remove_file(&output);
        assert!(decoded.status.success() && expected.status.success());
        assert_eq!(decoded.stdout.len(), 101 * 73 * 3);
        assert_eq!(decoded.stdout, expected.stdout, "Encoded crop must retain the exact selected pixels");
    }
}

#[cfg(test)]
mod settings_tests {
    use super::Settings;

    #[test]
    fn missing_fields_use_defaults_and_invalid_values_are_bounded() {
        let defaults: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(defaults.skip_back_seconds, 5);
        assert_eq!(defaults.window_width, 900);

        let settings: Settings = serde_json::from_str(
            r#"{"skipBackSeconds":0,"skipForwardSeconds":5000,"windowWidth":1,"windowHeight":99999}"#,
        ).unwrap();
        let settings = settings.validated();
        assert_eq!(settings.skip_back_seconds, 1);
        assert_eq!(settings.skip_forward_seconds, 3600);
        assert_eq!(settings.window_width, 700);
        assert_eq!(settings.window_height, 4320);
    }
}
