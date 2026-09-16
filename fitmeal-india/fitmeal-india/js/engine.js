/* FitMeal India — engine
   Deterministic meal planning, swaps, grocery aggregation and badges.

   Why not an LLM here: hitting a calorie and protein target from a known
   food table is a constraint problem, not a language problem. Solving it
   in code is instant, free, reproducible, and cannot invent a food that
   isn't in the database. */

import { MEALS, scale, EMPTY, n0, n1, clamp, dietTagFor } from "./core.js";
import { db } from "./db.js";

/* ---- seeded RNG so "regenerate" gives something new but a given
        seed always reproduces the same plan ---- */
export function rng(seed){
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

/* Which categories can fill each slot of each meal */
export const TEMPLATES = {
  breakfast: [
    { role:"base",    cats:["breakfast","bread"],            weight:1 },
    { role:"protein", cats:["dairy","protein","dal","nuts"], weight:1 },
    { role:"side",    cats:["fruit","beverage"],             weight:0.6 },
  ],
  lunch: [
    { role:"base",    cats:["bread","rice"],       weight:1 },
    { role:"protein", cats:["dal","curry"],        weight:1 },
    { role:"veg",     cats:["sabzi","vegetable"],  weight:0.8 },
    { role:"side",    cats:["dairy","condiment"],  weight:0.5 },
  ],
  snack: [
    { role:"base",    cats:["snack","fruit","nuts","dairy"], weight:1 },
    { role:"side",    cats:["beverage"],                     weight:0.5 },
  ],
  dinner: [
    { role:"base",    cats:["bread","rice"],       weight:1 },
    { role:"protein", cats:["curry","dal"],        weight:1 },
    { role:"veg",     cats:["sabzi","vegetable"],  weight:0.8 },
  ],
};

/* Fetch the candidate pool once, filtered to the user's diet. */
export async function candidatePool(profile){
  const tag = dietTagFor(profile?.diet_type || "veg");
  const foods = await db.searchFoods({ dietTag: tag, limit: 400 });
  return foods.filter(f => !isExcluded(f, profile));
}

export function isExcluded(food, profile){
  const bad = [...(profile?.allergies||[]), ...(profile?.dislikes||[])]
    .map(s => String(s).trim().toLowerCase()).filter(Boolean);
  if (!bad.length) return false;
  const hay = `${food.name} ${food.name_local||""} ${food.category}`.toLowerCase();
  return bad.some(b => hay.includes(b));
}

/* ------------------------------------------------------------------
   Generate one meal.
   Returns [{ food, qty_g }] scaled to hit kcal and protein budgets.
   ------------------------------------------------------------------ */
export function generateMeal({ mealId, pool, kcalBudget, proteinBudget, seed, prefer = [], maxCost = null }){
  const r = rng(seed);
  const slots = TEMPLATES[mealId] || TEMPLATES.snack;
  const preferIds = new Set(prefer.map(f => f.id));
  const chosen = [];

  for (const slot of slots){
    let pool2 = pool.filter(f => slot.cats.includes(f.category) && !chosen.some(c => c.food.id === f.id));
    if (!pool2.length) continue;

    // Prefer pantry items when the caller asked for it
    const inPantry = pool2.filter(f => preferIds.has(f.id));
    if (inPantry.length && r() < 0.75) pool2 = inPantry;

    // The protein slot skews toward genuinely protein-dense options
    if (slot.role === "protein"){
      const dense = pool2.filter(f => f.protein_g >= 6);
      if (dense.length >= 3) pool2 = dense;
    }
    // Skip the optional side about a third of the time so plans vary
    if (slot.weight <= 0.6 && r() < 0.35) continue;

    const food = pick(pool2, r);
    if (food) chosen.push({ food, qty_g: food.serving_g, role: slot.role, weight: slot.weight });
  }
  if (!chosen.length) return [];

  // 1. Push protein up if we're short, by growing the protein slot
  const proteinOf = rows => rows.reduce((s,x) => s + scale(x.food, x.qty_g).protein, 0);
  const kcalOf    = rows => rows.reduce((s,x) => s + scale(x.food, x.qty_g).kcal, 0);
  const pSlot = chosen.find(c => c.role === "protein");
  if (pSlot && proteinBudget){
    let guard = 0;
    while (proteinOf(chosen) < proteinBudget * 0.92 && guard++ < 12){
      const next = pSlot.qty_g * 1.15;
      if (next > pSlot.food.serving_g * 2.5) break;
      pSlot.qty_g = next;
    }
  }
  // 2. Scale everything to land on the calorie budget
  const cur = kcalOf(chosen);
  if (cur > 0 && kcalBudget){
    const f = clamp(kcalBudget / cur, 0.5, 2.4);
    for (const c of chosen) c.qty_g *= f;
  }
  // 3. Respect a cost ceiling by trimming the most expensive item
  if (maxCost){
    let guard = 0;
    while (costOf(chosen) > maxCost && guard++ < 10){
      const worst = [...chosen].sort((a,b) => scale(b.food,b.qty_g).cost - scale(a.food,a.qty_g).cost)[0];
      if (!worst || worst.qty_g <= worst.food.serving_g * 0.45) break;
      worst.qty_g *= 0.82;
    }
  }
  // 4. Round to something a person can actually measure
  for (const c of chosen){
    const perServing = c.food.serving_g;
    const servings = c.qty_g / perServing;
    const rounded = Math.max(Math.round(servings * 4) / 4, 0.25);   // quarter servings
    c.qty_g = n1(rounded * perServing);
  }
  return chosen.map(({ food, qty_g }) => ({ food, qty_g }));
}

export function costOf(rows){
  return rows.reduce((s,x) => s + scale(x.food, x.qty_g).cost, 0);
}
export function totalsOf(rows){
  const t = EMPTY();
  for (const x of rows){ const s = scale(x.food, x.qty_g); for (const k in t) t[k] += s[k]; }
  return t;
}

/* ------------------------------------------------------------------
   Generate a whole day. Locked meals are passed through untouched and
   their calories are deducted from the budget.
   ------------------------------------------------------------------ */
export function generateDay({ pool, target, seed, locked = {}, prefer = [], dailyBudget = null }){
  const out = {};
  let kcalLeft = target?.kcal || 2000;
  let proteinLeft = target?.protein || 60;
  let shareLeft = 0;

  for (const m of MEALS){
    if (locked[m.id]?.length){
      out[m.id] = locked[m.id];
      const t = totalsOf(locked[m.id]);
      kcalLeft -= t.kcal; proteinLeft -= t.protein;
    } else shareLeft += m.share;
  }
  kcalLeft = Math.max(kcalLeft, 300);
  proteinLeft = Math.max(proteinLeft, 10);

  let i = 0;
  for (const m of MEALS){
    if (out[m.id]) continue;
    const w = shareLeft > 0 ? m.share / shareLeft : 0.25;
    out[m.id] = generateMeal({
      mealId: m.id, pool, seed: seed + (i++ * 7919),
      kcalBudget: kcalLeft * w,
      proteinBudget: proteinLeft * w,
      prefer,
      maxCost: dailyBudget ? dailyBudget * w : null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------
   Swaps — find nutritionally comparable alternatives.
   reason: 'similar' | 'protein' | 'calories' | 'ingredients'
   ------------------------------------------------------------------ */
export function findSwaps(food, qty_g, pool, reason = "similar", pantryIds = new Set()){
  const cur = scale(food, qty_g);
  const sameish = pool.filter(f => f.id !== food.id);

  const scored = sameish.map(f => {
    // Portion this candidate to the same calories, then compare
    const grams = cur.kcal > 0 ? (cur.kcal / (f.kcal || 1)) * 100 : f.serving_g;
    const servings = clamp(grams / f.serving_g, 0.25, 3);
    const g = n1(Math.round(servings * 4) / 4 * f.serving_g);
    const s = scale(f, g);
    const sameCat = f.category === food.category ? 0 : 0.35;

    let score;
    if (reason === "protein"){
      if (s.protein <= cur.protein * 1.15) return null;
      score = -(s.protein - cur.protein) / 10 + Math.abs(s.kcal - cur.kcal)/cur.kcal + sameCat;
    } else if (reason === "calories"){
      if (s.kcal >= cur.kcal * 0.9) return null;
      score = (s.kcal / (cur.kcal||1)) - (s.protein / (cur.protein||1)) * 0.4 + sameCat;
    } else if (reason === "ingredients"){
      if (!pantryIds.has(f.id)) return null;
      score = Math.abs(s.kcal - cur.kcal)/(cur.kcal||1) + sameCat;
    } else {
      score = Math.abs(s.kcal - cur.kcal)/(cur.kcal||1)
            + Math.abs(s.protein - cur.protein)/Math.max(cur.protein,5) * 0.8
            + sameCat;
    }
    return { food:f, qty_g:g, totals:s, score };
  }).filter(Boolean);

  return scored.sort((a,b) => a.score - b.score).slice(0, 6);
}

/* ------------------------------------------------------------------
   Grocery list from plan items
   ------------------------------------------------------------------ */
const AISLE = {
  vegetable:"Vegetables", sabzi:"Vegetables", fruit:"Fruits",
  dal:"Grains & pulses", rice:"Grains & pulses", pantry:"Grains & pulses", bread:"Grains & pulses",
  dairy:"Dairy", protein:"Protein", curry:"Protein", nuts:"Nuts & seeds",
  fat:"Oils & fats", condiment:"Spices & condiments",
  snack:"Other", street:"Other", sweet:"Other", beverage:"Beverages", breakfast:"Other",
};

export function buildGroceryList(items, { people = 1 } = {}){
  const byFood = new Map();
  for (const it of items){
    if (!it.food) continue;
    const k = it.food.id;
    const prev = byFood.get(k) || { food: it.food, grams: 0 };
    prev.grams += Number(it.qty_g) * people;
    byFood.set(k, prev);
  }
  return [...byFood.values()].map(({ food, grams }) => {
    const g = Math.ceil(grams / 25) * 25;             // round up to a buyable amount
    const useKg = g >= 1000;
    return {
      name: food.name,
      qty: useKg ? n1(g/1000) : g,
      unit: useKg ? "kg" : "g",
      category: AISLE[food.category] || "Other",
      est_cost: n0(scale(food, g).cost),
    };
  }).sort((a,b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------
   Badges — all derived from data the user already generated
   ------------------------------------------------------------------ */
export const BADGES = [
  { code:"first_log",   emoji:"🍽️", name:"Healthy Starter", hint:"Log your first meal" },
  { code:"streak_7",    emoji:"🔥", name:"7-Day Consistency", hint:"Log food 7 days running" },
  { code:"streak_14",   emoji:"⚡", name:"14-Day Consistency", hint:"Log food 14 days running" },
  { code:"streak_30",   emoji:"🏆", name:"30-Day Consistency", hint:"Log food 30 days running" },
  { code:"protein_pro", emoji:"💪", name:"Protein Pro", hint:"Hit your protein target 5 days in a week" },
  { code:"meal_planner",emoji:"📅", name:"Meal Planner", hint:"Build a full week of meals" },
  { code:"hydration",   emoji:"💧", name:"Hydration Habit", hint:"Hit your water target 3 days running" },
  { code:"kitchen",     emoji:"🧺", name:"Stocked Kitchen", hint:"Add 10 items to your kitchen" },
];

export function evaluateBadges({ streak, range, target, planItemCount, pantryCount }){
  const earned = [];
  const days = Object.values(range || {});
  if (days.some(d => d.items > 0)) earned.push("first_log");
  if (streak >= 7)  earned.push("streak_7");
  if (streak >= 14) earned.push("streak_14");
  if (streak >= 30) earned.push("streak_30");
  if (target?.protein){
    const last7 = days.slice(-7);
    if (last7.filter(d => d.protein >= target.protein * 0.9).length >= 5) earned.push("protein_pro");
  }
  if (planItemCount >= 12) earned.push("meal_planner");
  const wTarget = 2000;
  const tail = days.slice(-3);
  if (tail.length === 3 && tail.every(d => d.water >= wTarget)) earned.push("hydration");
  if (pantryCount >= 10) earned.push("kitchen");
  return earned;
}

/* ------------------------------------------------------------------
   Smart search — turn plain language into filters.
   Handles the patterns people actually type; anything it can't parse
   falls through to a normal name search.
   ------------------------------------------------------------------ */
export function parseQuery(text){
  const q = String(text || "").toLowerCase();
  const f = { text:"", maxKcal:null, minProtein:null, maxCost:null, tags:[], cat:"all", veg:"all" };
  let rest = q;

  const take = (re, fn) => { const m = rest.match(re); if (m){ fn(m); rest = rest.replace(m[0], " "); } };

  take(/under\s*(\d{2,4})\s*(?:kcal|calorie|cal)/, m => f.maxKcal = +m[1]);
  take(/(?:below|less than|<)\s*(\d{2,4})\s*(?:kcal|calorie|cal)/, m => f.maxKcal = +m[1]);
  take(/(\d{1,3})\s*g?\s*(?:\+|plus|or more)?\s*protein/, m => f.minProtein = +m[1]);
  take(/(?:high|more)\s*protein/, () => f.tags.push("high_protein"));
  take(/(?:low|fewer)\s*cal(?:orie)?s?/, () => f.tags.push("low_calorie"));
  take(/high\s*fib(?:re|er)/, () => f.tags.push("high_fibre"));
  take(/gluten[\s-]?free/, () => f.tags.push("__no_gluten"));
  take(/(?:lactose|dairy)[\s-]?free/, () => f.tags.push("__no_dairy"));
  take(/(?:under|below|<)\s*(?:₹|rs\.?|inr)\s*(\d{2,4})/, m => f.maxCost = +m[1]);
  take(/(?:₹|rs\.?|inr)\s*(\d{2,4})/, m => f.maxCost = +m[1]);
  take(/\bvegan\b/, () => f.tags.push("vegan"));
  take(/\bjain\b/, () => f.tags.push("jain"));
  take(/\bveg(?:etarian)?\b/, () => f.veg = "veg");
  take(/\bnon[\s-]?veg\b/, () => f.veg = "nonveg");

  for (const c of ["breakfast","lunch","dinner","snack","sweet","dal","rice","bread","curry","sabzi","fruit","beverage","nuts","dairy"]){
    if (new RegExp(`\\b${c}s?\\b`).test(rest)){
      f.cat = c === "lunch" || c === "dinner" ? "all" : c;
      rest = rest.replace(new RegExp(`\\b${c}s?\\b`), " ");
      break;
    }
  }
  f.text = rest.replace(/\b(with|for|a|an|the|me|i|want|need|show|find|something|meal|food|min(?:ute)?s?|\d+)\b/g," ")
               .replace(/\s+/g," ").trim();
  return f;
}

export function applyQuery(foods, f){
  return foods.filter(x => {
    const per = scale(x, x.serving_g);
    if (f.maxKcal    && per.kcal    > f.maxKcal) return false;
    if (f.minProtein && per.protein < f.minProtein) return false;
    if (f.maxCost    && per.cost    > f.maxCost) return false;
    const tags = x.diet_tags || [];
    for (const t of f.tags){
      if (t === "__no_gluten"){ if (tags.includes("contains_gluten")) return false; continue; }
      if (t === "__no_dairy"){  if (tags.includes("contains_dairy"))  return false; continue; }
      if (!tags.includes(t)) return false;
    }
    return true;
  });
}
