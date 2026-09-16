"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { Mail, Lock, LogIn, UserPlus, CheckCircle2, ShieldCheck, ArrowLeft } from "lucide-react";

const ic = { size: 15, strokeWidth: 1.75, className: "shrink-0" } as const;

/** Supabase 英文报错 → 中文提示（覆盖不到的保留原文，便于排查） */
function mapAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials"))
    return "邮箱或密码不正确";
  if (m.includes("email not confirmed") || m.includes("confirm your email"))
    return "邮箱尚未验证：请先完成注册第二步的验证码";
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("already exists"))
    return "该邮箱已注册，请切换到「登录」";
  if (m.includes("invalid format") || m.includes("validate email"))
    return "邮箱格式不正确，请填写完整邮箱（如 xxx@qq.com）";
  if (m.includes("rate limit") || m.includes("too many") || m.includes("exceeded"))
    return "操作太频繁，请稍后再试（发信通道有限流，等一两分钟即可）";
  if (m.includes("invalid or expired otp") || m.includes("token has expired") || m.includes("otp"))
    return "验证码不正确或已过期，请重新发送";
  if (m.includes("password"))
    return "密码不符合要求（至少 6 位）";
  if (m.includes("failed to fetch") || m.includes("networkerror"))
    return "网络异常，无法连接登录服务，请检查网络后重试";
  return msg;
}

