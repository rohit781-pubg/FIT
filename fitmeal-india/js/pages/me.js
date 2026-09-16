/* FitMeal India — Me
   Profile, targets, food database browser, account. */

import { $, $$, el, esc, n0, n1, S, I, sb, DIETS, APPLIANCES, CATS, cap, scale,
         computeTargets, bmi, toast, loadingBlock, errorBlock, sheet, estimateTag } from "../core.js";
import { db } from "../db.js";
import { openCustomFood, foodRow, openPortion } from "../pickers.js";
import { parseQuery, applyQuery } from "../engine.js";
import { go } from "../app.js";

export async function renderMe(mount){
  const p = S.profile || {};
  const t = computeTargets(p);
  const b = bmi(p);

  const page = el(`<div>
    <div class="page-h">
      <div><h1>${esc(p.display_name || "Your profile")}</h1>
        <p class="sub">${esc(S.user.email)}</p></div>
      <button class="btn ghost sm" id="redo">Redo setup</button>
    </div>

    <div class="card">
      <div class="row between mb"><h2>Daily targets</h2>${estimateTag}</div>
      <div id="tgt"></div>
    </div>

    <div class="card">
      <h2 class="mb">About you</h2>
      <div id="msg"></div>
      <div class="grid g2">
        <div class="field"><label for="f-name">Name</label>
          <input id="f-name" data-f="display_name" value="${esc(p.display_name||"")}"></div>
        <div class="field"><label for="f-sex">Sex</label><select id="f-sex" data-f="sex">
          <option value="">Prefer not to say</option>
          ${["male","female","other"].map(s=>`<option value="${s}" ${p.sex===s?"selected":""}>${cap(s)}</option>`).join("")}
        </select></div>
        <div class="field"><label for="f-yr">Year of birth</label>
          <input id="f-yr" type="number" data-f="birth_year" value="${p.birth_year||""}"></div>
        <div class="field"><label for="f-ht">Height (cm)</label>
          <input id="f-ht" type="number" step="0.5" data-f="height_cm" value="${p.height_cm||""}"></div>
        <div class="field"><label for="f-wt">Weight (kg)</label>
          <input id="f-wt" type="number" step="0.1" data-f="weight_kg" value="${p.weight_kg||""}"></div>
        <div class="field"><label for="f-twt">Target weight (kg)</label>
          <input id="f-twt" type="number" step="0.1" data-f="target_weight_kg" value="${p.target_weight_kg||""}"></div>
        <div class="field"><label for="f-act">Activity</label><select id="f-act" data-f="activity_level">
          ${[["sedentary","Mostly sitting"],["light","Lightly active"],["moderate","Moderately active"],
             ["active","Very active"],["very_active","Athlete / heavy labour"]]
            .map(([v,l])=>`<option value="${v}" ${(p.activity_level||"light")===v?"selected":""}>${l}</option>`).join("")}
        </select></div>
        <div class="field"><label for="f-goal">Goal</label><select id="f-goal" data-f="goal">
          ${[["lose","Fat loss"],["muscle","Muscle gain"],["maintain","Maintenance"],["gain","Weight gain"]]
            .map(([v,l])=>`<option value="${v}" ${(p.goal||"maintain")===v?"selected":""}>${l}</option>`).join("")}
        </select></div>
        <div class="field"><label for="f-diet">How you eat</label><select id="f-diet" data-f="diet_type">
          ${DIETS.map(d=>`<option value="${d.id}" ${(p.diet_type||"veg")===d.id?"selected":""}>${d.label}</option>`).join("")}
        </select></div>
        <div class="field"><label for="f-hh">Cooking for</label>
          <input id="f-hh" type="number" min="1" max="12" data-f="household_size" value="${p.household_size||1}"></div>
        <div class="field"><label for="f-bud">Daily budget (₹)</label>
          <input id="f-bud" type="number" data-f="daily_budget_inr" value="${p.daily_budget_inr||""}" placeholder="optional"></div>
        <div class="field"><label for="f-wg">Water goal (ml)</label>
          <input id="f-wg" type="number" step="100" data-f="water_target_ml" value="${p.water_target_ml||2500}"></div>
      </div>
      <div class="field"><label for="f-al">Allergies (comma separated)</label>
        <input id="f-al" data-l="allergies" value="${esc((p.allergies||[]).join(", "))}"></div>
      <div class="field"><label for="f-dl">Foods you dislike</label>
        <input id="f-dl" data-l="dislikes" value="${esc((p.dislikes||[]).join(", "))}"></div>
      <div class="field"><label>Appliances you own</label><div class="chipwrap" id="appl">
        ${APPLIANCES.map(a=>`<button class="chip sm" data-ap="${a.id}"
          aria-pressed="${(p.appliances||[]).includes(a.id)}">${a.label}</button>`).join("")}
      </div></div>
      <button class="btn" id="save">Save profile</button>
      ${b ? `<p class="note mt">BMI ${b} — a crude screening number that ignores muscle,
        build and body composition. It is not a diagnosis.</p>` : ""}
    </div>

    <div class="card">
      <h2 class="mb">Set targets yourself</h2>
      <p class="note mb">Leave blank to let FitMeal calculate from the details above.</p>
      <div class="grid g4">
        <div class="field"><label for="t-k">Calories</label>
          <input id="t-k" type="number" value="${p.target_kcal||""}" placeholder="auto"></div>
        <div class="field"><label for="t-p">Protein (g)</label>
          <input id="t-p" type="number" value="${p.target_protein||""}" placeholder="auto"></div>
        <div class="field"><label for="t-c">Carbs (g)</label>
          <input id="t-c" type="number" value="${p.target_carb||""}" placeholder="auto"></div>
        <div class="field"><label for="t-f">Fat (g)</label>
          <input id="t-f" type="number" value="${p.target_fat||""}" placeholder="auto"></div>
      </div>
      <div class="row wrap">
        <button class="btn ghost" id="tsave">Save targets</button>
        <button class="btn ghost" id="tclear">Back to automatic</button>
      </div>
    </div>

    <div class="card">
      <div class="row between mb"><h2>Food database</h2>
        <button class="btn ghost sm" id="addfood">Add a food</button></div>
      <input id="fq" type="search" placeholder="Search 326 Indian foods, or try &ldquo;high protein under 300 calories&rdquo;">
      <div class="chiprow mt">
        ${CATS.map(c=>`<button class="chip sm" data-c="${c}" aria-pressed="false">${cap(c)}</button>`).join("")}
      </div>
      <div id="flist" class="mt"></div>
    </div>

    <div class="card">
      <h2 class="mb">About the numbers</h2>
      <p class="note">Nutrition values are composited from IFCT 2017, NIN Hyderabad tables and
        standard recipe analyses. They describe a typical preparation, not yours — a tablespoon of
        extra oil is about 120 kcal, and "one katori" is not a standardised unit. Costs are rough
        estimates that vary by city and store. Treat every number here as a good estimate to steer by,
        not a measurement.<br><br>
        FitMeal India gives nutrition information, not medical advice. It does not diagnose anything
        and cannot promise results. If you have a health condition, are pregnant, are managing
        diabetes or blood pressure, or are planning a big change to how you eat, work with a doctor
        or a registered dietitian.</p>
      <button class="btn ghost sm mt" id="out">Sign out</button>
    </div>
  </div>`);

  /* targets block */
  $("#tgt", page).innerHTML = t ? `<div class="grid g5">
      <div class="stat"><div class="v num">${n0(t.kcal)}</div><div class="k">kcal a day</div></div>
      <div class="stat"><div class="v num" style="color:var(--protein)">${n0(t.protein)}g</div><div class="k">Protein</div></div>
      <div class="stat"><div class="v num" style="color:var(--carb)">${n0(t.carb)}g</div><div class="k">Carbs</div></div>
      <div class="stat"><div class="v num" style="color:var(--fat)">${n0(t.fat)}g</div><div class="k">Fat</div></div>
      <div class="stat"><div class="v num" style="color:var(--fiber)">${n0(t.fiber)}g</div><div class="k">Fibre</div></div>
    </div>
    <p class="note mt">${t.auto
      ? `Mifflin-St Jeor${t.bmr?`, resting burn about ${t.bmr} kcal`:""}, adjusted for activity and goal.`
      : "These are the targets you set yourself."}</p>`
    : `<div class="msg info" style="margin:0">Add your sex, year of birth, height and weight below
        and FitMeal will calculate targets.</div>`;

  $("#redo", page).onclick = () => go("onboarding");

  /* appliances */
  let appliances = new Set(p.appliances || []);
  $$("[data-ap]", page).forEach(b => b.onclick = () => {
    const v = b.dataset.ap;
    if (v === "none") appliances = appliances.has("none") ? new Set() : new Set(["none"]);
    else { appliances.delete("none"); appliances.has(v) ? appliances.delete(v) : appliances.add(v); }
    $$("[data-ap]", page).forEach(x => x.setAttribute("aria-pressed", String(appliances.has(x.dataset.ap))));
  });

  $("#save", page).onclick = async () => {
    const num = id => { const v = $("#"+id, page).value.trim(); return v === "" ? null : Number(v); };
    const str = id => { const v = $("#"+id, page).value.trim(); return v === "" ? null : v; };
    const btn = $("#save", page); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try {
      S.profile = await db.saveProfile({
        display_name: str("f-name"), sex: str("f-sex"),
        birth_year: num("f-yr"), height_cm: num("f-ht"), weight_kg: num("f-wt"),
        target_weight_kg: num("f-twt"),
        activity_level: $("#f-act", page).value, goal: $("#f-goal", page).value,
        diet_type: $("#f-diet", page).value,
        household_size: num("f-hh") || 1, daily_budget_inr: num("f-bud"),
        water_target_ml: num("f-wg") || 2500,
        allergies: $("#f-al", page).value.split(",").map(s=>s.trim()).filter(Boolean),
        dislikes:  $("#f-dl", page).value.split(",").map(s=>s.trim()).filter(Boolean),
        appliances: [...appliances],
      });
      toast("Profile saved"); renderMe(mount);
    } catch(e){
      $("#msg", page).innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
      btn.disabled = false; btn.textContent = "Save profile";
    }
  };

  $("#tsave", page).onclick = async () => {
    const V = id => { const v = $("#"+id, page).value.trim(); return v === "" ? null : Number(v); };
    const k = V("t-k");
    if (k !== null && k < 1200)
      return toast("FitMeal won't set a target below 1,200 kcal. Very low intakes need medical supervision.");
    try {
      S.profile = await db.saveProfile({
        target_kcal:k, target_protein:V("t-p"), target_carb:V("t-c"), target_fat:V("t-f") });
      toast("Targets saved"); renderMe(mount);
    } catch(e){ toast(e.message, "err"); }
  };
  $("#tclear", page).onclick = async () => {
    S.profile = await db.saveProfile({ target_kcal:null, target_protein:null, target_carb:null, target_fat:null });
    toast("Back to automatic targets"); renderMe(mount);
  };

  /* food browser */
  const list = $("#flist", page);
  let fq = "", fcat = "all", timer = null;
  async function search(){
    list.replaceChildren(loadingBlock("Searching"));
    try {
      const parsed = parseQuery(fq);
      const smart = parsed.maxKcal || parsed.minProtein || parsed.maxCost || parsed.tags.length;
      let foods = await db.searchFoods({ q: smart ? parsed.text : fq,
        cat: fcat !== "all" ? fcat : parsed.cat, veg: parsed.veg, limit: 80 });
      if (smart) foods = applyQuery(foods, parsed);
      if (!foods.length) return list.innerHTML = `<div class="empty">Nothing matched that.</div>`;
      list.replaceChildren(
        el(`<p class="note mb">${foods.length} result${foods.length===1?"":"s"}</p>`),
        ...foods.map(f => foodRow(f, () => openFoodDetail(f)))
      );
    } catch(e){ list.replaceChildren(errorBlock(e, search)); }
  }
  $("#fq", page).oninput = e => { fq = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(search, 250); };
  $$("[data-c]", page).forEach(b => b.onclick = () => {
    const on = b.getAttribute("aria-pressed") === "true";
    $$("[data-c]", page).forEach(x => x.setAttribute("aria-pressed","false"));
    fcat = on ? "all" : b.dataset.c;
    if (!on) b.setAttribute("aria-pressed","true");
    search();
  });
  $("#addfood", page).onclick = () => openCustomFood(() => search());

  $("#out", page).onclick = async () => { await sb.auth.signOut(); location.reload(); };

  mount.replaceChildren(page);
  search();
}

