/* FitMeal India — My Kitchen
   Pantry with expiry and low-stock warnings, plus saved grocery lists. */

import { $, $$, el, esc, n0, n1, S, I, todayISO, toast, loadingBlock, errorBlock,
         sheet, emptyBlock, estimateTag, cap } from "../core.js";
import { db } from "../db.js";
import { openFoodPicker } from "../pickers.js";

const PANTRY_CATS = ["Vegetables","Fruits","Grains & pulses","Dairy","Protein",
                     "Nuts & seeds","Spices & condiments","Oils & fats","Beverages","Other"];
const UNITS = ["g","kg","ml","L","piece","packet"];

let tab = "pantry";

export async function renderKitchen(mount){
  mount.replaceChildren(loadingBlock("Opening your kitchen"));
  let pantry, lists;
  try { [pantry, lists] = await Promise.all([db.pantry(), db.groceryLists()]); }
  catch(e){ return mount.replaceChildren(errorBlock(e, () => renderKitchen(mount))); }

  const expiring = pantry.filter(p => p.expires_on &&
    p.expires_on <= todayISO(new Date(Date.now() + 3*864e5)));
  const low = pantry.filter(p => p.low_at != null && Number(p.qty) <= Number(p.low_at));

  const page = el(`<div>
    <div class="page-h">
      <div><h1>My kitchen</h1>
        <p class="sub">${pantry.length} item${pantry.length===1?"":"s"} in stock${lists.length ? ` · ${lists.length} shopping list${lists.length===1?"":"s"}` : ""}</p></div>
      <div class="row wrap">
        <button class="btn ghost sm" id="addfree">Add item</button>
        <button class="btn sm" id="addfood">Add from food list</button>
      </div>
    </div>

    <div class="seg mb" style="max-width:340px">
      <button data-tab="pantry"  aria-pressed="${tab==="pantry"}">Pantry</button>
      <button data-tab="grocery" aria-pressed="${tab==="grocery"}">Shopping lists</button>
    </div>

    ${expiring.length ? `<div class="card tight"><div class="msg warn" style="margin:0;
      background:rgba(233,164,38,.11);border:1px solid rgba(233,164,38,.4);color:var(--carb)">
      ${expiring.length} item${expiring.length===1?"":"s"} expiring within three days:
      ${esc(expiring.map(e => e.name).join(", "))}</div></div>` : ""}
    ${low.length ? `<div class="card tight"><div class="msg info" style="margin:0">
      Running low: ${esc(low.map(e => e.name).join(", "))}</div></div>` : ""}

    <div id="body" class="mt"></div>
  </div>`);

  $$("[data-tab]", page).forEach(b => b.onclick = () => { tab = b.dataset.tab; renderKitchen(mount); });
  $("#addfree", page).onclick = () => openPantryEditor(null, () => renderKitchen(mount));
  $("#addfood", page).onclick = () => openFoodPicker({
    title:"Add to my kitchen",
    onPick: async (food, grams) => {
      await db.addPantry({ food_id:food.id, name:food.name, qty:grams, unit:"g",
        category: aisleFor(food.category) });
      toast(`${food.name} added to your kitchen`);
      renderKitchen(mount);
    },
  });

  const body = $("#body", page);
  if (tab === "pantry") renderPantry(body, pantry, mount);
  else renderGrocery(body, lists, mount);

  mount.replaceChildren(page);
}

function aisleFor(cat){
  const M = { vegetable:"Vegetables", sabzi:"Vegetables", fruit:"Fruits",
    dal:"Grains & pulses", rice:"Grains & pulses", pantry:"Grains & pulses", bread:"Grains & pulses",
    dairy:"Dairy", protein:"Protein", curry:"Protein", nuts:"Nuts & seeds",
    fat:"Oils & fats", condiment:"Spices & condiments", beverage:"Beverages" };
  return M[cat] || "Other";
}

