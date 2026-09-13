import { NextResponse } from "next/server";
import { deepseekText } from "@/lib/deepseek";
import { captureToken } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 快速翻译：中英互译（自动判断方向），经 Edge Function 代理调用 DeepSeek */
export async function POST(req: Request) {
  captureToken(req);
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text || "").trim();
  if (!text) return NextResponse.json({ error: "请输入要翻译的内容" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "单次最多 4000 字" }, { status: 400 });

  try {
    const result = await deepseekText(
      "你是专业翻译。判断用户输入的语言：中文则翻译成地道英文，英文则翻译成简体中文，" +
        "其他语言翻译成简体中文。只输出译文本身，不要解释、不要加引号。",
      text
    );
    return NextResponse.json({ result: result.trim() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
