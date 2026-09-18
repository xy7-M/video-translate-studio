-- 视频快译 · 激活码（license）变现层
-- 一张表 + 三个函数：卡密由卖方批量生成（status='unused'），
-- 用户在自己的 Supabase 账号上「兑换」→ 绑定 user_id + 设备指纹 → status='active'。
-- AI 网关（deepseek-proxy）在扣配额前先查 has_license(user)，无有效许可直接 402。
-- 全程 service_role 可读写；开启 RLS 且不建 policy，anon/authenticated 无法直查，只能走函数。

create table if not exists public.licenses (
  code         text primary key,
  status       text not null default 'unused'
                 check (status in ('unused', 'active', 'revoked')),
  user_id      uuid,
  device_id    text,
  max_devices  integer not null default 1,
  created_at   timestamptz not null default now(),
  activated_at timestamptz
);

alter table public.licenses enable row level security;

-- ── 兑换：把卡密绑定到当前登录账号 + 设备指纹 ──
-- 原子操作，防并发重复兑换。返回 'ok' 或中文错误信息。
-- security definer：内部以函数所有者权限读写 licenses，调用者只暴露 auth.uid()。
create or replace function public.redeem_license(p_code text, p_device text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  row licenses%rowtype;
  active_same_user integer;
begin
  if u is null then
    return '请先登录后再激活';
  end if;
  if p_code is null or length(trim(p_code)) = 0 then
    return '请输入激活码';
  end if;
  if p_device is null or length(p_device) < 8 then
    return '设备信息异常，请重启应用后重试';
  end if;

  p_code := upper(trim(p_code));

  -- 行锁，避免同一码被并发兑换两次
  select * into row from public.licenses where code = p_code for update;
  if not found then
    return '激活码无效，请核对后重试';
  end if;

  if row.status = 'revoked' then
    return '该激活码已被停用';
  end if;

  -- 同一账号重复兑换同一码：幂等成功
  if row.status = 'active' and row.user_id = u then
    -- 换设备：超出 max_devices 则拒绝，否则追加设备（简单起见仅允许一台）
    if row.device_id is distinct from p_device then
      return '该激活码已绑定其他设备，如需换机请联系客服';
    end if;
    return 'ok';
  end if;

  if row.status = 'active' then
    return '该激活码已被使用';
  end if;

  -- unused → 绑定并激活
  update public.licenses
     set status = 'active', user_id = u, device_id = p_device, activated_at = now()
   where code = p_code;
  return 'ok';
end;
$$;

-- ── 查询当前账号的许可状态（供前端展示 / 换机检测）──
-- 返回 JSON：{ status, same_device }
create or replace function public.license_state(p_device text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status', coalesce((
      select l.status from public.licenses l
       where l.user_id = auth.uid() and l.status = 'active'
       limit 1), 'none'),
    'same_device', coalesce((
      select (l.device_id = p_device) from public.licenses l
       where l.user_id = auth.uid() and l.status = 'active'
       limit 1), false)
  );
$$;

-- ── 网关校验：该用户是否持有有效许可（service_role 专用）──
create or replace function public.has_license(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.licenses
     where user_id = p_user and status = 'active'
  );
$$;

-- 权限：全部收回 public/anon/authenticated，仅 service_role 可执行
revoke all on function public.redeem_license(text, text) from public, anon, authenticated;
revoke all on function public.license_state(text) from public, anon;
revoke all on function public.has_license(uuid) from public, anon, authenticated;

grant execute on function public.redeem_license(text, text) to authenticated;
grant execute on function public.license_state(text) to authenticated;
grant execute on function public.has_license(uuid) to service_role;
grant all on public.licenses to service_role;
