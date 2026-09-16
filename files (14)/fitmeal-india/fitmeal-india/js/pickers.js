/* FitMeal India — shared pickers
   Food search, portion chooser with multiple serving units, custom food. */

import { $, el, esc, cap, n0, n1, clamp, I, S, CATS, MEALS, scale,
         sheet, toast, loadingBlock, errorBlock, estimateTag, dietTagFor } from "./core.js";
import { db } from "./db.js";
import { parseQuery, applyQuery } from "./engine.js";

/* ------------------------------------------------------------------
   Food picker. Accepts plain names or smart queries like
   "high protein dinner under 400 calories".
   ------------------------------------------------------------------ */
export function openFoodPicker({ meal = "lunch", onPick, title }){
  const body = el(`<div>
    <input id="q" type="search" autocomplete="off"
      placeholder="Search, or try &ldquo;high protein under 400 calories&rdquo;">
    <p class="note" style="margin:7px 0 0">Plain names work too — roti, dal, dosa, paneer.</p>
    <div class="chiprow mt" id="filters">
      <button class="chip" data-veg="all" aria-pressed="true">Everything</button>
      <button class="chip" data-veg="veg" aria-pressed="false">Veg</button>
      <button class="chip" data-veg="nonveg" aria-pressed="false">Non-veg</button>
      ${CATS.map(c => `<button class="chip" data-cat="${c}" aria-pressed="false">${cap(c)}</button>`).join("")}
    </div>
    <div id="parsed" class="note mt"></div>
    <div id="results" class="mt"></div>
    <button class="btn ghost wide mt" id="custom">Add a food that isn't listed</button>
  </div>`);

  const { close } = sheet({
    title: title || `Add to ${MEALS.find(m => m.id === meal)?.label.toLowerCase() || meal}`,
    body,
  });

  let q = "", cat = "all", veg = "all", timer = null;
  const results = $("#results", body);

  async function refresh(){
    results.replaceChildren(loadingBlock("Searching"));
    try {
      const parsed = parseQuery(q);
      const useSmart = parsed.maxKcal || parsed.minProtein || parsed.maxCost || parsed.tags.length;
      $("#parsed", body).textContent = useSmart
        ? [ parsed.maxKcal    ? `under ${parsed.maxKcal} kcal` : null,
            parsed.minProtein ? `at least ${parsed.minProtein} g protein` : null,
            parsed.maxCost    ? `under ₹${parsed.maxCost}` : null,
            ...parsed.tags.map(t => t.replace("__no_","no ").replace("_"," ")),
          ].filter(Boolean).join(" · ")
        : "";

      let foods = await db.searchFoods({
        q: useSmart ? parsed.text : q,
        cat: cat !== "all" ? cat : parsed.cat,
        veg: veg !== "all" ? veg : parsed.veg,
        limit: 120,
      });
      if (useSmart) foods = applyQuery(foods, parsed);

      if (!foods.length){
        results.innerHTML = `<div class="empty"><b>Nothing matched</b>
          Try a shorter word, or loosen a filter. You can also add the dish yourself below.</div>`;
        return;
      }
      results.replaceChildren(...foods.map(f => foodRow(f, () =>
        openPortion(f, meal, async (grams, unitLabel) => { await onPick(f, grams, unitLabel); close(); })
      )));
    } catch(e){
      results.replaceChildren(errorBlock(e, refresh));
    }
  }

  $("#q", body).oninput = e => { q = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(refresh, 250); };
  body.querySelectorAll("[data-veg]").forEach(b => b.onclick = () => {
    veg = b.dataset.veg;
    body.querySelectorAll("[data-veg]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    refresh();
  });
  body.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => {
    const on = b.getAttribute("aria-pressed") === "true";
    body.querySelectorAll("[data-cat]").forEach(x => x.setAttribute("aria-pressed","false"));
    cat = on ? "all" : b.dataset.cat;
    if (!on) b.setAttribute("aria-pressed","true");
    refresh();
  });
  $("#custom", body).onclick = () => { close(); openCustomFood(); };

  setTimeout(() => $("#q", body)?.focus(), 60);
  refresh();
}

