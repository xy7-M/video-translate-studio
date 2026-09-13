// 视频快译 · DeepSeek 代理 Edge Function
// 职责：校验调用者 Supabase JWT → 检查每人每日配额 → 用服务端 secret 里的
// DEEPSEEK_API_KEY 调 DeepSeek → 返回 { content, usage }。密钥永不下发客户端。
// 部署时 verify_jwt = true，runtime 已拦截无效 token；本函数再叠加配额。

const DEEPSEEK_BASE = "https://api.deepseek.com";
const MODEL = "deepseek-chat";
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") || "300");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "缺少登录凭证" }, 401);

  // 校验 JWT 并取 user id（调 GoTrue /user 端点）
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (!url || !serviceKey || !apiKey) return json({ error: "服务端未配置完成" }, 500);

  let userId = "";
  try {
    const v = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: serviceKey },
    });
    if (v.status !== 200) return json({ error: "登录已失效，请重新登录" }, 401);
    const u = await v.json();
    userId = u?.id || "";
    if (!userId) return json({ error: "登录已失效，请重新登录" }, 401);
  } catch {
    return json({ error: "无法验证登录状态" }, 401);
  }

  // 原子配额：consume_ai_quota 返回 true 表示未超限
  let allowed = false;
  try {
    const q = await fetch(`${url}/rest/v1/rpc/consume_ai_quota`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_user: userId, p_limit: DAILY_LIMIT }),
    });
    allowed = (await q.json()) === true;
  } catch {
    return json({ error: "配额服务异常" }, 500);
  }
  if (!allowed) return json({ error: "今日 AI 额度已用完，请明天再试" }, 429);

  let body: { system?: string; user?: string; temperature?: number; json?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }
  const { system, user, temperature, json: wantJson } = body;
  if (typeof system !== "string" || typeof user !== "string") {
    return json({ error: "缺少 system / user" }, 400);
  }

  try {
    const r = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: typeof temperature === "number" ? temperature : 0.3,
        ...(wantJson ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      // 不把上游细节透传给客户端
      console.error("deepseek upstream error", r.status, t.slice(0, 300));
      return json({ error: `AI 服务暂时不可用 (${r.status})` }, 502);
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return json({ error: "AI 返回格式异常" }, 502);
    return json({ content, usage: data.usage || null });
  } catch (e) {
    console.error("deepseek-proxy fetch failed", e);
    return json({ error: "AI 服务连接失败" }, 502);
  }
});
