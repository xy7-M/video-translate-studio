/**
 * 视频快译 · 激活码批量生成（卖方自用，切勿分发）
 *
 * 用法（PowerShell）：
 *   $env:SUPABASE_URL="https://xxxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi..."   # 只在本机临时使用，不要写进任何文件
 *   node scripts/gen-licenses.mjs 20
 *
 * 生成 20 条码，格式 VTS-XXXX-XXXX-XXXX（去掉易混字符 O/0/I/1），
 * 以 status='unused' 写入 licenses 表，并把码打印到控制台供你发货。
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 无 O/0/I/1

function block(n) {
  let s = "";
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

function newCode() {
  return `VTS-${block(4)}-${block(4)}-${block(4)}`;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("缺少环境变量 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const count = Math.min(500, Math.max(1, Number(process.argv[2]) || 10));

  const codes = Array.from({ length: count }, newCode);
  const rows = codes.map((code) => ({ code, status: "unused", max_devices: 1 }));

  const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/licenses`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    console.error("写入失败：", r.status, await r.text());
    process.exit(1);
  }
  console.log(`已生成 ${count} 条激活码：\n`);
  for (const c of codes) console.log(c);
}

main();
