# FitMeal India 2.0

Plan Indian meals around your goal, track what you actually eat, and know what
you can cook with what's already in your kitchen.

Live: https://fitmealindia.netlify.app/

---

## 1. Feature audit — what changed

The previous version was a single 1,178-line `app.js` with six tables. Nothing
has been deleted; everything has been extended.

| Was | Now |
|---|---|
| One monolithic `app.js` | 10 ES modules, no build step |
| `S.view` string, no deep links | Hash router (`#/home`, `#/meals`…), Netlify SPA fallback |
| Supabase email auth | Unchanged — it worked |
| 6 tables | 16 tables, all with RLS. v1 tables untouched |
| 326 foods, one serving each | Same 326 foods + multiple serving units, diet tags, cost estimates |
| Refetch on every render | 45-second TTL cache, busted on write |
| Manual plan building | Deterministic generator with lock, swap and regenerate |
| No onboarding | Seven-step flow feeding every downstream feature |
| No `netlify.toml` | Build config, SPA redirect, security headers |

**Preserved:** auth, the signup trigger, the food table and its 326 rows, the
thali ring visual, the dark/turmeric identity, mobile bottom tabs.

---

## 2. Architecture

```
index.html          shell — loads one stylesheet and one module
css/app.css         design system: tokens, components, responsive rules
js/core.js          config, state, date helpers, nutrition maths, UI primitives
js/db.js            every Supabase call, plus the cache
js/engine.js        planner, swaps, grocery aggregation, badges, smart search
js/pickers.js       food search, portion chooser, custom food
js/app.js           router, auth screen, shell, boot
js/pages/
  onboarding.js     7-step profile setup
  home.js           dashboard, food log, water, quick actions
  meals.js          weekly plan: generate, lock, swap, copy, groceries
  kitchen.js        pantry + shopping lists
  track.js          progress charts, weight, badges
  me.js             profile, targets, food database browser
netlify/functions/
  assistant.js      AI endpoint — keeps the model key server-side
db/                 SQL migrations and the food dataset
scripts/            dataset source, generator, smoke test
```

No framework, no bundler, no `node_modules` in production. The whole app is
about 100 KB of source; Supabase and Google Fonts are the only external calls.

---

## 3. Database schema

Run in the Supabase SQL editor, in order. `03` is purely additive — it does not
drop or rename anything, so the live site keeps working while it runs.

1. `db/01_schema.sql` — v1 (already applied)
2. `db/02_seed_foods.sql` — 326 foods (already applied)
3. **`db/03_schema_v2.sql`** — everything below

**New tables:** `food_units`, `pantry_items`, `water_logs`, `weight_logs`,
`grocery_lists`, `grocery_items`, `achievements`, `households`,
`household_members`, `ai_conversations`

**Extended:** `foods` gains `diet_tags[]`, `cost_per_100g`, `is_estimate`.
`profiles` gains 15 onboarding columns. `plan_items` gains `is_locked`.

**New functions:** `day_summary(date)` rolls up a day in one round trip;
`current_streak()` computes consecutive logged days.

**RLS:** every user-owned table is `user_id = auth.uid()`. `grocery_items` and
`plan_items` inherit through their parent. `foods` and `food_units` are
world-readable; writes are restricted to the row's creator or an admin
(`profiles.is_admin`). Make yourself admin with:

```sql
update public.profiles set is_admin = true where id = auth.uid();
```

The migration also backfills serving units (half / single / double / 100 g),
derives diet tags from existing data, and sets rough per-100g costs.

---

## 4. Routes

| Route | Page | What it does |
|---|---|---|
| `#/home` | Dashboard | Today's ring, macros, four meals, water, quick actions |
| `#/meals` | Meal plan | Weekly calendar, generate, lock, swap, copy, groceries |
| `#/kitchen` | My Kitchen | Pantry with expiry + low stock, shopping lists |
| `#/track` | Progress | 7/30/90-day charts, weight, badges |
| `#/me` | Profile | Details, targets, food database, safety notes |
| `#/onboarding` | Setup | Shown automatically until `onboarded_at` is set |

Mobile: five bottom tabs plus a floating log-food button.

---

## 5. Environment variables

**Right now: none.** The Supabase URL and anon key are in `js/core.js`, which is
correct — the anon key is designed for browsers and RLS is what protects data.

**For the AI assistant (P2), set in Netlify → Site settings → Environment
variables, never in a file:**

```
ANTHROPIC_API_KEY = sk-ant-...
```

Until it's set, `/api/assistant` returns a clean 503 with an explanatory
message rather than failing silently.

**Never put the Supabase `service_role` key anywhere in this repo.** It bypasses
RLS entirely.

---

## 6. Implemented and working

| # | Feature | Notes |
|---|---|---|
| 1 | Onboarding & profile | 7 steps, live target preview, editable later |
| 2 | Food database | 326 foods, multi-unit servings, diet tags, cost |
| 3 | Meal planner | Deterministic, hits calorie + protein targets |
| 5 | Pantry | Quantities, units, expiry, low-stock warnings |
| 7 | Daily tracker | Calories, 4 macros, fibre, sodium, sugar, cost |
| 8 | Meal swaps | Four reasons: similar / more protein / fewer calories / what I have |
| 12 | Weight tracker | Start, now, goal, change, 30-point trend |
| 13 | Grocery list | Aggregated from a plan, scaled by household, grouped by aisle |
| 16 | Dietary modes | Veg, vegan, Jain, egg, non-veg — applied everywhere |
| 18 | Meal calendar | 7 day tabs, add/remove/swap, copy day to day |
| 19 | Repeat | Repeat yesterday, fill from plan, log a planned day, copy days |
| 21 | Water tracker | +250 / +500 / +1L / custom, undo, weekly average |
| 22 | Gamification | 8 badges, streak counter, all derived from real data |
| 24 | Portion scaling | Any unit, quarter-serving precision, live macro preview |
| — | Smart search | "high protein dinner under 400 calories ₹50" parses to filters |
| — | Dashboard | Redesigned around Today / Meals / Water / Quick actions |
| — | Accessibility | Semantic nav, `aria-current`, `aria-pressed`, focus rings, Escape closes sheets, reduced-motion respected |
| — | States | Loading, error with retry, and empty states on every async view |

