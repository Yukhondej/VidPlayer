const WINDOW_LABEL = "main";
const mpvConfig = {
  initialOptions: {
    vo: "gpu-next", hwdec: "auto-safe", "keep-open": "yes", "force-window": "yes", "input-default-bindings": "yes",
    scale: "nearest", dscale: "nearest", cscale: "nearest",
    "correct-downscaling": "no", "linear-downscaling": "no",
  },
  observedProperties: {
    pause: "flag",
    "time-pos": "double",
    duration: "double",
    "container-fps": "double",
    "eof-reached": "flag",
    "video-params/aspect": "double",
    "video-params/w": "double",
    "video-params/h": "double",
    "video-params/rotate": "double",
    "video-out-params/aspect": "double",
    "osd-dimensions/w": "double",
    "osd-dimensions/h": "double",
    "osd-dimensions/ml": "double",
    "osd-dimensions/mr": "double",
    "osd-dimensions/mt": "double",
    "osd-dimensions/mb": "double",
  },
};

const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;
const loadScreen = document.querySelector("#load-screen");
const editorScreen = document.querySelector("#editor-screen");
const controlPanel = document.querySelector(".control-panel");
const videoNavigation = document.querySelector("#video-navigation");
const cropCorners = document.querySelector("#crop-corners");
const cropShade = document.querySelector("#crop-shade");
let crop = { left: 0, top: 0, right: 1, bottom: 1 };
let cropGesture = null;
const cropDimensions = document.querySelector("#crop-dimensions");
const dimensionNodes = Object.fromEntries(["extensions", "horizontal", "vertical", "width", "height"].map(
  (name) => [name, document.querySelector(`#dimension-${name}`)]));
let sourceVideo = { w: 0, h: 0, rotate: 0 };
let editVideoView = null;
const loadWarning = document.querySelector("#load-warning");
const status = document.querySelector("#status");
const pathInput = document.querySelector("#video-path");
const playToggle = document.querySelector("#play-toggle");
const skipStart = document.querySelector("#skip-start");
const skipBack = document.querySelector("#skip-back");
const previousFrame = document.querySelector("#previous-frame");
const nextFrame = document.querySelector("#next-frame");
const skipForward = document.querySelector("#skip-forward");
const skipEnd = document.querySelector("#skip-end");
const transportButtons = document.querySelectorAll(".transport-button");
const playIcon = playToggle.querySelector(".play-icon");
const pauseIcon = playToggle.querySelector(".pause-icon");
const skipBackSecondsLabel = document.querySelector("#skip-back-seconds");
const skipForwardSecondsLabel = document.querySelector("#skip-forward-seconds");
const skipDialog = document.querySelector("#skip-dialog");
const skipForm = document.querySelector("#skip-form");
const skipAmount = document.querySelector("#skip-amount");
const progress = document.querySelector("#progress");
const timeReadout = document.querySelector("#time-readout");
const inControl = document.querySelector("#in-point");
const outControl = document.querySelector("#out-point");
const inTime = document.querySelector("#in-time");
const outTime = document.querySelector("#out-time");
const previewIn = document.querySelector("#preview-in");
const previewOut = document.querySelector("#preview-out");
const timeline = document.querySelector(".timeline");
const trimTimeDialog = document.querySelector("#trim-time-dialog");
const trimTimeForm = document.querySelector("#trim-time-form");
const trimTimeInput = document.querySelector("#trim-time-input");
const exportButton = document.querySelector("#export-clip");
const editToggle = document.querySelector("#edit-toggle");
const fullscreenButton = document.querySelector("#fullscreen");
const exportResult = document.querySelector("#export-result");
const exportMenu = document.querySelector("#export-menu");
const exportModeButtons = exportMenu.querySelectorAll("[data-export-mode]");
const exportProgress = document.querySelector("#export-progress");
const cropCoordinateDialog = document.querySelector("#crop-coordinate-dialog");
const cropCoordinateForm = document.querySelector("#crop-coordinate-form");
const cropCoordinateTitle = document.querySelector("#crop-coordinate-title");
const cropCoordinateX = document.querySelector("#crop-coordinate-x");
const cropCoordinateY = document.querySelector("#crop-coordinate-y");
let coordinateCorner = "tl";
const contextPopovers = [skipDialog, trimTimeDialog, exportMenu, cropCoordinateDialog];

let duration = 0;
let timePosition = 0;
let fps = 0;
let paused = true;
let inPoint = 0;
let outPoint = 0;
let rangeInitialized = false;
let isScrubbing = false;
let seekFrame;
let draggingHandle = null;
let videoLoaded = false;
let skipBackSeconds = 5;
let skipForwardSeconds = 5;
let lastExportFolder = "";
let settingsSaveTask = Promise.resolve();
let settingsResizeTimer;
let settingsLoaded = false;
let settingsWindowWidth = window.innerWidth;
let settingsWindowHeight = window.innerHeight;
let editingSkipDirection = "back";
let eofReached = false;
let outPointTracksEnd = true;
let editingTrimPoint = "in";
let frameStepInProgress = false;
let frameStepQueue = Promise.resolve();
let frameStepGeneration = 0;
let pendingFrameSteps = 0;
let confirmedTimePosition = 0;

function cancelFramePreview() {
  frameStepGeneration += 1;
  pendingFrameSteps = 0;
  frameStepInProgress = false;
}

async function getPlayerProperty(name, format) {
  return invoke("plugin:libmpv|get_property", { name, format, windowLabel: WINDOW_LABEL });
}
let videoMarginFrame;
let videoAspect = 16 / 9;
let videoOutputBounds = {};
let cropCornerFrame;
let presentedView = null;
let viewUpdateTask;
let wheelGesture = null;
let videoZoom = 0;
let videoPanX = 0;
let videoPanY = 0;
let defaultVideoView = true;
let panGesture = null;
const touchPoints = new Map();
let pinchGesture = null;
let viewUpdatePending = false;
let viewUpdateRunning = false;
let editing = false;
let trimApplied = false;
let enforcingTrim = false;
let exportInProgress = false;

function playbackRange() {
  return trimApplied && !editing
    ? { start: inPoint, end: outPoint }
    : { start: 0, end: duration > 0 ? lastFrameTime() : 0 };
}

async function enforceTrimRange() {
  if (!trimApplied || editing || enforcingTrim || pendingFrameSteps) return;
  const { start, end } = playbackRange();
  if (timePosition >= start && timePosition < end) return;
  if (paused && timePosition === end) return;
  enforcingTrim = true;
  const target = Math.max(start, Math.min(end, timePosition));
  try {
    if (timePosition >= end) {
      paused = true;
      await setProperty("pause", true);
    }
    if (timePosition !== target) await seekTo(target);
    timePosition = target;
    renderPlayback();
  } catch (error) {
    setStatus("Could not apply the trim playback boundary.", true);
    console.error(error);
  } finally {
    enforcingTrim = false;
  }
}
let fullscreenView = false;
let savedVideoView = null;
let menuClickTimer;
let videoDragMoved = false;

function setMenuVisible(visible) {
  controlPanel.hidden = !visible;
  scheduleCropRender();
  for (const popover of contextPopovers) if (popover.open) popover.close();
  if (!visible && controlPanel.contains(document.activeElement)) document.activeElement.blur();
}

