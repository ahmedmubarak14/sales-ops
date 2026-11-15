-- ============================================================
-- Sales Ops Portal — 007 managers manage employees only
--
-- Managers may add people as employees (role 'rep') and revoke or
-- restore an employee's access, and keep their plan, joining month and
-- sector up to date (Targets page). They cannot give anyone another
-- role, and cannot touch managers, finance or admins. Admins can do
-- everything, as before.
-- ============================================================

drop policy if exists app_users_insert on app_users;
drop policy if exists app_users_update on app_users;
drop policy if exists app_users_delete on app_users;

create policy app_users_insert on app_users for insert to authenticated
  with check ((select is_role('admin')) or ((select is_role('manager')) and role = 'rep'));
create policy app_users_update on app_users for update to authenticated
  using ((select is_role('admin')) or ((select is_role('manager')) and role = 'rep'))
  with check ((select is_role('admin')) or ((select is_role('manager')) and role = 'rep'));
create policy app_users_delete on app_users for delete to authenticated
  using ((select is_role('admin')));

-- An upsert by email (Access page) must not let a manager overwrite an
-- existing non-employee row through the insert path either: the update
-- policy above already refuses it, so on conflict the whole call fails.