**Planner quality:** in testing against a 140-food pool it lands within 1% of the
calorie target and about 80% of the protein target. Protein improves with the
full 326-food pool because there are more dense options to draw on.

---

## 7. Not built yet, and why

**P1 — needs a recipe dataset, no external service**

Features 4 (What Can I Eat), 6 (Air Fryer Mode), 14 (Budget Planner),
15 (Hostel Mode), 17 (Recipe metadata), 20 (Intermittent Fasting), 25 (Leftover
Mode) all depend on a `recipes` + `recipe_ingredients` dataset with structured
ingredients, cooking method, appliance, time, difficulty and cost. The food
table has nutrition but no ingredient lists, so "cook with what I have" has
nothing to match against. That dataset is the next build — roughly 150–200
recipes to be genuinely useful.

**P2 — needs credentials or significant scope**

| Feature | Blocker |
|---|---|
| 9 — "I ate 2 samosas and chai" | `ANTHROPIC_API_KEY`. Endpoint is written |
| 10 — Photo → nutrition | Same key, vision request. UI must let users correct every guess before it's logged |
| 23 — Family mode | Tables exist (`households`, `household_members`); UI and per-person serving logic remain |
| AI assistant | `ANTHROPIC_API_KEY`. `netlify/functions/assistant.js` is complete and only sends goal, targets, pantry and preferences — never email or user id |
| Admin panel | RLS policy exists. UI remains |

I did not stub these in the interface. A button that opens a sheet saying
"coming soon" is the fake functionality you asked me to avoid.

---

## 8. Testing checklist

```bash
npm install jsdom
node scripts/smoke.mjs      # 51 assertions, all green
```

Covers: shell and navigation, all five routes, thali ring, meal blocks, water
logging, day tabs, lock/regenerate controls, pantry, charts, badges, weight
trend, profile binding, food browser, food picker, portion sheet with multiple
units, and a write assertion on logging. Then the engine directly: calorie floor,
four-meal generation, target accuracy, determinism, locked-meal preservation,
swap correctness in both directions, grocery aggregation, smart-search parsing,
and dietary exclusions.

**Manual passes worth doing against the real database:**

- Sign up → onboarding → targets appear on Home
- Generate a week → lock lunch → regenerate → lunch unchanged
- Swap a meal for "more protein" → protein genuinely rises
- Plan → Make grocery list → appears in Kitchen → tick items
- Add pantry item → swap for "what I have in" → only pantry foods offered
- Log water → refresh → total persists
- Log weight twice on different dates → trend renders
- Sign in as a second user → confirm you see none of the first user's data

---

## 9. Netlify deployment

```bash
npx netlify-cli deploy --prod --dir .
```

Or drag the folder into the Netlify dashboard. `netlify.toml` handles the rest:
no build command, SPA redirect, functions directory, security headers.

Set **Authentication → URL Configuration → Site URL** in Supabase to
`https://fitmealindia.netlify.app` so confirmation emails link correctly.

Local development needs a real origin — Supabase auth won't work from `file://`:

```bash
python3 -m http.server 8080
```

---

## 10. Known issues

1. **`03_schema_v2.sql` must run before the new pages work.** Until then Kitchen
   and Track show an error card naming the missing table. That's deliberate — a
   clear error beats a blank screen.
2. **Diet tags are derived, not curated.** The Jain and vegan rules are keyword
   matches on food names. They will be wrong at the edges. Treat them as a first
   pass and correct specific rows by hand.
3. **Costs are crude.** Per-category baselines with a multiplier for non-veg.
   Good enough to compare meals, not to budget precisely.
4. **The planner can repeat foods across days.** It doesn't yet track variety
   over a week.
5. **Protein targets are harder to hit on vegan settings** — the pool loses
   paneer, curd and milk. The generator does its best within the pool.
6. **No offline support.** Losing connection mid-session shows errors.

---

## 11. Recommended next steps

1. **Build the recipe dataset.** It unblocks seven P1 features at once. Same
   pattern as the food data: Python tuples in `scripts/`, a generator that emits
   SQL.
2. **Add `ANTHROPIC_API_KEY`** to turn on the assistant and photo logging. The
   server side is already written.
3. **Variety scoring in the planner** — penalise a food that appeared in the
   last two days.
4. **PWA manifest and service worker**, the same route as GullyScore, so this
   installs on a phone.
5. **Weekly review** — one screen on Sunday: what went well, what slipped.
6. **Admin UI** for correcting nutrition values, since users will find errors.

---

## A note on the numbers

Nutrition values come from IFCT 2017, NIN Hyderabad tables and standard recipe
analyses. They describe a typical preparation, not yours — a tablespoon of extra
oil is about 120 kcal, and "one katori" is not a standardised unit. Costs vary by
city and store. Everything here is an estimate to steer by, not a measurement,
and the interface says so.

FitMeal India gives nutrition information, not medical advice. It does not
diagnose, cannot promise results, and will not set a calorie target below 1,500
for men or 1,200 for women. Users with a health condition, who are pregnant, or
who are planning a significant change to how they eat should work with a doctor
or a registered dietitian.