/* ---------------- pantry ---------------- */
function renderPantry(host, pantry, mount){
  if (!pantry.length){
    return host.replaceChildren(emptyBlock({
      title:"Nothing in your kitchen yet",
      body:"Add what you actually have. FitMeal uses it to suggest swaps you can cook tonight without shopping.",
      action:"Add your first item",
      onAction:() => openPantryEditor(null, () => renderKitchen(mount)),
    }));
  }
  const search = el(`<input type="search" placeholder="Search your kitchen" class="mb">`);
  const list = el(`<div></div>`);
  const draw = (q="") => {
    const rows = pantry.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()));
    if (!rows.length) return list.innerHTML = `<div class="empty">Nothing matches that.</div>`;
    const groups = {};
    for (const p of rows) (groups[p.category || "Other"] ||= []).push(p);
    list.replaceChildren(...Object.entries(groups).map(([g, items]) => {
      const sec = el(`<div class="card"><h2 class="mb">${esc(g)}</h2><div class="rows"></div></div>`);
      $(".rows", sec).replaceChildren(...items.map(p => {
        const isLow = p.low_at != null && Number(p.qty) <= Number(p.low_at);
        const exp = p.expires_on;
        const soon = exp && exp <= todayISO(new Date(Date.now() + 3*864e5));
        const row = el(`<div class="item" style="padding-left:0;padding-right:0">
          <div class="item-main">
            <div class="item-name">${esc(p.name)}
              ${isLow ? `<span class="pill" style="color:var(--carb)">low</span>` : ""}</div>
            <div class="item-meta num">${n1(p.qty)} ${esc(p.unit)}${exp
              ? ` · ${soon ? "expires" : "use by"} ${esc(exp)}` : ""}</div>
          </div>
          <button class="chip sm" data-minus>−</button>
          <button class="chip sm" data-plus>+</button>
          <button class="x" data-edit aria-label="Edit ${esc(p.name)}">${I.swap}</button>
          <button class="x" data-del aria-label="Remove ${esc(p.name)}">${I.x}</button>
        </div>`);
        const step = p.unit === "g" || p.unit === "ml" ? 50 : 1;
        $("[data-plus]",  row).onclick = async () => { await db.updatePantry(p.id,{qty:Number(p.qty)+step}); renderKitchen(mount); };
        $("[data-minus]", row).onclick = async () => {
          const q = Math.max(Number(p.qty)-step, 0);
          await db.updatePantry(p.id,{qty:q}); renderKitchen(mount);
        };
        $("[data-edit]", row).onclick = () => openPantryEditor(p, () => renderKitchen(mount));
        $("[data-del]",  row).onclick = async () => { await db.delPantry(p.id); toast("Removed"); renderKitchen(mount); };
        return row;
      }));
      return sec;
    }));
  };
  search.oninput = e => draw(e.target.value.trim());
  host.replaceChildren(search, list);
  draw();
}

