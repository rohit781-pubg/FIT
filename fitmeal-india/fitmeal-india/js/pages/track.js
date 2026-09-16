/* FitMeal India — Track
   Progress over time, weight log, badges. */

import { $, $$, el, esc, n0, n1, S, I, todayISO, shiftDate, computeTargets, bmi,
         toast, loadingBlock, errorBlock, sheet, estimateTag } from "../core.js";
import { db } from "../db.js";
import { BADGES, evaluateBadges } from "../engine.js";

let span = 7;

export async function renderTrack(mount){
  mount.replaceChildren(loadingBlock("Crunching your numbers"));
  let range, weights, streak, achv, pantry, plans;
  try {
    [range, weights, streak, achv, pantry, plans] = await Promise.all([
      db.range(span), db.weights(), db.streak().catch(()=>0),
      db.achievements().catch(()=>[]), db.pantry().catch(()=>[]), db.plans().catch(()=>[]),
    ]);
  } catch(e){ return mount.replaceChildren(errorBlock(e, () => renderTrack(mount))); }

  const target = computeTargets(S.profile);
  const days = Object.entries(range);
  const logged = days.filter(([,d]) => d.items > 0);
  const avg = k => logged.length ? logged.reduce((s,[,d]) => s + d[k], 0) / logged.length : 0;
  const adherence = target?.kcal
    ? logged.filter(([,d]) => Math.abs(d.kcal - target.kcal) <= target.kcal*0.15).length
    : 0;

  /* badges — award anything newly earned */
  let planItemCount = 0;
  if (plans.length){
    try { planItemCount = (await db.planItems((plans.find(p=>p.is_active)||plans[0]).id)).length; }
    catch { planItemCount = 0; }
  }
  const earned = evaluateBadges({ streak, range, target, planItemCount, pantryCount: pantry.length });
  const have = new Set(achv.map(a => a.code));
  for (const code of earned) if (!have.has(code)) db.earn(code).catch(()=>{});
  const shown = new Set([...have, ...earned]);

  const page = el(`<div>
    <div class="page-h">
      <div><h1>Progress</h1>
        <p class="sub">${logged.length} of ${days.length} days logged${streak>=2?` · 🔥 ${streak}-day streak`:""}</p></div>
      <div class="chiprow">
        ${[7,30,90].map(n => `<button class="chip" data-span="${n}" aria-pressed="${span===n}">${n} days</button>`).join("")}
      </div>
    </div>

    <div class="card">
      <div class="row between mb"><h2>Daily averages</h2>${estimateTag}</div>
      ${logged.length ? `<div class="grid g5">
        <div class="stat"><div class="v num">${n0(avg("kcal"))}</div><div class="k">kcal${target?` / ${n0(target.kcal)}`:""}</div></div>
        <div class="stat"><div class="v num" style="color:var(--protein)">${n0(avg("protein"))}g</div><div class="k">Protein${target?` / ${n0(target.protein)}`:""}</div></div>
        <div class="stat"><div class="v num" style="color:var(--carb)">${n0(avg("carb"))}g</div><div class="k">Carbs</div></div>
        <div class="stat"><div class="v num" style="color:var(--fat)">${n0(avg("fat"))}g</div><div class="k">Fat</div></div>
        <div class="stat"><div class="v num" style="color:var(--fiber)">${n0(avg("fiber"))}g</div><div class="k">Fibre</div></div>
      </div>
      <div class="grid g3 mt">
        <div class="stat"><div class="v num" style="color:var(--water)">${n1(avg("water")/1000)}L</div><div class="k">Water a day</div></div>
        <div class="stat"><div class="v num">${logged.length}/${days.length}</div><div class="k">Days logged</div></div>
        <div class="stat"><div class="v num">${target ? adherence : "—"}</div><div class="k">Days near target</div></div>
      </div>` : `<p class="note">Log a few days and your averages appear here.</p>`}
    </div>

    <div class="card">
      <h2 class="mb">Calories, last ${span} days</h2>
      <div id="kcalchart"></div>
    </div>

    <div class="card">
      <div class="row between mb"><h2>Weight</h2>
        <button class="btn sm" id="addw">Log weight</button></div>
      <div id="weight"></div>
    </div>

    <div class="card">
      <h2 class="mb">Badges</h2>
      <div class="grid g2" id="badges"></div>
      <p class="note mt">Earned from things you've already done. Nothing here changes your targets.</p>
    </div>
  </div>`);

  $$("[data-span]", page).forEach(b => b.onclick = () => { span = +b.dataset.span; renderTrack(mount); });

  /* calorie chart */
  const goal = target?.kcal || 2000;
  const max = Math.max(goal * 1.3, ...days.map(([,d]) => d.kcal), 1);
  const showLabels = days.length <= 14;
  $("#kcalchart", page).innerHTML = `<div class="trend">${days.map(([iso,d]) => {
    const h = Math.max(d.kcal / max * 100, d.kcal > 0 ? 3 : 1.2);
    const col = d.kcal === 0 ? "var(--surface-3)"
      : d.kcal > goal*1.12 ? "var(--fat)"
      : d.kcal < goal*0.65 ? "var(--fiber)" : "var(--protein)";
    return `<div class="b" title="${iso}: ${n0(d.kcal)} kcal">
      ${showLabels ? `<span class="num" style="font-size:10.5px;color:var(--muted)">${d.kcal?n0(d.kcal):""}</span>` : ""}
      <i style="height:${h}%;background:${col}"></i>
      ${showLabels ? `<span style="font-size:10.5px;color:var(--faint)">${new Date(iso+"T12:00:00").toLocaleDateString(undefined,{weekday:"narrow"})}</span>` : ""}
    </div>`;
  }).join("")}</div>
  <p class="note mt">Green sits within about 12% of your ${n0(goal)} kcal target.
    One day off means very little — the shape of the run is what matters.</p>`;

  /* weight */
  const wHost = $("#weight", page);
  if (!weights.length){
    wHost.innerHTML = `<p class="note">No weigh-ins yet. Weigh yourself at the same time of day —
      first thing, after the loo, before eating — so the numbers are comparable.</p>`;
  } else {
    const sorted = [...weights].sort((a,b) => a.log_date.localeCompare(b.log_date));
    const start = sorted[0], now = sorted[sorted.length-1];
    const change = n1(now.weight_kg - start.weight_kg);
    const goalW = S.profile?.target_weight_kg;
    const b = bmi({ ...S.profile, weight_kg: now.weight_kg });
    const wMin = Math.min(...sorted.map(s=>+s.weight_kg)), wMax = Math.max(...sorted.map(s=>+s.weight_kg));
    const spread = Math.max(wMax - wMin, 1);
    wHost.innerHTML = `
      <div class="grid g4 mb">
        <div class="stat"><div class="v num">${n1(start.weight_kg)}</div><div class="k">Started</div></div>
        <div class="stat"><div class="v num">${n1(now.weight_kg)}</div><div class="k">Now</div></div>
        <div class="stat"><div class="v num" style="color:${change<0?"var(--protein)":change>0?"var(--carb)":"inherit"}">${change>0?"+":""}${change}</div><div class="k">Change (kg)</div></div>
        <div class="stat"><div class="v num">${goalW ? n1(goalW) : "—"}</div><div class="k">Goal</div></div>
      </div>
      <div class="trend" style="height:96px">${sorted.slice(-30).map(s => {
        const h = 20 + ((+s.weight_kg - wMin) / spread) * 70;
        return `<div class="b" title="${s.log_date}: ${s.weight_kg} kg">
          <i style="height:${h}%;background:var(--carb)"></i></div>`;
      }).join("")}</div>
      <p class="note mt">${sorted.length} weigh-in${sorted.length===1?"":"s"} since ${esc(start.log_date)}.
        Weight swings a kilo or two day to day from water and food volume alone — read the trend, not the point.</p>`;
  }
  $("#addw", page).onclick = () => openWeightSheet(() => renderTrack(mount));

  /* badges */
  $("#badges", page).innerHTML = BADGES.map(b => `<div class="badge ${shown.has(b.code)?"on":""}"
    style="${shown.has(b.code)?"":"opacity:.5"}">
    <span class="e">${b.emoji}</span>
    <span><b>${esc(b.name)}</b><span>${shown.has(b.code) ? "Earned" : esc(b.hint)}</span></span></div>`).join("");

  mount.replaceChildren(page);
}

