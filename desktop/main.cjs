/**
 * 视频快译 · Electron 主进程
 * 职责：
 *  1) 用内置 Node（ELECTRON_RUN_AS_NODE）拉起 Next.js standalone 本地服务（127.0.0.1 随机端口）
 *  2) 注入便携 Python / ffmpeg / 数据目录 / DeepSeek 密钥等环境变量
 *  3) 显示桌面窗口，外部链接交给系统浏览器
 *  4) electron-updater 检测更新（generic feed，默认 GitHub Releases，可在设置里改）
 */
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require("electron");
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const os = require("os");
const crypto = require("crypto");

const APP_NAME = "视频快译";
const DEV_URL = process.env.VTS_DEV_URL || ""; // 开发联调：直接加载已在运行的 next dev
const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const USER_DATA = app.getPath("userData");
const HOME = path.join(USER_DATA, "vtdata"); // 所有任务/上传/模型缓存
const CONFIG_FILE = path.join(HOME, "config.json");
const SERVER_LOG = path.join(USER_DATA, "server.log");
const APP_LOG = path.join(USER_DATA, "app.log");

const DEFAULT_FEED =
  "https://github.com/xy7-M/video-translate-studio-feed/releases/latest/download/";

fs.mkdirSync(HOME, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(APP_LOG, line);
  } catch {
    /* ignore */
  }
  console.log(msg);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeConfig(patch) {
  const cfg = Object.assign(readConfig(), patch);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  return cfg;
}

let mainWin = null;
let serverProc = null;
let serverPort = 0;

// ────────────────────────── 单实例 ──────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
}

// ───────────────────── 旧版 .data 迁移（一次性） ─────────────────────
/** 任务元数据很小，启动前同步迁移；大目录后台复制，避免开窗卡顿 */
function migrateLegacyData() {
  const flag = path.join(USER_DATA, ".legacy-migrated");
  if (fs.existsSync(flag)) return;
  const candidates = [
    path.join(app.getPath("desktop"), "My Item", "视频快译", ".data"),
    "c:\\Users\\12653\\OneDrive\\Desktop\\My Item\\视频快译\\.data",
  ];
  let old = candidates.find((p) => fs.existsSync(p) && path.resolve(p) !== path.resolve(HOME));
  if (!old) {
    fs.writeFileSync(flag, new Date().toISOString());
    return;
  }
  try {
    const tasksSrc = path.join(old, "tasks");
    if (fs.existsSync(tasksSrc) && !fs.existsSync(path.join(HOME, "tasks"))) {
      fs.cpSync(tasksSrc, path.join(HOME, "tasks"), { recursive: true });
      log("已迁移旧任务记录 tasks/");
    }
  } catch (e) {
    log(`迁移旧任务失败（可忽略）：${e.message}`);
  }
  fs.writeFileSync(flag, new Date().toISOString());
  // 模型缓存 / 产物较大，后台复制（模型缺失时会自动走镜像下载，不影响使用）
  setTimeout(() => {
    for (const name of ["hf_cache", "out"]) {
      try {
        const src = path.join(old, name);
        const dst = path.join(HOME, name);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.cpSync(src, dst, { recursive: true });
          log(`后台迁移完成：${name}/`);
        }
      } catch (e) {
        log(`后台迁移 ${name} 失败（可忽略）：${e.message}`);
      }
    }
  }, 8000);
}

// ───────────────────────── 端口探测 ─────────────────────────
// 邮箱验证链接指向本机端口，固定端口可让重启后旧链接仍然有效；被占用时回退随机端口
const PREFERRED_PORT = 3456;

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function pickPort() {
  return (await isPortFree(PREFERRED_PORT)) ? PREFERRED_PORT : findFreePort();
}

function waitForServer(port, timeoutMs = 120000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("本地服务启动超时"));
        else setTimeout(tick, 600);
      });
      req.on("timeout", () => req.destroy());
    };
    tick();
  });
}

