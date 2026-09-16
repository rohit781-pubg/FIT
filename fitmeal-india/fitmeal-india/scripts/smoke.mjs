/* FitMeal India — smoke test
   Renders every page and walks the main flows against a stubbed Supabase
   client, then tests the planner engine directly. */

import { JSDOM } from "jsdom";
import fs from "fs";

const raw = JSON.parse(fs.readFileSync(new URL("../db/foods.json", import.meta.url)));
const FOODS = raw.slice(0, 140).map((f, i) => ({
  id: "f" + i, ...f, source: "test", cost_per_100g: 15,
  diet_tags: f.is_veg ? ["vegetarian", "jain"] : ["nonveg"],
}));

const TODAY = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const USER = { id: "u1", email: "rohit@example.com" };
const PROFILE = {
  id:"u1", display_name:"Rohit", sex:"male", birth_year:1998, height_cm:174, weight_kg:70,
  activity_level:"moderate", goal:"lose", diet_type:"veg", household_size:2,
  water_target_ml:2500, appliances:["gas","airfryer"], allergies:[], dislikes:[],
  onboarded_at:"2026-01-01T00:00:00Z", daily_budget_inr:250,
};
const TABLES = {
  foods: FOODS,
  food_units: [{ id:"u0", food_id:"f0", label:"1 roti", grams:35, is_default:true },
               { id:"u1", food_id:"f0", label:"100 g", grams:100 }],
  profiles: [PROFILE],
  log_entries: [
    { id:"l1", meal:"breakfast", qty_g:70,  log_date:TODAY, food:FOODS[0] },
    { id:"l2", meal:"lunch",     qty_g:150, log_date:TODAY, food:FOODS[1] },
  ],
  plans: [{ id:"p1", user_id:"u1", name:"Weekday plan", is_active:true }],
  plan_items: [{ id:"pi1", day_of_week:0, meal:"lunch", qty_g:120, sort_order:0,
                 is_locked:false, food:FOODS[2] }],
  water_logs: [{ id:"w1", log_date:TODAY, ml:500 }],
  weight_logs: [{ user_id:"u1", log_date:"2026-08-01", weight_kg:73 },
                { user_id:"u1", log_date:TODAY, weight_kg:70 }],
  pantry_items: [{ id:"k1", user_id:"u1", name:"Paneer", qty:200, unit:"g",
                   category:"Dairy", food_id:"f3", expires_on:null, low_at:100 }],
  grocery_lists: [{ id:"g1", user_id:"u1", name:"Week shop" }],
  grocery_items: [{ id:"gi1", list_id:"g1", name:"Paneer", qty:500, unit:"g",
                    category:"Dairy", est_cost:120, checked:false, have_it:false }],
  achievements: [{ user_id:"u1", code:"first_log" }],
};

const writes = [];
function table(name){
  const rows = TABLES[name] || [];
  function chain(result){
    const c = { eq(){return c;}, select(){return c;},
      single: async () => ({ data: result[0] ?? null, error:null }),
      then: (res) => res({ data: result, error:null }) };
    return c;
  }
  const q = {
    select(){return q;}, eq(){return q;}, gte(){return q;}, lte(){return q;},
    or(){return q;}, contains(){return q;}, order(){return q;}, limit(){return q;},
    insert(v){ writes.push([name,"insert",v]); return chain(Array.isArray(v)?v:[v]); },
    update(v){ writes.push([name,"update",v]); return chain([{ ...rows[0], ...v }]); },
    upsert(v){ writes.push([name,"upsert",v]); return chain([{ ...PROFILE, ...v }]); },
    delete(){ writes.push([name,"delete"]); return chain([]); },
    maybeSingle: async () => ({ data: rows[0] ?? null, error:null }),
    single:      async () => ({ data: rows[0] ?? null, error:null }),
    then: (res) => res({ data: rows, error:null }),
  };
  return q;
}
const stub = {
  auth: { getSession: async () => ({ data:{ session:{ user:USER } } }),
          onAuthStateChange(){}, signOut: async () => ({}) },
  from: table,
  rpc: async (fn) => {
    if (fn === "day_summary") return { data:[{ kcal:900, protein:40, carb:110, fiber:12,
      fat:28, sugar:20, sodium:1400, items:2, water_ml:500, weight_kg:70 }], error:null };
    if (fn === "current_streak") return { data:9, error:null };
    return { data:null, error:null };
  },
};

