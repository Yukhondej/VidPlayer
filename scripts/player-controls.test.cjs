const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/main.js"), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("zoom bursts coalesce and present matched snapshots while the backend is busy", async () => {
  const frames = [];
  const sent = [];
  const painted = [];
  let finish;
  const context = vm.createContext({
    videoZoom: 0, videoPanX: 0, videoPanY: 0, videoAspect: 16 / 9,
    crop: { left: 0, top: 0, right: 1, bottom: 1 },
    cropCornerFrame: undefined, presentedView: null, viewUpdateTask: null,
    viewUpdatePending: false, viewUpdateRunning: false,
    renderCropCorners: () => painted.push(context.presentedView), console, setStatus() {},
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    invoke: (name, view) => {
      assert.equal(name, "set_video_view");
      sent.push({ ...view });
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  vm.runInContext(source.slice(source.indexOf("function videoGestureSnapshot"), source.indexOf("function restoreVideoGesture")), context);
  vm.runInContext(source.slice(source.indexOf("async function updateVideoView"), source.indexOf("function videoDisplaySize")), context);
  const frame = async () => { const callbacks = frames.splice(0); for (const callback of callbacks) callback(); await tick(); };
  const pending = vm.runInContext("updateVideoView()", context);
  const joined = vm.runInContext("videoZoom = 1; videoPanX = 0.2; crop.left = 0.1; updateVideoView()", context);
  assert.equal(frames.length, 1);
  await frame();
  assert.deepEqual(sent, [{ zoom: 1, panX: 0.2, panY: 0 }]);
  vm.runInContext("videoZoom = 2; updateVideoView(); videoZoom = 3; videoPanY = -0.4; crop.left = 0.3; updateVideoView()", context);
  assert.equal(sent.length, 1);
  assert.equal(painted.length, 0);
  finish(); await tick(); await frame();
  assert.deepEqual(sent[1], { zoom: 3, panX: 0.2, panY: -0.4 });
  assert.equal(painted[0].videoZoom, 1);
  assert.equal(painted[0].crop.left, 0.1);
  finish(); await pending; await joined; await frame();
  assert.equal(painted.at(-1).videoZoom, 3);
  assert.equal(painted.at(-1).crop.left, 0.3);
  assert.equal(context.viewUpdateRunning, false);
});

function mockDimensionNodes() {
  return Object.fromEntries(["extensions", "horizontal", "vertical", "width", "height"].map(name => {
    const attrs = {};
    return [name, { textContent: "", getAttribute: key => attrs[key], setAttribute: (key, value) => { attrs[key] = value; } }];
  }));
}

test("crop corners follow renderer bounds across aspect, pan and display-scale changes", () => {
  const cropCorners = { hidden: true, style: {} };
  const bounds = { left: 0, top: 0, width: 900, height: 600 };
  const context = vm.createContext({
    cropCorners, videoLoaded: true, editing: true, fullscreenView: false,
    presentedView: null, viewUpdateRunning: false, dimensionNodes: mockDimensionNodes(),
    videoZoom: 0, videoPanX: -0.5 / 9, videoPanY: -0.3, videoAspect: 700 / 390,
    crop: { left: 0, top: 0, right: 1, bottom: 1 }, cropGesture: null,
    exportButton: {}, exportModeButtons: [{}],
    cropDimensions: { hidden: true, innerHTML: "" }, sourceVideo: { w: 1920, h: 1080, rotate: 0 },
    window: { innerWidth: 900, innerHeight: 600 },
    cropShade: { classList: { toggle() {} }, hidden: true, children: Array.from({ length: 4 }, () => ({ style: {} })) },
    controlPanel: { hidden: false },
    videoOutputBounds: { w: 1800, h: 1200, ml: 200, mr: 200, mt: 20, mb: 400 },
    videoDisplaySize: () => ({ bounds, width: 900, height: 600 }),
  });
  vm.runInContext(source.slice(source.indexOf("function videoGestureSnapshot"), source.indexOf("function restoreVideoGesture")), context);
  // A matching complete native rectangle supplies exact renderer rounding.
  context.videoDisplaySize = () => ({ bounds, width: 700, height: 390 });
  context.videoPanX = 0;
  context.videoPanY = (10 - 105) / 390;
  vm.runInContext(source.slice(source.indexOf("function renderCropCorners"), source.indexOf("function resetVideoView")), context);
  const render = () => vm.runInContext("renderCropCorners()", context);
  render();
  assert.equal(cropCorners.style.left, "100px");
  assert.equal(cropCorners.style.top, "10px");
  assert.equal(cropCorners.style.width, "700px");
  assert.equal(cropCorners.style.height, "390px");
  // Late properties for another zoom must never displace the current crop.
  context.videoOutputBounds = { w: 1800, h: 1200, ml: -100, mr: 900, mt: 100, mb: -100 };
  render();
  assert.equal(cropCorners.style.left, "100px");
  assert.equal(cropCorners.style.width, "700px");
  context.crop = { left: 0.25, top: 0.2, right: 0.75, bottom: 0.8 };
  render();
  assert.equal(cropCorners.style.width, "350px");
  assert.equal(cropCorners.style.top, "88px");
  assert.equal(cropCorners.style.height, "234px");
  assert.equal(context.cropShade.children[0].style.height, "78px");
  assert.equal(context.cropShade.children[1].style.height, "78px");
  assert.equal(context.dimensionNodes.width.textContent, "960 px");
  context.editing = false;
  render();
  assert.equal(cropCorners.hidden, true);
  assert.equal(context.cropShade.hidden, false);
  assert.equal(context.cropDimensions.hidden, true);
  context.editing = true;
  render();
  assert.equal(cropCorners.style.height, "234px");
});

test("crop corners clamp to the source and cannot cross their opposite corner", () => {
  const context = vm.createContext({ sourceVideo: { w: 1920, h: 1080, rotate: 0 }, crop: { left: 0, top: 0, right: 1, bottom: 1 } });
  vm.runInContext(source.slice(source.indexOf("function sourcePixelSize"), source.indexOf("function endCropDrag")), context);
  for (const corner of ["tl", "tr", "bl", "br"]) {
    context.crop = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 };
    vm.runInContext(`moveCropCorner("${corner}", ${corner.includes("l") ? -5 : 5}, ${corner.includes("t") ? -5 : 5})`, context);
    assert.equal(context.crop[corner.includes("l") ? "left" : "right"], corner.includes("l") ? 0 : 1);
    assert.equal(context.crop[corner.includes("t") ? "top" : "bottom"], corner.includes("t") ? 0 : 1);
    assert.equal(context.crop[corner.includes("l") ? "right" : "left"], corner.includes("l") ? 0.8 : 0.2);
    vm.runInContext(`moveCropCorner("${corner}", ${corner.includes("l") ? 5 : -5}, ${corner.includes("t") ? 5 : -5})`, context);
    assert.ok(context.crop.right > context.crop.left);
    assert.ok(context.crop.bottom > context.crop.top);
  }
});

