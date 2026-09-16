/* FitMeal India — onboarding
   Seven steps. Every answer maps to something the app actually uses;
   nothing is collected for its own sake. */

import { $, $$, el, esc, S, I, DIETS, APPLIANCES, toast, computeTargets, n0 } from "../core.js";
import { db } from "../db.js";

const STEPS = ["you", "body", "goal", "diet", "avoid", "kitchen", "rhythm"];

export function renderOnboarding(mount, onDone){
  const draft = {
    display_name: S.profile?.display_name || "",
    sex: S.profile?.sex || "", birth_year: S.profile?.birth_year || "",
    height_cm: S.profile?.height_cm || "", weight_kg: S.profile?.weight_kg || "",
    target_weight_kg: S.profile?.target_weight_kg || "",
    activity_level: S.profile?.activity_level || "light",
    goal: S.profile?.goal || "maintain",
    diet_type: S.profile?.diet_type || "veg",
    allergies: S.profile?.allergies || [], dislikes: S.profile?.dislikes || [],
    cuisines: S.profile?.cuisines || [],
    appliances: S.profile?.appliances?.length ? S.profile.appliances : ["gas","fridge"],
    daily_budget_inr: S.profile?.daily_budget_inr || "",
    cook_minutes: S.profile?.cook_minutes || 30,
    cook_skill: S.profile?.cook_skill || "beginner",
    household_size: S.profile?.household_size || 1,
    meals_per_day: S.profile?.meals_per_day || 4,
    water_target_ml: S.profile?.water_target_ml || 2500,
  };
  let step = 0;

  const wrap = el(`<div class="ob-wrap">
    <div class="brand">Fit<span>Meal</span> India<small>SET UP YOUR PROFILE</small></div>
    <div class="ob-bar"><i></i></div>
    <div class="ob-step" id="step"></div>
    <div class="ob-foot">
      <button class="btn ghost" id="back">Back</button>
      <button class="btn" id="next" style="flex:1">Continue</button>
    </div>
    <p class="note mt" style="text-align:center">You can change any of this later in Me.</p>
  </div>`);

  const opt = (name, value, title, sub) => `<button class="pick" data-set="${name}" data-val="${esc(value)}"
    aria-pressed="${String(draft[name]) === String(value)}"><span style="flex:1">
    <b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</span>
    <span class="tick">${I.tick}</span></button>`;

  const multi = (name, value, title) => `<button class="pick" data-toggle="${name}" data-val="${esc(value)}"
    aria-pressed="${(draft[name]||[]).includes(value)}"><span style="flex:1"><b>${esc(title)}</b></span>
    <span class="tick">${I.tick}</span></button>`;

  const VIEWS = {
    you: () => `<h1>First, your name</h1>
      <p class="sub mb">So the app can address you properly.</p>
      <div class="field"><label for="f-name">Name</label>
        <input id="f-name" data-field="display_name" value="${esc(draft.display_name)}" placeholder="Rohit"></div>
      <div class="grid g2">
        <div class="field"><label for="f-yr">Year of birth</label>
          <input id="f-yr" type="number" data-field="birth_year" value="${draft.birth_year}" placeholder="1998"></div>
        <div class="field"><label for="f-sex">Sex</label>
          <select id="f-sex" data-field="sex">
            <option value="">Prefer not to say</option>
            <option value="male"   ${draft.sex==="male"?"selected":""}>Male</option>
            <option value="female" ${draft.sex==="female"?"selected":""}>Female</option>
            <option value="other"  ${draft.sex==="other"?"selected":""}>Other</option>
          </select></div>
      </div>
      <p class="note">Sex and age only feed the calorie formula. Leaving them blank means you'll
        set your own targets instead.</p>`,

    body: () => `<h1>Your measurements</h1>
      <p class="sub mb">Used to estimate how much energy you burn at rest.</p>
      <div class="grid g2">
        <div class="field"><label for="f-ht">Height (cm)</label>
          <input id="f-ht" type="number" step="0.5" data-field="height_cm" value="${draft.height_cm}" placeholder="170"></div>
        <div class="field"><label for="f-wt">Weight (kg)</label>
          <input id="f-wt" type="number" step="0.1" data-field="weight_kg" value="${draft.weight_kg}" placeholder="68"></div>
      </div>
      <div class="field"><label for="f-twt">Target weight (kg) — optional</label>
        <input id="f-twt" type="number" step="0.1" data-field="target_weight_kg" value="${draft.target_weight_kg}" placeholder="63"></div>
      <h3 class="mt mb">How active is a normal day?</h3>
      ${opt("activity_level","sedentary","Mostly sitting","Desk work, little walking")}
      ${opt("activity_level","light","Lightly active","Some walking, light chores")}
      ${opt("activity_level","moderate","Moderately active","Exercise 3–5 days a week")}
      ${opt("activity_level","active","Very active","Hard exercise most days")}
      ${opt("activity_level","very_active","Athlete or heavy labour","Training twice a day, physical job")}`,

    goal: () => `<h1>What are you working towards?</h1>
      <p class="sub mb">This shifts your calorie target up or down.</p>
      ${opt("goal","lose","Fat loss","A moderate deficit")}
      ${opt("goal","muscle","Muscle gain","A small surplus with more protein")}
      ${opt("goal","maintain","Maintenance","Stay roughly where you are")}
      ${opt("goal","gain","Weight gain","A larger surplus")}
      ${opt("goal","healthy","General healthy eating","No weight target, better balance")}
      <p class="note mt">FitMeal won't set a target below 1,500 kcal for men or 1,200 for women,
        whatever the goal. Very low intakes need medical supervision.</p>`,

    diet: () => `<h1>How do you eat?</h1>
      <p class="sub mb">Everything — planner, search, swaps, grocery list — respects this.</p>
      ${DIETS.map(d => opt("diet_type", d.id, d.label,
        d.id==="jain" ? "No onion, garlic or root vegetables" :
        d.id==="vegan" ? "No dairy or animal products" :
        d.id==="egg" ? "Vegetarian plus eggs" : "")).join("")}`,

    avoid: () => `<h1>Anything to keep out?</h1>
      <p class="sub mb">Foods matching these words never get suggested to you.</p>
      <div class="field"><label for="f-al">Allergies</label>
        <input id="f-al" data-list="allergies" value="${esc((draft.allergies||[]).join(", "))}"
          placeholder="peanut, sesame"></div>
      <div class="field"><label for="f-dl">Foods you dislike</label>
        <input id="f-dl" data-list="dislikes" value="${esc((draft.dislikes||[]).join(", "))}"
          placeholder="karela, brinjal"></div>
      <p class="note">Separate with commas. Matching is on the food name, so broad words
        (&ldquo;paneer&rdquo;) exclude more than narrow ones.</p>
      <div class="msg info mt">This is a preference filter, not an allergy safety system.
        Always check labels and ask when eating out.</div>`,

    kitchen: () => `<h1>What can you cook with?</h1>
      <p class="sub mb">Recipes get filtered to what you actually own.</p>
      ${APPLIANCES.map(a => multi("appliances", a.id, a.label)).join("")}
      <div class="grid g2 mt">
        <div class="field"><label for="f-min">Minutes you'll spend cooking</label>
          <input id="f-min" type="number" data-field="cook_minutes" value="${draft.cook_minutes}"></div>
        <div class="field"><label for="f-skill">Cooking confidence</label>
          <select id="f-skill" data-field="cook_skill">
            <option value="beginner"    ${draft.cook_skill==="beginner"?"selected":""}>Beginner</option>
            <option value="comfortable" ${draft.cook_skill==="comfortable"?"selected":""}>Comfortable</option>
            <option value="confident"   ${draft.cook_skill==="confident"?"selected":""}>Confident</option>
          </select></div>
      </div>`,

    rhythm: () => `<h1>Your day</h1>
      <p class="sub mb">Last bit — then we'll calculate your targets.</p>
      <div class="grid g2">
        <div class="field"><label for="f-hh">Cooking for how many?</label>
          <input id="f-hh" type="number" min="1" max="12" data-field="household_size" value="${draft.household_size}"></div>
        <div class="field"><label for="f-mpd">Meals a day</label>
          <input id="f-mpd" type="number" min="2" max="6" data-field="meals_per_day" value="${draft.meals_per_day}"></div>
        <div class="field"><label for="f-bud">Daily food budget (₹) — optional</label>
          <input id="f-bud" type="number" data-field="daily_budget_inr" value="${draft.daily_budget_inr}" placeholder="200"></div>
        <div class="field"><label for="f-wt2">Daily water goal (ml)</label>
          <input id="f-wt2" type="number" step="100" data-field="water_target_ml" value="${draft.water_target_ml}"></div>
      </div>
      <div id="preview" class="mt"></div>`,
  };

  function paint(){
    const name = STEPS[step];
    $("#step", wrap).innerHTML = VIEWS[name]();
    $(".ob-bar i", wrap).style.width = ((step+1)/STEPS.length*100) + "%";
    $("#back", wrap).style.visibility = step === 0 ? "hidden" : "visible";
    $("#next", wrap).textContent = step === STEPS.length-1 ? "Finish setup" : "Continue";

    $$("[data-field]", wrap).forEach(inp => inp.oninput = () => {
      const v = inp.value.trim();
      draft[inp.dataset.field] = inp.type === "number" ? (v === "" ? "" : Number(v)) : v;
      if (name === "rhythm") showPreview();
    });
    $$("[data-list]", wrap).forEach(inp => inp.oninput = () => {
      draft[inp.dataset.list] = inp.value.split(",").map(s => s.trim()).filter(Boolean);
    });
    $$("[data-set]", wrap).forEach(b => b.onclick = () => {
      const f = b.dataset.set;
      draft[f] = b.dataset.val;
      $$(`[data-set="${f}"]`, wrap).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    });
    $$("[data-toggle]", wrap).forEach(b => b.onclick = () => {
      const f = b.dataset.toggle, v = b.dataset.val;
      const cur = new Set(draft[f] || []);
      if (v === "none"){ draft[f] = cur.has("none") ? [] : ["none"]; }
      else { cur.delete("none"); cur.has(v) ? cur.delete(v) : cur.add(v); draft[f] = [...cur]; }
      $$(`[data-toggle="${f}"]`, wrap).forEach(x =>
        x.setAttribute("aria-pressed", String((draft[f]||[]).includes(x.dataset.val))));
    });
    if (name === "rhythm") showPreview();
  }

  function showPreview(){
    const host = $("#preview", wrap); if (!host) return;
    const t = computeTargets({ ...draft, goal: draft.goal === "healthy" ? "maintain" : draft.goal });
    host.innerHTML = t ? `<div class="card tight">
        <h3 class="mb">Your daily targets</h3>
        <div class="grid g4">
          <div class="stat"><div class="v num">${n0(t.kcal)}</div><div class="k">kcal</div></div>
          <div class="stat"><div class="v num" style="color:var(--protein)">${n0(t.protein)}g</div><div class="k">Protein</div></div>
          <div class="stat"><div class="v num" style="color:var(--carb)">${n0(t.carb)}g</div><div class="k">Carbs</div></div>
          <div class="stat"><div class="v num" style="color:var(--fat)">${n0(t.fat)}g</div><div class="k">Fat</div></div>
        </div>
        <p class="note mt">Mifflin-St Jeor, adjusted for activity and goal. An estimate —
          adjust after a couple of weeks of real data.</p></div>`
      : `<div class="msg info">Add your height, weight, year of birth and sex and we'll
          calculate targets. Otherwise you can set them yourself later.</div>`;
  }

  $("#back", wrap).onclick = () => { if (step > 0){ step--; paint(); window.scrollTo(0,0); } };
  $("#next", wrap).onclick = async () => {
    if (STEPS[step] === "you" && !draft.display_name.trim()) return toast("What should we call you?");
    if (step < STEPS.length - 1){ step++; paint(); window.scrollTo(0,0); return; }

    const btn = $("#next", wrap); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try {
      const num = v => v === "" || v === null ? null : Number(v);
      S.profile = await db.saveProfile({
        display_name: draft.display_name.trim(),
        sex: draft.sex || null,
        birth_year: num(draft.birth_year),
        height_cm: num(draft.height_cm),
        weight_kg: num(draft.weight_kg),
        target_weight_kg: num(draft.target_weight_kg),
        activity_level: draft.activity_level,
        goal: draft.goal === "healthy" ? "maintain" : draft.goal,
        diet_type: draft.diet_type,
        allergies: draft.allergies, dislikes: draft.dislikes,
        appliances: draft.appliances,
        daily_budget_inr: num(draft.daily_budget_inr),
        cook_minutes: num(draft.cook_minutes),
        cook_skill: draft.cook_skill,
        household_size: num(draft.household_size) || 1,
        meals_per_day: num(draft.meals_per_day) || 4,
        water_target_ml: num(draft.water_target_ml) || 2500,
        onboarded_at: new Date().toISOString(),
      });
      if (draft.weight_kg) await db.addWeight(Number(draft.weight_kg), new Date().toISOString().slice(0,10)).catch(()=>{});
      toast("You're set up");
      onDone();
    } catch(e){
      toast(e.message, "err");
      btn.disabled = false; btn.textContent = "Finish setup";
    }
  };

  mount.replaceChildren(wrap);
  paint();
}
