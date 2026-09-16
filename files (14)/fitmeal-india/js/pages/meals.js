/* FitMeal India — Meals
   Weekly plan: generate, lock, swap, repeat, copy, and turn into groceries. */

import { $, $$, el, esc, n0, n1, S, I, MEALS, DAYS, DAYS_LONG, scale, sumRows, todayISO,
         computeTargets, thaliRing, macroBars, toast, loadingBlock, errorBlock, sheet,
         estimateTag, fmtQty, prettyDate } from "../core.js";
import { db } from "../db.js";
import { openFoodPicker, openPortion, foodRow } from "../pickers.js";
import { candidatePool, generateDay, generateMeal, findSwaps, buildGroceryList, totalsOf } from "../engine.js";
import { go } from "../app.js";

let pool = null;   // candidate foods for this profile, fetched once per session

export async function renderMeals(mount){
  mount.replaceChildren(loadingBlock("Loading your plan"));
  let plans, items = [];
  try {
    plans = await db.plans();
    if (!S.plan || !plans.find(p => p.id === S.plan.id))
      S.plan = plans.find(p => p.is_active) || plans[0] || null;
    if (S.plan) items = await db.planItems(S.plan.id);
  } catch(e){ return mount.replaceChildren(errorBlock(e, () => renderMeals(mount))); }

  const target = computeTargets(S.profile);

  if (!plans.length){
    const v = el(`<div>
      <div class="page-h"><div><h1>Meal plan</h1>
        <p class="sub">A reusable week you can generate, tweak and reuse.</p></div></div>
      <div class="card"><div class="empty">
        <b>No plan yet</b>
        Build a week once. FitMeal fills it to your calorie and protein targets using
        food that matches how you eat, and you can swap anything you don't fancy.
        <div class="mt row wrap" style="justify-content:center">
          <button class="btn" id="gen">Generate my week</button>
          <button class="btn ghost" id="blank">Start empty</button>
        </div></div></div></div>`);
    $("#gen", v).onclick   = () => createAndGenerate(mount, true);
    $("#blank", v).onclick = () => createAndGenerate(mount, false);
    return mount.replaceChildren(v);
  }

  const dayItems = items.filter(i => i.day_of_week === S.planDay);
  const dt = sumRows(dayItems);
  const cost = dt.cost;

  const page = el(`<div>
    <div class="page-h">
      <div>
        <h1>${esc(S.plan.name)}</h1>
        <p class="sub">${items.length} items across the week${cost ? ` · about ₹${n0(cost)} for ${DAYS[S.planDay]}` : ""}</p>
      </div>
      <div class="row wrap">
        ${plans.length > 1 ? `<select id="psel" style="width:auto">${plans.map(p =>
          `<option value="${p.id}" ${p.id===S.plan.id?"selected":""}>${esc(p.name)}</option>`).join("")}</select>` : ""}
        <button class="btn ghost sm" id="newplan">New plan</button>
        <button class="btn sm" id="genday">${I.spark} Generate ${DAYS[S.planDay]}</button>
      </div>
    </div>

    <div class="daytabs">${DAYS.map((d,i) => {
      const c = items.filter(x => x.day_of_week === i);
      return `<button class="daytab" data-d="${i}" aria-pressed="${i===S.planDay}">${d}
        <b class="num">${c.length ? n0(sumRows(c).kcal)+" kcal" : "empty"}</b></button>`;
    }).join("")}</div>

    <div class="card"><div class="thali">${thaliRing(dt, target)}${macroBars(dt, target)}</div></div>

    <div id="pm" class="mt"></div>

    <div class="card">
      <h2 class="mb">Week tools</h2>
      <div class="chipwrap">
        <button class="chip" id="genweek">${I.spark} Generate whole week</button>
        <button class="chip" id="useday">Log this day</button>
        <button class="chip" id="grocery">Make grocery list</button>
        <button class="chip" id="clearday">Clear ${DAYS[S.planDay]}</button>
      </div>
      <h3 class="mt mb">Copy ${DAYS_LONG[S.planDay]} to</h3>
      <div class="chipwrap" id="copyrow"></div>
      <hr>
      <div class="row between wrap">
        <p class="note" style="flex:1;min-width:200px">Locked meals survive regeneration.
          Tap the lock on any meal to keep it.</p>
        <button class="btn danger sm" id="delplan">Delete plan</button>
      </div>
    </div>
  </div>`);

  $$(".daytab", page).forEach(b => b.onclick = () => { S.planDay = +b.dataset.d; renderMeals(mount); });
  const sel = $("#psel", page);
  if (sel) sel.onchange = async () => {
    S.plan = plans.find(p => p.id === sel.value);
    await db.activatePlan(S.plan.id).catch(()=>{});
    renderMeals(mount);
  };
  $("#newplan", page).onclick  = () => createAndGenerate(mount, true);
  $("#genday",  page).onclick  = () => regenerateDay(mount, S.plan, S.planDay, items, target);
  $("#genweek", page).onclick  = () => regenerateWeek(mount, S.plan, items, target);
  $("#clearday",page).onclick  = async () => {
    if (!confirm(`Clear everything planned for ${DAYS_LONG[S.planDay]}? Locked meals stay.`)) return;
    await db.clearPlanDay(S.plan.id, S.planDay, true); toast("Cleared"); renderMeals(mount);
  };
  $("#useday",  page).onclick  = async () => {
    if (!dayItems.length) return toast("Nothing planned for this day");
    await db.addLogMany(dayItems.map(i => ({
      food_id:i.food.id, meal:i.meal, qty_g:i.qty_g, log_date:S.date })));
    toast(`Logged ${dayItems.length} items to ${prettyDate(S.date).toLowerCase()}`);
    go("home");
  };
  $("#grocery", page).onclick  = () => makeGroceryList(S.plan, items);
  $("#delplan", page).onclick  = async () => {
    if (!confirm(`Delete "${S.plan.name}"? Your food log is not affected.`)) return;
    await db.delPlan(S.plan.id); S.plan = null; toast("Plan deleted"); renderMeals(mount);
  };

  const copy = $("#copyrow", page);
  DAYS.forEach((d,i) => {
    if (i === S.planDay) return;
    const b = el(`<button class="chip">${d}</button>`);
    b.onclick = async () => {
      if (!dayItems.length) return toast("Nothing to copy");
      await db.addPlanItems(dayItems.map(it => ({
        plan_id:S.plan.id, food_id:it.food.id, day_of_week:i, meal:it.meal, qty_g:it.qty_g })));
      toast(`Copied to ${DAYS_LONG[i]}`); renderMeals(mount);
    };
    copy.appendChild(b);
  });

  /* meal blocks */
  const pm = $("#pm", page);
  for (const m of MEALS){
    const rows = dayItems.filter(r => r.meal === m.id);
    const mt = sumRows(rows);
    const locked = rows.length > 0 && rows.every(r => r.is_locked);
    const block = el(`<section class="meal">
      <div class="meal-h">
        <h2>${m.label}</h2>
        ${locked ? `<span class="pill locked">${I.lock} Locked</span>` : ""}
        <span class="meal-kcal num">${n0(mt.kcal)} kcal · ${n0(mt.protein)}g P</span>
        <button class="x" data-lock title="${locked?"Unlock":"Lock"} this meal">${I.lock}</button>
        <button class="x" data-regen title="Regenerate this meal">${I.spark}</button>
      </div>
      <div class="items"></div>
      <div class="add-line"><button>${I.plus} Add food</button></div>
    </section>`);
    const host = $(".items", block);

    if (!rows.length) host.appendChild(el(`<div class="item">
      <span class="item-meta" style="margin:0">Nothing planned.</span></div>`));

    for (const r of rows){
      const s = scale(r.food, r.qty_g);
      const row = el(`<div class="item">
        <span class="${r.food.is_veg?"veg-dot":"nonveg-dot"}"></span>
        <div class="item-main">
          <div class="item-name">${esc(r.food.name)}</div>
          <div class="item-meta num">${esc(fmtQty(r.qty_g, r.food))} · ${n0(s.protein)}g P · ₹${n0(s.cost)}</div>
        </div>
        <span class="item-kcal num">${n0(s.kcal)}</span>
        <button class="x" data-swap aria-label="Swap ${esc(r.food.name)}">${I.swap}</button>
        <button class="x" data-del aria-label="Remove ${esc(r.food.name)}">${I.x}</button>
      </div>`);
      $("[data-del]", row).onclick  = async () => { await db.delPlanItem(r.id); renderMeals(mount); };
      $("[data-swap]", row).onclick = () => openSwap(r, mount);
      host.appendChild(row);
    }

    $("[data-lock]", block).onclick = async () => {
      if (!rows.length) return toast("Add something to this meal first");
      await Promise.all(rows.map(r => db.updatePlanItem(r.id, { is_locked: !locked })));
      toast(locked ? "Unlocked" : "Locked — regeneration will skip it");
      renderMeals(mount);
    };
    $("[data-regen]", block).onclick = () => regenerateMeal(mount, S.plan, S.planDay, m.id, rows, target);
    $(".add-line button", block).onclick = () => openFoodPicker({
      meal: m.id,
      onPick: async (food, grams) => {
        await db.addPlanItems([{ plan_id:S.plan.id, food_id:food.id,
          day_of_week:S.planDay, meal:m.id, qty_g:grams }]);
        toast(`Added to ${DAYS[S.planDay]} ${m.label.toLowerCase()}`);
        renderMeals(mount);
      },
    });
    pm.appendChild(block);
  }

  mount.replaceChildren(page);
}