export function foodRow(f, onClick){
  const per = scale(f, f.serving_g);
  const b = el(`<button class="frow">
    <span class="${f.is_veg ? "veg-dot" : "nonveg-dot"}"></span>
    <span style="flex:1;min-width:0">
      <span class="fname">${esc(f.name)}</span>
      <span class="fmeta">${esc(f.serving_desc)} · ${esc(cap(f.category))}${f.name_local ? ` · ${esc(f.name_local)}` : ""}</span>
    </span>
    <span class="fkcal num"><b>${n0(per.kcal)}</b><span>kcal · ${n0(per.protein)}g P</span></span>
  </button>`);
  b.onclick = onClick;
  return b;
}

/* ------------------------------------------------------------------
   Portion chooser. Loads every unit defined for the food
   (1 roti / half roti / 2 roti / 100 g) plus a free grams entry.
   ------------------------------------------------------------------ */
export function openPortion(food, meal, onConfirm, opts = {}){
  const body = el(`<div>
    <p class="sub" style="margin:-8px 0 14px">${esc(food.serving_desc)} = ${n0(food.serving_g)} g ${estimateTag}</p>
    <div class="field"><label>Serving size</label><div class="chipwrap" id="units">
      <span class="note">Loading units…</span></div></div>
    <div class="field"><label for="amt" id="amtlab">How many?</label>
      <input id="amt" type="number" inputmode="decimal" step="0.25" min="0.25" value="${opts.amount ?? 1}"></div>
    <div class="grid g4" id="pv"></div>
    <div class="row between mt"><span class="note" id="costline"></span></div>
    <button class="btn wide mt" id="ok">${esc(opts.confirmLabel || `Add to ${MEALS.find(m=>m.id===meal)?.label.toLowerCase() || meal}`)}</button>
  </div>`);

  const { close } = sheet({ title: food.name, body });

  let unit = { label: food.serving_desc, grams: +food.serving_g };
  let amount = opts.amount ?? 1;

  const grams = () => amount * unit.grams;
  function preview(){
    const s = scale(food, grams());
    $("#pv", body).innerHTML = `
      <div class="stat"><div class="v num">${n0(s.kcal)}</div><div class="k">kcal</div></div>
      <div class="stat"><div class="v num" style="color:var(--protein)">${n1(s.protein)}g</div><div class="k">Protein</div></div>
      <div class="stat"><div class="v num" style="color:var(--carb)">${n1(s.carb)}g</div><div class="k">Carbs</div></div>
      <div class="stat"><div class="v num" style="color:var(--fat)">${n1(s.fat)}g</div><div class="k">Fat</div></div>`;
    $("#costline", body).textContent =
      `${n0(grams())} g · fibre ${n1(s.fiber)} g · about ₹${n0(s.cost)} (estimate)`;
  }

  db.foodUnits(food.id).then(units => {
    const list = units.length ? units : [{ label:food.serving_desc, grams:food.serving_g, is_default:true }];
    const host = $("#units", body);
    host.replaceChildren(...list.map(u => {
      const b = el(`<button class="chip sm" aria-pressed="${u.label === unit.label}">${esc(u.label)}</button>`);
      b.onclick = () => {
        unit = { label:u.label, grams:+u.grams };
        host.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        $("#amtlab", body).textContent = `How many × ${u.label}?`;
        preview();
      };
      return b;
    }), (() => {
      const b = el(`<button class="chip sm" aria-pressed="false">Grams</button>`);
      b.onclick = () => {
        unit = { label:"g", grams:1 };
        amount = Math.round(food.serving_g);
        $("#amt", body).value = amount; $("#amt", body).step = 5;
        host.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        $("#amtlab", body).textContent = "Weight in grams";
        preview();
      };
      return b;
    })());
  }).catch(() => { $("#units", body).innerHTML = `<span class="note">Using the default serving.</span>`; });

  $("#amt", body).oninput = e => { amount = Math.max(Number(e.target.value)||0, 0); preview(); };
  $("#ok", body).onclick = async () => {
    const g = grams();
    if (!(g > 0)) return toast("Enter an amount above zero");
    const btn = $("#ok", body); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try { await onConfirm(n1(g), unit.label); close(); }
    catch(e){ toast(e.message, "err"); btn.disabled = false; btn.textContent = "Add"; }
  };
  preview();
}