test("Explorer startup waits for the player and preserves spaces and Unicode in paths", async () => {
  const calls = [];
  const selectedPath = "C:\\Videos\\คลิป holiday.mp4";
  const pathInput = { disabled: true, value: "", focus() {} };
  let finishInit;
  const context = vm.createContext({
    WINDOW_LABEL: "main", pathInput, console,
    listen: async () => {},
    init: () => new Promise((resolve) => { finishInit = resolve; }),
    invoke: async (name) => { calls.push(name); return selectedPath; },
    loadVideo: async () => { calls.push(pathInput.value); },
    setLoadWarning: (message) => assert.fail(message),
  });
  vm.runInContext(source.slice(source.indexOf("async function loadStartupVideo"), source.indexOf('for (const handle of cropCorners.querySelectorAll')), context);
  const started = vm.runInContext("startPlayer()", context);
  await tick();
  assert.deepEqual(calls, []);
  finishInit();
  await started;
  assert.deepEqual(calls, ["startup_video_path", selectedPath]);
  assert.equal(pathInput.disabled, false);
});

test("normal startup leaves the path-entry screen ready without loading a file", async () => {
  const context = vm.createContext({
    pathInput: { value: "" },
    invoke: async () => null,
    loadVideo: async () => assert.fail("No video should be loaded"),
  });
  vm.runInContext(source.slice(source.indexOf("async function loadStartupVideo"), source.indexOf("async function startPlayer")), context);
  await vm.runInContext("loadStartupVideo()", context);
  assert.equal(context.pathInput.value, "");
});

test("preferences load before use and changed values are saved", async () => {
  const saves = [];
  const context = vm.createContext({
    skipBackSeconds: 5, skipForwardSeconds: 5, lastExportFolder: "",
    settingsWindowWidth: 900, settingsWindowHeight: 600,
    settingsSaveTask: Promise.resolve(), settingsLoaded: false,
    renderSkipInterval() {}, console,
    invoke: async (name, args) => {
      if (name === "load_settings") return {
        skipBackSeconds: 12, skipForwardSeconds: 8,
        windowWidth: 1100, windowHeight: 700,
        lastExportFolder: "C:\\Exports\\",
      };
      saves.push(args.settings);
    },
  });
  vm.runInContext(source.slice(source.indexOf("async function loadPreferences"), source.indexOf("async function loadStartupVideo")), context);
  await vm.runInContext("loadPreferences()", context);
  assert.equal(context.skipBackSeconds, 12);
  assert.equal(context.lastExportFolder, "C:\\Exports\\");
  vm.runInContext("skipForwardSeconds = 15; persistPreferences()", context);
  await context.settingsSaveTask;
  assert.equal(saves.length, 1);
  assert.equal(saves[0].skipForwardSeconds, 15);
  assert.equal(saves[0].windowWidth, 1100);
});

