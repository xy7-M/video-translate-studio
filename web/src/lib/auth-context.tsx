"use client";

/**
 * 全局登录态：未登录时强制弹出注册墙（头部「登录」按钮复用同一卡片）；
 * 已登录但未配置自有 API Key 时由 OnboardingApiKey 引导，AI 操作前后端双重校验。
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import AuthCard from "@/components/AuthCard";
import OnboardingApiKey from "@/components/OnboardingApiKey";

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
  const [isPublicRoute, setIsPublicRoute] = useState(false);

  useEffect(() => {
    // /confirm 邮箱验证落地页、/intro 应用内介绍页：均不强制登录
    if (/^\/(confirm|intro)(\/|$)/.test(window.location.pathname)) {
      setIsPublicRoute(true);
      setReady(true);
      return;
    }
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

  const signOut = useCallback(async () => {
    const sb = await getSupabase();
    await sb?.auth.signOut();
    setSession(null);
  }, []);

  return (
    <Ctx.Provider value={{ session, ready, openLogin: () => {}, signOut }}>
      {children}
      {/* 已登录但没有自有 API Key：注册成功后自动弹出，可取消但 AI 操作会拦截并重新唤起 */}
      <OnboardingApiKey />
      {/* 未登录时强制弹出注册弹窗：无关闭按钮、点遮罩不关闭，注册/登录可切换 */}
      {ready && !session && !isPublicRoute && (
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
