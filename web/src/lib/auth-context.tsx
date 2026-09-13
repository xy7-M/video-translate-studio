"use client";

/**
 * 全局登录态：不再强制整页墙，头部「登录」按钮打开登录卡；
 * 需要花 AI 额度的操作（上传翻译/重跑/问答/翻译）会先检查登录。
 * 同时每 60s 心跳把最新 token 上报本地服务，供后台管线调用 Edge Function。
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import AuthCard from "@/components/AuthCard";

type AuthCtx = {
  session: Session | null;
  ready: boolean;
  openLogin: () => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  session: null,
  ready: false,
  openLogin: () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(Ctx);

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let off = () => {};
    getSupabase().then((sb) => {
      if (!sb) {
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

  // 心跳：supabase-js 会自动续期，轮询即保持后台管线 token 新鲜
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

  const signOut = useCallback(async () => {
    const sb = await getSupabase();
    await sb?.auth.signOut();
    setSession(null);
  }, []);

  return (
    <Ctx.Provider value={{ session, ready, openLogin: () => {}, signOut }}>
      {children}
      {/* 未登录时强制弹出注册弹窗：无关闭按钮、点遮罩不关闭，注册/登录可切换 */}
      {ready && !session && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
          style={{ background: "rgba(28,25,17,0.45)" }}
        >
          <div className="relative w-full max-w-sm my-8">
            <AuthCard mode="register" onDone={() => {}} />
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
