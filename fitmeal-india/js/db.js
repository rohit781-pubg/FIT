/* FitMeal India — data layer
   Every Supabase call lives here. Small TTL cache so navigation doesn't
   refetch the same rows on every render. */

import { sb, S, todayISO, shiftDate } from "./core.js";

const cache = new Map();
const TTL = 45_000;

function key(...a){ return a.join("|"); }
async function cached(k, fn, ttl=TTL){
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await fn();
  cache.set(k, { v, at: Date.now() });
  return v;
}
export function bust(prefix){
  for (const k of [...cache.keys()]) if (!prefix || k.startsWith(prefix)) cache.delete(k);
}

function ok({ data, error }){ if (error) throw error; return data; }
const uid = () => S.user.id;

export const db = {
  /* ---------------- profile ---------------- */
  async profile(){
    return ok(await sb.from("profiles").select("*").eq("id", uid()).maybeSingle());
  },
  async saveProfile(patch){
    bust("profile");
    return ok(await sb.from("profiles")
      .upsert({ id: uid(), ...patch, updated_at: new Date().toISOString() })
      .select().single());
  },

  /* ---------------- foods ---------------- */
  async searchFoods({ q="", cat="all", veg="all", dietTag=null, tags=[], limit=80 } = {}){
    return cached(key("foods", q, cat, veg, dietTag, tags.join(","), limit), async () => {
      let sel = sb.from("foods").select("*");
      const safe = q.replace(/[,()%*\\"']/g, " ").trim().slice(0, 60);
      if (safe) sel = sel.or(`name.ilike.%${safe}%,name_local.ilike.%${safe}%`);
      if (cat && cat !== "all") sel = sel.eq("category", cat);
      if (veg === "veg")    sel = sel.eq("is_veg", true);
      if (veg === "nonveg") sel = sel.eq("is_veg", false);
      if (dietTag)          sel = sel.contains("diet_tags", [dietTag]);
      if (tags.length)      sel = sel.contains("diet_tags", tags);
      return ok(await sel.order("name").limit(limit)) || [];
    });
  },
  async foodUnits(food_id){
    return cached(key("units", food_id), async () =>
      ok(await sb.from("food_units").select("*").eq("food_id", food_id)
        .order("sort_order").order("grams")) || []);
  },
  async createFood(row){
    bust("foods");
    return ok(await sb.from("foods").insert({ ...row, created_by: uid(), verified:false })
      .select().single());
  },

  /* ---------------- food log ---------------- */
  async log(date){
    return cached(key("log", date), async () =>
      ok(await sb.from("log_entries")
        .select("id, meal, qty_g, log_date, food:foods(*)")
        .eq("user_id", uid()).eq("log_date", date).order("created_at")) || [], 8000);
  },
  async addLog(food_id, meal, qty_g, log_date){
    bust("log"); bust("summary"); bust("range");
    return ok(await sb.from("log_entries")
      .insert({ user_id: uid(), food_id, meal, qty_g, log_date }).select().single());
  },
  async addLogMany(rows){
    bust("log"); bust("summary"); bust("range");
    return ok(await sb.from("log_entries")
      .insert(rows.map(r => ({ user_id: uid(), ...r }))).select());
  },
  async updateLog(id, patch){
    bust("log"); bust("summary"); bust("range");
    return ok(await sb.from("log_entries").update(patch).eq("id", id).select().single());
  },
  async delLog(id){
    bust("log"); bust("summary"); bust("range");
    return ok(await sb.from("log_entries").delete().eq("id", id));
  },
  async daySummary(date){
    return cached(key("summary", date), async () => {
      const rows = ok(await sb.rpc("day_summary", { d: date }));
      return rows?.[0] || null;
    }, 8000);
  },
  async streak(){
    return cached("streak", async () => ok(await sb.rpc("current_streak")) ?? 0, 60_000);
  },

  /* Range of daily totals for the progress charts */
  async range(days){
    const from = shiftDate(todayISO(), -(days-1));
    return cached(key("range", days), async () => {
      const [logs, water, weights] = await Promise.all([
        sb.from("log_entries").select("log_date, qty_g, food:foods(kcal,protein_g,carb_g,fat_g,fiber_g)")
          .eq("user_id", uid()).gte("log_date", from),
        sb.from("water_logs").select("log_date, ml").eq("user_id", uid()).gte("log_date", from),
        sb.from("weight_logs").select("log_date, weight_kg").eq("user_id", uid())
          .gte("log_date", from).order("log_date"),
      ]);
      if (logs.error) throw logs.error;
      const byDay = {};
      for (let i = days-1; i >= 0; i--)
        byDay[shiftDate(todayISO(), -i)] = { kcal:0, protein:0, carb:0, fat:0, fiber:0, water:0, weight:null, items:0 };
      for (const r of logs.data || []){
        const d = byDay[r.log_date]; if (!d || !r.food) continue;
        const f = r.qty_g/100;
        d.kcal += r.food.kcal*f; d.protein += r.food.protein_g*f;
        d.carb += r.food.carb_g*f; d.fat += r.food.fat_g*f; d.fiber += r.food.fiber_g*f;
        d.items++;
      }
      for (const r of water.data || []) if (byDay[r.log_date]) byDay[r.log_date].water += r.ml;
      for (const r of weights.data || []) if (byDay[r.log_date]) byDay[r.log_date].weight = +r.weight_kg;
      return byDay;
    }, 20_000);
  },

  /* ---------------- water ---------------- */
  async addWater(ml, log_date){
    bust("summary"); bust("range"); bust("water");
    return ok(await sb.from("water_logs").insert({ user_id: uid(), ml, log_date }).select().single());
  },
  async waterToday(date){
    return cached(key("water", date), async () =>
      ok(await sb.from("water_logs").select("*").eq("user_id", uid())
        .eq("log_date", date).order("created_at", { ascending:false })) || [], 8000);
  },
  async delWater(id){
    bust("summary"); bust("range"); bust("water");
    return ok(await sb.from("water_logs").delete().eq("id", id));
  },

  /* ---------------- weight ---------------- */
  async addWeight(weight_kg, log_date, note){
    bust("range"); bust("weights"); bust("summary");
    return ok(await sb.from("weight_logs")
      .upsert({ user_id: uid(), log_date, weight_kg, note }).select().single());
  },
  async weights(limit=180){
    return cached("weights", async () =>
      ok(await sb.from("weight_logs").select("*").eq("user_id", uid())
        .order("log_date", { ascending:false }).limit(limit)) || [], 30_000);
  },
  async delWeight(log_date){
    bust("range"); bust("weights");
    return ok(await sb.from("weight_logs").delete()
      .eq("user_id", uid()).eq("log_date", log_date));
  },

  /* ---------------- plans ---------------- */
  async plans(){
    return cached("plans", async () =>
      ok(await sb.from("plans").select("*").eq("user_id", uid())
        .order("created_at", { ascending:false })) || [], 30_000);
  },
  async createPlan(name, makeActive=false){
    bust("plans");
    if (makeActive) await sb.from("plans").update({ is_active:false }).eq("user_id", uid());
    return ok(await sb.from("plans")
      .insert({ user_id: uid(), name, is_active: makeActive }).select().single());
  },
  async activatePlan(id){
    bust("plans");
    await sb.from("plans").update({ is_active:false }).eq("user_id", uid());
    return ok(await sb.from("plans").update({ is_active:true }).eq("id", id).select().single());
  },
  async delPlan(id){ bust("plans"); bust("planItems"); return ok(await sb.from("plans").delete().eq("id", id)); },
  async planItems(plan_id){
    return cached(key("planItems", plan_id), async () =>
      ok(await sb.from("plan_items")
        .select("id, day_of_week, meal, qty_g, sort_order, is_locked, food:foods(*)")
        .eq("plan_id", plan_id).order("day_of_week").order("sort_order")) || [], 8000);
  },
  async addPlanItems(rows){
    bust("planItems");
    return ok(await sb.from("plan_items").insert(rows).select());
  },
  async updatePlanItem(id, patch){
    bust("planItems");
    return ok(await sb.from("plan_items").update(patch).eq("id", id).select().single());
  },
  async delPlanItem(id){ bust("planItems"); return ok(await sb.from("plan_items").delete().eq("id", id)); },
  async clearPlanDay(plan_id, day_of_week, keepLocked=true){
    bust("planItems");
    let q = sb.from("plan_items").delete().eq("plan_id", plan_id).eq("day_of_week", day_of_week);
    if (keepLocked) q = q.eq("is_locked", false);
    return ok(await q);
  },

  /* ---------------- pantry ---------------- */
  async pantry(){
    return cached("pantry", async () =>
      ok(await sb.from("pantry_items").select("*").eq("user_id", uid())
        .order("category").order("name")) || [], 20_000);
  },
  async addPantry(row){
    bust("pantry");
    return ok(await sb.from("pantry_items").insert({ user_id: uid(), ...row }).select().single());
  },
  async updatePantry(id, patch){
    bust("pantry");
    return ok(await sb.from("pantry_items")
      .update({ ...patch, updated_at:new Date().toISOString() }).eq("id", id).select().single());
  },
  async delPantry(id){ bust("pantry"); return ok(await sb.from("pantry_items").delete().eq("id", id)); },

  /* ---------------- grocery ---------------- */
  async groceryLists(){
    return cached("glists", async () =>
      ok(await sb.from("grocery_lists").select("*").eq("user_id", uid())
        .order("created_at", { ascending:false })) || [], 20_000);
  },
  async createGroceryList(name, plan_id=null){
    bust("glists");
    return ok(await sb.from("grocery_lists")
      .insert({ user_id: uid(), name, plan_id }).select().single());
  },
  async delGroceryList(id){ bust("glists"); bust("gitems"); return ok(await sb.from("grocery_lists").delete().eq("id", id)); },
  async groceryItems(list_id){
    return cached(key("gitems", list_id), async () =>
      ok(await sb.from("grocery_items").select("*").eq("list_id", list_id)
        .order("category").order("sort_order")) || [], 8000);
  },
  async addGroceryItems(rows){ bust("gitems"); return ok(await sb.from("grocery_items").insert(rows).select()); },
  async updateGroceryItem(id, patch){
    bust("gitems");
    return ok(await sb.from("grocery_items").update(patch).eq("id", id).select().single());
  },
  async delGroceryItem(id){ bust("gitems"); return ok(await sb.from("grocery_items").delete().eq("id", id)); },

  /* ---------------- achievements ---------------- */
  async achievements(){
    return cached("achv", async () =>
      ok(await sb.from("achievements").select("*").eq("user_id", uid())) || [], 60_000);
  },
  async earn(code){
    bust("achv");
    const { error } = await sb.from("achievements")
      .upsert({ user_id: uid(), code }, { onConflict:"user_id,code", ignoreDuplicates:true });
    if (error && error.code !== "23505") throw error;
  },
};
