/**
 * 用户自带 API Key 本地存储：仅用于「导入自己 API」功能。
 *
 * 设计原则（与用户安全红线一致）：
 *  - 密钥只存在用户本机文件（DATA_DIR/user-config.json），永不进 localStorage、永不回传前端、永不入 git。
 *  - 文件落在用户自己的 AppData 目录，由操作系统文件权限保护（与桌面应用存放凭证的惯例一致）。
 *  - GET /api/user-config 只返回 { hasKey: boolean }，绝不把明文 key 发回浏览器。
 *
 * 当用户启用自带 Key 时：
 *  - deepseek.ts 直接用此 Key 调 DeepSeek，绕过 Supabase Edge Function 代理与许可门禁；
 *  - 用户自行承担 DeepSeek 侧计费（建议在 DeepSeek 平台设置消费上限 100 元）。
 * 当未启用时：回退到原 Edge Function 代理路径（应用共享 Key + 激活码门禁 + 每日配额）。
 */
import fs from "fs";
import path from "path";

// 不从 pipeline.ts 导入 DATA_DIR，避免循环依赖：
// pipeline.ts → deepseek.ts → user-config.ts → pipeline.ts
// 与 pipeline.ts 中的 DATA_DIR 计算逻辑保持一致
const ROOT = process.env.VIDEOTRANS_ROOT
  ? path.resolve(process.env.VIDEOTRANS_ROOT)
  : path.resolve(process.cwd(), "..");
const DATA_DIR = process.env.VIDEOTRANS_HOME
  ? path.resolve(process.env.VIDEOTRANS_HOME)
  : path.join(ROOT, ".data");

const CONFIG_FILE = path.join(DATA_DIR, "user-config.json");

type UserConfig = {
  /** 用户自带 DeepSeek API Key（明文存本机，文件权限保护） */
  deepseekApiKey?: string;
  /** 是否主动启用了自带 Key 模式（区分"没填"和"填了但暂时关闭"） */
  useOwnKey?: boolean;
  /** ISO 时间戳：上次写入时间，用于调试 */
  updatedAt?: string;
};

function read(): UserConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as UserConfig;
  } catch {
    return {};
  }
}

function write(cfg: UserConfig) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...cfg, updatedAt: new Date().toISOString() }, null, 2));
}

/** 取用户自带 Key：仅在服务端调用，返回明文供 deepseek.ts 直连 DeepSeek 使用 */
export function getUserApiKey(): string | null {
  const cfg = read();
  if (!cfg.useOwnKey) return null;
  const k = (cfg.deepseekApiKey || "").trim();
  return k.length >= 8 ? k : null;
}

/** 是否启用了自带 Key（前端只应拿到这个布尔值，不应拿到 Key 本身） */
export function hasOwnKey(): boolean {
  return getUserApiKey() !== null;
}

/** 保存用户自带 Key 并启用 */
export function setUserApiKey(key: string) {
  const trimmed = key.trim();
  if (trimmed.length < 8) throw new Error("API Key 长度过短");
  write({ ...read(), deepseekApiKey: trimmed, useOwnKey: true });
}

/** 关闭自带 Key 模式（保留 Key 以便下次重开，但不再使用） */
export function disableOwnKey() {
  write({ ...read(), useOwnKey: false });
}

/** 彻底清除用户自带 Key */
export function clearUserApiKey() {
  write({ ...read(), deepseekApiKey: "", useOwnKey: false });
}
