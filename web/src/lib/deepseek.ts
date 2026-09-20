/**
 * DeepSeek 调用封装：双路径。
 *
 * 路径 A（默认）：经 Supabase Edge Function 代理。
 *   - 应用共享 DEEPSEEK_API_KEY，由激活码门禁 + 每日配额管控，应用侧计费。
 *   - 用户的 access token 由 session.ts 暂存，代理端校验 JWT + 配额。
 *
 * 路径 B（用户自带 Key）：直连 DeepSeek。
 *   - 用户在「设置 → 导入自己 API」填入自己的 DeepSeek Key，存本机 user-config.json。
 *   - 绕过 Edge Function、激活码门禁与配额，用户自行在 DeepSeek 平台付费。
 *   - 建议用户在 DeepSeek 平台设置消费上限 100 元，防预算失控。
 */
import { getUserApiKey } from "./user-config";
import { getToken } from "./session";

const DEEPSEEK_BASE = "https://api.deepseek.com";
const MODEL = "deepseek-chat";

function proxyEndpoint() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!url) {
    throw new Error("未配置 Supabase（NEXT_PUBLIC_SUPABASE_URL），AI 功能不可用");
  }
  return `${url.replace(/\/$/, "")}/functions/v1/deepseek-proxy`;
}

/** 路径 B：用用户自带 Key 直连 DeepSeek，不经代理、不查配额 */
async function chatWithOwnKey(
  system: string,
  user: string,
  json: boolean,
  temperature: number,
): Promise<string> {
  const key = getUserApiKey();
  if (!key) throw new Error("自带 Key 模式但未找到 Key，请联系客服");

  const r = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if (r.status === 401) throw new Error("你填的 API Key 无效或已失效（401），请检查或重填");
    if (r.status === 402) throw new Error("你的 DeepSeek 账户余额不足（402），请去 platform.deepseek.com 充值");
    if (r.status === 429) throw new Error("触发 DeepSeek 限流（429），稍后再试");
    console.error("deepseek own-key error", r.status, t.slice(0, 200));
    throw new Error(`AI 服务异常 (${r.status})`);
  }
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI 服务返回格式异常");
  return content;
}

/** 路径 A：经 Supabase Edge Function 代理，走激活码门禁 + 每日配额 */
async function chatViaProxy(
  system: string,
  user: string,
  json: boolean,
  temperature: number,
): Promise<string> {
  const token = getToken();
  if (!token) throw new Error("登录会话已失效，请重新登录后再试");

  const resp = await fetch(proxyEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ system, user, json, temperature }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    if (resp.status === 401) throw new Error("登录已失效，请重新登录");
    if (resp.status === 402) {
      let msg = "该账号未激活，请在「设置 → 软件许可」输入激活码";
      try {
        const j = JSON.parse(body) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* 保留默认文案 */
      }
      throw new Error(msg);
    }
    if (resp.status === 429) throw new Error("今日 AI 额度已用完，明天再试；或在「设置 → 导入自己 API」用你自己的 Key");
    throw new Error(`AI 服务异常 (${resp.status}): ${body.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { content?: string };
  if (typeof data.content !== "string") throw new Error("AI 服务返回格式异常");
  return data.content;
}

/** 统一入口：自带 Key 优先，否则走代理 */
async function chat(system: string, user: string, json: boolean, temperature: number): Promise<string> {
  if (getUserApiKey()) return chatWithOwnKey(system, user, json, temperature);
  return chatViaProxy(system, user, json, temperature);
}

/** 返回纯文本回答 */
export function deepseekText(system: string, user: string, temperature = 0.3): Promise<string> {
  return chat(system, user, false, temperature);
}

/** 返回解析后的 JSON 对象 */
export async function deepseekJson(
  system: string,
  user: string,
  temperature = 0.3
): Promise<Record<string, unknown>> {
  return JSON.parse(await chat(system, user, true, temperature)) as Record<string, unknown>;
}