const normEmail = (raw: string) => (/^\d{5,11}$/.test(raw.trim()) ? `${raw.trim()}@qq.com` : raw.trim());
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 登录 / 两步注册卡（纸墨手账奶油风）：注册 = 邮箱密码 → 6 位邮箱验证码 */
export default function AuthCard({
  onDone,
  mode: initialMode = "login",
}: {
  onDone: (s: Session | null) => void;
  mode?: "login" | "register";
}) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [step, setStep] = useState<1 | 2>(1); // 注册第二步：验证码
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const relayTimer = useRef<ReturnType<typeof setInterval>>();

  // 重发验证码的 60 秒冷却倒计时
  useEffect(() => {
    if (mode === "register" && step === 2 && cooldown > 0) {
      const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
      return () => clearInterval(t);
    }
  }, [mode, step, cooldown]);

  // 轮询本地服务：兼容旧的「浏览器确认链接」接力（若仍有用户卡在那一步）
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

  const resetForm = () => {
    setErr("");
    setNotice("");
    setOtp("");
  };

  const switchMode = (m: "login" | "register") => {
    setMode(m);
    setStep(1);
    resetForm();
  };

  /** 注册第一步：提交邮箱密码（Supabase 发 6 位验证码邮件），进入第二步 */
  const submitRegisterStep1 = async () => {
    resetForm();
    const e = normEmail(email);
    if (!e || !password) {
      setErr("请填写邮箱和密码");
      return;
    }
    if (!EMAIL_RE.test(e)) {
      setErr("邮箱格式不正确，请填写完整邮箱（如 xxx@qq.com）");
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
      const { data, error } = await sb.auth.signUp({ email: e, password });
      if (error) throw error;
      if (data.session) {
        // 兜底：若云端没开邮箱验证，直接登录成功
        onDone(data.session);
        return;
      }
      setEmail(e);
      setStep(2);
      setNotice(`验证码已发送至 ${e}（含垃圾箱），6 位数字，1 分钟内有效。`);
      setCooldown(60);
    } catch (raw) {
      setErr(mapAuthError(raw instanceof Error ? raw.message : String(raw)));
    } finally {
      setBusy(false);
    }
  };

  /** 注册第二步：校验 6 位验证码 */
  const submitRegisterStep2 = async () => {
    resetForm();
    const code = otp.trim();
    if (!/^\d{6}$/.test(code)) {
      setErr("请输入 6 位数字验证码");
      return;
    }
    const sb = await getSupabase();
    if (!sb) {
      setErr("登录服务未配置");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await sb.auth.verifyOtp({ email, token: code, type: "signup" });
      if (error) throw error;
      if (!data.session) throw new Error("验证失败，请重新发送验证码");
      onDone(data.session);
    } catch (raw) {
      setErr(mapAuthError(raw instanceof Error ? raw.message : String(raw)));
    } finally {
      setBusy(false);
    }
  };

  /** 重新发送验证码 */
  const resendOtp = async () => {
    if (cooldown > 0 || busy) return;
    resetForm();
    const sb = await getSupabase();
    if (!sb) return;
    setBusy(true);
    try {
      const { error } = await sb.auth.resend({ type: "signup", email });
      if (error) throw error;
      setNotice(`验证码已重新发送至 ${email}。`);
      setCooldown(60);
    } catch (raw) {
      setErr(mapAuthError(raw instanceof Error ? raw.message : String(raw)));
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = async () => {
    resetForm();
    const e = normEmail(email);
    if (!e || !password) {
      setErr("请填写邮箱和密码");
      return;
    }
    if (!EMAIL_RE.test(e)) {
      setErr("邮箱格式不正确，请填写完整邮箱（如 xxx@qq.com）");
      return;
    }
    const sb = await getSupabase();
    if (!sb) {
      setErr("登录服务未配置");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: e, password });
      if (error) throw error;
      if (data.session) onDone(data.session);
    } catch (raw) {
      setErr(mapAuthError(raw instanceof Error ? raw.message : String(raw)));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-[var(--muted)]";
  const fieldCls =
    "flex items-center gap-2 border border-[var(--line)] rounded-full px-4 py-2.5 focus-within:border-[var(--accent)] transition-colors duration-150";

  return (
    <div className="w-full">
      <div
        className="panel p-8 space-y-6"
        style={{ transform: "rotate(-0.8deg)", boxShadow: "6px 6px 0 rgba(28,25,17,.16)" }}
      >
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold" style={{ fontFamily: '"Kaiti SC","STKaiti",serif' }}>
            视频快译
          </h1>
          <p className="text-xs text-[var(--muted)]">登录后即可使用 AI 翻译与课堂笔记</p>
        </div>

        {/* 注册第二步：顶部步骤指示 + 返回 */}
        {mode === "register" && step === 2 ? (
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => {
                setStep(1);
                resetForm();
              }}
              className="text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"
            >
              <ArrowLeft size={14} strokeWidth={1.75} /> 返回
            </button>
            <span className="flex-1 text-center mono text-xs text-[var(--muted)]">
              第 2 步 / 共 2 步 · 邮箱验证码
            </span>
          </div>
        ) : (
          <div className="flex rounded-full border-[1.5px] border-[var(--line)] p-1 text-sm">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`flex-1 py-1.5 rounded-full transition-all duration-150 ${
                  mode === m ? "bg-[var(--accent)] text-white" : "text-[var(--muted)]"
                }`}
              >
                {m === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>
        )}

        {mode === "register" && step === 2 ? (
          /* ── 注册第二步：验证码 ── */
          <div className="space-y-3">
            <label className={`${fieldCls} justify-center`}>
              <ShieldCheck {...ic} className="text-[var(--muted)]" />
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && submitRegisterStep2()}
                placeholder="6 位验证码"
                inputMode="numeric"
                autoFocus
                className={`${inputCls} text-center tracking-[0.5em] text-lg font-medium`}
              />
            </label>
            <button
              onClick={resendOtp}
              disabled={busy || cooldown > 0}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline underline-offset-2 disabled:no-underline disabled:opacity-50"
            >
              {cooldown > 0 ? `重新发送（${cooldown}s）` : "没收到？重新发送验证码"}
            </button>
          </div>
        ) : (
          /* ── 登录 / 注册第一步：邮箱 + 密码 ── */
          <div className="space-y-3">
            <label className={fieldCls}>
              <Mail {...ic} className="text-[var(--muted)]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="邮箱（支持QQ邮箱）"
                autoComplete="email"
                className={inputCls}
              />
            </label>
            <label className={fieldCls}>
              <Lock {...ic} className="text-[var(--muted)]" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (mode === "login" ? submitLogin() : submitRegisterStep1())}
                placeholder="密码（至少 6 位）"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className={inputCls}
              />
            </label>
          </div>
        )}

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

        <button
          className="btn-primary w-full justify-center"
          onClick={() => {
            if (mode === "login") submitLogin();
            else if (step === 1) submitRegisterStep1();
            else submitRegisterStep2();
          }}
          disabled={busy}
        >
          {busy ? "处理中…" : mode === "login" ? <><LogIn {...ic} /> 登录</> : step === 1 ? <><UserPlus {...ic} /> 下一步：发送验证码</> : <><ShieldCheck {...ic} /> 完成注册</>}
        </button>

        <p className="text-[11px] text-[var(--muted)] mono text-center leading-relaxed">
          视频与数据均保存在本机 · 视频不出本机
        </p>
      </div>
    </div>
  );
}