function toggleFullscreenView() {
  if (!videoLoaded) return;
  wheelGesture = null;
  clearTimeout(menuClickTimer);
  if (!fullscreenView) {
    savedVideoView = { videoZoom, videoPanX, videoPanY, defaultVideoView };
    fullscreenView = true;
    defaultVideoView = false;
    videoZoom = videoPanX = videoPanY = 0;
    if (!editing && hasCrop()) fitDefaultVideoView();
    setMenuVisible(false);
  } else {
    fullscreenView = false;
    ({ videoZoom, videoPanX, videoPanY, defaultVideoView } = savedVideoView);
    setMenuVisible(true);
  }
  fullscreenButton.setAttribute("aria-pressed", String(fullscreenView));
  updateVideoView();
}

// One native request in flight; each acknowledged view carries its own crop.
async function updateVideoView() {
  viewUpdatePending = true;
  if (viewUpdateRunning) return viewUpdateTask;
  viewUpdateRunning = true;
  viewUpdateTask = (async () => {
    try {
      while (viewUpdatePending) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        viewUpdatePending = false;
        const snapshot = videoGestureSnapshot();
        await invoke("set_video_view", { zoom: snapshot.videoZoom, panX: snapshot.videoPanX, panY: snapshot.videoPanY });
        presentedView = snapshot;
        scheduleCropRender();
      }
    } catch (error) {
      viewUpdatePending = false;
      console.error("Could not update the video view:", error);
      setStatus("Could not update video pan/zoom.", true);
    } finally {
      viewUpdateRunning = false;
      scheduleCropRender();
    }
  })();
  return viewUpdateTask;
}

function scheduleCropRender() {
  if (cropCornerFrame !== undefined) return;
  cropCornerFrame = requestAnimationFrame(() => {
    cropCornerFrame = undefined;
    renderCropCorners();
  });
}

function videoDisplaySize(view = null) {
  // The navigation surface is fixed at inset:0. No synchronous layout read is
  // needed for each wheel or pointer event, even after overlay style writes.
  const bounds = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const aspect = view?.aspect ?? videoAspect;
  const width = Math.min(bounds.width, bounds.height * aspect) * (2 ** (view?.videoZoom ?? videoZoom));
  return { bounds, width, height: width / aspect };
}

