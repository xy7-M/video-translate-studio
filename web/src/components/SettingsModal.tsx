"use client";

import { useEffect, useState } from "react";
import {
  Cloud,
  Download,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import type { DesktopUpdateStatus } from "@/desktop";

const ic = { size: 15, strokeWidth: 1.75, className: "shrink-0" } as const;

/** 顶部齿轮按钮 + 设置弹窗（AI 服务说明 / 版本更新） */
export default function SettingsModal() {
  const [open, setOpen] = useState(false);
  const [app, setApp] = useState<{ version: string; feed: string } | null>(null);
  const [feedVal, setFeedVal] = useState("");
  const [feedSaved, setFeedSaved] = useState(false);
  const [upd, setUpd] = useState<DesktopUpdateStatus | null>(null);

  const desktop = typeof window !== "undefined" ? window.desktop : undefined;

  useEffect(() => {
    if (!open) return;
    desktop?.getInfo().then((i) => {
      setApp(i);
      setFeedVal(i.feed || "");
    });
  }, [open, desktop]);

  useEffect(() => {
    if (!desktop) return;
    const off = desktop.onUpdateStatus(setUpd);
    return off;
  }, [desktop]);

  const saveFeed = async () => {
    if (!desktop) return;
    await desktop.setFeedUrl(feedVal.trim());
    setFeedSaved(true);
    setTimeout(() => setFeedSaved(false), 2500);
  };

  const updText = (() => {
    if (!upd) return "";
    switch (upd.state) {
      case "checking": return "正在检查更新…";
      case "available": return `发现新版本 v${upd.version || ""}，开始下载…`;
      case "not-available": return "已是最新版本";
      case "downloading": return `正在下载更新 ${Math.round(upd.percent || 0)}%`;
      case "downloaded": return "新版本已就绪，重启后完成安装";
      case "error": return `检查更新失败：${upd.message || "网络不可达"}`;
    }
  })();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="设置"
        title="设置"
        className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--muted)] hover:text-[var(--accent)] border border-[var(--line)] hover:border-[var(--accent)] transition-all duration-150"
      >
        <Settings size={16} strokeWidth={1.75} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(28,25,17,0.35)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="panel w-full max-w-md p-6 space-y-6"
            style={{ transform: "rotate(-0.4deg)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold inline-flex items-center gap-2">
                <Settings size={18} strokeWidth={1.75} className="text-[var(--accent)]" />
                设置
              </h2>
              <button onClick={() => setOpen(false)} aria-label="关闭" className="text-[var(--muted)] hover:text-[var(--text)]">
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>

            {/* AI 服务说明 */}
            <section className="space-y-3">
              <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest inline-flex items-center gap-1.5">
                <Cloud size={13} strokeWidth={1.75} /> AI 服务
              </p>
              <p className="text-sm text-[var(--ok)]">已连接云端翻译服务 ✓</p>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                翻译、标点校对与课堂笔记由登录账号统一提供，无需配置任何 API 密钥。
                视频转写与全部数据仍保存在本机，视频不出本机。
              </p>
            </section>

            {/* 桌面版更新 */}
            {desktop && (
              <section className="space-y-3 border-t border-dashed border-[var(--line)] pt-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest inline-flex items-center gap-1.5">
                    <RefreshCw size={13} strokeWidth={1.75} /> 软件更新
                  </p> <span className="text-xs mono text-[var(--muted)]">v{app?.version || "…"}</span>
                </div>
                {upd?.state === "downloaded" ? (
                  <button className="btn-primary w-full justify-center" onClick={() => desktop.restartToUpdate()}>
                    <Download {...ic} /> 立即重启并安装
                  </button>
                ) : (
                  <button
                    className="btn-ghost w-full justify-center"
                    onClick={() => desktop.checkUpdates()}
                    disabled={upd?.state === "checking" || upd?.state === "downloading"}
                  >
                    <RefreshCw {...ic} /> 检查更新
                  </button>
                )}
                {updText && (
                  <p
                    className="text-xs"
                    style={{ color: upd?.state === "error" ? "var(--err)" : upd?.state === "not-available" || upd?.state === "downloaded" ? "var(--ok)" : "var(--muted)" }}
                  >
                    {updText}
                  </p>
                )}
                <div>
                  <p className="text-[11px] text-[var(--muted)] mb-1">更新通道地址（一般无需修改）</p>
                  <div className="flex gap-2">
                    <input
                      value={feedVal}
                      onChange={(e) => setFeedVal(e.target.value)}
                      placeholder="默认 GitHub 更新源"
                      className="flex-1 min-w-0 bg-transparent border border-[var(--line)] rounded-full px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] transition-colors duration-150"
                    />
                    <button className="btn-ghost text-xs whitespace-nowrap" onClick={saveFeed}>
                      {feedSaved ? "已保存" : "保存"}
                    </button>
                  </div>
                </div>
              </section>
            )}

            <p className="text-[11px] text-[var(--muted)] mono text-center">
              视频与数据均保存在本机 · 视频不出本机
            </p>
          </div>
        </div>
      )}
    </>
  );
}
