/*
 * Electron main process for "Oryares Engine Predictive Maintenance".
 *
 * Responsibilities:
 *   1. Enforce a single running instance.
 *   2. Pick a free loopback port.
 *   3. Launch the bundled FastAPI/PyInstaller backend on that port.
 *   4. Poll GET /api/health until the server is ready.
 *   5. Show the window pointing at the backend (which also serves the SPA).
 *   6. Tear the backend down when the app quits.
 */

const { app, BrowserWindow, shell, session, dialog } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// GPU selection
// ---------------------------------------------------------------------------
// Hybrid laptops (e.g. Intel iGPU + NVIDIA RTX) may bind Chromium's GPU process
// to the integrated adapter, which is what caused the three.js engine twin to
// lose its WebGL context. These switches must be appended before the app's
// ready event, so they live at module top level.
// Prefer the discrete/high-performance GPU when more than one is present.
app.commandLine.appendSwitch("force_high_performance_gpu");
// Lift Chromium's GPU blocklist so hardware acceleration stays on even for
// drivers that would otherwise be demoted to software rendering.
app.commandLine.appendSwitch("ignore-gpu-blocklist");

const PRODUCT_NAME = "Oryares Engine Predictive Maintenance";
const HEALTH_TIMEOUT_MS = 90000;

let mainWindow = null;
let backendProcess = null;
let backendLogStream = null;
let isQuitting = false;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
function backendExecutablePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "backend", "oryares-backend.exe");
  }
  return path.join(
    __dirname,
    "..",
    "..",
    "backend",
    "dist",
    "oryares-backend",
    "oryares-backend.exe"
  );
}

function openLogStream() {
  try {
    const logPath = path.join(app.getPath("userData"), "backend.log");
    backendLogStream = fs.createWriteStream(logPath, { flags: "a" });
    return logPath;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function pingHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForBackend(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isQuitting) return false;
    if (await pingHealth(port)) return true;
    await delay(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Backend lifecycle
// ---------------------------------------------------------------------------
async function startBackend() {
  const exePath = backendExecutablePath();
  if (!fs.existsSync(exePath)) {
    throw new Error(
      `Backend executable not found at:\n${exePath}\n\n` +
        "Build it first with backend\\backend.spec (PyInstaller)."
    );
  }

  const port = await getFreePort();
  const logPath = openLogStream();

  backendProcess = spawn(exePath, ["--host", "127.0.0.1", "--port", String(port)], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const writeLog = (chunk) => {
    if (backendLogStream) backendLogStream.write(chunk);
  };
  backendProcess.stdout.on("data", writeLog);
  backendProcess.stderr.on("data", writeLog);

  backendProcess.on("exit", (code, signal) => {
    if (!isQuitting && mainWindow) {
      dialog.showErrorBox(
        PRODUCT_NAME,
        `The local engine service stopped unexpectedly (${code ?? signal}).\n\nLog:\n${logPath ?? "n/a"}`
      );
    }
  });

  const ready = await waitForBackend(port, HEALTH_TIMEOUT_MS);
  if (!ready) {
    throw new Error(
      `The local engine service did not become ready within ${HEALTH_TIMEOUT_MS / 1000}s.\n\n` +
        `Log:\n${logPath ?? "n/a"}`
    );
  }

  return port;
}

function stopBackend() {
  if (!backendProcess) return;
  try {
    backendProcess.kill();
  } catch {
    /* ignore */
  }
  backendProcess = null;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: "#111827",
    autoHideMenuBar: true,
    title: PRODUCT_NAME,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Keep the app locked to the local service; open any external links in the
  // system browser instead of inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://127.0.0.1")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // Give the user a proper "Save As" dialog for exported PDF reports.
  session.defaultSession.on("will-download", (_event, item) => {
    const suggested = item.getFilename() || "engine_report.pdf";
    item.setSaveDialogOptions({
      title: "Save engine report",
      defaultPath: path.join(app.getPath("downloads"), suggested),
      filters: [{ name: "PDF report", extensions: ["pdf"] }],
    });
  });
}

function showStartupError(message) {
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>
      body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
      background:#111827;color:#9CA3AF;font-family:system-ui,Segoe UI,sans-serif;text-align:center}
      div{max-width:640px;padding:2rem}
      h2{color:#F87171}
      pre{white-space:pre-wrap;text-align:left;background:#0b1220;padding:1rem;border-radius:8px;color:#FBBF24;font-size:.8rem}
    </style></head><body><div>
      <h2>Could not start the engine service</h2>
      <pre>${message.replace(/</g, "&lt;")}</pre>
    </div></body></html>`;

  mainWindow = new BrowserWindow({
    width: 760,
    height: 520,
    backgroundColor: "#111827",
    autoHideMenuBar: true,
    title: PRODUCT_NAME,
  });
  mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const port = await startBackend();
      createWindow(port);
    } catch (err) {
      showStartupError(err && err.message ? err.message : String(err));
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    stopBackend();
  });

  app.on("will-quit", () => {
    stopBackend();
    if (backendLogStream) backendLogStream.end();
  });
}
