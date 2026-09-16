/* FitMeal India — core
   Config, shared state, formatting, nutrition maths, UI primitives. */

/* ---- connection ---------------------------------------------------
   The anon key is meant to live in the browser; row level security is
   what protects the data. Never put the service_role key here.        */
export const SUPABASE_URL  = "https://rvikragvitbclbfkbhdf.supabase.co";
export const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2aWtyYWd2aXRiY2xiZmtiaGRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTg2NzQsImV4cCI6MjEwNTEzNDY3NH0.hv2QE8ddKT2laq0IH4JOmpmrI5_DigDE_CvgQhVosNU";

export let sb = null;
export function initClient(){
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return sb;
}

/* ---- shared state ---- */
export const S = {
  route: "home",
  user: null,
  profile: null,
  date: todayISO(),
  planDay: (new Date().getDay() + 6) % 7,
  plan: null,
  streak: 0,
};

/* ---- constants ---- */
export const MEALS = [
  { id:"breakfast", label:"Breakfast", defaultTime:"08:00", share:0.25 },
  { id:"lunch",     label:"Lunch",     defaultTime:"13:30", share:0.35 },
  { id:"snack",     label:"Snacks",    defaultTime:"17:30", share:0.12 },
  { id:"dinner",    label:"Dinner",    defaultTime:"20:30", share:0.28 },
];
export const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
export const DAYS_LONG = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
export const CATS = ["bread","rice","dal","sabzi","curry","breakfast","snack","street",
  "sweet","dairy","beverage","fruit","vegetable","nuts","protein","pantry","condiment","fat"];

export const DIETS = [
  { id:"veg",    label:"Vegetarian",     tag:"vegetarian" },
  { id:"vegan",  label:"Vegan",          tag:"vegan" },
  { id:"jain",   label:"Jain",           tag:"jain" },
  { id:"egg",    label:"Eggetarian",     tag:"egg" },
  { id:"nonveg", label:"Non-vegetarian", tag:null },
];
export const APPLIANCES = [
  { id:"gas",     label:"Gas stove" },
  { id:"induction",label:"Induction" },
  { id:"microwave",label:"Microwave" },
  { id:"otg",     label:"OTG / oven" },
  { id:"airfryer",label:"Air fryer" },
  { id:"kettle",  label:"Electric kettle" },
  { id:"fridge",  label:"Refrigerator" },
  { id:"none",    label:"No cooking equipment" },
];
export const ACTIVITY = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, very_active:1.9 };

/* ---- DOM helpers ---- */
export const $  = (s, r=document) => r.querySelector(s);
export const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
export const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const cap = (s) => String(s||"").charAt(0).toUpperCase() + String(s||"").slice(1);
export const n0 = (x) => Math.round(Number(x)||0);
export const n1 = (x) => Math.round((Number(x)||0)*10)/10;
export const clamp = (x,a,b) => Math.min(Math.max(x,a),b);

