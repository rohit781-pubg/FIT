-- ============================================================
--  THALI — Indian diet planner + food log
--  01_schema.sql  |  Run this FIRST in the Supabase SQL editor
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. Food database (public read, admin write)
-- ------------------------------------------------------------
create table if not exists public.foods (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  name_local    text,                       -- Hindi / regional name
  category      text not null,              -- grain, dal, sabzi, snack, sweet, ...
  region        text not null default 'pan-india',
  is_veg        boolean not null default true,
  -- Default household serving
  serving_desc  text not null,              -- "1 medium roti", "1 katori"
  serving_g     numeric(7,2) not null,      -- grams in that serving
  -- Nutrition per 100 g edible portion
  kcal          numeric(7,2) not null,
  protein_g     numeric(6,2) not null default 0,
  carb_g        numeric(6,2) not null default 0,
  fiber_g       numeric(6,2) not null default 0,
  fat_g         numeric(6,2) not null default 0,
  sat_fat_g     numeric(6,2) not null default 0,
  sugar_g       numeric(6,2) not null default 0,
  sodium_mg     numeric(7,2) not null default 0,
  source        text default 'IFCT 2017 / composite',
  verified      boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists foods_name_idx     on public.foods using gin (to_tsvector('simple', name || ' ' || coalesce(name_local,'')));
create index if not exists foods_category_idx on public.foods (category);
create index if not exists foods_region_idx   on public.foods (region);

-- ------------------------------------------------------------
-- 2. Profiles — one row per auth user
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  display_name   text,
  sex            text check (sex in ('male','female','other')),
  birth_year     int  check (birth_year between 1900 and 2100),
  height_cm      numeric(5,1),
  weight_kg      numeric(5,1),
  activity_level text default 'light'
                 check (activity_level in ('sedentary','light','moderate','active','very_active')),
  goal           text default 'maintain'
                 check (goal in ('lose','maintain','gain')),
  diet_type      text default 'veg' check (diet_type in ('veg','egg','nonveg','vegan','jain')),
  -- Daily targets. Null => app computes from the fields above.
  target_kcal    numeric(7,1),
  target_protein numeric(6,1),
  target_carb    numeric(6,1),
  target_fat     numeric(6,1),
  units          text not null default 'metric',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Auto-create a profile row whenever a user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 3. Diet plans — a reusable weekly template
-- ------------------------------------------------------------
create table if not exists public.plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  notes       text,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists plans_user_idx on public.plans (user_id);

create table if not exists public.plan_items (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  food_id     uuid not null references public.foods(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Monday
  meal        text not null check (meal in ('breakfast','lunch','snack','dinner')),
  qty_g       numeric(7,2) not null check (qty_g > 0),
  sort_order  smallint not null default 0
);
create index if not exists plan_items_plan_idx on public.plan_items (plan_id, day_of_week);

-- ------------------------------------------------------------
-- 4. Food log — what was actually eaten
-- ------------------------------------------------------------
create table if not exists public.log_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  food_id    uuid not null references public.foods(id) on delete cascade,
  log_date   date not null default current_date,
  meal       text not null check (meal in ('breakfast','lunch','snack','dinner')),
  qty_g      numeric(7,2) not null check (qty_g > 0),
  created_at timestamptz not null default now()
);
create index if not exists log_user_date_idx on public.log_entries (user_id, log_date);

-- Optional: daily weight / notes
create table if not exists public.day_notes (
  user_id   uuid not null references auth.users(id) on delete cascade,
  log_date  date not null,
  weight_kg numeric(5,1),
  water_ml  int,
  note      text,
  primary key (user_id, log_date)
);

-- ------------------------------------------------------------
-- 5. Row Level Security
-- ------------------------------------------------------------
alter table public.foods       enable row level security;
alter table public.profiles    enable row level security;
alter table public.plans       enable row level security;
alter table public.plan_items  enable row level security;
alter table public.log_entries enable row level security;
alter table public.day_notes   enable row level security;

-- Foods: anyone (even signed-out) can read. Signed-in users may add
-- their own custom foods, which land unverified.
drop policy if exists foods_read   on public.foods;
drop policy if exists foods_insert on public.foods;
drop policy if exists foods_update on public.foods;
drop policy if exists foods_delete on public.foods;

create policy foods_read   on public.foods for select using (true);
create policy foods_insert on public.foods for insert to authenticated
  with check (created_by = auth.uid() and verified = false);
create policy foods_update on public.foods for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy foods_delete on public.foods for delete to authenticated
  using (created_by = auth.uid());

-- Profiles
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Plans
drop policy if exists plans_own on public.plans;
create policy plans_own on public.plans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Plan items: ownership is inherited through the parent plan
drop policy if exists plan_items_own on public.plan_items;
create policy plan_items_own on public.plan_items for all to authenticated
  using (exists (select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid()));

-- Log entries
drop policy if exists log_own on public.log_entries;
create policy log_own on public.log_entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Day notes
drop policy if exists day_notes_own on public.day_notes;
create policy day_notes_own on public.day_notes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 6. Convenience view: a day's totals, already scaled
-- ------------------------------------------------------------
create or replace view public.v_log_detail
with (security_invoker = true) as
select
  l.id, l.user_id, l.log_date, l.meal, l.qty_g,
  f.id as food_id, f.name, f.name_local, f.category, f.region,
  f.is_veg, f.serving_desc, f.serving_g,
  round(f.kcal      * l.qty_g / 100, 1) as kcal,
  round(f.protein_g * l.qty_g / 100, 1) as protein_g,
  round(f.carb_g    * l.qty_g / 100, 1) as carb_g,
  round(f.fiber_g   * l.qty_g / 100, 1) as fiber_g,
  round(f.fat_g     * l.qty_g / 100, 1) as fat_g,
  round(f.sugar_g   * l.qty_g / 100, 1) as sugar_g,
  round(f.sodium_mg * l.qty_g / 100, 1) as sodium_mg
from public.log_entries l
join public.foods f on f.id = l.food_id;

-- Full-text-ish food search callable from the client
create or replace function public.search_foods(q text, lim int default 40)
returns setof public.foods
language sql stable as $$
  select * from public.foods
  where q is null or q = ''
     or name ilike '%' || q || '%'
     or coalesce(name_local,'') ilike '%' || q || '%'
     or category ilike '%' || q || '%'
  order by (name ilike q || '%') desc, verified desc, name
  limit least(coalesce(lim, 40), 200);
$$;
