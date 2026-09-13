"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import AuthCard from "./AuthCard";

/**
 * 全局登录墙：未登录时渲染登录/注册卡，登录后渲染应用。
 * 同时把最新 session 的 access token 上报给本地服务（心跳），供后台 AI 管线取用。
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  // /confirm 是邮箱验证落地页（浏览器打开），必须绕过登录墙
  const [isConfirmPage, setIsConfirmPage] = useState(false);

  useEffect(() => {
    if (window.location.pathname.startsWith("/confirm")) {
      setIsConfirmPage(true);
      setReady(true);
      return;
    }
    let off = () => {};
    getSupabase().then((sb) => {
      if (!sb) {
        setNotConfigured(true);
        setReady(true);
        return;
      }
      sb.auth.getSession().then(({ data }) => {
        setSession(data.session);
        setReady(true);
      });
      const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
      off = () => sub.subscription.unsubscribe();
    });
    return () => off();
  }, []);

  // 心跳：每 60s 把当前 token 同步给本地 Next 服务（supabase-js 会自动续期）
  useEffect(() => {
    if (!session) return;
    const push = () => {
      fetch("/api/auth/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: "{}",
      }).catch(() => {});
    };
    push();
    const t = setInterval(push, 60000);
    return () => clearInterval(t);
  }, [session]);

  if (isConfirmPage) return <>{children}</>;

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-[var(--muted)] mono animate-pulse">加载中…</p>
      </div>
    );
  }

  if (notConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="panel p-8 max-w-md text-center space-y-3" style={{ transform: "rotate(-0.6deg)" }}>
          <h1 className="text-lg font-bold">尚未配置登录服务</h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            请在项目环境变量中填入 <span className="mono">NEXT_PUBLIC_SUPABASE_URL</span> 与{" "}
            <span className="mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> 后重启应用。
          </p>
        </div>
      </div>
    );
  }

  if (!session) return <AuthCard onDone={setSession} />;
  return <>{children}</>;
}