function openPantryEditor(item, onSaved){
  const body = el(`<div>
    <div id="msg"></div>
    <div class="field"><label for="p-name">Item</label>
      <input id="p-name" value="${esc(item?.name || "")}" placeholder="Paneer"></div>
    <div class="grid g3">
      <div class="field"><label for="p-qty">Quantity</label>
        <input id="p-qty" type="number" step="0.1" min="0" value="${item?.qty ?? 200}"></div>
      <div class="field"><label for="p-unit">Unit</label><select id="p-unit">
        ${UNITS.map(u => `<option ${item?.unit===u?"selected":""}>${u}</option>`).join("")}</select></div>
      <div class="field"><label for="p-low">Warn below</label>
        <input id="p-low" type="number" step="0.1" min="0" value="${item?.low_at ?? ""}" placeholder="optional"></div>
    </div>
    <div class="grid g2">
      <div class="field"><label for="p-cat">Category</label><select id="p-cat">
        ${PANTRY_CATS.map(c => `<option ${item?.category===c?"selected":""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="p-exp">Use by</label>
        <input id="p-exp" type="date" value="${item?.expires_on || ""}"></div>
    </div>
    <button class="btn wide" id="save">${item ? "Save changes" : "Add to kitchen"}</button>
  </div>`);
  const { close } = sheet({ title: item ? "Edit item" : "Add to my kitchen", body });

  $("#save", body).onclick = async () => {
    const name = $("#p-name", body).value.trim();
    if (!name) return $("#msg", body).innerHTML = `<div class="msg err">Give the item a name.</div>`;
    const row = {
      name, qty: Number($("#p-qty", body).value) || 0,
      unit: $("#p-unit", body).value, category: $("#p-cat", body).value,
      low_at: $("#p-low", body).value === "" ? null : Number($("#p-low", body).value),
      expires_on: $("#p-exp", body).value || null,
    };
    const btn = $("#save", body); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try {
      item ? await db.updatePantry(item.id, row) : await db.addPantry(row);
      toast(item ? "Updated" : "Added"); close(); onSaved();
    } catch(e){
      $("#msg", body).innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
      btn.disabled = false; btn.textContent = "Save";
    }
  };
}

/* ---------------- grocery lists ---------------- */
function renderGrocery(host, lists, mount){
  if (!lists.length){
    return host.replaceChildren(emptyBlock({
      title:"No shopping lists yet",
      body:"Build a meal plan, then tap \u201cMake grocery list\u201d — quantities are worked out for you.",
      action:"Create an empty list",
      onAction: async () => { await db.createGroceryList("Shopping list"); renderKitchen(mount); },
    }));
  }
  const wrap = el(`<div></div>`);
  lists.forEach(l => {
    const card = el(`<div class="card">
      <div class="row between mb"><h2>${esc(l.name)}</h2>
        <button class="btn danger sm" data-del>Delete</button></div>
      <div class="rows"><div class="loading"><span class="spin"></span>Loading</div></div>
      <div class="row wrap mt">
        <button class="btn ghost sm" data-add>Add item</button>
        <button class="btn ghost sm" data-clear>Clear ticked</button>
        <span class="note" data-total></span>
      </div></div>`);
    $("[data-del]", card).onclick = async () => {
      if (!confirm(`Delete "${l.name}"?`)) return;
      await db.delGroceryList(l.id); renderKitchen(mount);
    };
    const rowsHost = $(".rows", card);

    const load = async () => {
      try {
        const items = await db.groceryItems(l.id);
        if (!items.length){ rowsHost.innerHTML = `<p class="note">Nothing on this list yet.</p>`; return; }
        const done = items.filter(i => i.checked || i.have_it).length;
        const cost = items.filter(i => !i.have_it).reduce((s,i) => s + Number(i.est_cost||0), 0);
        $("[data-total]", card).innerHTML =
          `${done} of ${items.length} done · about ₹${n0(cost)} to buy ${estimateTag}`;
        const groups = {};
        for (const i of items) (groups[i.category || "Other"] ||= []).push(i);
        rowsHost.replaceChildren(...Object.entries(groups).map(([g, gi]) => {
          const sec = el(`<div><h3 class="mb" style="margin-top:12px;color:var(--muted)">${esc(g)}</h3></div>`);
          gi.forEach(i => {
            const row = el(`<div class="item" style="padding-left:0;padding-right:0;opacity:${i.checked||i.have_it?.5:1}">
              <button class="chip sm" data-check aria-pressed="${i.checked}"
                aria-label="Mark ${esc(i.name)} bought">${i.checked ? I.tick : "&nbsp;&nbsp;"}</button>
              <div class="item-main">
                <div class="item-name" style="${i.checked?"text-decoration:line-through":""}">${esc(i.name)}</div>
                <div class="item-meta num">${i.qty ?? ""} ${esc(i.unit||"")}${i.est_cost?` · ₹${i.est_cost}`:""}${i.have_it?" · already have":""}</div>
              </div>
              <button class="chip sm" data-have aria-pressed="${i.have_it}">Have it</button>
              <button class="x" data-rm aria-label="Remove ${esc(i.name)}">${I.x}</button>
            </div>`);
            $("[data-check]", row).onclick = async () => { await db.updateGroceryItem(i.id,{checked:!i.checked}); load(); };
            $("[data-have]",  row).onclick = async () => { await db.updateGroceryItem(i.id,{have_it:!i.have_it}); load(); };
            $("[data-rm]",    row).onclick = async () => { await db.delGroceryItem(i.id); load(); };
            sec.appendChild(row);
          });
          return sec;
        }));
      } catch(e){ rowsHost.replaceChildren(errorBlock(e, load)); }
    };

    $("[data-add]", card).onclick = async () => {
      const name = prompt("Item name"); if (!name) return;
      const qty = prompt("Quantity (number only)", "1");
      await db.addGroceryItems([{ list_id:l.id, name:name.trim(),
        qty: Number(qty)||null, unit:"g", category:"Other" }]);
      load();
    };
    $("[data-clear]", card).onclick = async () => {
      const items = await db.groceryItems(l.id);
      const ticked = items.filter(i => i.checked);
      if (!ticked.length) return toast("Nothing ticked");
      await Promise.all(ticked.map(i => db.delGroceryItem(i.id)));
      toast(`Cleared ${ticked.length}`); load();
    };
    load();
    wrap.appendChild(card);
  });
  host.replaceChildren(wrap);
}