test("compact central timecodes switch at one minute", () => {
  const context = vm.createContext({ fps: 25, duration: 100 });
  vm.runInContext(source.slice(source.indexOf("function frameRate"), source.indexOf("function renderPlayback")), context);
  assert.equal(vm.runInContext("formatTime(5.48, 59.96, true)", context), "05:12");
  assert.equal(vm.runInContext("formatTime(5.48, 60, true)", context), "00:05:12");
  assert.equal(vm.runInContext("parseTimecode('05:12')", context), 5.48);
  assert.equal(vm.runInContext("parseTimecode('05:25')", context), null);
});

test("typed playhead time uses the visible range origin and rejects positions past its end", () => {
  let submit;
  let sought;
  let invalid = "";
  const context = vm.createContext({
    fps: 25, duration: 20, editingTrimPoint: "playhead",
    playbackRange: () => ({ start: 5, end: 7 }),
    trimTimeInput: { value: "00:01:00", setCustomValidity(value) { invalid = value; }, reportValidity() {} },
    trimTimeForm: { addEventListener(_, handler) { submit = handler; } },
    seekTo: async (value) => { sought = value; }, console,
  });
  vm.runInContext(source.slice(source.indexOf("function frameRate"), source.indexOf("function renderPlayback")), context);
  const start = source.indexOf('trimTimeForm.addEventListener("submit"');
  vm.runInContext(source.slice(start, source.indexOf('trimTimeInput.addEventListener("input"', start)), context);
  let prevented = false;
  const event = { preventDefault() { prevented = true; } };
  submit(event);
  assert.equal(sought, 6);
  assert.equal(invalid, "");
  context.trimTimeInput.value = "00:02:00";
  submit(event);
  assert.equal(sought, 7);
  context.trimTimeInput.value = "00:02:01";
  submit(event);
  assert.equal(prevented, true);
  assert.notEqual(invalid, "");
  assert.equal(sought, 7);
});

test("frame timecodes round-trip at integer and fractional frame rates", () => {
  for (const fps of [24, 25, 30, 24000 / 1001, 30000 / 1001, 60000 / 1001]) {
    const context = vm.createContext({ fps, duration: 4000 });
    vm.runInContext(source.slice(source.indexOf("function frameRate"), source.indexOf("function renderPlayback")), context);
    const nominal = Math.round(fps);
    for (const index of [0, 1, nominal - 1, nominal, nominal * 60, nominal * 3600, 123457]) {
      context.index = index;
      assert.equal(vm.runInContext("frameIndex(parseTimecode(formatTime(frameTime(index))))", context), index);
    }
    context.duration = 1;
    assert.equal(vm.runInContext("formatTime(0)", context), "00:00:00");
    assert.equal(vm.runInContext(`formatTime(frameTime(${nominal - 1}))`, context), `00:00:${String(nominal - 1).padStart(2, "0")}`);
    assert.equal(vm.runInContext(`formatTime(frameTime(${nominal}))`, context), "00:01:00");
  }
});

test("last timestamp is frame N-1; inclusive export contains N frames", () => {
  const context = vm.createContext({ fps: 30000 / 1001, duration: 300 * 1001 / 30000 });
  vm.runInContext(source.slice(source.indexOf("function frameRate"), source.indexOf("function formatTime")), context);
  vm.runInContext(source.slice(source.indexOf("function lastFrameTime"), source.indexOf("async function seekToLastFrame")), context);
  assert.equal(vm.runInContext("frameIndex(lastFrameTime())", context), 299);
  assert.ok(Math.abs(vm.runInContext("lastFrameTime() + frameTime(1) - duration", context)) < 1e-10);
  context.duration = 1001 / 30000;
  assert.equal(vm.runInContext("lastFrameTime()", context), 0);
});

