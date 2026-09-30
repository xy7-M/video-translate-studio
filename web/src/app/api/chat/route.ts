import { NextResponse } from "next/server";
import { addChatHistory, retrieveCorpus } from "@/lib/pipeline";
import { hasOwnKey } from "@/lib/user-config";
import { deepseekText } from "@/lib/deepseek";

export const runtime = "nodejs";
export const maxDuration = 120;

/** AI Chat 跨课程问答（借鉴 Otter）：基于已转写课程语料回答复习问题 */
export async function POST(req: Request) {
  // 严格 BYO-Key：未配置用户自有 Key 一律拦截
  if (!hasOwnKey()) {
    return NextResponse.json(
      { error: "请先填入你自己的 DeepSeek API Key（设置 → 导入自己 API）", needApiKey: true },
      { status: 400 },
    );
  }
  const body = (await req.json()) as { question?: string; course?: string };
  const question = (body.question || "").trim().slice(0, 2000);
  if (!question) return NextResponse.json({ error: "请输入问题" }, { status: 400 });
  const course = typeof body.course === "string" ? body.course.trim().slice(0, 200) : "";

  const corpus = retrieveCorpus(question, course || undefined);
  if (!corpus) {
    return NextResponse.json({
      answer: "还没有检索到相关课程内容。先在「工作台」导入几节课堂视频，转写完成后就能向我提问了。",
      sources: [],
    });
  }

  try {
    const answer = await deepseekText(
      "你是中外合作办学学生的课堂复习助手。只根据用户提供的课堂转录语料回答问题，用简体中文，条理清晰；" +
        "语料中没有的内容明确说明「课程记录中未提及」，不要编造。引用时标注来源视频标题与时间戳。",
      `课堂语料：\n${corpus.slice(0, 12000)}\n\n学生问题：${question}`
    );
    addChatHistory(question, answer, course); // 写入问答历史库
    return NextResponse.json({ answer });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
