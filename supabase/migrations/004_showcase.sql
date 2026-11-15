-- ============================================================
-- Sales Ops Portal — 004 Top Zid Stores showcase
--
-- Same as Sales Hunter 015/050/051/052: sync-metabase ranks the top ten
-- stores of every category from the warehouse and writes them here.
-- store_showcase carries order counts and revenue, so only admins read
-- it directly. Everyone else reads store_showcase_lite: name, category,
-- rank and web address only, and only when the caller is an active
-- member.
-- ============================================================

create table store_showcase (
  store_id text primary key,
  name text not null,
  category text not null,
  orders_count integer,
  orders_total_sar numeric,
  rank_in_category integer,
  store_url text,
  synced_at timestamptz not null default now()
);
create index store_showcase_category_idx on store_showcase (category, rank_in_category);
create index store_showcase_synced_idx on store_showcase (synced_at);

alter table store_showcase enable row level security;
create policy store_showcase_admin_read on store_showcase for select to authenticated
  using ((select is_role('admin')));
revoke all on store_showcase from anon;
revoke insert, update, delete, truncate on store_showcase from authenticated;

-- security_invoker stays OFF on purpose. With it on, the view would run
-- with the reader's rights, store_showcase's admin-only policy would
-- apply, and every rep, manager and finance user would see zero stores
-- (this is exactly what happened to Sales Hunter, migration 050, after a
-- security-advisor suggestion was applied in the dashboard). The view
-- exists to be everyone's window on that table: it runs with its
-- owner's rights, exposes no order counts or revenue, and returns rows
-- only to an active member (current_member() is not null).
-- Do not "fix" the advisor warning on this view.
create or replace view store_showcase_lite with (security_invoker = false) as
  select store_id, name, category, rank_in_category, store_url
  from store_showcase
  where (select (current_member()).id) is not null;

revoke all on store_showcase_lite from anon;
grant select on store_showcase_lite to authenticated;
