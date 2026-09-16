/* FitMeal India — router, auth and shell */

import { $, $$, el, esc, S, I, sb, initClient, toast, loadingBlock } from "./core.js";
import { db, bust } from "./db.js";
import { renderOnboarding } from "./pages/onboarding.js";
import { renderHome, currentMeal } from "./pages/home.js";
import { renderMeals } from "./pages/meals.js";
import { renderKitchen } from "./pages/kitchen.js";
import { renderTrack } from "./pages/track.js";
import { renderMe } from "./pages/me.js";
import { openFoodPicker } from "./pickers.js";

const ROUTES = {
  home:    { label:"Home",    icon:"home",    render: renderHome },
  meals:   { label:"Meals",   icon:"meals",   render: renderMeals },
  kitchen: { label:"Kitchen", icon:"kitchen", render: renderKitchen },
  track:   { label:"Track",   icon:"track",   render: renderTrack },
  me:      { label:"Me",      icon:"me",      render: renderMe },
};

export function go(route){
  if (route === "onboarding"){ location.hash = "#/onboarding"; return; }
  location.hash = "#/" + route;
}
function routeFromHash(){
  const r = (location.hash || "").replace(/^#\/?/, "").split("/")[0];
  return ROUTES[r] ? r : (r === "onboarding" ? "onboarding" : "home");
}

/* ---------------- auth ---------------- */
let authMode = "in";
function renderAuth(){
  const v = el(`<div class="ob-wrap" style="justify-content:center">
    <div class="brand" style="text-align:center;padding:0;font-size:34px">Fit<span>Meal</span> India</div>
    <p class="sub" style="text-align:center;margin-bottom:24px">
      Plan Indian meals around your goal, and track what you actually eat.</p>
    <div class="card">
      <div class="seg mb">
        <button data-m="in" aria-pressed="${authMode==="in"}">Sign in</button>
        <button data-m="up" aria-pressed="${authMode==="up"}">Create account</button>
      </div>
      <div id="msg"></div>
      <form id="f">
        <div class="field ${authMode==="up"?"":"hide"}"><label for="dn">Name</label>
          <input id="dn" autocomplete="name" placeholder="What should we call you?"></div>
        <div class="field"><label for="em">Email</label>
          <input id="em" type="email" autocomplete="email" required placeholder="you@example.com"></div>
        <div class="field"><label for="pw">Password</label>
          <input id="pw" type="password" required minlength="8"
            autocomplete="${authMode==="up"?"new-password":"current-password"}" placeholder="At least 8 characters"></div>
        <button class="btn wide" type="submit" id="go">${authMode==="up"?"Create account":"Sign in"}</button>
      </form>
    </div>
    <p class="note mt" style="text-align:center">FitMeal India gives nutrition estimates, not medical
      advice. For a health condition, pregnancy, or a big change to how you eat, talk to a doctor
      or a registered dietitian.</p>
  </div>`);

  $$("[data-m]", v).forEach(b => b.onclick = () => { authMode = b.dataset.m; paint(); });

  $("#f", v).onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#go", v), msg = $("#msg", v);
    const email = $("#em", v).value.trim(), password = $("#pw", v).value;
    btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try {
      if (authMode === "up"){
        const display_name = $("#dn", v).value.trim() || email.split("@")[0];
        const { data, error } = await sb.auth.signUp({ email, password, options:{ data:{ display_name } } });
        if (error) throw error;
        if (!data.session){
          msg.innerHTML = `<div class="msg ok">Account created. Check your email for the
            confirmation link, then sign in.</div>`;
          authMode = "in"; paint(); return;
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch(err){
      msg.innerHTML = `<div class="msg err">${esc(err.message || "That didn't work. Try again.")}</div>`;
      btn.disabled = false; btn.textContent = authMode === "up" ? "Create account" : "Sign in";
    }
  };
  return v;
}

/* ---------------- shell ---------------- */
function navButton(id, active){
  const r = ROUTES[id];
  const b = el(`<button class="navbtn" ${active===id?'aria-current="page"':""}>
    ${I[r.icon]}<span>${r.label}</span></button>`);
  b.onclick = () => go(id);
  return b;
}

function renderShell(route){
  const shell = el(`<div class="shell">
    <nav class="rail" aria-label="Main">
      <div class="brand">Fit<span>Meal</span> India<small>PLAN · COOK · TRACK</small></div>
    </nav>
    <main id="main" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Main"></nav>
    <button class="fab" id="fab" aria-label="Log food">${I.plusL}</button>
  </div>`);

  const rail = $(".rail", shell), tabs = $(".tabbar", shell);
  for (const id of Object.keys(ROUTES)){
    rail.appendChild(navButton(id, route));
    tabs.appendChild(navButton(id, route));
  }
  const foot = el(`<div class="rail-foot">
    <div class="who">${esc(S.profile?.display_name || S.user.email)}</div>
    <button class="navbtn" id="out"><span>Sign out</span></button></div>`);
  $("#out", foot).onclick = async () => { await sb.auth.signOut(); location.reload(); };
  rail.appendChild(foot);

  $("#fab", shell).onclick = () => openFoodPicker({
    meal: currentMeal(),
    onPick: async (food, grams) => {
      await db.addLog(food.id, currentMeal(), grams, S.date);
      toast("Logged");
      if (routeFromHash() === "home") paint(); else go("home");
    },
  });
  return shell;
}

/* ---------------- paint ---------------- */
let painting = false;
export async function paint(){
  if (painting) return;
  painting = true;
  const app = $("#app");
  try {
    if (!S.user){ app.replaceChildren(renderAuth()); return; }

    const route = routeFromHash();
    const needsOnboarding = !S.profile?.onboarded_at;
    if (route === "onboarding" || needsOnboarding){
      renderOnboarding(app, () => { location.hash = "#/home"; paint(); });
      return;
    }
    const shell = renderShell(route);
    app.replaceChildren(shell);
    const main = $("#main", shell);
    main.replaceChildren(loadingBlock());
    await ROUTES[route].render(main);
  } catch(e){
    console.error(e);
    toast(e.message || "Something went wrong", "err");
  } finally { painting = false; }
}

/* ---------------- boot ---------------- */
(async function boot(){
  try { initClient(); }
  catch(e){
    $("#app").innerHTML = `<div class="ob-wrap"><div class="card"><div class="msg err">
      Couldn't reach Supabase. Check the URL and anon key in <code>js/core.js</code>.</div></div></div>`;
    return;
  }

  const { data:{ session } } = await sb.auth.getSession();
  S.user = session?.user || null;
  if (S.user){
    try { S.profile = await db.profile(); }
    catch(e){ console.warn("profile load failed", e); }
  }
  if (!location.hash) location.hash = "#/home";
  await paint();

  window.addEventListener("hashchange", paint);

  sb.auth.onAuthStateChange(async (evt, sess) => {
    const was = S.user?.id;
    S.user = sess?.user || null;
    if (S.user && S.user.id !== was){
      bust();
      try { S.profile = await db.profile(); } catch(e){ console.warn(e); }
      location.hash = "#/home";
    }
    if (!S.user){ S.profile = null; bust(); }
    await paint();
  });
})();
