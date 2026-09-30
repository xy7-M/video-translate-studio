/**
 * 邮箱验证接力（服务端会话暂存）：
 * 确认链接在系统浏览器打开 → /confirm 页面把 Supabase 回传的 session POST 给
 * /api/auth/relay → 暂存于此；桌面窗口轮询 GET 取回后写入自己的 Supabase 客户端。
 * 纯内存、单进程（Next standalone）：浏览器回调与应用轮询命中同一进程。
 */
let pendingSession: string | null = null;

export function setPendingSession(json: string | null) {
  pendingSession = json;
}

export function takePendingSession(): string | null {
  const s = pendingSession;
  pendingSession = null;
  return s;
}
