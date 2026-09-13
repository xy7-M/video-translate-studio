/** Electron preload 注入的桌面桥接（浏览器环境下 window.desktop 为 undefined） */

export type DesktopUpdateStatus = {
  state: "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  version?: string;
  percent?: number;
  message?: string;
};

export type DesktopInfo = {
  version: string;
  feed: string;
};

export interface DesktopBridge {
  getInfo: () => Promise<DesktopInfo>;
  checkUpdates: () => Promise<{ ok: boolean; message?: string }>;
  restartToUpdate: () => void;
  setFeedUrl: (url: string) => Promise<{ ok: boolean }>;
  onUpdateStatus: (cb: (s: DesktopUpdateStatus) => void) => () => void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
