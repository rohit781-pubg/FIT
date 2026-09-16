-- ============================================================
--  FitMeal India 2.0 — schema v2
--  03_schema_v2.sql | Run AFTER 01_schema.sql and 02_seed_foods.sql
--
--  Purely ADDITIVE. Nothing from v1 is dropped or renamed, so the
--  live site keeps working while this runs.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extend foods: diet tags, cost, and multiple serving units
-- ------------------------------------------------------------
alter table public.foods add column if not exists diet_tags   text[] not null default '{}';
alter table public.foods add column if not exists cost_per_100g numeric(7,2);      -- INR, estimate
alter table public.foods add column if not exists is_estimate  boolean not null default true;

create index if not exists foods_diet_tags_idx on public.foods using gin (diet_tags);

-- A food can be measured several ways: 1 roti / 1 bowl / 50 g / 1 tbsp
create table if not exists public.food_units (
  id        uuid primary key default gen_random_uuid(),
  food_id   uuid not null references public.foods(id) on delete cascade,
  label     text not null,              -- "1 roti", "1 katori", "100 g"
  grams     numeric(7,2) not null check (grams > 0),
  is_default boolean not null default false,
  sort_order smallint not null default 0,
  unique (food_id, label)
);
create index if not exists food_units_food_idx on public.food_units (food_id);

-- ------------------------------------------------------------
-- 2. Profile: onboarding fields
-- ------------------------------------------------------------
alter table public.profiles add column if not exists target_weight_kg numeric(5,1);
alter table public.profiles add column if not exists allergies        text[] not null default '{}';
alter table public.profiles add column if not exists dislikes         text[] not null default '{}';
alter table public.profiles add column if not exists cuisines         text[] not null default '{}';
alter table public.profiles add column if not exists appliances       text[] not null default '{}';
alter table public.profiles add column if not exists daily_budget_inr numeric(7,2);
alter table public.profiles add column if not exists cook_minutes     int;          -- max willing
alter table public.profiles add column if not exists cook_skill       text default 'beginner'
  check (cook_skill in ('beginner','comfortable','confident'));
alter table public.profiles add column if not exists household_size   int not null default 1;
alter table public.profiles add column if not exists meals_per_day    int not null default 4;
alter table public.profiles add column if not exists meal_times       jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists water_target_ml  int not null default 2500;
alter table public.profiles add column if not exists fasting_window   text;          -- '16:8', null = off
alter table public.profiles add column if not exists onboarded_at     timestamptz;
alter table public.profiles add column if not exists is_admin         boolean not null default false;

-- ------------------------------------------------------------
-- 3. Pantry / My Kitchen
-- ------------------------------------------------------------
create table if not exists public.pantry_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  food_id    uuid references public.foods(id) on delete set null,   -- null for free-text items
  name       text not null,
  qty        numeric(9,2) not null default 1 check (qty >= 0),
  unit       text not null default 'g',        -- g, ml, piece, packet
  category   text not null default 'other',
  low_at     numeric(9,2),                     -- warn below this
  expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pantry_user_idx on public.pantry_items (user_id);

-- ------------------------------------------------------------
-- 4. Water + weight (day_notes already exists; add a water log
--    so "+250 ml" taps are individually undoable)
-- ------------------------------------------------------------
create table if not exists public.water_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  log_date   date not null default current_date,
  ml         int  not null check (ml > 0),
  created_at timestamptz not null default now()
);
create index if not exists water_user_date_idx on public.water_logs (user_id, log_date);

create table if not exists public.weight_logs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  log_date   date not null default current_date,
  weight_kg  numeric(5,1) not null check (weight_kg between 20 and 400),
  note       text,
  created_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

