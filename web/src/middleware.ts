import { NextResponse, type NextRequest } from "next/server";

/**
 * 本地服务同源 + 私域化 ACL：
 * 1) 同源校验：浏览器跨站请求一定带 Origin，且 Origin host 与 Host 不一致 → 拒绝；
 *    防止恶意网站在浏览器里借用户机器发请求偷字幕/视频/会话 token。
 * 2) 私域化 ACL：仅放行 loopback + 局域网（RFC1918）+ 链路本地地址，
 *    公网 IP 一律 403。即便用户路由器误把 3456 转发到公网、或在公网 WiFi
 *    下运行桌面版，外部 IP 也无法访问任何 /api/* 接口。
 *
 * 安全第一：桌面版无反向代理，Next 的 req.ip 在 base-server.js L530 由
 * `x-forwarded-for ?? socket.remoteAddress` 决定。在没有反代的前提下
 * socket.remoteAddress 即真实对端 IP；仍优先取该值，XFF 仅作兜底。
 * 不影响：本机 127.0.0.1、局域网 192.168/10/172.16-31、IPv6 loopback ::1。
 */
export function middleware(req: NextRequest) {
  // —— 1) 同源校验 ——
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      /* 非法 Origin（如 "null"）直接拒绝 */
    }
    const host = req.headers.get("host") || "";
    if (!originHost || originHost !== host) {
      return new NextResponse("跨域请求被拒绝", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }

  // —— 2) 私域化 ACL ——
  const ip = req.ip || extractIp(req);
  if (ip && !isPrivateIp(ip)) {
    return new NextResponse("私域服务禁止公网访问", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.next();
}

/** Next 14.2 的 req.ip 在 base-server.js L530 取 XFF 头兜底；此函数仅在 req.ip 缺失时使用 */
function extractIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  return null;
}

/** 判断 IP 是否属于私域（loopback / RFC1918 / 链路本地） */
function isPrivateIp(raw: string): boolean {
  // 去掉 IPv4-mapped IPv6 前缀 ::ffff:
  const ip = raw.replace(/^::ffff:/i, "").trim();

  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback 127.0.0.0/8
    if (a === 10) return true; // 私网 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 私网 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 私网 172.16.0.0/12
    if (a === 169 && b === 254) return true; // 链路本地 169.254.0.0/16
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:")) return true; // 链路本地
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  return false;
}

export const config = {
  matcher: ["/api/:path*"],
};
