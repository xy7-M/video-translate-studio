import { NextResponse } from "next/server";
import { supabaseUrl } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * 激活码本地代理：浏览器（含 Electron 窗口）不直连 Supabase RPC，
 * 统一带上用户 Authorization token 由这里转发，保持「密钥与数据访问都在服务端」的边界。
 *  POST { action: "redeem", code, device } —— 兑换并绑定设备
 *  POST { action: "state", device }       —— 查询当前账号许可状态
 */

const CODE_RE = /^[A-Z0-9-]{8,40}$/;
const DEVICE_RE = /^[a-z0-9-]{8,64}$/;

async function rpc(req: Request, fn: string, payload: Record<string, unknown>) {
  const url = supabaseUrl();
  if (!url) return NextResponse.json({ error: "未配置云端服务" }, { status: 500 });
  const auth = req.headers.get("authorization") || "";
  const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return NextResponse.json({ error: `许可服务异常 (${r.status}): ${t.slice(0, 120)}` }, { status: 502 });
  }
  return NextResponse.json(await r.json());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    code?: string;
    device?: string;
  };
  const device = typeof body.device === "string" ? body.device.trim().toLowerCase() : "";
  if (!DEVICE_RE.test(device)) {
    return NextResponse.json({ error: "设备信息异常，请重启应用后重试" }, { status: 400 });
  }

  if (body.action === "redeem") {
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ error: "激活码格式不正确" }, { status: 400 });
    }
    // redeem_license 返回 text：'ok' 或中文错误信息
    const resp = await rpc(req, "redeem_license", { p_code: code, p_device: device });
    const data = await resp.clone().json().catch(() => null);
    if (typeof data === "string") {
      if (data === "ok") return NextResponse.json({ ok: true });
      return NextResponse.json({ error: data }, { status: 400 });
    }
    return resp;
  }

  if (body.action === "state") {
    // license_state 返回 jsonb：{ status, same_device }
    return rpc(req, "license_state", { p_device: device });
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