/* ---------------- generation ---------------- */
async function getPool(){
  if (!pool) pool = await candidatePool(S.profile);
  if (!pool.length) throw new Error("No foods match your dietary preference. Loosen it in Me, or run 03_schema_v2.sql so diet tags exist.");
  return pool;
}

async function createAndGenerate(mount, generate){
  const name = prompt("Name this plan", generate ? "My week" : "Blank plan");
  if (!name) return;
  try {
    S.plan = await db.createPlan(name.trim(), true);
    if (generate){
      const target = computeTargets(S.profile);
      await regenerateWeek(mount, S.plan, [], target, true);
      return;
    }
    toast("Plan created"); renderMeals(mount);
  } catch(e){ toast(e.message, "err"); }
}

async function regenerateDay(mount, plan, day, items, target, quiet){
  if (!quiet) toast("Generating…");
  try {
    const p = await getPool();
    const existing = items.filter(i => i.day_of_week === day);
    const locked = {};
    for (const m of MEALS){
      const rows = existing.filter(i => i.meal === m.id && i.is_locked);
      if (rows.length) locked[m.id] = rows.map(r => ({ food:r.food, qty_g:+r.qty_g }));
    }
    await db.clearPlanDay(plan.id, day, true);
    const dayPlan = generateDay({
      pool: p, target, seed: (Date.now() + day * 131) | 0, locked,
      dailyBudget: S.profile?.daily_budget_inr || null,
    });
    const rows = [];
    for (const m of MEALS){
      if (locked[m.id]) continue;
      (dayPlan[m.id] || []).forEach((x, i) => rows.push({
        plan_id:plan.id, food_id:x.food.id, day_of_week:day, meal:m.id,
        qty_g:x.qty_g, sort_order:i,
      }));
    }
    if (rows.length) await db.addPlanItems(rows);
    if (!quiet){ toast(`${DAYS_LONG[day]} generated`); renderMeals(mount); }
  } catch(e){ toast(e.message, "err"); }
}

