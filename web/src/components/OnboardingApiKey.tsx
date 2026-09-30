"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { REQUIRE_API_KEY_EVENT } from "@/lib/ensure-api-key";

/**
 * 注册成功后的强制引导（BYO-Key）：
 *  - 已登录但本机没有自有 DeepSeek Key 时立即弹出；点遮罩不关闭。
 *  - 提供「取消（暂不配置）」：本次会话内隐藏；用户触发任何 AI 操作时
 *    ensureApiKey 会发事件把它重新唤起，未配置 Key 的 AI 调用一律拦截。
 *  - 保存成功（或「测试通过后保存」）后自动消失。
 *  - Key 只 POST 给本地 /api/user-config，落盘 user-config.json；
 *    服务端永不回传明文 Key。
 */
export default function OnboardingApiKey() {
  const { session } = useAuth();
  const [state, setState] = useState<"loading" | "need" | "done">("loading");
  const [dismissed, setDismissed] = useState(false); // 用户点取消：本次会话内隐藏，AI 操作触发时重新弹出
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const dead = useRef(false);

  // 已登录才检查；未登录时由 AuthCard 全屏接管
  useEffect(() => {
    dead.current = false;
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const r = await fetch("/api/user-config");
        const d = (await r.json()) as { hasKey?: boolean };
        if (dead.current) return;
        setState(d.hasKey ? "done" : "need");
      } catch {
        // 瞬时网络错误：2s 后重试，避免错误弹窗
        timer = setTimeout(check, 2000);
      }
    };
    void check();
    return () => {
      dead.current = true;
      clearTimeout(timer);
    };
  }, [session]);

  // 监听 AI 操作门禁的重新唤起事件（取消后用户尝试使用 AI 时触发）
  useEffect(() => {
    const reOpen = () => {
      setDismissed(false);
      setState("loading");
      void fetch("/api/user-config")
        .then((r) => r.json())
        .then((d: { hasKey?: boolean }) => setState(d.hasKey ? "done" : "need"))
        .catch(() => setState("need"));
    };
    window.addEventListener(REQUIRE_API_KEY_EVENT, reOpen);
    return () => window.removeEventListener(REQUIRE_API_KEY_EVENT, reOpen);
  }, []);

  if (!session || state !== "need" || dismissed) return null;

  const postSave = async (apiKey: string) => {
    const r = await fetch("/api/user-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", apiKey }),
    });
    return (await r.json()) as { ok?: boolean; error?: string };
  };

  // 直接保存并启用
  const save = async () => {
    const k = input.trim();
    if (k.length < 8 || !k.startsWith("sk-")) {
      setMsg({ text: "Key 格式不正确：DeepSeek Key 以 sk- 开头", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const d = await postSave(k);
      if (d.ok) {
        setState("done");
      } else {
        setMsg({ text: d.error || "保存失败，请重试", ok: false });
      }
    } catch {
      setMsg({ text: "网络异常，保存失败，请重试", ok: false });
    } finally {
      setBusy(false);
    }
  };

  // 先用 1 token 探活，通过后自动保存（不通过给原因，不落盘）
  const testThenSave = async () => {
    const k = input.trim();
    if (k.length < 8 || !k.startsWith("sk-")) {
      setMsg({ text: "Key 格式不正确：DeepSeek Key 以 sk- 开头", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // 先临时保存以复用 /api/user-config/test（Key 仍只在本机）
      const d0 = await postSave(k);
      if (!d0.ok) {
        setMsg({ text: d0.error || "保存失败，请重试", ok: false });
        return;
      }
      const r = await fetch("/api/user-config/test", { method: "POST" });
      const d = (await r.json()) as { ok?: boolean; error?: string; echo?: string };
      if (d.ok) {
        setState("done");
        return;
      }
      // 测试失败：禁用刚存的 Key，提示用户修正
      await fetch("/api/user-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable" }),
      }).catch(() => {});
      setMsg({ text: d.error || "Key 测试失败，请检查后重试", ok: false });
    } catch {
      setMsg({ text: "网络异常，请重试", ok: false });
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    "打开 DeepSeek 开放平台，登录 / 注册",
    "创建一个 API Key（sk- 开头），建议同时设置消费上限 100 元",
    "把 Key 粘贴到下方输入框",
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(28,25,17,0.45)" }}
    >
      <div
        className="panel w-full max-w-md p-8 space-y-5 my-8"
        style={{ transform: "rotate(0.6deg)", boxShadow: "6px 6px 0 rgba(28,25,17,.16)" }}
      >
        <div className="text-center space-y-2">
          <span
            className="inline-flex items-center gap-1.5 text-[11px] mono px-3 py-1 rounded-full"
            style={{
              background: "#FBE8A6",
              border: "1.5px solid #1C1911",
              boxShadow: "2px 2px 0 rgba(28,25,17,.16)",
            }}
          >
            <KeyRound size={12} strokeWidth={2} /> 最后一步
          </span>
          <h2
            className="text-2xl font-bold"
            style={{ fontFamily: '"Kaiti SC","STKaiti",serif' }}
          >
            填入你自己的 API Key
          </h2>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            AI 翻译、课堂笔记与问答都需要它；调用费用走你自己的 DeepSeek
            账户额度，应用不提供共享 Key。
          </p>
        </div>

        <ol className="space-y-2 text-xs text-[var(--text)]">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] mono"
                style={{
                  border: "1.5px solid var(--line)",
                  background: "var(--card)",
                }}
              >
                {i + 1}
              </span>
              <span className="leading-5 pt-px">{s}</span>
            </li>
          ))}
        </ol>

        <a
          href="https://platform.deepseek.com/api-keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--accent)] underline underline-offset-2"
        >
          <Wallet size={13} strokeWidth={1.75} />
          去 DeepSeek 平台申请 Key
          <ArrowRight size={12} strokeWidth={2} />
        </a>

        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="sk-开头的 DeepSeek API Key"
          maxLength={120}
          aria-label="DeepSeek API Key"
          autoFocus
          className="w-full bg-transparent border border-[var(--line)] rounded-full px-4 py-2.5 text-sm mono tracking-wider outline-none focus:border-[var(--accent)] transition-colors duration-150"
        />

        {msg && (
          <p
            className="text-xs leading-relaxed inline-flex items-start gap-1.5"
            style={{ color: msg.ok ? "var(--ok)" : "var(--err)" }}
          >
            {msg.ok && <CheckCircle2 size={14} strokeWidth={2} className="mt-0.5 shrink-0" />}
            {msg.text}
          </p>
        )}

        <div className="flex gap-2">
          <button
            className="btn-primary flex-1 justify-center"
            onClick={save}
            disabled={busy}
          >
            {busy ? "处理中…" : "保存并开始使用"}
          </button>
          <button
            className="btn-ghost whitespace-nowrap"
            onClick={testThenSave}
            disabled={busy}
            title="先用 1 token 验证 Key 可用，再保存"
          >
            <FlaskConical size={14} strokeWidth={1.75} /> 测试后保存
          </button>
        </div>

        {/* 取消：本次会话内隐藏；未配置 Key 时任何 AI 操作都会被拦截并重新弹出此窗 */}
        <button
          className="mx-auto flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)] transition-colors duration-150"
          onClick={() => {
            setDismissed(true);
            setMsg(null);
          }}
          disabled={busy}
        >
          <X size={12} strokeWidth={2} /> 取消（暂不配置）
        </button>

        <p className="text-[11px] text-[var(--muted)] leading-relaxed">
          Key 只存在这台电脑的{" "}
          <code className="mono">user-config.json</code>
          ，不进浏览器 localStorage、不上传任何服务器、不入 git。
        </p>
      </div>
    </div>
  );
}