test("trimmed timeline rebases time, includes the Out frame, and reaches its visual end", () => {
  const context = vm.createContext({
    trimApplied: true, editing: false, inPoint: 5, outPoint: 7, duration: 20,
    fps: 25, timePosition: 7, isScrubbing: false, paused: true,
    frameTime: (index) => index / 25, frameIndex: (seconds) => Math.round(seconds * 25),
    lastFrameTime: () => 19.96,
    progress: { value: "0" }, timeReadout: {},
    timeline: { style: { setProperty() {} } },
    formatTime: (value) => value.toFixed(2),
    playIcon: { classList: { toggle() {} } }, pauseIcon: { classList: { toggle() {} } },
    playToggle: { setAttribute() {} },
  });
  vm.runInContext(source.slice(source.indexOf("function playbackRange"), source.indexOf("async function enforceTrimRange")), context);
  vm.runInContext(source.slice(source.indexOf("function renderPlayback"), source.indexOf("function renderSkipInterval")), context);
  vm.runInContext("renderPlayback()", context);
  assert.equal(context.progress.value, "1000");
  assert.equal(context.timeReadout.value, "2.00 / 2.00");
  context.timePosition = 5;
  vm.runInContext("renderPlayback()", context);
  assert.equal(context.progress.value, "0");
  context.editing = true;
  assert.equal(vm.runInContext("playbackRange().start", context), 0);
  context.timePosition = 19.96;
  vm.runInContext("renderPlayback()", context);
  assert.equal(context.progress.value, "1000");
});

test("trimmed playback stops at Out and corrects positions outside the range", async () => {
  const seeks = [], pauses = [];
  const context = vm.createContext({
    trimApplied: true, editing: false, enforcingTrim: false, pendingFrameSteps: 0,
    paused: false, timePosition: 7.1, playbackRange: () => ({ start: 5, end: 7 }),
    setProperty: async (_, value) => pauses.push(value), seekTo: async (value) => seeks.push(value),
    renderPlayback() {}, setStatus() {}, console,
  });
  vm.runInContext(source.slice(source.indexOf("async function enforceTrimRange"), source.indexOf("let fullscreenView")), context);
  await vm.runInContext("enforceTrimRange()", context);
  assert.deepEqual(pauses, [true]);
  assert.deepEqual(seeks, [7]);
  assert.equal(context.timePosition, 7);
  context.timePosition = 4;
  await vm.runInContext("enforceTrimRange()", context);
  assert.deepEqual(seeks, [7, 5]);
});

test("Space works with a focused timeline and ignores held-key repeats and text entry", () => {
  let handler;
  let plays = 0;
  let fullscreen = 0;
  const context = vm.createContext({
    videoLoaded: true, contextPopovers: [],
    togglePlayback: () => { plays++; },
    toggleFullscreenView: () => { fullscreen++; },
    window: { addEventListener: (_, callback) => { handler = callback; } },
  });
  const start = source.lastIndexOf('window.addEventListener("keydown"');
  vm.runInContext(source.slice(start, source.indexOf("// Initial media loading", start)), context);
  let prevented = false;
  const event = { code: "Space", repeat: false, target: { matches: () => false }, preventDefault() { prevented = true; } };
  handler(event);
  assert.equal(plays, 1);
  assert.equal(prevented, true);
  handler({ ...event, repeat: true });
  handler({ ...event, target: { matches: () => true } });
  assert.equal(plays, 1);
  handler({ ...event, code: "KeyF" });
  assert.equal(fullscreen, 1);
});

test("fullscreen fits the whole window, hides controls, and restores the previous view", () => {
  const panel = { hidden: false, contains: () => false };
  const context = vm.createContext({
    videoLoaded: true, videoZoom: 1, videoPanX: 0.2, videoPanY: -0.3, defaultVideoView: false,
    controlPanel: panel, contextPopovers: [], document: { activeElement: null },
    fullscreenButton: { setAttribute() {} }, clearTimeout, updateVideoView() {}, scheduleCropRender() {}, hasCrop: () => false,
  });
  const start = source.indexOf("let editing =");
  vm.runInContext(source.slice(start, source.indexOf("// One native request", start)), context);
  vm.runInContext("toggleFullscreenView()", context);
  assert.equal(panel.hidden, true);
  assert.equal(context.videoZoom, 0);
  assert.equal(context.videoPanX, 0);
  assert.equal(context.videoPanY, 0);
  vm.runInContext("toggleFullscreenView()", context);
  assert.equal(panel.hidden, false);
  assert.equal(context.videoZoom, 1);
  assert.equal(context.videoPanX, 0.2);
  assert.equal(context.videoPanY, -0.3);
});