async function regenerateWeek(mount, plan, items, target, fresh){
  if (!fresh && !confirm("Regenerate the whole week? Locked meals are kept.")) return;
  toast("Generating your week…");
  try {
    await getPool();
    for (let d = 0; d < 7; d++) await regenerateDay(mount, plan, d, items, target, true);
    toast("Week generated");
    renderMeals(mount);
  } catch(e){ toast(e.message, "err"); }
}

async function regenerateMeal(mount, plan, day, mealId, rows, target){
  try {
    const p = await getPool();
    if (rows.some(r => r.is_locked)) return toast("This meal is locked");
    const m = MEALS.find(x => x.id === mealId);
    const gen = generateMeal({
      mealId, pool:p, seed:(Date.now()|0),
      kcalBudget: (target?.kcal || 2000) * m.share,
      proteinBudget: (target?.protein || 60) * m.share,
      maxCost: S.profile?.daily_budget_inr ? S.profile.daily_budget_inr * m.share : null,
    });
    await Promise.all(rows.map(r => db.delPlanItem(r.id)));
    if (gen.length) await db.addPlanItems(gen.map((x,i) => ({
      plan_id:plan.id, food_id:x.food.id, day_of_week:day, meal:mealId, qty_g:x.qty_g, sort_order:i })));
    toast(`${m.label} regenerated`);
    renderMeals(mount);
  } catch(e){ toast(e.message, "err"); }
}

