-- 视频快译 · AI 用量配额表
-- 仅 service role 可读写（Edge Function 用），故开启 RLS 且不建任何 policy。

create table if not exists public.ai_usage (
  user_id uuid not null,
  day     date not null default current_date,
  calls   integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

-- 原子「检查并 +1」：返回 true 表示本次未超限（已自增），false 表示已达上限。
-- 用 CTE + insert..on conflict 保证并发下不超卖。
create or replace function public.consume_ai_quota(p_user uuid, p_limit integer)
returns boolean
language sql
security definer
set search_path = public
as $$
  with upsert as (
    insert into public.ai_usage (user_id, day, calls)
    values (p_user, current_date, 1)
    on conflict (user_id, day)
    do update set calls = public.ai_usage.calls + 1
      where public.ai_usage.calls < p_limit
    returning 1
  )
  select exists (select 1 from upsert);
$$;

revoke all on function public.consume_ai_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, integer) to service_role;
grant all on public.ai_usage to service_role;
