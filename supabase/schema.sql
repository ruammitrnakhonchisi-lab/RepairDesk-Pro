-- ============================================================
--  RepairDesk — Supabase schema
--  Run this once in Supabase Dashboard > SQL Editor
-- ============================================================

-- ---------- MACHINES / VEHICLES ----------
create table if not exists machines (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  category    text default 'เครื่องจักร',
  location    text,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------- TECHNICIANS ----------
create sequence if not exists tech_code_seq;

create table if not exists techs (
  code        text primary key,
  name        text not null,
  phone       text,
  skill       text,
  status      text not null default 'ใช้งาน',
  created_at  timestamptz not null default now()
);

create or replace function set_tech_code()
returns trigger language plpgsql as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'TC-' || lpad(nextval('tech_code_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tech_code on techs;
create trigger trg_tech_code
before insert on techs
for each row execute function set_tech_code();

-- ---------- JOBS (ใบแจ้งซ่อม) ----------
create sequence if not exists job_code_seq;

create table if not exists jobs (
  id              text primary key,
  reported_at     date not null default current_date,
  customer_name   text,
  phone           text,
  category        text default 'เครื่องจักร',
  machine_name    text,
  problem_detail  text,
  location        text,
  urgency         text default 'ปานกลาง',
  status          text not null default 'รอดำเนินการ',
  technician      text,
  note            text,
  due_date        date,
  parts_used      text,
  cost            numeric,
  solution        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function set_job_id()
returns trigger language plpgsql as $$
begin
  if new.id is null or new.id = '' then
    new.id := 'RD-' || lpad(nextval('job_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_job_id on jobs;
create trigger trg_job_id
before insert on jobs
for each row execute function set_job_id();

create or replace function touch_job_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_job_touch on jobs;
create trigger trg_job_touch
before update on jobs
for each row execute function touch_job_updated_at();

-- ---------- JOB TIMELINE (ประวัติการดำเนินงาน) ----------
create table if not exists job_timeline (
  id          bigint generated always as identity primary key,
  job_id      text not null references jobs(id) on delete cascade,
  changed_at  timestamptz not null default now(),
  old_status  text,
  new_status  text,
  technician  text,
  note        text
);

create index if not exists idx_job_timeline_job_id on job_timeline(job_id);

-- log initial status on insert, and status changes on update
create or replace function log_job_timeline()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into job_timeline(job_id, old_status, new_status, technician, note)
    values (new.id, null, new.status, new.technician, 'เริ่มต้นใบแจ้งซ่อม');
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into job_timeline(job_id, old_status, new_status, technician, note)
    values (new.id, old.status, new.status, new.technician, null);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_job_timeline on jobs;
create trigger trg_job_timeline
after insert or update on jobs
for each row execute function log_job_timeline();

-- ---------- SETTINGS (singleton row) ----------
create table if not exists settings (
  id            smallint primary key default 1 check (id = 1),
  company_name  text,
  department    text,
  phone         text,
  address       text,
  updated_at    timestamptz not null default now()
);

insert into settings (id, company_name, department, phone, address)
values (1, 'RepairDesk Pro', 'ระบบแจ้งซ่อมและบำรุงรักษา', '', '')
on conflict (id) do nothing;

create or replace function touch_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_settings_touch on settings;
create trigger trg_settings_touch
before update on settings
for each row execute function touch_settings_updated_at();

-- ============================================================
--  ROW LEVEL SECURITY
--  App has no login (matches the original Google Apps Script
--  behaviour: anyone with the link can read/write). RLS is
--  enabled with fully-open policies for the anon role so the
--  browser can talk to Supabase directly via the anon key.
--  If you later add login, replace these policies with
--  auth.uid()-based checks.
-- ============================================================
alter table machines     enable row level security;
alter table techs        enable row level security;
alter table jobs         enable row level security;
alter table job_timeline enable row level security;
alter table settings     enable row level security;

drop policy if exists "public full access" on machines;
create policy "public full access" on machines
  for all using (true) with check (true);

drop policy if exists "public full access" on techs;
create policy "public full access" on techs
  for all using (true) with check (true);

drop policy if exists "public full access" on jobs;
create policy "public full access" on jobs
  for all using (true) with check (true);

drop policy if exists "public read/insert" on job_timeline;
drop policy if exists "public select" on job_timeline;
create policy "public select" on job_timeline
  for select using (true);
drop policy if exists "public insert" on job_timeline;
create policy "public insert" on job_timeline
  for insert with check (true);

drop policy if exists "public full access" on settings;
create policy "public full access" on settings
  for all using (true) with check (true);

-- ============================================================
--  PREVENTIVE MAINTENANCE (PM)
--  One flexible model instead of the old paper system's many
--  different form layouts (daily tick-grids, weekly rotation
--  sheets, detailed monthly checklists): a reusable checklist
--  template assigned to a machine at a chosen frequency, with a
--  due date the system advances automatically after each check.
-- ============================================================

-- ---------- CHECKLIST TEMPLATES ----------
create table if not exists pm_checklists (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  items       jsonb not null default '[]'::jsonb, -- ["ตรวจสอบ...", "ตรวจสอบ...", ...]
  created_at  timestamptz not null default now()
);

-- ---------- PER-MACHINE SCHEDULE ----------
create table if not exists pm_schedules (
  id               bigint generated always as identity primary key,
  machine_name     text not null references machines(name) on delete cascade,
  checklist_id     bigint not null references pm_checklists(id) on delete restrict,
  frequency        text not null check (frequency in ('daily','weekly','monthly')),
  next_due_date    date not null default current_date,
  last_checked_at  timestamptz,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists idx_pm_schedules_machine on pm_schedules(machine_name);

-- ---------- COMPLETED CHECKS ----------
create table if not exists pm_records (
  id              bigint generated always as identity primary key,
  schedule_id     bigint references pm_schedules(id) on delete set null,
  machine_name    text not null,
  checklist_name  text not null, -- snapshot, so history reads correctly even if the template is edited later
  checked_at      timestamptz not null default now(),
  checked_by      text,
  results         jsonb not null default '[]'::jsonb, -- [{"item":"...", "status":"ok"|"issue", "note":"..."}, ...]
  has_issue       boolean not null default false,
  overall_note    text
);

create index if not exists idx_pm_records_machine on pm_records(machine_name);
create index if not exists idx_pm_records_schedule on pm_records(schedule_id);

-- after each check, push the schedule's due date forward by its frequency
create or replace function advance_pm_schedule()
returns trigger language plpgsql as $$
declare
  freq text;
  base date;
begin
  if new.schedule_id is not null then
    select frequency into freq from pm_schedules where id = new.schedule_id;
    base := (new.checked_at at time zone 'Asia/Bangkok')::date;
    update pm_schedules
    set next_due_date = case freq
          when 'daily' then base + 1
          when 'weekly' then base + 7
          when 'monthly' then (base + interval '1 month')::date
          else base + 1
        end,
        last_checked_at = new.checked_at
    where id = new.schedule_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_advance_pm_schedule on pm_records;
create trigger trg_advance_pm_schedule
after insert on pm_records
for each row execute function advance_pm_schedule();

alter table pm_checklists enable row level security;
alter table pm_schedules  enable row level security;
alter table pm_records    enable row level security;

drop policy if exists "public full access" on pm_checklists;
create policy "public full access" on pm_checklists
  for all using (true) with check (true);

drop policy if exists "public full access" on pm_schedules;
create policy "public full access" on pm_schedules
  for all using (true) with check (true);

drop policy if exists "public full access" on pm_records;
create policy "public full access" on pm_records
  for all using (true) with check (true);