/* ---------------- swaps ---------------- */
async function openSwap(item, mount){
  const body = el(`<div>
    <p class="sub" style="margin:-8px 0 14px">Swapping ${esc(item.food.name)} ·
      ${n0(scale(item.food, item.qty_g).kcal)} kcal · ${n0(scale(item.food, item.qty_g).protein)}g protein</p>
    <div class="chipwrap mb">
      <button class="chip" data-r="similar"     aria-pressed="true">Something similar</button>
      <button class="chip" data-r="protein"     aria-pressed="false">More protein</button>
      <button class="chip" data-r="calories"    aria-pressed="false">Fewer calories</button>
      <button class="chip" data-r="ingredients" aria-pressed="false">What I have in</button>
    </div>
    <div id="alts"></div>
  </div>`);
  const { close } = sheet({ title:"Swap this", body });
  let reason = "similar";

  async function load(){
    $("#alts", body).replaceChildren(loadingBlock("Finding alternatives"));
    try {
      const p = await getPool();
      let pantryIds = new Set();
      if (reason === "ingredients"){
        const pantry = await db.pantry();
        pantryIds = new Set(pantry_ids(pantry));
      }
      const alts = findSwaps(item.food, item.qty_g, p, reason, pantryIds);
      if (!alts.length){
        $("#alts", body).innerHTML = `<div class="empty"><b>No good match</b>
          ${reason === "ingredients"
            ? "Nothing in your kitchen fits this slot. Add a few staples in My Kitchen."
            : "Try a different reason, or pick a replacement by hand."}</div>`;
        return;
      }
      $("#alts", body).replaceChildren(...alts.map(a => {
        const b = foodRow(a.food, async () => {
          await db.updatePlanItem(item.id, { food_id: a.food.id, qty_g: a.qty_g });
          toast(`Swapped for ${a.food.name}`);
          close(); renderMeals(mount);
        });
        b.querySelector(".fmeta").textContent =
          `${fmtQty(a.qty_g, a.food)} · ${n0(a.totals.protein)}g protein · ₹${n0(a.totals.cost)}`;
        return b;
      }));
    } catch(e){ $("#alts", body).replaceChildren(errorBlock(e, load)); }
  }
  $$("[data-r]", body).forEach(b => b.onclick = () => {
    reason = b.dataset.r;
    $$("[data-r]", body).forEach(x => x.setAttribute("aria-pressed", String(x===b)));
    load();
  });
  load();
}
function pantry_ids(rows){ return (rows||[]).map(r => r.food_id).filter(Boolean); }

/* ---------------- grocery list ---------------- */
async function makeGroceryList(plan, items){
  if (!items.length) return toast("Plan something first");
  const people = S.profile?.household_size || 1;
  const list = buildGroceryList(items, { people });
  const total = list.reduce((s,x) => s + (x.est_cost||0), 0);

  const body = el(`<div>
    <p class="sub" style="margin:-8px 0 12px">${list.length} items for ${people} ${people===1?"person":"people"},
      a week of ${esc(plan.name)}. About ₹${n0(total)} ${estimateTag}</p>
    <div style="max-height:44vh;overflow:auto" id="prev"></div>
    <button class="btn wide mt" id="save">Save as a shopping list</button>
    <p class="note mt">Prices are rough estimates and vary by city and store.</p>
  </div>`);
  const { close } = sheet({ title:"Grocery list", body });

  const groups = {};
  for (const x of list) (groups[x.category] ||= []).push(x);
  $("#prev", body).innerHTML = Object.entries(groups).map(([g, rows]) =>
    `<h3 class="mb" style="margin-top:12px">${esc(g)}</h3>` +
    rows.map(r => `<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line)">
      <span>${esc(r.name)}</span>
      <span class="num sub">${r.qty} ${r.unit} · ₹${r.est_cost}</span></div>`).join("")
  ).join("");

  $("#save", body).onclick = async () => {
    const btn = $("#save", body); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try {
      const gl = await db.createGroceryList(`${plan.name} — week`, plan.id);
      await db.addGroceryItems(list.map((x,i) => ({ list_id: gl.id, ...x, sort_order:i })));
      toast("Saved to My Kitchen");
      close(); go("kitchen");
    } catch(e){ toast(e.message,"err"); btn.disabled = false; btn.textContent = "Save as a shopping list"; }
  };
}
