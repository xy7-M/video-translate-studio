/**
 * 服务端会话桥：把浏览器请求携带的 Supabase access token 暂存到进程内存，
 * 供 fire-and-forget 的后台管线（translate/analyze/punctuate）调用 Edge Function 时取用。
 * 纯内存、零依赖；前端轮询会持续刷新这里的最新 token。
 */
let accessToken = "";

export function setToken(token: string | null | undefined) {
  const t = (token || "").replace(/^Bearer\s+/i, "").trim();
  if (t) accessToken = t;
}

export function getToken(): string {
  return accessToken;
}

/** 从 Next route 的 Request 头提取并暂存 Authorization token */
export function captureToken(req: Request) {
  setToken(req.headers.get("authorization"));
}

/**
 * 邮箱验证接力：确认链接在系统浏览器打开 → 命中本地服务的 /api/auth/relay，
 * 换到的 session 暂存于此，桌面窗口轮询取回后写入自己的 Supabase 客户端。
 * （单进程 Next standalone，浏览器回调与应用轮询命中的是同一进程。）
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