const dom = new JSDOM(fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"),
  { url:"https://fitmealindia.netlify.app/", pretendToBeVisual:true });
const w = dom.window;
w.supabase = { createClient: () => stub };
global.window = w; global.document = w.document;
Object.defineProperty(global, "navigator", { value: w.navigator, configurable: true });
global.location = w.location;
global.HTMLElement = w.HTMLElement; global.Node = w.Node; global.Event = w.Event;
w.scrollTo = () => {}; w.confirm = () => true; w.prompt = (q,d) => d || "Test";

const errors = [];
w.addEventListener("error", e => errors.push("window: " + e.message));
process.on("unhandledRejection", r => errors.push("unhandled: " + (r?.message || r)));

const { paint } = await import("../js/app.js");
const wait = ms => new Promise(r => setTimeout(r, ms));
const $  = s => w.document.querySelector(s);
const $$ = s => [...w.document.querySelectorAll(s)];

const out = []; let failed = 0;
function check(label, cond, extra=""){
  if (!cond) failed++;
  out.push(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
}
async function goto(hash){
  w.location.hash = hash; await paint(); await wait(240);
  check(`route ${hash} renders`, !!$("main h1"), ($("main h1")?.textContent || "").slice(0,40));
}

await wait(500);

check("shell rendered", !!$(".shell"));
check("rail navigation", $$(".rail .navbtn").length === 6, $$(".rail .navbtn").length + " (5 + sign out)");
check("mobile tabbar", $$(".tabbar .navbtn").length === 5);
check("floating log button", !!$("#fab"));
check("thali ring drawn", $$(".ring svg circle").length >= 3);
check("four meal blocks", $$(".meal").length === 4, $$(".meal").length + " found");
check("logged item shown", ($(".item-name")?.textContent || "").length > 0, $(".item-name")?.textContent);
check("kcal figure numeric", /\d/.test($(".ring-mid .big")?.textContent || ""), $(".ring-mid .big")?.textContent);
check("water quick buttons", $$("[data-water]").length === 3);
check("quick actions", $$("#qa .stat").length === 6, $$("#qa .stat").length + " found");

$("[data-water='250']").click(); await wait(220);
check("water tap writes a row", writes.some(([t,op]) => t==="water_logs" && op==="insert"));

await goto("#/meals");
check("seven day tabs", $$(".daytab").length === 7);
check("plan meal blocks", $$(".meal").length === 4);
check("generate-week control", !!$("#genweek"));
check("lock + regenerate per meal", $$("[data-lock]").length === 4 && $$("[data-regen]").length === 4);

await goto("#/kitchen");
check("pantry item listed", w.document.body.textContent.includes("Paneer"));
check("kitchen tabs", $$("[data-tab]").length === 2);

await goto("#/track");
check("averages block", w.document.body.textContent.includes("Daily averages"));
check("calorie chart bars", $$("#kcalchart .b").length > 0, $$("#kcalchart .b").length + " bars");
check("badges rendered", $$("#badges .badge").length === 8, $$("#badges .badge").length);
check("weight trend shown", w.document.body.textContent.includes("Change (kg)"));

await goto("#/me");
check("targets computed", /\d{3,4}/.test($("#tgt")?.textContent || ""));
check("profile fields bound", $$("[data-f]").length >= 10, $$("[data-f]").length + " fields");
check("appliance chips", $$("[data-ap]").length === 8);
check("food browser populated", $$("#flist .frow").length > 0, $$("#flist .frow").length + " foods");

w.location.hash = "#/home"; await paint(); await wait(260);
$(".add-line button").click(); await wait(420);
check("food picker opens", !!$(".scrim .sheet"));
check("picker lists foods", $$(".scrim .frow").length > 0, $$(".scrim .frow").length + " rows");
$(".scrim .frow").click(); await wait(320);
check("portion sheet opens", $$(".scrim").length === 2);
const portion = $$(".scrim")[1];
check("portion preview computes", /\d/.test(portion.querySelector(".stat .v")?.textContent || ""));
check("multiple serving units", portion.querySelectorAll("#units .chip").length >= 2,
      portion.querySelectorAll("#units .chip").length + " units");
portion.querySelector("#ok").click(); await wait(320);
check("logging writes a row", writes.some(([t,op]) => t==="log_entries" && op==="insert"));

/* ---- engine ---- */
const eng  = await import("../js/engine.js");
const core = await import("../js/core.js");
const target = core.computeTargets(PROFILE);
check("target respects the floor", target.kcal >= 1500, target.kcal + " kcal");

const pool = FOODS.filter(f => f.is_veg);
const day = eng.generateDay({ pool, target, seed: 42 });
const rows = Object.values(day).flat();
check("planner fills four meals", Object.keys(day).length === 4);
check("planner produces items", rows.length >= 4, rows.length + " items");
const tot = eng.totalsOf(rows);
const off = Math.abs(tot.kcal - target.kcal) / target.kcal;
check("plan lands near calorie target", off < 0.22,
      `${Math.round(tot.kcal)} vs ${target.kcal} kcal, ${Math.round(off*100)}% off`);
check("plan supplies real protein", tot.protein > target.protein * 0.5,
      `${Math.round(tot.protein)}g vs ${target.protein}g`);
check("deterministic for a given seed",
  JSON.stringify(eng.generateDay({ pool, target, seed:42 }).lunch.map(x=>x.food.id)) ===
  JSON.stringify(day.lunch.map(x=>x.food.id)));
check("locked meals survive regeneration",
  JSON.stringify(eng.generateDay({ pool, target, seed:99, locked:{ lunch:day.lunch } }).lunch) ===
  JSON.stringify(day.lunch));

const base = FOODS[1], baseT = core.scale(base,150);
const sw = eng.findSwaps(base, 150, pool, "protein");
check("protein swaps really are higher protein",
  sw.every(s => s.totals.protein > baseT.protein), sw.length + " alternatives");
const swLow = eng.findSwaps(base, 150, pool, "calories");
check("lower-calorie swaps really are lower",
  swLow.every(s => s.totals.kcal < baseT.kcal), swLow.length + " alternatives");

const groc = eng.buildGroceryList([{ food:FOODS[0], qty_g:210 },{ food:FOODS[0], qty_g:140 }], { people:2 });
check("grocery aggregates duplicates", groc.length === 1 && groc[0].qty >= 700, JSON.stringify(groc[0]));

const pq = eng.parseQuery("high protein dinner under 400 calories ₹50");
check("smart search reads calories", pq.maxKcal === 400, JSON.stringify(pq));
check("smart search reads budget", pq.maxCost === 50);
check("smart search reads tags", pq.tags.includes("high_protein"));

const paneer = FOODS.find(f => /paneer/i.test(f.name));
check("dislikes exclude matching foods",
  !paneer || eng.isExcluded(paneer, { dislikes:["paneer"] }));
check("jain filter excludes onion and potato",
  !eng.applyQuery(FOODS.filter(f => /aloo|onion/i.test(f.name))
    .map(f => ({...f, diet_tags:["vegetarian"]})), { tags:["jain"], maxKcal:null,
    minProtein:null, maxCost:null }).length);

check("no uncaught errors", errors.length === 0, errors.slice(0,3).join(" | "));

console.log(out.join("\n"));
console.log(`\n${out.length - failed} of ${out.length} passed`);
process.exitCode = failed ? 1 : 0;
