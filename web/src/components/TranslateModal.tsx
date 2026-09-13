"use client";

import { useState } from "react";
import { Languages, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

/** 快速翻译弹窗：输入文本 → 经本地服务走 Edge Function 调 DeepSeek，中英互译 */
export default function TranslateModal() {
  const { session, openLogin } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    const t = text.trim();
    if (!t || busy) return;
    if (!session) {
      openLogin();
      return;
    }
    setErr("");
    setResult("");
    setBusy(true);
    try {
      const r = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ text: t }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "翻译失败");
      setResult(j.result || "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-5 py-2 rounded-full text-sm text-[var(--muted)] hover:text-[var(--text)] transition-all duration-200 inline-flex items-center gap-1.5"
      >
        <Languages size={14} strokeWidth={1.75} /> 翻译
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(28,25,17,0.35)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="panel w-full max-w-lg p-6 space-y-4"
            style={{ transform: "rotate(-0.5deg)", boxShadow: "6px 6px 0 rgba(28,25,17,.16)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold inline-flex items-center gap-2">
                <Languages size={18} strokeWidth={1.75} className="text-[var(--accent)]" />
                快速翻译
              </h2>
              <button onClick={() => setOpen(false)} aria-label="关闭" className="text-[var(--muted)] hover:text-[var(--text)]">
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入中文或英文，自动判断方向互译…"
              rows={5}
              className="w-full bg-transparent border border-[var(--line)] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[var(--accent)] transition-colors duration-150 resize-none placeholder:text-[var(--muted)]"
            />

            <div className="flex items-center gap-3">
              <button className="btn-primary" onClick={run} disabled={busy || !text.trim()}>
                {busy ? "翻译中…" : "翻译"}
              </button>
              {result && (
                <button
                  className="btn-ghost text-xs"
                  onClick={() => navigator.clipboard.writeText(result).catch(() => {})}
                >
                  复制结果
                </button>
              )}
              {!session && <span className="text-xs text-[var(--muted)]">需登录后使用</span>}
            </div>

            {err && <p className="text-xs" style={{ color: "var(--err)" }}>{err}</p>}
            {result && (
              <div className="border-t border-dashed border-[var(--line)] pt-4">
                <p className="text-xs mono text-[var(--muted)] uppercase tracking-widest mb-2">译文</p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{result}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
