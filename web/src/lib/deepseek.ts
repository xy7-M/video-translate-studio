/**
 * DeepSeek 调用封装：不再直连 DeepSeek，而是经 Supabase Edge Function 代理。
 * 用户的 access token 由 session.ts 从浏览器请求中转暂存，代理端校验 JWT + 配额。
 * 密钥 DEEPSEEK_API_KEY 只存在于 Edge Function 服务端，永不下发到用户机器。
 */
import { getToken } from "./session";

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!url) {
    throw new Error("未配置 Supabase（NEXT_PUBLIC_SUPABASE_URL），AI 功能不可用");
  }
  return { endpoint: `${url.replace(/\/$/, "")}/functions/v1/deepseek-proxy` };
}

async function chat(system: string, user: string, json: boolean, temperature: number): Promise<string> {
  const token = getToken();
  if (!token) throw new Error("登录会话已失效，请重新登录后再试");

  const { endpoint } = config();
  const resp = await fetch(endpoint, {
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
    if (resp.status === 402) throw new Error("该账号未开通 AI 服务");
    if (resp.status === 429) throw new Error("今日 AI 额度已用完，请明天再试");
    throw new Error(`AI 服务异常 (${resp.status}): ${body.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { content?: string };
  if (typeof data.content !== "string") throw new Error("AI 服务返回格式异常");
  return data.content;
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