-- ------------------------------------------------------------
-- 5. Grocery lists
-- ------------------------------------------------------------
create table if not exists public.grocery_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'Shopping list',
  plan_id    uuid references public.plans(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists grocery_lists_user_idx on public.grocery_lists (user_id);

create table if not exists public.grocery_items (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.grocery_lists(id) on delete cascade,
  name       text not null,
  qty        numeric(9,2),
  unit       text default 'g',
  category   text not null default 'other',
  est_cost   numeric(7,2),
  checked    boolean not null default false,
  have_it    boolean not null default false,
  sort_order smallint not null default 0
);
create index if not exists grocery_items_list_idx on public.grocery_items (list_id);

-- ------------------------------------------------------------
-- 6. Plan items: lock flag, so regeneration can skip them
-- ------------------------------------------------------------
alter table public.plan_items add column if not exists is_locked boolean not null default false;

-- ------------------------------------------------------------
-- 7. Streaks and badges
-- ------------------------------------------------------------
create table if not exists public.achievements (
  user_id    uuid not null references auth.users(id) on delete cascade,
  code       text not null,                 -- 'streak_7', 'protein_pro', ...
  earned_on  date not null default current_date,
  primary key (user_id, code)
);

-- ------------------------------------------------------------
-- 8. Family mode (P2 — table now so no migration later)
-- ------------------------------------------------------------
create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'My household',
  created_at timestamptz not null default now()
);
create table if not exists public.household_members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,  -- null = managed profile
  display_name text not null,
  goal         text default 'maintain',
  target_kcal  numeric(7,1),
  serving_mult numeric(4,2) not null default 1.0,
  created_at   timestamptz not null default now()
);
create index if not exists hh_members_idx on public.household_members (household_id);

-- ------------------------------------------------------------
-- 9. AI conversations (P2 — assistant history)
-- ------------------------------------------------------------
create table if not exists public.ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_conv_user_idx on public.ai_conversations (user_id, created_at);

-- ============================================================
-- 10. Row Level Security for everything new
-- ============================================================
alter table public.food_units        enable row level security;
alter table public.pantry_items      enable row level security;
alter table public.water_logs        enable row level security;
alter table public.weight_logs       enable row level security;
alter table public.grocery_lists     enable row level security;
alter table public.grocery_items     enable row level security;
alter table public.achievements      enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.ai_conversations  enable row level security;

drop policy if exists food_units_read on public.food_units;
create policy food_units_read on public.food_units for select using (true);

-- Owner-only tables
do $$
declare t text;
begin
  foreach t in array array['pantry_items','water_logs','weight_logs','grocery_lists','achievements','ai_conversations']
  loop
    execute format('drop policy if exists %I_own on public.%I', t, t);
    execute format(
      'create policy %I_own on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t, t);
  end loop;
end $$;

-- Grocery items inherit ownership through their list
drop policy if exists grocery_items_own on public.grocery_items;
create policy grocery_items_own on public.grocery_items for all to authenticated
  using (exists (select 1 from public.grocery_lists g where g.id = list_id and g.user_id = auth.uid()))
  with check (exists (select 1 from public.grocery_lists g where g.id = list_id and g.user_id = auth.uid()));

drop policy if exists households_own on public.households;
create policy households_own on public.households for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists hh_members_own on public.household_members;
create policy hh_members_own on public.household_members for all to authenticated
  using (exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid()));

-- Admin write access to the shared food table
drop policy if exists foods_admin_write on public.foods;
create policy foods_admin_write on public.foods for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ============================================================
-- 11. Daily rollup — one round trip for the dashboard
-- ============================================================
create or replace function public.day_summary(d date)
returns table (
  kcal numeric, protein numeric, carb numeric, fiber numeric,
  fat numeric, sugar numeric, sodium numeric, items int, water_ml int, weight_kg numeric
)
language sql stable security invoker as $$
  with f as (
    select
      coalesce(sum(fd.kcal      * l.qty_g / 100), 0) kcal,
      coalesce(sum(fd.protein_g * l.qty_g / 100), 0) protein,
      coalesce(sum(fd.carb_g    * l.qty_g / 100), 0) carb,
      coalesce(sum(fd.fiber_g   * l.qty_g / 100), 0) fiber,
      coalesce(sum(fd.fat_g     * l.qty_g / 100), 0) fat,
      coalesce(sum(fd.sugar_g   * l.qty_g / 100), 0) sugar,
      coalesce(sum(fd.sodium_mg * l.qty_g / 100), 0) sodium,
      count(*)::int items
    from public.log_entries l
    join public.foods fd on fd.id = l.food_id
    where l.user_id = auth.uid() and l.log_date = d
  ), w as (
    select coalesce(sum(ml), 0)::int ml from public.water_logs
    where user_id = auth.uid() and log_date = d
  ), g as (
    select weight_kg from public.weight_logs where user_id = auth.uid() and log_date = d
  )
  select f.kcal, f.protein, f.carb, f.fiber, f.fat, f.sugar, f.sodium, f.items,
         w.ml, (select weight_kg from g)
  from f, w;
$$;