export function openFoodDetail(f){
  const p100 = scale(f, 100), pS = scale(f, f.serving_g);
  const line = (k,a,b,u) => `<div class="row between" style="padding:9px 0;border-bottom:1px solid var(--line)">
    <span>${k}</span><span class="num" style="color:var(--muted)">${n1(a)}${u} · <b style="color:var(--cream)">${n1(b)}${u}</b></span></div>`;
  const body = el(`<div>
    <p class="sub" style="margin:-8px 0 12px">${esc(f.name_local ? f.name_local+" · " : "")}${esc(cap(f.category))} · ${esc(f.region)} ${estimateTag}</p>
    ${(f.diet_tags||[]).length ? `<div class="chipwrap mb">${f.diet_tags.map(t =>
      `<span class="chip sm">${esc(t.replace(/_/g," "))}</span>`).join("")}</div>` : ""}
    <div class="row between note" style="padding-bottom:6px"><span></span>
      <span>per 100 g · <b style="color:var(--muted)">per ${esc(f.serving_desc)}</b></span></div>
    ${line("Calories", p100.kcal, pS.kcal, " kcal")}
    ${line("Protein", p100.protein, pS.protein, " g")}
    ${line("Carbohydrate", p100.carb, pS.carb, " g")}
    ${line("&nbsp;&nbsp;of which sugar", p100.sugar, pS.sugar, " g")}
    ${line("Fibre", p100.fiber, pS.fiber, " g")}
    ${line("Fat", p100.fat, pS.fat, " g")}
    ${line("&nbsp;&nbsp;saturated", f.sat_fat_g, f.sat_fat_g*f.serving_g/100, " g")}
    ${line("Sodium", p100.sodium, pS.sodium, " mg")}
    ${f.cost_per_100g ? line("Approx. cost", p100.cost, pS.cost, "") : ""}
    <button class="btn wide mt" id="log">Log this</button>
    <p class="note mt">Source: ${esc(f.source || "composite")}. Cooked dishes assume typical home
      preparation — your oil and portion sizes will move these numbers.</p>
  </div>`);
  const { close } = sheet({ title: f.name, body });
  $("#log", body).onclick = () => {
    close();
    const meal = new Date().getHours() < 11 ? "breakfast"
      : new Date().getHours() < 16 ? "lunch"
      : new Date().getHours() < 19 ? "snack" : "dinner";
    openPortion(f, meal, async (g) => {
      await db.addLog(f.id, meal, g, S.date);
      toast("Logged"); go("home");
    });
  };
}