// ───────────────────── 启动 Next standalone 服务 ─────────────────────
function startServer(port) {
  const serverJs = path.join(RES, "server", "server.js");
  const pythonExe = path.join(RES, "runtime", "python", "python.exe");
  const ffmpegExe = path.join(RES, "runtime", "ffmpeg", "ffmpeg.exe");

  if (!fs.existsSync(serverJs)) throw new Error(`缺少服务文件：${serverJs}`);

  const env = Object.assign({}, process.env, {
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    ELECTRON_RUN_AS_NODE: "1", // 用 electron.exe 当 Node 运行时
    VIDEOTRANS_ROOT: RES, // resources/，scripts/transcribe.py 在其下
    VIDEOTRANS_HOME: HOME,
    PYTHON_BIN: pythonExe,
    FFMPEG_BIN: ffmpegExe,
    HF_ENDPOINT: process.env.HF_ENDPOINT || "https://hf-mirror.com",
    HF_HUB_DISABLE_XET: "1",
  });
  // AI 调用改走 Supabase Edge Function 代理：密钥只存在于云端 secret，本机不再注入 DeepSeek key

  const out = fs.openSync(SERVER_LOG, "w");
  serverProc = spawn(process.execPath, [serverJs], {
    cwd: path.join(RES, "server"),
    env,
    windowsHide: true,
    stdio: ["ignore", out, out],
  });
  serverProc.on("exit", (code) => log(`本地服务退出 code=${code}`));
  log(`本地服务已启动 pid=${serverProc.pid} port=${port}`);
}

function stopServer() {
  if (!serverProc || serverProc.killed) return;
  try {
    execSync(`taskkill /pid ${serverProc.pid} /T /F`, { stdio: "ignore" });
  } catch {
    try {
      serverProc.kill();
    } catch {
      /* ignore */
    }
  }
}

// ─────────────────────────── 菜单 ───────────────────────────
function buildMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [{ role: "about", label: "关于 视频快译" }, { type: "separator" }, { role: "quit", label: "退出" }],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ────────────────────────── 自动更新 ──────────────────────────
const { autoUpdater } = require("electron-updater");
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function currentFeed() {
  return readConfig().updateUrl || DEFAULT_FEED;
}
function applyFeed() {
  autoUpdater.setFeedURL({ provider: "generic", url: currentFeed() });
}
function sendUpd(status) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("update:status", status);
}

function bindUpdater() {
  applyFeed();
  autoUpdater.on("checking-for-update", () => sendUpd({ state: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpd({ state: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => sendUpd({ state: "not-available" }));
  autoUpdater.on("download-progress", (p) =>
    sendUpd({ state: "downloading", percent: Math.round(p.percent || 0) })
  );
  autoUpdater.on("error", (err) => {
    log(`更新检查失败：${err && err.message}`);
    sendUpd({ state: "error", message: err ? String(err.message || err) : "未知错误" });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendUpd({ state: "downloaded", version: info.version });
    dialog
      .showMessageBox(mainWin, {
        type: "info",
        title: "发现新版本",
        message: `新版本 v${info.version || ""} 已下载完成`,
        detail: "重启应用后完成安装。",
        buttons: ["立即重启", "稍后"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((r) => {
        if (r.response === 0) autoUpdater.quitAndInstall();
      });
  });
}

async function manualCheck() {
  try {
    applyFeed();
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    sendUpd({ state: "error", message: e.message });
    return { ok: false, message: e.message };
  }
}

// ───────────────────── 下载：弹出保存位置对话框 ─────────────────────
/** 拦截所有下载：先弹出系统「另存为」让用户选地点，完成后提示并可直接打开所在文件夹 */
function bindDownloads() {
  const ses = require("electron").session.defaultSession;
  ses.on("will-download", (_event, item) => {
    item.setSavePath(""); // 空字符串 = 强制弹出系统保存对话框（选择下载地点）
    item.once("done", (_e, state) => {
      if (state !== "completed" || !mainWin || mainWin.isDestroyed()) return;
      const savePath = item.getSavePath();
      dialog
        .showMessageBox(mainWin, {
          type: "info",
          title: "下载完成",
          message: `已保存到：${savePath}`,
          buttons: ["打开所在文件夹", "知道了"],
          defaultId: 0,
          cancelId: 1,
        })
        .then((r) => {
          if (r.response === 0) shell.showItemInFolder(savePath);
        });
    });
  });
}

// ─────────────────────────── 窗口 ───────────────────────────
async function createWindow(url) {
  mainWin = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#F5F0E8",
    title: APP_NAME,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWin.once("ready-to-show", () => mainWin.show());
  await mainWin.loadURL(url);

  // 外部链接交给系统浏览器
  mainWin.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith("http://127.0.0.1") || u.startsWith("http://localhost")) return { action: "allow" };
    shell.openExternal(u);
    return { action: "deny" };
  });
  mainWin.webContents.on("will-navigate", (e, u) => {
    const loc = mainWin.webContents.getURL();
    try {
      const from = new URL(loc);
      const to = new URL(u);
      if (to.origin !== from.origin) {
        e.preventDefault();
        shell.openExternal(u);
      }
    } catch {
      /* ignore */
    }
  });
}

// ───────────────── 设备指纹（激活码绑定用） ─────────────────
// 优先取 Windows MachineGuid（重装系统前稳定），叠加硬件摘要做哈希；
// 首次计算后持久化进 config.json，之后即使网卡切换/信息波动也保持不变，避免误判换机。
let deviceIdCache = "";
function getDeviceId() {
  if (deviceIdCache) return deviceIdCache;
  const saved = readConfig().deviceId;
  if (saved && String(saved).length >= 16) {
    deviceIdCache = String(saved);
    return deviceIdCache;
  }
  let machineGuid = "";
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { windowsHide: true, timeout: 5000 }
    ).toString();
    const m = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out);
    if (m) machineGuid = m[1];
  } catch {
    /* 非 Windows 或注册表不可读，走兜底 */
  }
  const mac =
    Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.mac && i.mac !== "00:00:00:00:00:00")
      .map((i) => i.mac)
      .sort()[0] || "";
  const raw = [machineGuid || os.hostname(), mac, os.cpus()[0]?.model || "", os.arch(), String(os.totalmem())].join("|");
  const id = "dev-" + crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
  deviceIdCache = id;
  try {
    writeConfig({ deviceId: id });
  } catch {
    /* 写失败不影响本次使用 */
  }
  return id;
}