function openWeightSheet(onSaved){
  const body = el(`<div>
    <div id="msg"></div>
    <div class="grid g2">
      <div class="field"><label for="w-kg">Weight (kg)</label>
        <input id="w-kg" type="number" step="0.1" min="20" max="400"
          value="${S.profile?.weight_kg || ""}" autofocus></div>
      <div class="field"><label for="w-d">Date</label>
        <input id="w-d" type="date" value="${todayISO()}" max="${todayISO()}"></div>
    </div>
    <div class="field"><label for="w-n">Note (optional)</label>
      <input id="w-n" placeholder="After a heavy weekend"></div>
    <button class="btn wide" id="save">Save weigh-in</button>
    <p class="note mt">Saving today's weight also updates the weight on your profile,
      so your calorie target stays current.</p>
  </div>`);
  const { close } = sheet({ title:"Log your weight", body });

  $("#save", body).onclick = async () => {
    const kg = Number($("#w-kg", body).value);
    const d  = $("#w-d", body).value || todayISO();
    if (!(kg >= 20 && kg <= 400))
      return $("#msg", body).innerHTML = `<div class="msg err">Enter a weight between 20 and 400 kg.</div>`;
    const btn = $("#save", body); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try {
      await db.addWeight(kg, d, $("#w-n", body).value.trim() || null);
      if (d === todayISO()) S.profile = await db.saveProfile({ weight_kg: kg });
      toast("Saved"); close(); onSaved();
    } catch(e){
      $("#msg", body).innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
      btn.disabled = false; btn.textContent = "Save weigh-in";
    }
  };
}
