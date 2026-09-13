/**
 * 本地配置：AI 服务已由 Supabase 云代理统一提供，用户不再需要（也不能）自带 DeepSeek 密钥。
 * 这里仅保留只读的服务信息，供设置面板展示。
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    aiProvider: "supabase-proxy",
    hasKey: true, // 密钥由服务端 Edge Function 持有，始终可用
  });
}
