/**
 * 本地配置：桌面版把 DeepSeek 密钥保存在数据目录 config.json（用户目录下，不上传）。
 * 开发态若未保存过，则回退读取服务端环境变量 DEEPSEEK_API_KEY。
 * GET 永远不回传完整密钥，只回传是否已配置与末 4 位。
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/pipeline";

const CONFIG_FILE = path.join(DATA_DIR, "config.json");

function readConfig(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeConfig(cfg: Record<string, string>) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

export async function GET() {
  const cfg = readConfig();
  const key = cfg.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "";
  return NextResponse.json({
    hasKey: !!key && !key.startsWith("sk-xxxx"),
    tail: key ? key.slice(-4) : "",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { apiKey?: string };
  const cfg = readConfig();
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    cfg.deepseekApiKey = body.apiKey.trim();
    // 立即对当前服务进程生效，无需重启
    process.env.DEEPSEEK_API_KEY = cfg.deepseekApiKey;
  }
  writeConfig(cfg);
  return NextResponse.json({ ok: true });
}
