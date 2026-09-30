"use client";

/**
 * 前端 AI 操作门禁：
 * 任何触发 AI 的操作（上传翻译 / 重跑字幕 / AI 问答）执行前先查本机
 * 是否已保存用户自己的 DeepSeek Key；未配置则唤起 OnboardingApiKey 弹窗并拦截。
 *
 * 仅返回布尔，不接触 Key 明文。
 */

export const REQUIRE_API_KEY_EVENT = "vts:require-api-key";

export async function ensureApiKey(): Promise<boolean> {
  try {
    const r = await fetch("/api/user-config");
    if (!r.ok) throw new Error();
    const d = (await r.json()) as { hasKey?: boolean };
    if (d.hasKey) return true;
  } catch {
    /* fallthrough：未确认有 Key 就拦截 */
  }
  window.dispatchEvent(new CustomEvent(REQUIRE_API_KEY_EVENT));
  return false;
}
