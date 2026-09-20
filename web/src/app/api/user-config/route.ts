/**
 * 用户自带 API Key 管理：只在服务端读写本机 user-config.json。
 * 安全约束：GET 永远只返回 { hasKey, useOwnKey }，绝不把明文 Key 回传给浏览器。
 */
import { NextResponse } from "next/server";
import {
  clearUserApiKey,
  disableOwnKey,
  hasOwnKey,
  setUserApiKey,
} from "@/lib/user-config";

export const runtime = "nodejs";

/** GET：查询当前是否启用了自带 Key（不返回 Key 本身） */
export async function GET() {
  return NextResponse.json({
    hasKey: hasOwnKey(),
    useOwnKey: hasOwnKey(),
  });
}

/** POST：保存/启用自带 Key，或切换启用状态 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    apiKey?: string;
    action?: "save" | "disable" | "clear";
  };

  // 关闭自带 Key 模式（保留 Key 备用）
  if (body.action === "disable") {
    disableOwnKey();
    return NextResponse.json({ ok: true, hasKey: false, useOwnKey: false });
  }

  // 彻底清除
  if (body.action === "clear") {
    clearUserApiKey();
    return NextResponse.json({ ok: true, hasKey: false, useOwnKey: false });
  }

  // 保存/启用
  const key = (body.apiKey || "").trim();
  if (key.length < 8) {
    return NextResponse.json({ error: "API Key 格式不正确（至少 8 位）" }, { status: 400 });
  }
  try {
    setUserApiKey(key);
    return NextResponse.json({ ok: true, hasKey: true, useOwnKey: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 },
    );
  }
}

/** DELETE：彻底清除自带 Key */
export async function DELETE() {
  clearUserApiKey();
  return NextResponse.json({ ok: true, hasKey: false, useOwnKey: false });
}