function player() {
  let actual = 10;
  let finish;
  let fail = false;
  const commands = [];
  const context = vm.createContext({
    WINDOW_LABEL: "main", duration: 20, timePosition: 10, fps: 25,
    paused: true, eofReached: false,
    renderPlayback() {}, setStatus() {}, setProperty: async () => {},
    lastFrameTime: () => 19.96,
    playbackRange: () => ({ start: 0, end: 19.96 }),
    command: async (name) => {
      commands.push(name);
      if (fail) throw new Error("Decoder error");
    },
    invoke: async (_, { name }) => {
      if (name === "time-pos") return actual;
      if (name === "pause") return true;
      if (name === "seeking") return new Promise((resolve) => {
        finish = () => {
          actual = Math.max(0, Math.min(19.96, actual + (commands.at(-1) === "frame-step" ? 0.04 : -0.04)));
          resolve(false);
        };
      });
    },
    window: { setTimeout },
  });
  const run = (code) => vm.runInContext(code, context);
  run(source.slice(source.indexOf("let frameStepInProgress"), source.indexOf("let videoMarginFrame")));
  run(source.slice(source.indexOf("async function stepFrame"), source.indexOf("function lastFrameTime")));
  run("confirmedTimePosition = 10");
  return { context, commands, run, finish: () => finish(), fail: () => { fail = true; } };
}

test("back/back/forward preserves all keypresses while decoding is delayed", async () => {
  const p = player();
  const tasks = [p.run("stepFrame(-1)"), p.run("stepFrame(-1)"), p.run("stepFrame(1)")];
  assert.ok(Math.abs(p.context.timePosition - 9.96) < 1e-8);
  await tick();
  assert.deepEqual(p.commands, ["frame-back-step"]);
  for (let index = 0; index < tasks.length; index++) {
    p.finish();
    await tasks[index];
    await tick();
    assert.ok(Math.abs(p.context.timePosition - 9.96) < 1e-8);
  }
  assert.deepEqual(p.commands, ["frame-back-step", "frame-back-step", "frame-step"]);
  assert.equal(p.run("pendingFrameSteps"), 0);
  assert.equal(p.run("frameStepInProgress"), false);
});

test("forward then backward uses the same ordered queue", async () => {
  const p = player();
  const tasks = [p.run("stepFrame(1)"), p.run("stepFrame(-1)")];
  await tick();
  assert.deepEqual(p.commands, ["frame-step"]);
  p.finish(); await tasks[0]; await tick();
  p.finish(); await tasks[1];
  assert.deepEqual(p.commands, ["frame-step", "frame-back-step"]);
  assert.ok(Math.abs(p.context.timePosition - 10) < 1e-8);
});

test("navigation cancels stale queued work and preserves the new readout", async () => {
  const p = player();
  const tasks = [p.run("stepFrame(-1)"), p.run("stepFrame(1)")];
  await tick();
  p.run("cancelFramePreview(); timePosition = 5");
  p.finish(); await Promise.all(tasks);
  assert.equal(p.context.timePosition, 5);
  assert.deepEqual(p.commands, ["frame-back-step"]);
});

test("decoder failure restores the confirmed timestamp and clears the queue", async () => {
  const p = player();
  p.fail();
  await assert.rejects(p.run("stepFrame(-1)"));
  assert.equal(p.context.timePosition, 10);
  assert.equal(p.run("pendingFrameSteps"), 0);
});

test("native pinch is enabled and its browser default is intercepted", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
  assert.equal(config.app.windows[0].zoomHotkeysEnabled, true);
  const handlers = {};
  const context = vm.createContext({ window: { addEventListener(name, handler, options) {
    handlers[name] = handler;
    if (name === "wheel") assert.deepEqual(options.passive, false);
  } } });
  const start = source.indexOf('window.addEventListener("wheel"');
  vm.runInContext(source.slice(start, source.indexOf('videoNavigation.addEventListener("wheel"', start)), context);
  let prevented = false;
  handlers.wheel({ ctrlKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  prevented = false;
  handlers.wheel({ ctrlKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});

function cropContext() {
  const context = vm.createContext({ sourceVideo: { w: 1920, h: 1080, rotate: 0 },
    crop: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 } });
  vm.runInContext(source.slice(source.indexOf("function sourcePixelSize"), source.indexOf("function endCropDrag")), context);
  return context;
}

test("crop zoom keeps screen edges stationary to the nearest source pixel", () => {
  const context = cropContext();
  const original = { ...context.crop };
  const scale = vm.runInContext("cropThroughZoom(1.7, 0.4, 0.6)", context);
  for (const [edge, anchor, pixels] of [["left", 0.4, 1920], ["right", 0.4, 1920], ["top", 0.6, 1080], ["bottom", 0.6, 1080]]) {
    const projected = anchor + (context.crop[edge] - anchor) * scale;
    assert.ok(Math.abs(projected - original[edge]) <= scale / (2 * pixels) + 1e-12);
    assert.ok(Math.abs(context.crop[edge] * pixels - Math.round(context.crop[edge] * pixels)) < 1e-9);
  }
  assert.ok(context.crop.right - context.crop.left < original.right - original.left);
  vm.runInContext("cropThroughZoom(0.01, 0.4, 0.6)", context);
  assert.ok(context.crop.left >= 0 && context.crop.top >= 0 && context.crop.right <= 1 && context.crop.bottom <= 1);
});

test("one pixel crop, odd dimensions, and rotated source retain exact geometry", () => {
  const context = cropContext();
  vm.runInContext("moveCropCorner('tl', 101 / 1920, 53 / 1080); moveCropCorner('br', 802 / 1920, 554 / 1080)", context);
  let pixels = vm.runInContext("cropPixels()", context);
  assert.deepEqual(JSON.parse(JSON.stringify(pixels)), { x: 101, y: 53, width: 701, height: 501, sourceWidth: 1920, sourceHeight: 1080 });
  vm.runInContext("moveCropCorner('tl', 1, 1)", context);
  pixels = vm.runInContext("cropPixels()", context);
  assert.equal(pixels.width, 1);
  assert.equal(pixels.height, 1);
  context.sourceVideo.rotate = 90;
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("sourcePixelSize()", context))), { width: 1080, height: 1920 });
});

