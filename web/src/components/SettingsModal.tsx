"use client";

import { useEffect, useState } from "react";
import {
  Cloud,
  Download,
  FlaskConical,
  RefreshCw,
  Settings,
  Wallet,
  X,
} from "lucide-react";
import type { DesktopUpdateStatus } from "@/desktop";

const ic = { size: 15, strokeWidth: 1.75, className: "shrink-0" } as const;

/** 顶部齿轮按钮 + 设置弹窗（AI 服务说明 / 导入自己 API / 版本更新） */
export default function SettingsModal() {
  const [open, setOpen] = useState(false);
  const [app, setApp] = useState<{ version: string; feed: string } | null>(null);
  const [feedVal, setFeedVal] = useState("");
  const [feedSaved, setFeedSaved] = useState(false);
  const [upd, setUpd] = useState<DesktopUpdateStatus | null>(null);

  // 用户自带 API Key 状态
  const [ownKeyOn, setOwnKeyOn] = useState(false); // 是否已启用自带 Key
  const [ownKeyInput, setOwnKeyInput] = useState(""); // 输入框值（仅新增/替换时填）
  const [ownKeyMsg, setOwnKeyMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [ownKeyBusy, setOwnKeyBusy] = useState(false); // 保存 / 测试 中

  const desktop = typeof window !== "undefined" ? window.desktop : undefined;

  useEffect(() => {
    if (!open) return;
    desktop?.getInfo().then((i) => {
      setApp(i);
      setFeedVal(i.feed || "");
    });
  }, [open, desktop]);

  // 打开设置时查询自带 Key 状态（不返回 Key 本身）
  useEffect(() => {
    if (!open) return;
    let dead = false;
    void (async () => {
      try {
        const r = await fetch("/api/user-config");
        const d = (await r.json()) as { hasKey?: boolean; useOwnKey?: boolean };
        if (!dead) setOwnKeyOn(!!d.useOwnKey);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      dead = true;
    };
  }, [open]);

  // 保存 / 替换自带 Key
  const saveOwnKey = async () => {
    const k = ownKeyInput.trim();
    if (k.length < 8) {
      setOwnKeyMsg({ text: "Key 格式不正确（至少 8 位）", ok: false });
      return;
    }
    setOwnKeyBusy(true);
    setOwnKeyMsg(null);
    try {
      const r = await fetch("/api/user-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", apiKey: k }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (d.ok) {
        setOwnKeyOn(true);
        setOwnKeyInput("");
        setOwnKeyMsg({ text: "已保存并启用，之后 AI 调用走你自己的 Key 与额度", ok: true });
      } else {
        setOwnKeyMsg({ text: d.error || "保存失败", ok: false });
      }
    } catch {
      setOwnKeyMsg({ text: "网络异常，保存失败", ok: false });
    } finally {
      setOwnKeyBusy(false);
    }
  };

  // 测试自带 Key 是否可用（用 1 token 探活，不消耗配额）
  const testOwnKey = async () => {
    setOwnKeyBusy(true);
    setOwnKeyMsg(null);
    try {
      const r = await fetch("/api/user-config/test", { method: "POST" });
      const d = (await r.json()) as { ok?: boolean; error?: string; echo?: string };
      if (d.ok) {
        setOwnKeyMsg({ text: `Key 可用 ✓（DeepSeek 回复：${d.echo || "ok"}）`, ok: true });
      } else {
        setOwnKeyMsg({ text: d.error || "测试失败", ok: false });
      }
    } catch {
      setOwnKeyMsg({ text: "网络异常，测试失败", ok: false });
    } finally {
      setOwnKeyBusy(false);
    }
  };

  // 彻底清除自带 Key（清除后强制引导会重新弹出）
  const clearOwnKey = async () => {
    if (!confirm("确认清除你保存的 DeepSeek API Key？清除后需要重新填入才能使用 AI 功能。")) return;
    setOwnKeyBusy(true);
    try {
      await fetch("/api/user-config", { method: "DELETE" });
      setOwnKeyOn(false);
      setOwnKeyInput("");
      setOwnKeyMsg({ text: "已清除", ok: true });
    } catch {
      setOwnKeyMsg({ text: "网络异常", ok: false });
    } finally {
      setOwnKeyBusy(false);
    }
  };

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
              <p
                className="text-sm"
                style={{ color: ownKeyOn ? "var(--ok)" : "var(--err)" }}
              >
                {ownKeyOn ? "正在使用你自己的 DeepSeek API Key" : "尚未配置 API Key，AI 功能不可用"}
              </p>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                {ownKeyOn
                  ? "AI 调用直接走你的 DeepSeek 账户额度。建议在 DeepSeek 平台设置消费上限 100 元。"
                  : "本应用不提供共享 Key：请在下方「导入自己 API」填入你自己的 DeepSeek API Key。视频转写与全部数据仍保存在本机，视频不出本机。"}
              </p>
            </section>

            {/* 导入自己 API：用户自带 DeepSeek Key，花自己的钱 */}
            <section className="space-y-3 border-t border-dashed border-[var(--line)] pt-5">
              <div className="flex items-center justify-between">
                <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest inline-flex items-center gap-1.5">
                  <Wallet size={13} strokeWidth={1.75} /> 导入自己 API
                </p>
                <span
                  className="text-[11px] mono px-2 py-0.5 rounded-full"
                  style={{
                    border: "1.5px solid var(--line)",
                    color: ownKeyOn ? "var(--ok)" : "var(--muted)",
                  }}
                >
                  {ownKeyOn ? "自有 Key · 计费中" : "未启用"}
                </span>
              </div>

              <p className="text-xs text-[var(--muted)] leading-relaxed">
                填入你自己的 DeepSeek API Key，AI 调用（翻译 / 笔记 / 问答）将直接走你的账户额度。
                本应用不提供共享 Key，请去
                <a
                  href="https://platform.deepseek.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] underline ml-0.5"
                >
                  DeepSeek 平台
                </a>
                申请 Key，建议同时设置消费上限 100 元。
              </p>

              {ownKeyOn ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-ghost text-xs whitespace-nowrap"
                      onClick={testOwnKey}
                      disabled={ownKeyBusy}
                    >
                      <FlaskConical {...ic} /> {ownKeyBusy ? "测试中…" : "测试 Key"}
                    </button>
                    <button
                      className="btn-ghost text-xs whitespace-nowrap"
                      onClick={clearOwnKey}
                      disabled={ownKeyBusy}
                      style={{ color: "var(--err)" }}
                    >
                      彻底清除
                    </button>
                  </div>
                  {/* 替换为新 Key 的输入框（可选） */}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-[var(--muted)] select-none">替换为新 Key</summary>
                    <div className="mt-2 flex gap-2">
                      <input
                        type="password"
                        value={ownKeyInput}
                        onChange={(e) => setOwnKeyInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveOwnKey()}
                        placeholder="粘贴新的 DeepSeek API Key"
                        maxLength={120}
                        className="flex-1 min-w-0 bg-transparent border border-[var(--line)] rounded-full px-4 py-2 text-sm mono tracking-wider outline-none focus:border-[var(--accent)] transition-colors duration-150"
                      />
                      <button className="btn-primary whitespace-nowrap" onClick={saveOwnKey} disabled={ownKeyBusy}>
                        替换
                      </button>
                    </div>
                  </details>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={ownKeyInput}
                    onChange={(e) => setOwnKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveOwnKey()}
                    placeholder="sk-开头的 DeepSeek API Key"
                    maxLength={120}
                    aria-label="DeepSeek API Key"
                    className="flex-1 min-w-0 bg-transparent border border-[var(--line)] rounded-full px-4 py-2 text-sm mono tracking-wider outline-none focus:border-[var(--accent)] transition-colors duration-150"
                  />
                  <button className="btn-primary whitespace-nowrap" onClick={saveOwnKey} disabled={ownKeyBusy}>
                    {ownKeyBusy ? "保存中…" : "保存并启用"}
                  </button>
                </div>
              )}

              {ownKeyMsg && (
                <p className="text-xs" style={{ color: ownKeyMsg.ok ? "var(--ok)" : "var(--err)" }}>
                  {ownKeyMsg.text}
                </p>
              )}

              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                Key 只存在这台电脑的 <code className="mono">user-config.json</code>，
                不进浏览器 localStorage、不上传任何服务器、不入 git。
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
