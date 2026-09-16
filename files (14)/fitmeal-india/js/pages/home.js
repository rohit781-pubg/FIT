/* FitMeal India — Home / dashboard */

import { $, $$, el, esc, n0, n1, S, I, MEALS, todayISO, shiftDate, prettyDate, longDate,
         computeTargets, sumRows, scale, thaliRing, macroBars, toast, loadingBlock,
         errorBlock, estimateTag, fmtQty, EMPTY } from "../core.js";
import { db } from "../db.js";
import { openFoodPicker, openPortion } from "../pickers.js";
import { go } from "../app.js";

export async function renderHome(mount){
  mount.replaceChildren(loadingBlock());
  let log, summary, streak;
  try {
    [log, summary, streak] = await Promise.all([
      db.log(S.date), db.daySummary(S.date).catch(() => null), db.streak().catch(() => 0),
    ]);
  } catch(e){ return mount.replaceChildren(errorBlock(e, () => renderHome(mount))); }

  S.streak = streak || 0;
  const target = computeTargets(S.profile);
  const t = sumRows(log);
  const water = Number(summary?.water_ml || 0);
  const waterGoal = S.profile?.water_target_ml || 2500;
  const name = (S.profile?.display_name || "").split(" ")[0];

  const page = el(`<div>
    <div class="page-h">
      <div>
        <h1>${S.date === todayISO() ? esc(greeting(name)) : esc(prettyDate(S.date))}</h1>
        <p class="sub">${esc(longDate(S.date))}${S.streak >= 2 ? ` · 🔥 ${S.streak}-day streak` : ""}</p>
      </div>
      <div class="row">
        <button class="btn ghost sm" id="prev" aria-label="Previous day">${I.left}</button>
        <button class="btn ghost sm" id="today">Today</button>
        <button class="btn ghost sm" id="next" aria-label="Next day">${I.right}</button>
      </div>
    </div>

    <div class="card"><div class="thali">${thaliRing(t, target)}${macroBars(t, target)}</div></div>

    ${!target ? `<div class="card"><div class="msg info" style="margin:0">
      Finish your profile and FitMeal will work out daily targets for you.</div>
      <button class="btn sm mt" id="setup">Set my targets</button></div>` : ""}

    <div class="card">
      <div class="row between mb"><h2>Water</h2>
        <span class="num sub">${n1(water/1000)} L of ${n1(waterGoal/1000)} L</span></div>
      <div class="bar mb"><i style="width:${Math.min(water/waterGoal*100,100)}%;background:var(--water)"></i></div>
      <div class="chipwrap">
        <button class="chip" data-water="250">+250 ml</button>
        <button class="chip" data-water="500">+500 ml</button>
        <button class="chip" data-water="1000">+1 L</button>
        <button class="chip" id="water-custom">Other…</button>
        ${water > 0 ? `<button class="chip" id="water-undo">Undo last</button>` : ""}
      </div>
    </div>

    <h2 class="mt mb">Today's meals</h2>
    <div id="meals"></div>

    <div class="card">
      <h2 class="mb">Quick actions</h2>
      <div class="grid g3" id="qa"></div>
    </div>

    <div class="card">
      <div class="row between mb"><h2>The rest of the picture</h2>${estimateTag}</div>
      <div class="grid g4">
        <div class="stat"><div class="v num">${n0(t.fiber)}g</div><div class="k">Fibre</div></div>
        <div class="stat"><div class="v num">${n0(t.sugar)}g</div><div class="k">Sugar</div></div>
        <div class="stat"><div class="v num">${n0(t.sodium)}mg</div><div class="k">Sodium</div></div>
        <div class="stat"><div class="v num">₹${n0(t.cost)}</div><div class="k">Approx. cost</div></div>
      </div>
      ${t.sodium > 2300 ? `<p class="note mt">Sodium is past the 2,300 mg daily guideline —
        usually pickle, papad or packaged namkeen.</p>` : ""}
    </div>
  </div>`);

  $("#prev",  page).onclick = () => { S.date = shiftDate(S.date,-1); renderHome(mount); };
  $("#next",  page).onclick = () => { S.date = shiftDate(S.date, 1); renderHome(mount); };
  $("#today", page).onclick = () => { S.date = todayISO(); renderHome(mount); };
  $("#setup", page)?.addEventListener("click", () => go("me"));

  /* water */
  $$("[data-water]", page).forEach(b => b.onclick = async () => {
    try { await db.addWater(+b.dataset.water, S.date); renderHome(mount); }
    catch(e){ toast(e.message, "err"); }
  });
  $("#water-custom", page).onclick = () => {
    const v = prompt("How much water, in millilitres?", "300");
    if (!v) return;
    const ml = Math.round(Number(v));
    if (!(ml > 0)) return toast("Enter a number above zero");
    db.addWater(ml, S.date).then(() => renderHome(mount)).catch(e => toast(e.message,"err"));
  };
  $("#water-undo", page)?.addEventListener("click", async () => {
    try {
      const rows = await db.waterToday(S.date);
      if (!rows.length) return;
      await db.delWater(rows[0].id);
      renderHome(mount);
    } catch(e){ toast(e.message, "err"); }
  });

  /* meals */
  const meals = $("#meals", page);
  for (const m of MEALS){
    const rows = log.filter(r => r.meal === m.id);
    const mt = sumRows(rows);
    const share = target ? n0(target.kcal * m.share) : null;
    const block = el(`<section class="meal">
      <div class="meal-h">
        <h2>${m.label}</h2>
        <span class="meal-time">${m.defaultTime}</span>
        <span class="meal-kcal num">${n0(mt.kcal)}${share ? ` / ${share}` : ""} kcal</span>
      </div>
      <div class="items"></div>
      <div class="add-line"><button>${I.plus} Add food</button></div>
    </section>`);
    const items = $(".items", block);

    if (!rows.length){
      items.appendChild(el(`<div class="item">
        <span class="item-meta" style="margin:0">Nothing logged yet.</span></div>`));
    }
    for (const r of rows){
      const s = scale(r.food, r.qty_g);
      const row = el(`<div class="item">
        <span class="${r.food.is_veg ? "veg-dot" : "nonveg-dot"}"></span>
        <div class="item-main">
          <div class="item-name">${esc(r.food.name)}</div>
          <div class="item-meta num">${esc(fmtQty(r.qty_g, r.food))} · P ${n0(s.protein)} · C ${n0(s.carb)} · F ${n0(s.fat)}</div>
        </div>
        <span class="item-kcal num">${n0(s.kcal)}</span>
        <button class="x" data-edit aria-label="Change portion of ${esc(r.food.name)}">${I.swap}</button>
        <button class="x" data-del aria-label="Remove ${esc(r.food.name)}">${I.x}</button>
      </div>`);
      $("[data-del]", row).onclick = async () => {
        try { await db.delLog(r.id); toast("Removed"); renderHome(mount); }
        catch(e){ toast(e.message, "err"); }
      };
      $("[data-edit]", row).onclick = () => openPortion(r.food, r.meal, async (grams) => {
        await db.updateLog(r.id, { qty_g: grams });
        toast("Portion updated"); renderHome(mount);
      }, { amount: n1(r.qty_g / r.food.serving_g), confirmLabel:"Update portion" });
      items.appendChild(row);
    }

    $(".add-line button", block).onclick = () => openFoodPicker({
      meal: m.id,
      onPick: async (food, grams) => {
        await db.addLog(food.id, m.id, grams, S.date);
        toast(`Added to ${m.label.toLowerCase()}`);
        renderHome(mount);
      },
    });
    meals.appendChild(block);
  }

  /* quick actions — each one goes somewhere real */
  const QA = [
    ["Log food",        () => openFoodPicker({ meal: currentMeal(), onPick: async (f,g) => {
      await db.addLog(f.id, currentMeal(), g, S.date); toast("Logged"); renderHome(mount); } })],
    ["Repeat yesterday",async () => {
      const y = await db.log(shiftDate(S.date,-1));
      if (!y.length) return toast("Nothing logged yesterday");
      await db.addLogMany(y.map(r => ({ food_id:r.food.id, meal:r.meal, qty_g:r.qty_g, log_date:S.date })));
      toast(`Copied ${y.length} items`); renderHome(mount);
    }],
    ["Fill from plan",  () => fillFromPlan(mount)],
    ["Meal plan",       () => go("meals")],
    ["My kitchen",      () => go("kitchen")],
    ["Progress",        () => go("track")],
  ];
  $("#qa", page).replaceChildren(...QA.map(([label, fn]) => {
    const b = el(`<button class="stat tap"><div class="v" style="font-size:15px;font-family:var(--sans)">${esc(label)}</div></button>`);
    b.onclick = fn;
    return b;
  }));

  mount.replaceChildren(page);
}

function greeting(name){
  const h = new Date().getHours();
  const g = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return name ? `${g}, ${name}` : g;
}
export function currentMeal(){
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 19 ? "snack" : "dinner";
}

export async function fillFromPlan(mount){
  try {
    const plans = await db.plans();
    const plan = plans.find(p => p.is_active) || plans[0];
    if (!plan) return toast("No plan yet — build one in Meals");
    const items = await db.planItems(plan.id);
    const dow = (new Date(S.date+"T12:00:00").getDay() + 6) % 7;
    const forDay = items.filter(i => i.day_of_week === dow);
    if (!forDay.length) return toast("Nothing planned for this day");
    await db.addLogMany(forDay.map(i => ({
      food_id:i.food.id, meal:i.meal, qty_g:i.qty_g, log_date:S.date })));
    toast(`Added ${forDay.length} items from ${plan.name}`);
    if (mount) renderHome(mount);
  } catch(e){ toast(e.message, "err"); }
}
