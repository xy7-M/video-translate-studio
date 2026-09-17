import { NextResponse, type NextRequest } from "next/server";

/**
 * 本地服务同源校验：
 * 应用默认监听 127.0.0.1（桌面版固定 3456），开发联调时也可能监听局域网 IP。
 * 任意网页都能让浏览器向 localhost/局域网端口发请求（跨站），若无校验，
 * 恶意网站可读取本机全部字幕/视频、删除任务，甚至从 /api/auth/relay 偷走登录会话。
 *
 * 策略：浏览器跨站请求一定带 Origin，且 Origin host 与 Host 不一致 → 拒绝；
 * 同源页面（含手机用局域网 IP 访问）与无 Origin 的非浏览器请求放行。
 */
export function middleware(req: NextRequest) {
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
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
