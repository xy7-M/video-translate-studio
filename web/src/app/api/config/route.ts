/**
 * 本地只读配置：AI 为强制 BYO-Key——这里返回当前是否已配置用户自己的
 * DeepSeek Key，供界面展示真实可用状态。
 */
import { NextResponse } from "next/server";
import { hasOwnKey } from "@/lib/user-config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    aiProvider: "deepseek-byok",
    hasKey: hasOwnKey(),
  });
}
