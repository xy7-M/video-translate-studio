/**
 * DeepSeek 调用封装：仅 BYO-Key（Bring Your Own Key）单路径。
 *
 *  - 一律使用用户在「导入自己 API」中填入、存于本机 user-config.json 的 Key
 *    直连 DeepSeek，费用走用户自己的账户额度。
 *  - 应用不提供共享 Key，也不再经过 Supabase Edge Function 代理、
 *    激活码门禁与每日配额。
 *  - 建议用户在 DeepSeek 平台设置消费上限 100 元，防预算失控。
 */
import { getUserApiKey } from "./user-config";

const DEEPSEEK_BASE = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-flash"; // DeepSeek-V4.1-Flash-1017（deepseek-chat 旧名仍可用）

/** 用用户自带 Key 直连 DeepSeek */
async function chat(
  system: string,
  user: string,
  json: boolean,
  temperature: number,
): Promise<string> {
  const key = getUserApiKey();
  if (!key) {
    throw new Error(
      "请先填入你自己的 DeepSeek API Key（注册后会自动弹出，或在「设置 → 导入自己 API」中填写）",
    );
  }

  const r = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
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