test("normal and fullscreen views center and fit the selected crop", () => {
  const context = cropContext();
  Object.assign(context, { editorScreen: { hidden: false }, controlPanel: { hidden: false, getBoundingClientRect: () => ({ top: 500 }) },
    window: { innerWidth: 900, innerHeight: 600 }, fullscreenView: false, editing: false, videoAspect: 16 / 9,
    videoZoom: 0, videoPanX: 0, videoPanY: 0, videoOutputBounds: {} });
  vm.runInContext(source.slice(source.indexOf("function fitDefaultVideoView"), source.indexOf("function updateVideoMargin")), context);
  for (const fullscreen of [false, true]) {
    context.fullscreenView = fullscreen;
    vm.runInContext("fitDefaultVideoView()", context);
    const width = 900 * 2 ** context.videoZoom;
    const height = width / context.videoAspect;
    const x = 450 + (context.videoPanX - 0.5 + context.crop.left) * width;
    const y = 300 + (context.videoPanY - 0.5 + context.crop.top) * height;
    assert.ok(x >= -1e-8 && y >= -1e-8);
    assert.ok(x + width * 0.5 <= 900 + 1e-8);
    assert.ok(y + height * 0.5 <= (fullscreen ? 600 : 500) + 1e-8);
  }
});

function navigationContext() {
  const context = cropContext();
  const handlers = {};
  const captured = new Set();
  Object.assign(context, {
    videoLoaded: true, editing: true, cropCorners: { hidden: false }, cropGesture: null,
    window: { innerWidth: 960, innerHeight: 540 }, wheelGesture: null,
    videoZoom: 0, videoPanX: 0, videoPanY: 0, videoAspect: 16 / 9, videoOutputBounds: {}, defaultVideoView: false,
    panGesture: null, pinchGesture: null, touchPoints: new Map(), videoDragMoved: false, contextPopovers: [],
    menuClickTimer: null, clearTimeout, updateVideoView() {},
    videoNavigation: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
      classList: { add() {}, remove() {} },
      addEventListener: (name, fn) => { handlers[name] = fn; },
      setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id),
      releasePointerCapture: id => { captured.delete(id); handlers.lostpointercapture?.({ pointerId: id }); },
    },
  });
  vm.runInContext(source.slice(source.indexOf("function videoDisplaySize"), source.indexOf("function renderCropCorners")), context);
  vm.runInContext(source.slice(source.indexOf("function renderedVideoBounds"), source.indexOf("function sourcePixelSize")), context);
  vm.runInContext(source.slice(source.indexOf("function endVideoPan"), source.indexOf("function setStatus")), context);
  vm.runInContext(source.slice(source.indexOf('videoNavigation.addEventListener("wheel"'), source.indexOf('videoNavigation.addEventListener("click"')), context);
  const dispatch = (name, id, x, y, pointerType = "touch") => handlers[name]({ pointerId: id, clientX: x, clientY: y, pointerType, button: 0, preventDefault() {} });
  const rect = () => {
    const r = vm.runInContext("renderedVideoBounds(true)", context);
    return { x: r.left + context.crop.left * r.width, y: r.top + context.crop.top * r.height,
      width: (context.crop.right - context.crop.left) * r.width, height: (context.crop.bottom - context.crop.top) * r.height };
  };
  return { context, dispatch, rect, captured, handlers };
}

