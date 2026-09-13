"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { Mail, Lock, LogIn, UserPlus, CheckCircle2 } from "lucide-react";

const ic = { size: 15, strokeWidth: 1.75, className: "shrink-0" } as const;

/** 登录 / 注册卡（纸墨手账奶油风），邮箱验证走「浏览器确认 → 本地接力」 */
export default function AuthCard({ onDone }: { onDone: (s: Session | null) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const relayTimer = useRef<ReturnType<typeof setInterval>>();

  // 轮询本地服务：一旦浏览器完成邮箱验证并接力 session，就自动登录
  useEffect(() => {
    relayTimer.current = setInterval(async () => {
      try {
        const r = await fetch("/api/auth/relay");
        const j = await r.json();
        if (!j.session) return;
        const sb = await getSupabase();
        if (!sb) return;
        const { data, error } = await sb.auth.setSession(JSON.parse(j.session));
        if (!error && data.session) {
          clearInterval(relayTimer.current);
          onDone(data.session);
        }
      } catch {
        /* 忽略瞬时错误 */
      }
    }, 2500);
    return () => clearInterval(relayTimer.current);
  }, [onDone]);

  const submit = async () => {
    setErr("");
    setNotice("");
    const e = email.trim();
    if (!e || !password) {
      setErr("请填写邮箱和密码");
      return;
    }
    if (password.length < 6) {
      setErr("密码至少 6 位");
      return;
    }
    const sb = await getSupabase();
    if (!sb) {
      setErr("登录服务未配置");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        const { data, error } = await sb.auth.signInWithPassword({ email: e, password });
        if (error) throw error;
        if (data.session) onDone(data.session);
      } else {
        const redirectTo = `${window.location.origin}/confirm`;
        const { data, error } = await sb.auth.signUp({ email: e, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (data.session) {
          // 未开启邮箱验证时直接登录
          onDone(data.session);
        } else {
          setNotice(`验证邮件已发至 ${e}，请在浏览器中点击确认，本窗口会自动登录。`);
        }
      }
    } catch (raw) {
      const msg = raw instanceof Error ? raw.message : String(raw);
      setErr(
        msg.includes("Invalid login credentials")
          ? "邮箱或密码不正确"
          : msg.includes("already registered") || msg.includes("already been registered")
          ? "该邮箱已注册，请直接登录"
          : msg.includes("rate limit") || msg.includes("Email rate limit")
          ? "发信太频繁，请稍后再试（免费 SMTP 限流约 2 封/小时）"
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div
        className="panel p-8 w-full max-w-sm space-y-6"
        style={{ transform: "rotate(-0.8deg)", boxShadow: "6px 6px 0 rgba(28,25,17,.16)" }}
      >
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold" style={{ fontFamily: '"Kaiti SC","STKaiti",serif' }}>
            视频快译
          </h1>
          <p className="text-xs text-[var(--muted)]">登录后即可使用 AI 翻译与课堂笔记</p>
        </div>

        {/* 模式切换 */}
        <div className="flex rounded-full border-[1.5px] border-[var(--line)] p-1 text-sm">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setErr("");
                setNotice("");
              }}
              className={`flex-1 py-1.5 rounded-full transition-all duration-150 ${
                mode === m ? "bg-[var(--accent)] text-white" : "text-[var(--muted)]"
              }`}
            >
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-2 border border-[var(--line)] rounded-full px-4 py-2.5 focus-within:border-[var(--accent)] transition-colors duration-150">
            <Mail {...ic} className="text-[var(--muted)]" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="邮箱"
              autoComplete="email"
              className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-[var(--muted)]"
            />
          </label>
          <label className="flex items-center gap-2 border border-[var(--line)] rounded-full px-4 py-2.5 focus-within:border-[var(--accent)] transition-colors duration-150">
            <Lock {...ic} className="text-[var(--muted)]" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="密码（至少 6 位）"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-[var(--muted)]"
            />
          </label>
        </div>

        {err && (
          <p className="text-xs leading-relaxed" style={{ color: "var(--err)" }}>
            {err}
          </p>
        )}
        {notice && (
          <p className="text-xs leading-relaxed inline-flex items-start gap-1.5" style={{ color: "var(--ok)" }}>
            <CheckCircle2 size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
            {notice}
          </p>
        )}

        <button className="btn-primary w-full justify-center" onClick={submit} disabled={busy}>
          {busy ? "处理中…" : mode === "login" ? <><LogIn {...ic} /> 登录</> : <><UserPlus {...ic} /> 注册并发送验证邮件</>}
        </button>

        <p className="text-[11px] text-[var(--muted)] mono text-center leading-relaxed">
          视频与数据均保存在本机 · 视频不出本机
        </p>
      </div>
    </div>
  );
}
