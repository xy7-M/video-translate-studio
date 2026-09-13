"use client";

import { Suspense, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type State = "working" | "done" | "error";

/**
 * 邮箱确认落地页：Supabase 把系统浏览器重定向到这里（http://127.0.0.1:PORT/confirm）。
 * 页面用 code（PKCE）或 hash（implicit）换到 session，交给本地服务暂存，
 * 桌面窗口随后轮询取回并自动完成登录。
 */
function ConfirmInner() {
  const [state, setState] = useState<State>("working");
  const [msg, setMsg] = useState("正在验证邮箱…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const sb = await getSupabase();
      if (!sb) {
        setState("error");
        setMsg("登录服务未配置，请返回应用检查环境变量。");
        return;
      }

      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const errorDesc = url.searchParams.get("error_description");
      if (errorDesc) {
        setState("error");
        setMsg(`验证失败：${errorDesc}`);
        return;
      }

      try {
        if (code) {
          const { data, error } = await sb.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (!data.session) throw new Error("未获得会话");
          await relay(JSON.stringify(data.session));
        } else if (url.hash.includes("access_token")) {
          // implicit 兜底：hash 片段本身就是 session 载荷
          const frag = new URLSearchParams(url.hash.replace(/^#/, ""));
          const accessToken = frag.get("access_token");
          if (!accessToken) throw new Error("缺少 access_token");
          const { data, error } = await sb.auth.getSession();
          if (error) throw error;
          await relay(JSON.stringify(data.session ?? { access_token: accessToken }));
        } else {
          setState("error");
          setMsg("链接不完整，请回到应用重新发送验证邮件。");
          return;
        }
        if (!cancelled) {
          setState("done");
          setMsg("验证成功，请回到「视频快译」窗口，应用会自动登录。");
        }
      } catch (e) {
        if (!cancelled) {
          setState("error");
          setMsg(`验证失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })();

    async function relay(sessionJson: string) {
      const r = await fetch("/api/auth/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: sessionJson }),
      });
      if (!r.ok) throw new Error("本地服务未响应，请确认应用窗口处于打开状态");
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div
        className="panel p-8 max-w-sm w-full text-center space-y-4"
        style={{ transform: "rotate(-0.6deg)", boxShadow: "5px 6px 0 rgba(28,25,17,.16)" }}
      >
        <h1 className="text-xl font-bold" style={{ fontFamily: '"Kaiti SC","STKaiti",serif' }}>
          邮箱验证
        </h1>
        <p
          className="text-sm leading-relaxed"
          style={{ color: state === "error" ? "var(--err)" : state === "done" ? "var(--ok)" : "var(--muted)" }}
        >
          {msg}
        </p>
        {state === "working" && <p className="text-xs mono text-[var(--muted)] animate-pulse">处理中…</p>}
        <p className="text-[11px] text-[var(--muted)]">此页面可以关闭</p>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmInner />
    </Suspense>
  );
}
