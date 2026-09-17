import { NextResponse } from "next/server";
import { getTask, buildDocx } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const t = getTask(params.id);
  if (!t || !t.segments) return NextResponse.json({ error: "字幕尚未生成" }, { status: 404 });

  const safe = (t.title || t.id).replace(/[\\/:*?"<>|]/g, "_");
  // 中文标题必须用 RFC 5987 编码，否则 Node 写 header 时会抛 ByteString 错误
  const disp = (name: string) =>
    `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

  // 导出 Word 双语字幕表，Word/WPS 可直接打开
  const buf = await buildDocx(t.title || safe, t.segments);
  // Node Buffer 不直接满足 BodyInit 类型，转 Uint8Array 视图（零拷贝）
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": disp(`subtitle-${safe}.docx`),
    },
  });
}