// ─────────────────────────── IPC ───────────────────────────
ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  feed: currentFeed(),
  defaultFeed: DEFAULT_FEED,
}));
ipcMain.handle("device:id", () => getDeviceId());
ipcMain.handle("updater:check", () => manualCheck());
ipcMain.handle("updater:restart", () => {
  autoUpdater.quitAndInstall();
});
ipcMain.handle("updater:set-feed", (_e, url) => {
  writeConfig({ updateUrl: String(url || "").trim() });
  applyFeed();
  return { ok: true };
});

// ───────────────── 登录会话持久化（不进 localStorage） ─────────────────
const AUTH_FILE = path.join(HOME, "auth.json");
ipcMain.handle("auth:get", () => {
  try {
    return fs.readFileSync(AUTH_FILE, "utf8");
  } catch {
    return null;
  }
});
ipcMain.handle("auth:set", (_e, raw) => {
  try {
    fs.writeFileSync(AUTH_FILE, String(raw || ""), "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});
ipcMain.handle("auth:remove", () => {
  try {
    fs.rmSync(AUTH_FILE, { force: true });
  } catch {
    /* ignore */
  }
  return { ok: true };
});

// ─────────────────────────── 启动 ───────────────────────────
app.setAppUserModelId("com.mengxiaoyao.videotranslate");

app.whenReady().then(async () => {
  buildMenu();
  bindUpdater();
  bindDownloads();

  if (DEV_URL) {
    await createWindow(DEV_URL);
    return;
  }

  try {
    migrateLegacyData();
    serverPort = await pickPort();
    startServer(serverPort);
    await waitForServer(serverPort);
    await createWindow(`http://127.0.0.1:${serverPort}`);
    // 启动 8 秒后静默检查更新（失败不打扰）
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((e) => log(`自动检查更新失败：${e.message}`));
    }, 8000);
  } catch (e) {
    log(`启动失败：${e.stack || e.message}`);
    dialog.showErrorBox(
      `${APP_NAME} 启动失败`,
      `本地服务未能启动：${e.message}\n\n日志位置：\n${SERVER_LOG}\n${APP_LOG}`
    );
    stopServer();
    app.quit();
  }
});

app.on("before-quit", stopServer);
app.on("window-all-closed", () => {
  stopServer();
  app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWin === null) {
    // macOS-only 场景，Windows 不会走到
  }
});