-- Logging streak: consecutive days ending today with at least one entry
create or replace function public.current_streak()
returns int language sql stable security invoker as $$
  with days as (
    select distinct log_date from public.log_entries
    where user_id = auth.uid() and log_date <= current_date
  ), ranked as (
    select log_date, log_date - (row_number() over (order by log_date desc) - 1) * interval '1 day' as grp
    from days
  )
  select coalesce((
    select count(*)::int from ranked
    where grp = (select grp from ranked order by log_date desc limit 1)
      and (select max(log_date) from days) >= current_date - 1
  ), 0);
$$;

-- ============================================================
-- 12. Backfill: default serving unit + a gram unit for every food
-- ============================================================
insert into public.food_units (food_id, label, grams, is_default, sort_order)
select id, serving_desc, serving_g, true, 0 from public.foods
on conflict (food_id, label) do nothing;

insert into public.food_units (food_id, label, grams, is_default, sort_order)
select id, '100 g', 100, false, 9 from public.foods
where serving_desc <> '100 g'
on conflict (food_id, label) do nothing;

-- Half and double portions for anything measured in household units
insert into public.food_units (food_id, label, grams, is_default, sort_order)
select id, 'Half ' || lower(regexp_replace(serving_desc, '^1\s+', '')), round(serving_g/2, 1), false, 1
from public.foods where serving_desc like '1 %' and serving_g >= 20
on conflict (food_id, label) do nothing;

insert into public.food_units (food_id, label, grams, is_default, sort_order)
select id, '2 ' || regexp_replace(serving_desc, '^1\s+', ''), serving_g*2, false, 2
from public.foods where serving_desc like '1 %'
on conflict (food_id, label) do nothing;

-- ============================================================
-- 13. Diet tags derived from what we already know
-- ============================================================
update public.foods set diet_tags = (
  select array_agg(distinct t) from unnest(array[
    case when is_veg then 'vegetarian' end,
    case when is_veg and category not in ('dairy') and name not ilike '%paneer%'
              and name not ilike '%curd%' and name not ilike '%ghee%'
              and name not ilike '%butter%' and name not ilike '%malai%'
              and name not ilike '%khoya%' and name not ilike '%cheese%'
              and name not ilike '%milk%' and name not ilike '%lassi%'
         then 'vegan' end,
    case when not is_veg and (name ilike '%egg%') then 'egg' end,
    case when not is_veg and name not ilike '%egg%' then 'nonveg' end,
    case when protein_g >= 12 then 'high_protein' end,
    case when fiber_g >= 5 then 'high_fibre' end,
    case when kcal <= 120 then 'low_calorie' end,
    case when category in ('dairy') or name ilike '%paneer%' or name ilike '%curd%'
              or name ilike '%milk%' or name ilike '%cheese%' or name ilike '%lassi%'
         then 'contains_dairy' end,
    case when category in ('bread','pantry') and (name ilike '%wheat%' or name ilike '%atta%'
              or name ilike '%roti%' or name ilike '%paratha%' or name ilike '%naan%'
              or name ilike '%puri%' or name ilike '%bread%' or name ilike '%rava%'
              or name ilike '%sooji%' or name ilike '%maida%')
         then 'contains_gluten' end
  ]) t where t is not null
);

-- Jain: no onion, garlic, potato or other root vegetables
update public.foods set diet_tags = array_append(diet_tags, 'jain')
where 'vegetarian' = any(diet_tags)
  and name not ilike '%aloo%'   and name not ilike '%potato%'
  and name not ilike '%onion%'  and name not ilike '%pyaaz%'
  and name not ilike '%garlic%' and name not ilike '%lehsun%'
  and name not ilike '%beetroot%' and name not ilike '%carrot%'
  and name not ilike '%gajar%'  and name not ilike '%mooli%'
  and name not ilike '%radish%' and name not ilike '%kanda%'
  and name not ilike '%ginger%' and name not ilike '%adrak%';

-- ============================================================
-- 14. Rough cost per 100 g (INR). Estimates for the budget planner.
-- ============================================================
update public.foods set cost_per_100g = case category
  when 'pantry'    then 12 when 'fat'       then 18 when 'dairy'   then 22
  when 'nuts'      then 85 when 'fruit'     then 12 when 'vegetable' then 8
  when 'dal'       then 14 when 'rice'      then 11 when 'bread'    then 13
  when 'sabzi'     then 16 when 'curry'     then 26 when 'protein'  then 40
  when 'breakfast' then 14 when 'snack'     then 24 when 'street'   then 22
  when 'sweet'     then 38 when 'beverage'  then 10 when 'condiment' then 20
  else 18 end
where cost_per_100g is null;

update public.foods set cost_per_100g = cost_per_100g * 2.2 where not is_veg;
