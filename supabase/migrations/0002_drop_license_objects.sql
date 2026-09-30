-- 视频快译 · 移除软件许可（变现层）——AI 改为强制 BYO-Key 后的远端清理
-- 顺序：先删依赖该表的函数，再删表；if exists 保证重复执行安全。
-- 许可功能已无任何代码路径调用这些对象。

drop function if exists public.has_license(uuid);
drop function if exists public.license_state(text);
drop function if exists public.redeem_license(text, text);

drop table if exists public.licenses;