/* ------------------------------------------------------------------
   Custom food
   ------------------------------------------------------------------ */
export function openCustomFood(onSaved){
  const num = (id, label) => `<div class="field"><label for="${id}">${label}</label>
    <input id="${id}" type="number" inputmode="decimal" step="0.1" min="0" value="0"></div>`;
  const body = el(`<div>
    <p class="note mb">Enter the numbers per 100 g — that's how packet labels list them.
      Only you will see this food.</p>
    <div id="msg"></div>
    <div class="field"><label for="cf-name">Name</label>
      <input id="cf-name" type="text" placeholder="Ammi's rajma"></div>
    <div class="grid g2">
      <div class="field"><label for="cf-cat">Category</label><select id="cf-cat">
        ${CATS.map(c => `<option value="${c}">${cap(c)}</option>`).join("")}</select></div>
      <div class="field"><label for="cf-veg">Type</label><select id="cf-veg">
        <option value="true">Veg</option><option value="false">Non-veg</option></select></div>
      <div class="field"><label for="cf-sd">One serving is</label>
        <input id="cf-sd" type="text" placeholder="1 katori"></div>
      <div class="field"><label for="cf-sg">…which weighs (g)</label>
        <input id="cf-sg" type="number" min="1" step="1" value="100"></div>
    </div>
    <h3 class="mt mb">Per 100 g</h3>
    <div class="grid g2">
      ${num("cf-kcal","Calories (kcal)")}${num("cf-p","Protein (g)")}
      ${num("cf-c","Carbs (g)")}${num("cf-f","Fat (g)")}
      ${num("cf-fib","Fibre (g)")}${num("cf-sug","Sugar (g)")}
      ${num("cf-sat","Saturated fat (g)")}${num("cf-na","Sodium (mg)")}
    </div>
    <button class="btn wide" id="save">Save food</button>
  </div>`);

  const { close } = sheet({ title:"Add your own food", body });

  $("#save", body).onclick = async () => {
    const V = id => Number($("#"+id, body).value) || 0;
    const name = $("#cf-name", body).value.trim();
    if (!name) return ($("#msg", body).innerHTML = `<div class="msg err">Give the food a name.</div>`);
    if (V("cf-kcal") <= 0) return ($("#msg", body).innerHTML = `<div class="msg err">Calories per 100 g can't be zero.</div>`);
    const btn = $("#save", body); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try {
      const food = await db.createFood({
        name, category: $("#cf-cat", body).value, region: "custom",
        is_veg: $("#cf-veg", body).value === "true",
        serving_desc: $("#cf-sd", body).value.trim() || "1 serving",
        serving_g: Number($("#cf-sg", body).value) || 100,
        kcal:V("cf-kcal"), protein_g:V("cf-p"), carb_g:V("cf-c"), fiber_g:V("cf-fib"),
        fat_g:V("cf-f"), sat_fat_g:V("cf-sat"), sugar_g:V("cf-sug"), sodium_mg:V("cf-na"),
        source:"user",
      });
      toast("Saved — search for it by name");
      close();
      onSaved?.(food);
    } catch(e){
      $("#msg", body).innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
      btn.disabled = false; btn.textContent = "Save food";
    }
  };
}
