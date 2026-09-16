"use client";

/**
 * Supabase 客户端：邮箱登录。
 * 桌面版会话 token 经 IPC 写入本机 vtdata/auth.json（不碰 localStorage）；
 * 浏览器（开发/网页版）无文件系统能力，降级为 localStorage 持久化以实现「下次打开自动登录」。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const browserStorage = {
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 隐私模式等场景静默降级为内存态 */
    }
  },
  removeItem: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

// 内存镜像：供无 bridge 环境下 supabase-js 读写（实际落盘走 browserStorage）
const memoryStore = new Map<string, string>();

const memStorage = {
  getItem: (k: string) => memoryStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memoryStore.set(k, v),
  removeItem: (k: string) => void memoryStore.delete(k),
};

let client: SupabaseClient | null = null;

export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

/** 取得（并按需初始化）Supabase 客户端；未配置环境变量时返回 null */
export async function getSupabase(): Promise<SupabaseClient | null> {
  if (client) return client;
  const url = supabaseUrl();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anon) return null;

  const bridge = typeof window !== "undefined" ? window.desktop?.authStore : undefined;

  if (!bridge) {
    client = createClient(url, anon, {
      auth: { storage: browserStorage, persistSession: true, detectSessionInUrl: false, flowType: "implicit" },
    });
    return client;
  }

  // 桌面版：先用本地文件里已有的会话水合到内存，再交给 supabase-js
  const saved = await bridge.get().catch(() => null);
  // 必须与 supabase-js 内部 defaultStorageKey 完全一致：sb-{hostname首段}-auth-token
  const STORAGE_KEY = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  if (saved) memoryStore.set(STORAGE_KEY, saved);

  client = createClient(url, anon, {
    auth: { storage: memStorage, persistSession: true, detectSessionInUrl: false, flowType: "implicit" },
  });

  // 会话变化（登录/刷新/登出）时同步落盘
  client.auth.onAuthStateChange((_evt, session) => {
    const raw = session ? JSON.stringify(session) : "";
    memoryStore.set(STORAGE_KEY, raw);
    void (raw ? bridge.set(raw) : bridge.remove());
  });

  return client;
}

/** 当前 access token（无登录则空串）；同时用于给本地 API 请求带上身份 */
export async function currentAccessToken(): Promise<string> {
  const sb = await getSupabase();
  if (!sb) return "";
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || "";
}

/** 带 Authorization 头的 fetch 包装：本地 API 一律用它，服务端据此取用户身份 */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await currentAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}