test("coordinate entry uses exclusive far boundaries and rejects crossing or fractional input", () => {
  const { context } = navigationContext();
  assert.equal(vm.runInContext("setCropCoordinates('tl', 0, 0)", context), true);
  assert.equal(vm.runInContext("setCropCoordinates('br', 1920, 1080)", context), true);
  assert.equal(context.crop.right, 1);
  assert.equal(context.crop.bottom, 1);
  assert.equal(vm.runInContext("setCropCoordinates('tl', 101, 53)", context), true);
  assert.equal(vm.runInContext("setCropCoordinates('br', 802, 554)", context), true);
  for (const expr of ["setCropCoordinates('tl', 802, 53)", "setCropCoordinates('br', 101, 554)", "setCropCoordinates('br', 1921, 1080)", "setCropCoordinates('tl', -1, 0)", "setCropCoordinates('tl', 1.5, 0)"]) {
    const saved = JSON.stringify(context.crop);
    assert.equal(vm.runInContext(expr, context), false);
    assert.equal(JSON.stringify(context.crop), saved);
  }
  const pixels = vm.runInContext("cropPixels()", context);
  assert.equal(pixels.width, 701);
  assert.equal(pixels.height, 501);
});

test("panning inside the crop keeps its screen edges fixed and cannot expose empty image", () => {
  const { context, dispatch, rect } = navigationContext();
  const initial = rect();
  dispatch("pointerdown", 1, 480, 270, "mouse");
  dispatch("pointermove", 1, 530, 300, "mouse");
  for (const key of Object.keys(initial)) assert.ok(Math.abs(rect()[key] - initial[key]) < 1e-8);
  assert.ok(context.crop.left < 0.25 && context.crop.top < 0.25);
  dispatch("pointermove", 1, 10000, 10000, "mouse");
  assert.equal(context.crop.left, 0);
  assert.equal(context.crop.top, 0);
  for (const key of Object.keys(initial)) assert.ok(Math.abs(rect()[key] - initial[key]) < 1e-8);
  dispatch("pointerup", 1, 10000, 10000, "mouse");
  assert.equal(context.panGesture, null);
});

test("panning outside crop moves the frame with the picture", () => {
  const { context, dispatch, rect } = navigationContext();
  const initial = rect();
  dispatch("pointerdown", 1, 30, 30, "mouse");
  dispatch("pointermove", 1, 80, 70, "mouse");
  assert.equal(context.crop.left, 0.25);
  assert.ok(Math.abs(rect().x - initial.x - 50) < 1e-8);
  assert.ok(Math.abs(rect().y - initial.y - 40) < 1e-8);
});

test("touch pinch and translation keep crop fixed, rebase to one finger, and clean up capture", () => {
  const { context, dispatch, rect, captured } = navigationContext();
  const initial = rect();
  dispatch("pointerdown", 1, 400, 270);
  dispatch("pointerdown", 2, 560, 270);
  dispatch("pointermove", 1, 320, 270);
  dispatch("pointermove", 2, 640, 270);
  assert.equal(context.videoZoom, 1);
  for (const key of Object.keys(initial)) assert.ok(Math.abs(rect()[key] - initial[key]) < 1e-8);
  dispatch("pointermove", 1, 360, 290);
  dispatch("pointermove", 2, 680, 290);
  for (const key of Object.keys(initial)) assert.ok(Math.abs(rect()[key] - initial[key]) < 1e-8);
  dispatch("pointerdown", 3, 400, 300);
  assert.equal(context.touchPoints.size, 2);
  dispatch("pointerup", 2, 680, 290);
  const previous = rect();
  dispatch("pointermove", 1, 370, 300);
  for (const key of Object.keys(previous)) assert.ok(Math.abs(rect()[key] - previous[key]) < 1e-8);
  assert.equal(context.videoDragMoved, true);
  dispatch("pointercancel", 1, 370, 300);
  assert.equal(context.touchPoints.size, 0);
  assert.equal(captured.size, 0);
  assert.equal(context.panGesture, null);
  assert.equal(context.pinchGesture, null);
});

test("touch pinch outside crop scales crop and video together", () => {
  const { context, dispatch, rect } = navigationContext();
  const initial = rect();
  dispatch("pointerdown", 1, 20, 50);
  dispatch("pointerdown", 2, 80, 50);
  dispatch("pointermove", 1, 0, 50);
  dispatch("pointermove", 2, 100, 50);
  assert.equal(context.crop.left, 0.25);
  assert.equal(context.crop.right, 0.75);
  assert.ok(rect().width > initial.width);
});


test("tiny wheel inputs accumulate without moving the fixed crop frame", () => {
  const { context, rect, handlers } = navigationContext();
  const initial = rect();
  for (let i = 0; i < 200; i++) {
    handlers.wheel({ clientX: 480, clientY: 270, deltaY: -0.05, deltaMode: 0, ctrlKey: true, timeStamp: i * 2, preventDefault() {} });
  }
  const pixels = vm.runInContext("cropPixels()", context);
  // Same result as one accumulated gesture, not 200 rounded intermediate crops.
  const expected = navigationContext();
  vm.runInContext("zoomVideoAt(480, 270, 0.1)", expected.context);
  assert.deepEqual(JSON.parse(JSON.stringify(pixels)), JSON.parse(JSON.stringify(vm.runInContext("cropPixels()", expected.context))));
  for (const key of Object.keys(initial)) assert.ok(Math.abs(rect()[key] - initial[key]) < 0.6);
  assert.ok(pixels.width < 960);
});

