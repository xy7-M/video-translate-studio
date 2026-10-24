/**
 * 测试用户自己的 DeepSeek API Key 是否可用：小 token 请求探活。
 * 注意：deepseek-flash 为推理模型，max_tokens 过小会被推理占用导致回复为空，故用 64。
 * 直连 DeepSeek，走用户自己的账户额度。
 */
import { NextResponse } from "next/server";
import { getUserApiKey } from "@/lib/user-config";
import { DEEPSEEK_MODEL } from "@/lib/deepseek";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  const key = getUserApiKey();
  if (!key) {
    return NextResponse.json({ ok: false, error: "尚未启用自带 API Key" }, { status: 400 });
  }

  try {
    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        max_tokens: 64,
        messages: [
          { role: "system", content: "回复两个字：可用" },
          { role: "user", content: "ping" },
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      let msg = `DeepSeek 返回 ${r.status}`;
      if (r.status === 401) msg = "API Key 无效或已失效（401）";
      else if (r.status === 402) msg = "账户余额不足（402），请去 DeepSeek 平台充值";
      else if (r.status === 429) msg = "触发限流（429），稍后再试";
      // 不把上游细节全透传
      console.error("user key test failed", r.status, t.slice(0, 200));
      return NextResponse.json({ ok: false, error: msg }, { status: 200 });
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    return NextResponse.json({
      ok: true,
      echo: typeof content === "string" ? content.slice(0, 40) : "",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `网络异常：${e instanceof Error ? e.message : "未知错误"}` },
      { status: 200 },
    );
  }
}