function renderCropCorners() {
  const display = viewUpdateRunning && presentedView ? presentedView : videoGestureSnapshot();
  if (!viewUpdateRunning) presentedView = display;
  const selection = display.crop;
  const rect = renderedVideoBounds(false, display);
  const left = rect.left + selection.left * rect.width;
  const top = rect.top + selection.top * rect.height;
  const right = rect.left + selection.right * rect.width;
  const bottom = rect.top + selection.bottom * rect.height;
  exportButton.title = hasCrop() ? "Export precise cropped clip (re-encoded)." : "Export lossless. Right-click for export modes.";
  exportModeButtons[0].disabled = hasCrop();
  cropCorners.hidden = !videoLoaded || !editing || fullscreenView || controlPanel.hidden;
  cropDimensions.hidden = cropCorners.hidden;
  const preview = !editing && hasCrop();
  cropShade.hidden = !videoLoaded || (cropCorners.hidden && !preview);
  cropShade.classList.toggle("is-preview", preview);
  if (cropCorners.hidden) endCropDrag();
  if (cropShade.hidden) return;
  Object.assign(cropCorners.style, {
    left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`,
  });
  if (!cropCorners.hidden) renderCropDimensions(rect, { left, top, right, bottom }, selection);
  // In preview, opaque masks hide everything outside the exported rectangle.
  const outer = preview ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight } : rect;
  const masks = [
    [outer.left, outer.top, outer.width, Math.max(0, Math.min(outer.height, top - outer.top))],
    [outer.left, Math.max(outer.top, bottom), outer.width, outer.top + outer.height - Math.max(outer.top, bottom)],
    [outer.left, top, left - outer.left, bottom - top],
    [Math.max(outer.left, right), top, outer.left + outer.width - Math.max(outer.left, right), bottom - top],
  ];
  masks.forEach(([x, y, width, height], index) => Object.assign(cropShade.children[index].style, {
    left: `${x}px`, top: `${y}px`, width: `${Math.max(0, width)}px`, height: `${Math.max(0, height)}px`,
  }));
}

function renderedVideoBounds(useRequested = false, view = null) {
  const { bounds, width, height } = videoDisplaySize(view);
  const { w, h, ml, mr, mt, mb } = videoOutputBounds;
  const requested = {
    left: bounds.left + (bounds.width - width) / 2 + (view?.videoPanX ?? videoPanX) * width,
    top: bounds.top + (bounds.height - height) / 2 + (view?.videoPanY ?? videoPanY) * height,
    width, height,
  };
  if (!useRequested && [w, h, ml, mr, mt, mb].every(Number.isFinite) && w > 0 && h > 0) {
    const reported = {
      left: bounds.left + ml * bounds.width / w,
      top: bounds.top + mt * bounds.height / h,
      width: Math.max(0, w - ml - mr) * bounds.width / w,
      height: Math.max(0, h - mt - mb) * bounds.height / h,
    };
    // Property events arrive separately and have no view revision. Use native
    // pixel rounding only when the complete rectangle agrees with this view.
    if (Object.keys(requested).every((key) => Math.abs(reported[key] - requested[key]) <= 1)) return reported;
  }
  return requested;
}

function sourcePixelSize() {
  const rotated = Math.abs(sourceVideo.rotate % 180) === 90;
  return { width: rotated ? sourceVideo.h : sourceVideo.w, height: rotated ? sourceVideo.w : sourceVideo.h };
}

function updateSourceAspect() {
  const aspect = sourceVideo.aspect || sourceVideo.w / sourceVideo.h;
  if (!Number.isFinite(aspect) || aspect <= 0) return;
  videoAspect = Math.abs(sourceVideo.rotate % 180) === 90 ? 1 / aspect : aspect;
  updateVideoMargin();
}

function cropPixels(selection = crop) {
  const { width, height } = sourcePixelSize();
  const x = Math.round(selection.left * width);
  const y = Math.round(selection.top * height);
  return { x, y, width: Math.round(selection.right * width) - x, height: Math.round(selection.bottom * height) - y,
    sourceWidth: width, sourceHeight: height };
}

function hasCrop() {
  return crop.left > 0 || crop.top > 0 || crop.right < 1 || crop.bottom < 1;
}

function moveCropCorner(corner, x, y) {
  const { width, height } = sourcePixelSize();
  if (!width || !height) return;
  x = Math.round(x * width) / width;
  y = Math.round(y * height) / height;
  if (corner.includes("l")) crop.left = Math.max(0, Math.min(x, crop.right - 1 / width));
  else crop.right = Math.min(1, Math.max(x, crop.left + 1 / width));
  if (corner.includes("t")) crop.top = Math.max(0, Math.min(y, crop.bottom - 1 / height));
  else crop.bottom = Math.min(1, Math.max(y, crop.top + 1 / height));
}

function cropThroughZoom(scale, anchorX, anchorY) {
  const { width, height } = sourcePixelSize();
  if (!width || !height) return;
  // Keep the screen rectangle fixed while the image scales beneath the cursor.
  // Zoom-out stops when any crop edge reaches the original image boundary.
  const minimumScale = Math.max(
    anchorX > 0 ? (anchorX - crop.left) / anchorX : 0,
    anchorX < 1 ? (crop.right - anchorX) / (1 - anchorX) : 0,
    anchorY > 0 ? (anchorY - crop.top) / anchorY : 0,
    anchorY < 1 ? (crop.bottom - anchorY) / (1 - anchorY) : 0,
  );
  const maximumScale = Math.min((crop.right - crop.left) * width, (crop.bottom - crop.top) * height);
  scale = Math.min(maximumScale, Math.max(minimumScale, scale));
  const snap = (value, pixels) => Math.max(0, Math.min(pixels, Math.round(value * pixels))) / pixels;
  crop = {
    left: snap(anchorX + (crop.left - anchorX) / scale, width),
    right: snap(anchorX + (crop.right - anchorX) / scale, width),
    top: snap(anchorY + (crop.top - anchorY) / scale, height),
    bottom: snap(anchorY + (crop.bottom - anchorY) / scale, height),
  };
  return scale;
}

function renderCropDimensions(rect, selection, selectedCrop = crop) {
  const pixels = cropPixels(selectedCrop);
  if (!pixels.width || !pixels.height) { cropDimensions.hidden = true; return; }
  const { left, top, right, bottom } = selection;
  const y = rect.top - 20;
  const x = rect.left - 20;
  const attribute = (node, name, value) => {
    const text = String(value);
    if (node.getAttribute(name) !== text) node.setAttribute(name, text);
  };
  attribute(dimensionNodes.extensions, "d", `M${left} ${top - 4}V${y - 5} M${right} ${top - 4}V${y - 5} M${left - 4} ${top}H${x - 5} M${left - 4} ${bottom}H${x - 5}`);
  attribute(dimensionNodes.horizontal, "d", `M${left} ${y}H${right}`);
  attribute(dimensionNodes.vertical, "d", `M${x} ${top}V${bottom}`);
  attribute(dimensionNodes.width, "x", (left + right) / 2);
  attribute(dimensionNodes.width, "y", y);
  attribute(dimensionNodes.height, "transform", `translate(${x},${(top + bottom) / 2}) rotate(-90)`);
  for (const [node, text] of [[dimensionNodes.width, `${pixels.width} px`], [dimensionNodes.height, `${pixels.height} px`]]) {
    if (node.textContent !== text) node.textContent = text;
  }
}

function endCropDrag() {
  const gesture = cropGesture;
  cropGesture = null;
  if (gesture && gesture.handle.hasPointerCapture(gesture.id)) gesture.handle.releasePointerCapture(gesture.id);
}

function resetVideoView() {
  defaultVideoView = true;
  fitDefaultVideoView();
  endVideoPan();
  return updateVideoView();
}

function endVideoPan() {
  wheelGesture = null;
  const ids = [...touchPoints.keys()];
  if (panGesture) ids.push(panGesture.id);
  panGesture = null;
  pinchGesture = null;
  touchPoints.clear();
  for (const id of new Set(ids)) {
    if (videoNavigation.hasPointerCapture(id)) videoNavigation.releasePointerCapture(id);
  }
  videoNavigation.classList.remove("is-panning");
}

function cropCoordinateLimits(corner) {
  const pixels = cropPixels();
  return corner === "tl"
    ? { minX: 0, minY: 0, maxX: pixels.x + pixels.width - 1, maxY: pixels.y + pixels.height - 1 }
    : { minX: pixels.x + 1, minY: pixels.y + 1, maxX: pixels.sourceWidth, maxY: pixels.sourceHeight };
}

function setCropCoordinates(corner, x, y) {
  wheelGesture = null;
  if (!["tl", "br"].includes(corner)) return false;
  const { width, height } = sourcePixelSize();
  const limits = cropCoordinateLimits(corner);
  if (!width || !height || !Number.isInteger(x) || !Number.isInteger(y)
      || x < limits.minX || x > limits.maxX || y < limits.minY || y > limits.maxY) return false;
  // Coordinates name pixel boundaries: the far edge of 1920x1080 is (1920,1080).
  if (corner === "tl") { crop.left = x / width; crop.top = y / height; }
  else { crop.right = x / width; crop.bottom = y / height; }
  return true;
}

function openCropCoordinates(event, corner) {
  event.preventDefault();
  event.stopPropagation();
  if (!editing || cropCorners.hidden) return;
  const pixels = cropPixels();
  if (!pixels.width || !pixels.height) return;
  endCropDrag();
  endVideoPan();
  clearTimeout(menuClickTimer);
  coordinateCorner = corner;
  cropCoordinateTitle.textContent = corner === "tl" ? "Top-left coordinates" : "Bottom-right coordinates";
  cropCoordinateX.value = corner === "tl" ? pixels.x : pixels.x + pixels.width;
  cropCoordinateY.value = corner === "tl" ? pixels.y : pixels.y + pixels.height;
  const limits = cropCoordinateLimits(corner);
  for (const [input, min, max] of [[cropCoordinateX, limits.minX, limits.maxX], [cropCoordinateY, limits.minY, limits.maxY]]) {
    input.min = min; input.max = max; input.setCustomValidity("");
  }
  positionPopover(cropCoordinateDialog, event, 240, 210);
  cropCoordinateX.focus();
  cropCoordinateX.select();
}

function pointInsideCrop(x, y) {
  if (!editing || cropCorners.hidden) return false;
  const rect = renderedVideoBounds(true);
  return x >= rect.left + crop.left * rect.width && x <= rect.left + crop.right * rect.width
    && y >= rect.top + crop.top * rect.height && y <= rect.top + crop.bottom * rect.height;
}

function videoGestureSnapshot() {
  return { videoZoom, videoPanX, videoPanY, aspect: videoAspect, crop: { ...crop } };
}

function restoreVideoGesture(snapshot) {
  ({ videoZoom, videoPanX, videoPanY } = snapshot);
  crop = { ...snapshot.crop };
  videoOutputBounds = {};
}

function panVideoBy(dx, dy, fixedCrop) {
  const { width, height } = videoDisplaySize();
  if (!width || !height) return;
  if (fixedCrop) {
    const pixels = cropPixels();
    if (!pixels.sourceWidth || !pixels.sourceHeight) return;
    const shiftX = Math.max(pixels.x + pixels.width - pixels.sourceWidth, Math.min(pixels.x, Math.round(dx / width * pixels.sourceWidth)));
    const shiftY = Math.max(pixels.y + pixels.height - pixels.sourceHeight, Math.min(pixels.y, Math.round(dy / height * pixels.sourceHeight)));
    crop = {
      left: (pixels.x - shiftX) / pixels.sourceWidth,
      top: (pixels.y - shiftY) / pixels.sourceHeight,
      right: (pixels.x + pixels.width - shiftX) / pixels.sourceWidth,
      bottom: (pixels.y + pixels.height - shiftY) / pixels.sourceHeight,
    };
    dx = shiftX / pixels.sourceWidth * width;
    dy = shiftY / pixels.sourceHeight * height;
  }
  videoPanX += dx / width;
  videoPanY += dy / height;
  videoOutputBounds = {};
  defaultVideoView = false;
}

function zoomVideoAt(clientX, clientY, zoomDelta, fixedCrop = pointInsideCrop(clientX, clientY)) {
  const { bounds, width, height } = videoDisplaySize();
  if (!width || !height) return;
  let nextZoom = Math.max(-2, Math.min(4, videoZoom + zoomDelta));
  let scale = 2 ** (nextZoom - videoZoom);
  const rect = renderedVideoBounds(true);
  if (fixedCrop) {
    // A pinch can move its midpoint beyond the crop; keep its zoom anchor in it.
    clientX = Math.max(rect.left + crop.left * rect.width, Math.min(clientX, rect.left + crop.right * rect.width));
    clientY = Math.max(rect.top + crop.top * rect.height, Math.min(clientY, rect.top + crop.bottom * rect.height));
    const anchorX = (clientX - rect.left) / rect.width;
    const anchorY = (clientY - rect.top) / rect.height;
    scale = cropThroughZoom(scale, anchorX, anchorY) ?? scale;
    nextZoom = videoZoom + Math.log2(scale);
  }
  videoPanX += ((clientX - bounds.left - bounds.width / 2) / width) * (1 / scale - 1);
  videoPanY += ((clientY - bounds.top - bounds.height / 2) / height) * (1 / scale - 1);
  videoZoom = nextZoom;
  videoOutputBounds = {};
  defaultVideoView = false;
}

function touchMetrics() {
  const [a, b] = [...touchPoints.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}

function beginVideoPan(id, x, y) {
  wheelGesture = null;
  panGesture = { id, x, y, fixedCrop: pointInsideCrop(x, y), snapshot: videoGestureSnapshot() };
  videoNavigation.classList.add("is-panning");
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function setLoadWarning(message) {
  loadWarning.textContent = message;
}

function normalizeInputPath(value) {
  let path = value.trim();
  const quotePairs = new Map([["\"", "\""], ["'", "'"], ["`", "`"], ["“", "”"], ["‘", "’"]]);
  while (path.length >= 2 && quotePairs.get(path[0]) === path.at(-1)) {
    path = path.slice(1, -1).trim();
  }
  return path;
}

function setExportResult(message, isError = false) {
  exportResult.textContent = message;
  exportResult.classList.toggle("error", isError);
}

function frameRate() {
  return Number.isFinite(fps) && fps > 0 ? fps : 30;
}

function frameIndex(seconds) {
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * frameRate())) : 0;
}

function frameTime(index) {
  return Math.max(0, index) / frameRate();
}

function formatTime(seconds, displayDuration = duration, compact = false) {
  const nominalFps = Math.max(1, Math.round(fps || 30));
  const frameDigits = Math.max(2, String(nominalFps - 1).length);
  const showHours = frameIndex(displayDuration) >= nominalFps * 3600;
  const showMinutes = !compact || frameIndex(displayDuration) >= nominalFps * 60;
  if (!Number.isFinite(seconds) || seconds < 0) {
    return showHours ? `000:00:00:${"0".repeat(frameDigits)}` : `${showMinutes ? "00:" : ""}00:${"0".repeat(frameDigits)}`;
  }

  // Non-drop-frame timecode: split an integer frame index, never the fractional
  // part of wall-clock seconds. Use the real rate when converting back to mpv.
  const index = frameIndex(seconds);
  const wholeSeconds = Math.floor(index / nominalFps);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  const frameInSecond = index % nominalFps;
  const clock = `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}:${String(frameInSecond).padStart(frameDigits, "0")}`;
  return showHours ? `${String(hours).padStart(3, "0")}:${clock}` : showMinutes ? clock : clock.slice(3);
}

function parseTimecode(value) {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 4) return null;
  if (parts.some((part) => !/^\d+$/.test(part))) return null;

  const values = parts.map(Number);
  const nominalFps = Math.max(1, Math.round(fps || 30));
  const [hours, minutes, seconds, frames] = [...Array(4 - values.length).fill(0), ...values];
  if (minutes >= 60 || seconds >= 60 || frames >= nominalFps) return null;
  return frameTime(((hours * 3600) + (minutes * 60) + seconds) * nominalFps + frames);
}

function renderPlayback() {
  const { start, end } = playbackRange();
  const length = frameTime(frameIndex(end) - frameIndex(start));
  const displayLength = length;
  const elapsed = frameTime(Math.max(0, Math.min(frameIndex(end) - frameIndex(start), frameIndex(timePosition) - frameIndex(start))));
  const ratio = length > 0 ? elapsed / length : 0;
  if (!isScrubbing) progress.value = String(ratio * 1000);
  renderPlayheadGap();
  timeReadout.value = `${formatTime(elapsed, displayLength, true)} / ${formatTime(displayLength, displayLength, true)}`;
  playIcon.classList.toggle("is-hidden", !paused);
  pauseIcon.classList.toggle("is-hidden", paused);
  playToggle.setAttribute("aria-label", paused ? "Play" : "Pause");
  playToggle.title = paused ? "Play (Space)" : "Pause (Space)";
}

function renderPlayheadGap() {
  const ratio = Number(progress.value) / Number(progress.max || 1000);
  timeline.style.setProperty("--playhead", `${ratio * 100}%`);
  timeline.style.setProperty("--playhead-offset", "0px");
}

function renderSkipInterval() {
  skipBackSecondsLabel.textContent = String(Number(skipBackSeconds.toFixed(3)));
  skipForwardSecondsLabel.textContent = String(Number(skipForwardSeconds.toFixed(3)));
  skipBack.setAttribute("aria-label", `Skip backward ${skipBackSeconds} seconds`);
  skipForward.setAttribute("aria-label", `Skip forward ${skipForwardSeconds} seconds`);
}

function renderTrim() {
  const enabled = duration > 0;
  const end = lastFrameTime();
  const inRatio = end > 0 ? (inPoint / end) * 100 : 0;
  const outRatio = end > 0 ? (outPoint / end) * 100 : 0;
  timeline.style.setProperty("--trim-in", `${inRatio}%`);
  timeline.style.setProperty("--trim-out", `${outRatio}%`);
  inControl.style.left = `${inRatio}%`;
  outControl.style.left = `${outRatio}%`;
  for (const [control, value] of [[inControl, inPoint], [outControl, outPoint]]) {
    control.setAttribute("aria-valuemin", "0");
    control.setAttribute("aria-valuemax", String(duration));
    control.setAttribute("aria-valuenow", String(value));
    control.setAttribute("aria-valuetext", formatTime(value));
    control.toggleAttribute("aria-disabled", !enabled);
  }
  inTime.textContent = formatTime(inPoint);
  outTime.textContent = formatTime(outPoint);
  previewIn.disabled = !enabled;
  previewOut.disabled = !enabled;
  exportButton.disabled = exportInProgress || !enabled || !videoLoaded || outPoint < inPoint;
}

async function init() {
  await invoke("plugin:libmpv|init", { mpvConfig, windowLabel: WINDOW_LABEL });
  await setProperty("video-margin-ratio-bottom", 0);
}

async function command(name, args = []) {
  await invoke("plugin:libmpv|command", { name, args, windowLabel: WINDOW_LABEL });
}

async function setProperty(name, value) {
  await invoke("plugin:libmpv|set_property", { name, value, windowLabel: WINDOW_LABEL });
}

function positionPopover(dialog, event, width, height) {
  for (const popover of contextPopovers) {
    if (popover !== dialog && popover.open) popover.close();
  }
  const left = Math.min(event.clientX, window.innerWidth - width - 8);
  const top = Math.min(event.clientY, window.innerHeight - height - 8);
  dialog.style.left = `${Math.max(8, left)}px`;
  dialog.style.top = `${Math.max(8, top)}px`;
  dialog.show();
}

function fitDefaultVideoView() {
  wheelGesture = null;
  if (editorScreen.hidden || window.innerHeight <= 0 || window.innerWidth <= 0) return;
  const panelTop = fullscreenView || controlPanel.hidden ? window.innerHeight : controlPanel.getBoundingClientRect().top;
  const gutter = editing && !fullscreenView ? 60 : fullscreenView ? 0 : 10;
  const selected = !editing ? crop : { left: 0, top: 0, right: 1, bottom: 1 };
  const cropWidth = selected.right - selected.left;
  const cropHeight = selected.bottom - selected.top;
  const fittedWidth = Math.min(Math.max(1, window.innerWidth - gutter * 2) / cropWidth,
    Math.max(1, panelTop - gutter * 2) * videoAspect / cropHeight);
  const fullWidth = Math.min(window.innerWidth, window.innerHeight * videoAspect);
  videoZoom = Math.log2(fittedWidth / fullWidth);
  videoPanX = 0.5 - (selected.left + selected.right) / 2;
  videoPanY = (panelTop / 2 - window.innerHeight / 2) / (fittedWidth / videoAspect)
    + 0.5 - (selected.top + selected.bottom) / 2;
  videoOutputBounds = {};
}

function updateVideoMargin() {
  cancelAnimationFrame(videoMarginFrame);
  videoMarginFrame = requestAnimationFrame(() => {
    if (editorScreen.hidden || controlPanel.hidden || window.innerHeight <= 0) return;
    // Fit the initial view without a permanent black renderer margin. Manual
    // zoom/pan can then reveal the video through the translucent controls.
    if (defaultVideoView) {
      fitDefaultVideoView();
      updateVideoView();
    }
  });
}

async function seekTo(target) {
  if (!duration) return;
  cancelFramePreview();
  const { start, end } = playbackRange();
  const boundedTarget = Math.max(start, Math.min(target, end));
  eofReached = false;
  timePosition = boundedTarget;
  renderPlayback();
  await command("seek", [boundedTarget, "absolute+exact"]);
}

async function seekFromProgress() {
  const { start, end } = playbackRange();
  await seekTo(start + (Number(progress.value) / Number(progress.max)) * (end - start));
}

async function loadVideo() {
  trimApplied = false;
  cancelFramePreview();
  const path = normalizeInputPath(pathInput.value);
  if (!path) {
    setLoadWarning("Enter a video file path.");
    return;
  }

  pathInput.disabled = true;
  pathInput.value = path;
  rangeInitialized = false;
  videoLoaded = false;
  videoOutputBounds = {};
  scheduleCropRender();
  eofReached = false;
  outPointTracksEnd = true;
  renderTrim();
  setLoadWarning("");
  try {
    await invoke("validate_video_path", { path });
    sourceVideo = { w: 0, h: 0, rotate: 0 };
    crop = { left: 0, top: 0, right: 1, bottom: 1 };
    editVideoView = null;
    await resetVideoView();
    await command("loadfile", [path]);
    endCropDrag();
    crop = { left: 0, top: 0, right: 1, bottom: 1 };
    videoLoaded = true;
    setExportResult("");
    setStatus(path.split(/[\\/]/).pop());
    loadScreen.hidden = true;
    editorScreen.hidden = false;
    renderTrim();
    updateVideoMargin();
  } catch (error) {
    console.error("libmpv could not load the video:", error);
    if (editorScreen.hidden) {
      setLoadWarning("Could not open this video. Check the path and try again.");
    } else {
      setStatus("Could not reload this video.", true);
    }
  } finally {
    pathInput.disabled = false;
    if (!loadScreen.hidden) pathInput.focus();
  }
}

async function togglePlayback() {
  cancelFramePreview();
  const previousPaused = paused;
  paused = !paused;
  renderPlayback();
  try {
    const { start, end } = playbackRange();
    if (!paused && (eofReached || timePosition >= end || timePosition < start)) await seekTo(start);
    await setProperty("pause", paused);
  } catch (error) {
    paused = previousPaused;
    renderPlayback();
    console.error("libmpv could not change playback state:", error);
    setStatus("Could not change playback state.", true);
  }
}

async function stepFrame(direction) {
  if (!duration) return;
  const generation = frameStepGeneration;
  pendingFrameSteps += 1;
  frameStepInProgress = true;
  eofReached = false;
  paused = true;
  const range = playbackRange();
  timePosition = Math.max(range.start, Math.min(range.end, timePosition + direction / (fps || 30)));
  renderPlayback();

  // Queue real frame steps, but let every click update the readout immediately.
  const task = frameStepQueue.then(async () => {
    if (generation !== frameStepGeneration) return;
    try {
      await setProperty("pause", true);
      if (generation !== frameStepGeneration) return;
      const before = await getPlayerProperty("time-pos", "double");
      if (generation !== frameStepGeneration) return;
    const atRangeBoundary = direction < 0 ? Number(before) <= range.start : Number(before) >= range.end;
    if (!atRangeBoundary) await command(direction < 0 ? "frame-back-step" : "frame-step");
      // Command completion only acknowledges the seek. Wait for reconstruction.
      let actual;
      for (let attempt = 0; ; attempt += 1) {
        if (generation !== frameStepGeneration) return;
        const seeking = await getPlayerProperty("seeking", "flag");
        actual = await getPlayerProperty("time-pos", "double");
        const playerPaused = await getPlayerProperty("pause", "flag");
      const atBoundary = atRangeBoundary;
        const moved = actual != null && before != null && (Number(actual) - Number(before)) * direction > 1e-7;
        if (!seeking && playerPaused && (moved || atBoundary)) break;
        if (attempt >= 199) throw new Error("Timed out waiting for the requested frame.");
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (generation !== frameStepGeneration) return;
    if (actual == null || !Number.isFinite(Number(actual))) throw new Error("Could not read the requested frame time.");
    if (Number(actual) < range.start || Number(actual) > range.end) {
      actual = Math.max(range.start, Math.min(range.end, Number(actual)));
      await command("seek", [actual, "absolute+exact"]);
      if (generation !== frameStepGeneration) return;
    }
      confirmedTimePosition = Number(actual);
      pendingFrameSteps -= 1;
      if (!pendingFrameSteps) {
        frameStepInProgress = false;
        timePosition = confirmedTimePosition;
        renderPlayback();
      }
    } catch (error) {
      if (generation !== frameStepGeneration) return;
      cancelFramePreview();
      timePosition = confirmedTimePosition;
      renderPlayback();
      setStatus("Could not step to the requested frame.", true);
      throw error;
    }
  });
  frameStepQueue = task.catch(() => {});
  return task;
}

function lastFrameTime() {
  return frameTime(Math.max(0, Math.ceil(duration * frameRate() - 1e-4) - 1));
}

async function seekToLastFrame() {
  paused = true;
  renderPlayback();
  await setProperty("pause", true);
  await seekTo(lastFrameTime());
}

function editSkipInterval(event) {
  event.preventDefault();
  editingSkipDirection = event.currentTarget === skipBack ? "back" : "forward";
  skipAmount.value = String(editingSkipDirection === "back" ? skipBackSeconds : skipForwardSeconds);
  positionPopover(skipDialog, event, 104, 58);
  skipAmount.focus();
  skipAmount.select();
}

function editTrimTime(event) {
  event.preventDefault();
  editingTrimPoint = event.currentTarget === previewIn ? "in" : "out";
  trimTimeInput.value = formatTime(editingTrimPoint === "in" ? inPoint : outPoint);
  positionPopover(trimTimeDialog, event, 190, 58);
  trimTimeInput.focus();
  trimTimeInput.select();
}

function editPlayheadTime(event) {
  event.preventDefault();
  if (!videoLoaded) return;
  editingTrimPoint = "playhead";
  const { start, end } = playbackRange();
  trimTimeInput.value = formatTime(frameTime(frameIndex(timePosition) - frameIndex(start)), end - start, true);
  trimTimeInput.setCustomValidity("");
  const bounds = timeReadout.getBoundingClientRect();
  positionPopover(trimTimeDialog, { clientX: bounds.left, clientY: bounds.bottom }, 190, 58);
  trimTimeInput.focus();
  trimTimeInput.select();
}

function openExportMenu(event) {
  event.preventDefault();
  positionPopover(exportMenu, event, 130, 86);
}

async function exportClip(mode = "lossless") {
  if (!videoLoaded || duration <= 0 || exportInProgress) return;
  const exportCrop = hasCrop() ? cropPixels() : null;
  if (exportCrop && (!exportCrop.width || !exportCrop.height)) {
    setExportResult("Wait for the video dimensions before exporting.", true);
    return;
  }
  if (exportCrop) mode = "precise";
  const exportRange = { inTime: inPoint, outTime: outPoint, frameDuration: frameTime(1) };
  exportInProgress = true;
  exportButton.disabled = true;
  const inputPath = pathInput.value.trim();
  const lastSlash = Math.max(inputPath.lastIndexOf("\\"), inputPath.lastIndexOf("/"));
  const folder = lastSlash >= 0 ? inputPath.slice(0, lastSlash + 1) : "";
  const fileName = inputPath.slice(lastSlash + 1);
  const extensionIndex = fileName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = mode === "precise" ? "mp4" : extensionIndex > 0 ? fileName.slice(extensionIndex + 1) : "mp4";

  try {
    const selectedPath = await invoke("plugin:dialog|save", {
      options: {
        title: `Export ${mode} clip`,
        defaultPath: `${lastExportFolder || folder}${stem}_trim_${mode}.${extension}`,
        filters: [{ name: "Video", extensions: [extension] }],
      },
    });

    if (!selectedPath) return;
    const selectedSlash = Math.max(selectedPath.lastIndexOf("\\"), selectedPath.lastIndexOf("/"));
    if (selectedSlash >= 0) {
      lastExportFolder = selectedPath.slice(0, selectedSlash + 1);
      persistPreferences();
    }
    exportProgress.hidden = mode !== "precise";
    exportProgress.value = 0;
    setExportResult(mode === "precise" ? "Encoding precise clip..." : "Exporting without re-encoding...");

    let collisionAction = "ask";
    let result;
    while (!result) {
      try {
        result = await invoke("export_clip", {
          inputPath,
          outputPath: selectedPath,
          collisionAction,
          mode,
          ...exportRange,
          crop: exportCrop,
        });
      } catch (error) {
        const errorText = String(error);
        if (!errorText.includes("SOURCE_COLLISION") && !errorText.includes("OUTPUT_EXISTS")) throw error;

        const isSource = errorText.includes("SOURCE_COLLISION");
        const choice = await invoke("plugin:dialog|message", {
          title: "File already exists",
          kind: "warning",
          message: isSource
            ? "This name is the source video. Replace it, or create a separate copy?"
            : "A file with this name already exists. Replace it, or create a separate copy?",
          buttons: { YesNoCancelCustom: ["Replace", "Keep both", "Cancel"] },
        });
        if (choice === "Cancel") return;
        collisionAction = choice === "Replace" ? "replace" : "keep-both";
      }
    }

    if (result.replaced_source) {
      pathInput.value = result.output_path;
      await loadVideo();
      setExportResult(`Replaced and reloaded: ${result.output_path}`);
    } else {
      setExportResult(`Saved: ${result.output_path}`);
    }
  } catch (error) {
    console.error(`${mode} export failed:`, error);
    setExportResult(String(error), true);
  } finally {
    exportInProgress = false;
    exportProgress.hidden = true;
    renderTrim();
  }
}

function updateDraggedHandle(event) {
  if (!draggingHandle || !duration) return;
  const bounds = timeline.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const target = frameTime(frameIndex(ratio * lastFrameTime()));
  if (draggingHandle === "in") inPoint = Math.min(target, outPoint);
  if (draggingHandle === "out") {
    outPointTracksEnd = false;
    outPoint = Math.max(Math.min(target, lastFrameTime()), inPoint);
  }
  renderTrim();
}

async function loadPreferences() {
  try {
    const settings = await invoke("load_settings");
    skipBackSeconds = settings.skipBackSeconds;
    skipForwardSeconds = settings.skipForwardSeconds;
    lastExportFolder = settings.lastExportFolder;
    settingsWindowWidth = settings.windowWidth;
    settingsWindowHeight = settings.windowHeight;
    renderSkipInterval();
  } catch (error) {
    console.error("Could not load settings:", error);
  } finally {
    settingsLoaded = true;
  }
}

function persistPreferences() {
  if (!settingsLoaded) return;
  const settings = {
    skipBackSeconds,
    skipForwardSeconds,
    windowWidth: settingsWindowWidth,
    windowHeight: settingsWindowHeight,
    lastExportFolder,
  };
  settingsSaveTask = settingsSaveTask.catch(() => {}).then(() => invoke("save_settings", { settings }))
    .catch((error) => console.error("Could not save settings:", error));
}

async function loadStartupVideo() {
  const path = await invoke("startup_video_path");
  if (path) {
    pathInput.value = path;
    await loadVideo();
  }
}

async function startPlayer() {
  try {
    await listen(`mpv-event-${WINDOW_LABEL}`, ({ payload }) => {
      if (payload.event !== "property-change") return;
      if (["video-params/w", "video-params/h", "video-params/rotate"].includes(payload.name)) {
        sourceVideo[payload.name.split("/")[1]] = Number(payload.data) || 0;
        updateSourceAspect();
        scheduleCropRender();
        return;
      }
      if (payload.name.startsWith("osd-dimensions/")) {
        const key = payload.name.slice("osd-dimensions/".length);
        videoOutputBounds[key] = payload.data == null ? undefined : Number(payload.data);
        // Batch the individual margin events into one overlay update.
        scheduleCropRender();
        return;
      }
      if (payload.name === "duration") {
        duration = Number(payload.data) || 0;
        if (duration > 0 && !rangeInitialized) {
          inPoint = 0;
          outPoint = lastFrameTime();
          rangeInitialized = true;
        }
      }
      if (["video-params/aspect", "video-out-params/aspect"].includes(payload.name) && Number(payload.data) > 0) {
        sourceVideo.aspect = Number(payload.data);
        updateSourceAspect();
        scheduleCropRender();
      }
      if (payload.name === "time-pos" && payload.data != null && Number.isFinite(Number(payload.data))) {
        confirmedTimePosition = Number(payload.data);
        if (!pendingFrameSteps) timePosition = confirmedTimePosition;
        enforceTrimRange();
      }
      if (payload.name === "pause") paused = eofReached || frameStepInProgress ? true : Boolean(payload.data);
      if (payload.name === "container-fps") {
        fps = Number(payload.data) || 0;
        if (outPointTracksEnd && duration > 0) outPoint = lastFrameTime();
      }
      if (payload.name === "eof-reached") {
        eofReached = Boolean(payload.data);
        if (eofReached && !pendingFrameSteps) {
          timePosition = playbackRange().end;
          paused = true;
          setProperty("pause", true).catch(console.error);
        }
      }

      progress.disabled = duration <= 0;
      for (const button of transportButtons) button.disabled = duration <= 0;
      renderPlayback();
      renderTrim();
    });
    await listen("export-progress", ({ payload }) => {
      exportProgress.value = Number(payload.fraction) || 0;
    });

    await init();
    pathInput.disabled = false;
    pathInput.focus();
    await loadStartupVideo();
  } catch (error) {
    console.error("libmpv initialization failed:", error);
    setLoadWarning("The video engine could not start.");
  }
}

for (const handle of cropCorners.querySelectorAll("[data-corner]")) {
  handle.addEventListener("pointerdown", (event) => {
    if (!editing || cropCorners.hidden || event.button !== 0 || cropGesture) return;
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(menuClickTimer);
    endVideoPan();
    const bounds = renderedVideoBounds();
    if (!bounds.width || !bounds.height) return;
    const corner = handle.dataset.corner;
    cropGesture = {
      id: event.pointerId, handle, corner,
      offsetX: (event.clientX - bounds.left) / bounds.width - (corner.includes("l") ? crop.left : crop.right),
      offsetY: (event.clientY - bounds.top) / bounds.height - (corner.includes("t") ? crop.top : crop.bottom),
    };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!cropGesture || cropGesture.id !== event.pointerId) return;
    const bounds = renderedVideoBounds();
    if (!bounds.width || !bounds.height) return;
    moveCropCorner(cropGesture.corner,
      (event.clientX - bounds.left) / bounds.width - cropGesture.offsetX,
      (event.clientY - bounds.top) / bounds.height - cropGesture.offsetY);
    scheduleCropRender();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(name, endCropDrag);
  if (["tl", "br"].includes(handle.dataset.corner)) {
    handle.addEventListener("contextmenu", (event) => openCropCoordinates(event, handle.dataset.corner));
  }
}
window.addEventListener("blur", endCropDrag);

cropCoordinateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editing || !cropCoordinateDialog.open) return;
  const x = cropCoordinateX.valueAsNumber;
  const y = cropCoordinateY.valueAsNumber;
  if (!setCropCoordinates(coordinateCorner, x, y)) {
    cropCoordinateX.setCustomValidity("Enter whole-pixel coordinates inside the video without crossing the opposite corner.");
    cropCoordinateX.reportValidity();
    return;
  }
  cropCoordinateDialog.close();
  scheduleCropRender();
});
for (const input of [cropCoordinateX, cropCoordinateY]) {
  input.addEventListener("input", () => cropCoordinateX.setCustomValidity(""));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cropCoordinateDialog.close();
  });
}
document.querySelector("#crop-coordinate-cancel").addEventListener("click", () => cropCoordinateDialog.close());

pathInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadVideo().catch(console.error);
});
// Keep native pinch recognition enabled, but consume zoom gestures before the
// webview scales the controls. Only gestures over the video change its view.
window.addEventListener("wheel", (event) => {
  if (event.ctrlKey) event.preventDefault();
}, { passive: false, capture: true });
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "0"].includes(event.key)) {
    event.preventDefault();
  }
});
videoNavigation.addEventListener("wheel", (event) => {
  if (!videoLoaded || touchPoints.size || cropGesture) return;
  event.preventDefault();
  const { bounds } = videoDisplaySize();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
  const zoomSensitivity = event.ctrlKey ? 100 : 600;
  const fixedCrop = pointInsideCrop(event.clientX, event.clientY);
  if (!wheelGesture || event.timeStamp - wheelGesture.time > 180 || wheelGesture.ctrlKey !== event.ctrlKey
      || Math.hypot(event.clientX - wheelGesture.x, event.clientY - wheelGesture.y) > 1
      || wheelGesture.fixedCrop !== fixedCrop) {
    wheelGesture = { x: event.clientX, y: event.clientY, time: event.timeStamp, ctrlKey: event.ctrlKey,
      fixedCrop, delta: 0, snapshot: videoGestureSnapshot() };
  }
  wheelGesture.time = event.timeStamp;
  wheelGesture.delta -= Math.max(-240, Math.min(240, delta)) / zoomSensitivity;
  restoreVideoGesture(wheelGesture.snapshot);
  zoomVideoAt(wheelGesture.x, wheelGesture.y, wheelGesture.delta, wheelGesture.fixedCrop);
  // Discard input beyond a bound so reversing direction responds immediately.
  wheelGesture.delta = videoZoom - wheelGesture.snapshot.videoZoom;
  updateVideoView();
}, { passive: false });
videoNavigation.addEventListener("pointerdown", (event) => {
  if (!videoLoaded || cropGesture || contextPopovers.some((popover) => popover.open)) return;
  if (event.pointerType === "touch") {
    if (touchPoints.size >= 2 || (panGesture && !touchPoints.size)) return;
    event.preventDefault();
    clearTimeout(menuClickTimer);
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    videoNavigation.setPointerCapture(event.pointerId);
    if (touchPoints.size === 1) {
      videoDragMoved = false;
      beginVideoPan(event.pointerId, event.clientX, event.clientY);
    } else {
      const metrics = touchMetrics();
      pinchGesture = { ...metrics, fixedCrop: pointInsideCrop(metrics.x, metrics.y), snapshot: videoGestureSnapshot() };
      panGesture = null;
      videoDragMoved = true;
    }
    return;
  }
  if (panGesture || touchPoints.size || (event.button !== 0 && event.button !== 1)) return;
  event.preventDefault();
  clearTimeout(menuClickTimer);
  videoDragMoved = false;
  beginVideoPan(event.pointerId, event.clientX, event.clientY);
  videoNavigation.setPointerCapture(event.pointerId);
});
videoNavigation.addEventListener("pointermove", (event) => {
  if (touchPoints.has(event.pointerId)) {
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchGesture && touchPoints.size === 2) {
      const metrics = touchMetrics();
      if (metrics.distance < 1 || pinchGesture.distance < 1) return;
      restoreVideoGesture(pinchGesture.snapshot);
      zoomVideoAt(pinchGesture.x, pinchGesture.y, Math.log2(metrics.distance / pinchGesture.distance), pinchGesture.fixedCrop);
      panVideoBy(metrics.x - pinchGesture.x, metrics.y - pinchGesture.y, pinchGesture.fixedCrop);
      updateVideoView();
      return;
    }
  }
  if (!panGesture || event.pointerId !== panGesture.id) return;
  if (Math.hypot(event.clientX - panGesture.x, event.clientY - panGesture.y) > 4) videoDragMoved = true;
  if (!videoDragMoved) return;
  restoreVideoGesture(panGesture.snapshot);
  panVideoBy(event.clientX - panGesture.x, event.clientY - panGesture.y, panGesture.fixedCrop);
  updateVideoView();
});
videoNavigation.addEventListener("pointerup", (event) => {
  if (!touchPoints.has(event.pointerId)) {
    if (panGesture?.id === event.pointerId) endVideoPan();
    return;
  }
  touchPoints.delete(event.pointerId);
  if (videoNavigation.hasPointerCapture(event.pointerId)) videoNavigation.releasePointerCapture(event.pointerId);
  pinchGesture = null;
  if (touchPoints.size === 1) {
    const [id, point] = [...touchPoints.entries()][0];
    beginVideoPan(id, point.x, point.y);
  } else endVideoPan();
});
for (const name of ["pointercancel", "lostpointercapture"]) {
  videoNavigation.addEventListener(name, (event) => {
    if (touchPoints.has(event.pointerId) || panGesture?.id === event.pointerId) endVideoPan();
  });
}
videoNavigation.addEventListener("click", (event) => {
  if (!videoLoaded || videoDragMoved || event.detail > 1) return;
  clearTimeout(menuClickTimer);
  menuClickTimer = setTimeout(() => setMenuVisible(controlPanel.hidden), 250);
});
videoNavigation.addEventListener("dblclick", () => {
  if (videoDragMoved) return;
  clearTimeout(menuClickTimer);
  if (fullscreenView) toggleFullscreenView();
  else { setMenuVisible(true); resetVideoView(); }
});
fullscreenButton.addEventListener("click", toggleFullscreenView);
editToggle.addEventListener("click", async () => {
  endVideoPan();
  cancelFramePreview();
  if (editing) editVideoView = { videoZoom, videoPanX, videoPanY, defaultVideoView };
  editing = !editing;
  if (editing && editVideoView) {
    ({ videoZoom, videoPanX, videoPanY, defaultVideoView } = editVideoView);
    videoOutputBounds = {};
  } else {
    defaultVideoView = true;
    fitDefaultVideoView();
  }
  updateVideoView();
  scheduleCropRender();
  if (!editing) trimApplied = true;
  controlPanel.classList.toggle("is-editing", editing);
  if (defaultVideoView) updateVideoMargin();
  editToggle.setAttribute("aria-pressed", String(editing));
  editToggle.textContent = editing ? "Done" : "Edit";
  for (const popover of contextPopovers) if (popover.open) popover.close();
  renderTrim();
  renderPlayback();
  if (!editing) {
    try {
      paused = true;
      await setProperty("pause", true);
      await seekTo(inPoint);
    } catch (error) {
      setStatus("Could not start the trimmed preview.", true);
      console.error(error);
    }
  }
});
window.addEventListener("blur", endVideoPan);
window.addEventListener("resize", () => {
  wheelGesture = null;
  videoOutputBounds = {};
  scheduleCropRender();
  if (window.innerWidth >= 700 && window.innerHeight >= 400) {
    settingsWindowWidth = window.innerWidth;
    settingsWindowHeight = window.innerHeight;
    clearTimeout(settingsResizeTimer);
    settingsResizeTimer = window.setTimeout(persistPreferences, 400);
  }
});
playToggle.addEventListener("click", togglePlayback);
skipStart.addEventListener("click", () => seekTo(0).catch(console.error));
skipBack.addEventListener("click", () => seekTo(timePosition - skipBackSeconds).catch(console.error));
previousFrame.addEventListener("click", () => stepFrame(-1).catch(console.error));
nextFrame.addEventListener("click", () => stepFrame(1).catch(console.error));
skipForward.addEventListener("click", () => seekTo(timePosition + skipForwardSeconds).catch(console.error));
skipEnd.addEventListener("click", () => seekToLastFrame().catch(console.error));
skipBack.addEventListener("contextmenu", editSkipInterval);
skipForward.addEventListener("contextmenu", editSkipInterval);
skipForm.addEventListener("submit", (event) => {
  const value = Number(skipAmount.value);
  if (!Number.isFinite(value)) {
    event.preventDefault();
    skipAmount.setCustomValidity("Enter a number.");
    skipAmount.reportValidity();
    return;
  }
  skipAmount.setCustomValidity("");
  const roundedValue = Math.max(1, Math.min(Math.round(value), 3600));
  if (editingSkipDirection === "back") {
    skipBackSeconds = roundedValue;
  } else {
    skipForwardSeconds = roundedValue;
  }
  renderSkipInterval();
  persistPreferences();
});
skipAmount.addEventListener("input", () => skipAmount.setCustomValidity(""));
skipAmount.addEventListener("keydown", (event) => {
  if (event.key === "Escape") skipDialog.close();
});
trimTimeForm.addEventListener("submit", (event) => {
  const value = parseTimecode(trimTimeInput.value);
  if (editingTrimPoint === "playhead") {
    const { start, end } = playbackRange();
    if (value == null || frameIndex(value) > frameIndex(end) - frameIndex(start)) {
      event.preventDefault();
      trimTimeInput.setCustomValidity("Enter a time within the displayed playback range.");
      trimTimeInput.reportValidity();
      return;
    }
    trimTimeInput.setCustomValidity("");
    seekTo(frameTime(frameIndex(start) + frameIndex(value))).catch(console.error);
    return;
  }
  const invalidRange = value == null || value < 0 || value > lastFrameTime()
    || (editingTrimPoint === "in" && value > outPoint)
    || (editingTrimPoint === "out" && value < inPoint);
  if (invalidRange) {
    event.preventDefault();
    trimTimeInput.setCustomValidity("Enter a valid time within the selected range.");
    trimTimeInput.reportValidity();
    return;
  }

  trimTimeInput.setCustomValidity("");
  if (editingTrimPoint === "in") {
    inPoint = value;
  } else {
    outPoint = value;
    outPointTracksEnd = frameIndex(value) === frameIndex(lastFrameTime());
  }
  renderTrim();
  seekTo(value).catch(console.error);
});
trimTimeInput.addEventListener("input", () => trimTimeInput.setCustomValidity(""));
trimTimeInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") trimTimeDialog.close();
});
window.addEventListener("pointerdown", (event) => {
  for (const popover of contextPopovers) {
    if (popover.open && !popover.contains(event.target)) popover.close();
  }
});
progress.addEventListener("pointerdown", () => { isScrubbing = true; });
progress.addEventListener("pointerup", async () => {
  isScrubbing = false;
  await seekFromProgress();
});
progress.addEventListener("input", () => {
  renderPlayheadGap();
  if (!isScrubbing) return;
  cancelAnimationFrame(seekFrame);
  seekFrame = requestAnimationFrame(() => seekFromProgress().catch(console.error));
});
for (const [control, kind] of [[inControl, "in"], [outControl, "out"]]) {
  control.addEventListener("pointerdown", (event) => {
    if (!duration) return;
    event.preventDefault();
    draggingHandle = kind;
    control.setPointerCapture(event.pointerId);
    updateDraggedHandle(event);
  });
  control.addEventListener("pointermove", updateDraggedHandle);
  control.addEventListener("pointerup", () => { draggingHandle = null; });
  control.addEventListener("pointercancel", () => { draggingHandle = null; });
}
previewIn.addEventListener("click", () => seekTo(inPoint).catch(console.error));
previewOut.addEventListener("click", () => seekTo(outPoint).catch(console.error));
previewIn.addEventListener("contextmenu", editTrimTime);
previewOut.addEventListener("contextmenu", editTrimTime);
timeReadout.addEventListener("click", editPlayheadTime);
timeReadout.addEventListener("contextmenu", editPlayheadTime);
timeReadout.addEventListener("keydown", (event) => {
  if (event.key === "Enter") editPlayheadTime(event);
});
// Capture before focused inputs/popovers handle keys; use the same export path.
window.addEventListener("keydown", (event) => {
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.code !== "KeyS") return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) exportClip("lossless").catch(console.error);
}, { capture: true });

exportButton.addEventListener("click", () => exportClip("lossless"));
exportButton.addEventListener("contextmenu", openExportMenu);
for (const button of exportModeButtons) {
  button.addEventListener("click", () => {
    exportMenu.close();
    exportClip(button.dataset.exportMode).catch(console.error);
  });
}
window.addEventListener("keydown", (event) => {
  const typing = event.target.isContentEditable || event.target.matches('textarea, select, input:not([type="range"])');
  if (typing || !videoLoaded || contextPopovers.some((popover) => popover.open) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) togglePlayback();
  }
  if (event.code === "KeyF") {
    event.preventDefault();
    if (!event.repeat) toggleFullscreenView();
  }
  if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
    event.preventDefault();
    seekTo(timePosition + (event.code === "ArrowLeft" ? -skipBackSeconds : skipForwardSeconds)).catch(console.error);
  }
  if (event.code === "Comma" || event.code === "Period") {
    event.preventDefault();
    stepFrame(event.code === "Comma" ? -1 : 1).catch(console.error);
  }
});

// Initial media loading and explicit reset fit the video. Resizing the window
// or controls must not reapply the default 10px clearance.

renderSkipInterval();
loadPreferences().then(startPlayer);
