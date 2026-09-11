/** DeepSeek chat 封装：密钥仅存于服务端环境变量 */

function config() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || key.startsWith("sk-xxxx")) {
    throw new Error("未配置 DEEPSEEK_API_KEY，请在项目根目录 .env.local 中填写");
  }
  return {
    key,
    base: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  };
}

async function chat(
  system: string,
  user: string,
  json: boolean,
  temperature: number
): Promise<string> {
  const { key, base, model } = config();
  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`DeepSeek API ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content as string;
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