test("wheel input reverses immediately after reaching image bounds", () => {
  const { context, handlers } = navigationContext();
  context.crop = { left: 0, top: 0, right: 1, bottom: 1 };
  const wheel = (deltaY, timeStamp) => handlers.wheel({ clientX: 480, clientY: 270, deltaY, deltaMode: 0, ctrlKey: true, timeStamp, preventDefault() {} });
  for (let i = 0; i < 10; i++) wheel(100, i * 10);
  assert.equal(context.videoZoom, 0);
  wheel(-10, 101);
  assert.ok(context.videoZoom > 0);
});

test("overlay invalidations coalesce and dimensions reuse nodes without rewriting unchanged values", () => {
  const frames = [];
  let painted = 0;
  const context = cropContext();
  Object.assign(context, { cropCornerFrame: undefined, renderCropCorners: () => painted++,
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    cropDimensions: { hidden: false }, dimensionNodes: mockDimensionNodes() });
  vm.runInContext(source.slice(source.indexOf("function scheduleCropRender"), source.indexOf("function videoDisplaySize")), context);
  vm.runInContext("for (let i = 0; i < 200; i++) scheduleCropRender()", context);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(painted, 1);
  vm.runInContext("renderCropDimensions({ left: 100, top: 60 }, { left: 200, top: 150, right: 700, bottom: 400 })", context);
  const originalNodes = context.dimensionNodes;
  let writes = 0;
  for (const node of Object.values(originalNodes)) node.setAttribute = () => { writes++; };
  vm.runInContext("renderCropDimensions({ left: 100, top: 60 }, { left: 200, top: 150, right: 700, bottom: 400 })", context);
  assert.equal(context.dimensionNodes, originalNodes);
  assert.equal(writes, 0);
  assert.equal(originalNodes.width.textContent, "960 px");
  assert.equal(originalNodes.height.textContent, "540 px");
});


test("Ctrl+S captures across focused inputs and popovers and calls the button's export path", () => {
  let handler;
  const calls = [];
  const context = vm.createContext({ console,
    window: { addEventListener(name, callback, options) { assert.equal(name, "keydown"); assert.equal(options.capture, true); handler = callback; } },
    exportClip: async mode => { calls.push(mode); },
  });
  vm.runInContext(source.slice(source.indexOf("// Capture before focused"), source.indexOf('exportButton.addEventListener("click"')), context);
  for (const target of [{ isContentEditable: true }, { tagName: "INPUT" }, { tagName: "DIALOG" }]) {
    let prevented = false, stopped = false;
    handler({ ctrlKey: true, code: "KeyS", target, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  }
  handler({ ctrlKey: true, code: "KeyS", repeat: true, preventDefault() {}, stopPropagation() {} });
  handler({ ctrlKey: false, code: "KeyS" });
  assert.deepEqual(calls, ["lossless", "lossless", "lossless"]);
});

test("export works outside Edit and prevents duplicate save dialogs until completion", async () => {
  let closeDialog;
  let dialogs = 0;
  const context = vm.createContext({
    videoLoaded: true, duration: 10, editing: false, exportInProgress: false, lastExportFolder: "",
    hasCrop: () => false, inPoint: 0, outPoint: 9, frameTime: () => 1 / 30,
    exportButton: {}, pathInput: { value: "C:/Videos/example.mp4" }, exportProgress: {},
    renderTrim() {}, console, setExportResult() {},
    invoke: async name => { assert.equal(name, "plugin:dialog|save"); dialogs++; return new Promise(resolve => { closeDialog = resolve; }); },
  });
  vm.runInContext(source.slice(source.indexOf("async function exportClip"), source.indexOf("function updateDraggedHandle")), context);
  const first = vm.runInContext("exportClip('lossless')", context);
  await vm.runInContext("exportClip('lossless')", context);
  assert.equal(dialogs, 1);
  assert.equal(context.exportInProgress, true);
  closeDialog(null); await first;
  assert.equal(context.exportInProgress, false);
  const next = vm.runInContext("exportClip('lossless')", context);
  assert.equal(dialogs, 2);
  closeDialog(null); await next;
  context.videoLoaded = false;
  await vm.runInContext("exportClip('lossless')", context);
  assert.equal(dialogs, 2);
});