/* ---- dates ---- */
export function todayISO(d = new Date()){
  return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
export function shiftDate(iso, days){
  const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate()+days); return todayISO(d);
}
export function dowOf(iso){ return (new Date(iso+"T12:00:00").getDay() + 6) % 7; }
export function prettyDate(iso){
  if (iso === todayISO()) return "Today";
  if (iso === shiftDate(todayISO(),-1)) return "Yesterday";
  if (iso === shiftDate(todayISO(), 1)) return "Tomorrow";
  return new Date(iso+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"});
}
export function longDate(iso){
  return new Date(iso+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"});
}

/* ---- nutrition maths ---- */
export function scale(food, grams){
  const f = (Number(grams)||0)/100;
  return {
    kcal:(food.kcal||0)*f, protein:(food.protein_g||0)*f, carb:(food.carb_g||0)*f,
    fiber:(food.fiber_g||0)*f, fat:(food.fat_g||0)*f, sugar:(food.sugar_g||0)*f,
    sodium:(food.sodium_mg||0)*f, cost:(food.cost_per_100g||0)*f,
  };
}
export const EMPTY = () => ({kcal:0,protein:0,carb:0,fiber:0,fat:0,sugar:0,sodium:0,cost:0});
export function sumRows(rows){
  const t = EMPTY();
  for (const r of rows||[]){
    if (!r.food) continue;
    const s = scale(r.food, r.qty_g);
    for (const k in t) t[k] += s[k];
  }
  return t;
}

/* Mifflin-St Jeor. Returns null until we have enough to compute honestly. */
export function computeTargets(p){
  if (!p) return null;
  if (p.target_kcal && p.target_protein && p.target_carb && p.target_fat)
    return { kcal:+p.target_kcal, protein:+p.target_protein, carb:+p.target_carb,
             fat:+p.target_fat, fiber:30, auto:false };
  if (!p.height_cm || !p.weight_kg || !p.birth_year || !p.sex) return null;

  const age = new Date().getFullYear() - p.birth_year;
  const w = +p.weight_kg, h = +p.height_cm;
  const bmr = 10*w + 6.25*h - 5*age + (p.sex==="male" ? 5 : p.sex==="female" ? -161 : -78);
  let kcal = bmr * (ACTIVITY[p.activity_level] || 1.375);

  if (p.goal === "lose")       kcal -= 400;
  else if (p.goal === "gain")  kcal += 350;
  else if (p.goal === "muscle")kcal += 250;

  // Hard floor. We will not hand anyone a dangerous target.
  kcal = Math.max(kcal, p.sex === "male" ? 1500 : 1200);

  const protein = Math.round(w * (p.goal === "lose" || p.goal === "muscle" ? 1.6 : 1.4));
  const fat     = Math.round((kcal * 0.27) / 9);
  const carb    = Math.round(Math.max((kcal - protein*4 - fat*9) / 4, 60));
  return { kcal:Math.round(kcal/10)*10, protein, carb, fat, fiber:30, auto:true, bmr:Math.round(bmr) };
}

export function bmi(p){
  if (!p?.height_cm || !p?.weight_kg) return null;
  return n1(p.weight_kg / Math.pow(p.height_cm/100, 2));
}

/* Diet tag the planner and filters should apply for a given preference */
export function dietTagFor(diet){
  return (DIETS.find(d => d.id === diet) || {}).tag || null;
}

/* ---- icons ---- */
export const I = {
  home:   '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/></svg>',
  meals:  '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.4"/></svg>',
  kitchen:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 8.5 6.5 3.5h11L20 8.5"/><path d="M9.5 13h5"/></svg>',
  track:  '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V10M9.3 19V5M14.7 19v-6M20 19V8"/></svg>',
  me:     '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20c1.4-3.7 4.2-5.5 7.5-5.5s6.1 1.8 7.5 5.5"/></svg>',
  x:      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  plusL:  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  left:   '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right:  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>',
  tick:   '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 9.5 17.5 19.5 7"/></svg>',
  swap:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/></svg>',
  lock:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></svg>',
  spark:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9L4.5 10.8 10.2 9z"/></svg>',
};

/* ---- toast ---- */
export function toast(msg, kind=""){
  $$(".toast").forEach(t => t.remove());
  const t = el(`<div class="toast" role="status">${esc(msg)}</div>`);
  if (kind === "err") t.style.borderColor = "rgba(226,104,75,.5)";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

/* ---- bottom sheet / modal ---- */
export function sheet({ title, body, wide }){
  const scrim = el(`<div class="scrim"><div class="sheet" role="dialog" aria-modal="true"
    ${wide?'style="max-width:720px"':""}>
    <div class="sheet-h"><h2>${esc(title)}</h2>
      <button class="x" data-close aria-label="Close">${I.x}</button></div>
    <div class="sheet-body"></div></div></div>`);
  const close = () => { scrim.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  scrim.onclick = (e) => { if (e.target === scrim) close(); };
  $("[data-close]", scrim).onclick = close;
  document.addEventListener("keydown", onKey);
  const host = $(".sheet-body", scrim);
  if (typeof body === "string") host.innerHTML = body; else if (body) host.appendChild(body);
  document.body.appendChild(scrim);
  return { scrim, host, close };
}

/* ---- common blocks ---- */
export function loadingBlock(label="Loading"){
  return el(`<div class="loading"><span class="spin"></span>${esc(label)}</div>`);
}
export function errorBlock(e, retry){
  const v = el(`<div class="card"><div class="msg err" style="margin:0">
    ${esc(e?.message || String(e) || "Something went wrong.")}</div>
    <div class="row mt"><button class="btn ghost sm" data-retry>Try again</button></div>
    <p class="note mt">If this mentions a missing table or column, run <code>db/03_schema_v2.sql</code>
      in the Supabase SQL editor.</p></div>`);
  $("[data-retry]", v).onclick = () => retry ? retry() : location.reload();
  return v;
}
export function emptyBlock({ title, body, action, onAction }){
  const v = el(`<div class="card"><div class="empty"><b>${esc(title)}</b>${esc(body)}
    ${action ? `<div class="mt"><button class="btn" data-a>${esc(action)}</button></div>` : ""}
  </div></div>`);
  if (action) $("[data-a]", v).onclick = onAction;
  return v;
}
export const estimateTag = `<span class="est" title="Nutrition values are estimates">EST</span>`;

/* ---- the thali ring ---- */
export function thaliRing(t, target){
  const R = 82, C = 2*Math.PI*R;
  const eaten = t.kcal, goal = target?.kcal || 2000;
  const pct = Math.min(eaten/goal, 1);
  const from = { carb:t.carb*4, protein:t.protein*4, fat:t.fat*9 };
  const total = from.carb + from.protein + from.fat || 1;
  let off = 0;
  const arcs = [["carb","var(--carb)"],["protein","var(--protein)"],["fat","var(--fat)"]].map(([k,col])=>{
    const share = (from[k]/total)*pct;
    const s = `<circle cx="95" cy="95" r="${R}" fill="none" stroke="${col}" stroke-width="15"
      stroke-dasharray="${(share*C).toFixed(1)} ${C.toFixed(1)}"
      stroke-dashoffset="${(-off*C).toFixed(1)}"/>`;
    off += share; return s;
  }).join("");
  const over = eaten > goal;
  return `<div class="ring">
    <svg viewBox="0 0 190 190" aria-hidden="true">
      <circle cx="95" cy="95" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="15"/>
      <circle cx="95" cy="95" r="${R-13}" fill="none" stroke="var(--line)" stroke-width="1"/>
      ${arcs}
    </svg>
    <div class="ring-mid">
      <div class="big num">${n0(over ? eaten-goal : goal-eaten)}</div>
      <div class="lab">kcal ${over ? "over" : "left"}</div>
      <div class="lab num" style="color:var(--faint)">${n0(eaten)} of ${n0(goal)}</div>
    </div></div>`;
}

export function macroBars(t, target){
  const rows = [
    ["Protein", t.protein, target?.protein, "var(--protein)"],
    ["Carbs",   t.carb,    target?.carb,    "var(--carb)"],
    ["Fat",     t.fat,     target?.fat,     "var(--fat)"],
    ["Fibre",   t.fiber,   target?.fiber || 30, "var(--fiber)"],
  ];
  return `<div class="macros">${rows.map(([label,val,goal,col])=>{
    const pct = goal ? Math.min(val/goal*100,100) : 0;
    return `<div><div class="macro-lab"><span>${label}</span>
      <span class="num"><b>${n0(val)}</b>${goal?` / ${n0(goal)}`:""} g</span></div>
      <div class="bar"><i style="width:${pct}%;background:${col}"></i></div></div>`;
  }).join("")}</div>`;
}

/* Format a quantity against a food's default serving */
export function fmtQty(grams, food){
  const servings = grams / (food.serving_g || 100);
  const s = servings % 1 === 0 ? servings : n1(servings);
  return `${s} × ${food.serving_desc} · ${n0(grams)} g`;
}
