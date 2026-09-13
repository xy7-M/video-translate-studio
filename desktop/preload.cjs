/** preload：只暴露最小、安全的 IPC 桥接给渲染进程（contextIsolation） */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getInfo: () => ipcRenderer.invoke("app:info"),
  checkUpdates: () => ipcRenderer.invoke("updater:check"),
  restartToUpdate: () => ipcRenderer.invoke("updater:restart"),
  setFeedUrl: (url) => ipcRenderer.invoke("updater:set-feed", url),
  onUpdateStatus: (cb) => {
    const handler = (_evt, data) => cb(data);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  },
});
