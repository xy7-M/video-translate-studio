import { NextResponse } from "next/server";
import { retrieveCorpus } from "@/lib/pipeline";
import { deepseekText } from "@/lib/deepseek";

export const runtime = "nodejs";
export const maxDuration = 120;

/** AI Chat 跨课程问答（借鉴 Otter）：基于已转写课程语料回答复习问题 */
export async function POST(req: Request) {
  const body = (await req.json()) as { question?: string; course?: string };
  const question = (body.question || "").trim();
  if (!question) return NextResponse.json({ error: "请输入问题" }, { status: 400 });

  const corpus = retrieveCorpus(question, (body.course || "").trim() || undefined);
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
    return NextResponse.json({ answer });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
