# -*- coding: utf-8 -*-
"""Builds 02_seed_foods.sql, foods.json and foods.csv from the dataset modules."""
import csv, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import data_a, data_b, data_c

GROUPS = []
for mod in (data_a, data_b, data_c):
    for attr in dir(mod):
        if attr.isupper() and isinstance(getattr(mod, attr), list):
            GROUPS.append(getattr(mod, attr))

COLS = ["name","name_local","category","region","is_veg","serving_desc","serving_g",
        "kcal","protein_g","carb_g","fiber_g","fat_g","sat_fat_g","sugar_g","sodium_mg"]

rows, seen = [], set()
for g in GROUPS:
    for r in g:
        assert len(r) == 15, f"bad row ({len(r)} cols): {r[0]}"
        key = r[0].strip().lower()
        if key in seen:
            print("  ! duplicate skipped:", r[0]); continue
        seen.add(key)
        rows.append(dict(zip(COLS, r)))

rows.sort(key=lambda r: (r["category"], r["name"]))

def q(v):
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "db")
os.makedirs(out, exist_ok=True)

with open(os.path.join(out, "02_seed_foods.sql"), "w", encoding="utf-8") as f:
    f.write("-- ============================================================\n")
    f.write("--  THALI — food database seed\n")
    f.write("--  02_seed_foods.sql | Run AFTER 01_schema.sql\n")
    f.write(f"--  {len(rows)} items. All nutrition values are per 100 g edible portion.\n")
    f.write("--  Sources: IFCT 2017 / NIN tables / composite recipe analysis.\n")
    f.write("--  Home-cooked dishes assume typical preparation — adjust for your kitchen.\n")
    f.write("-- ============================================================\n\n")
    f.write("insert into public.foods\n  (name, name_local, category, region, is_veg, serving_desc, serving_g,\n")
    f.write("   kcal, protein_g, carb_g, fiber_g, fat_g, sat_fat_g, sugar_g, sodium_mg)\nvalues\n")
    vals = []
    for r in rows:
        vals.append("  ({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})".format(
            q(r["name"]), q(r["name_local"]), q(r["category"]), q(r["region"]),
            "true" if r["is_veg"] else "false", q(r["serving_desc"]), r["serving_g"],
            r["kcal"], r["protein_g"], r["carb_g"], r["fiber_g"],
            r["fat_g"], r["sat_fat_g"], r["sugar_g"], r["sodium_mg"]))
    f.write(",\n".join(vals))
    f.write("\non conflict do nothing;\n")

with open(os.path.join(out, "foods.json"), "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=1)

with open(os.path.join(out, "foods.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=COLS)
    w.writeheader()
    for r in rows:
        w.writerow(r)

cats = {}
for r in rows:
    cats[r["category"]] = cats.get(r["category"], 0) + 1
print(f"{len(rows)} foods written")
for c, n in sorted(cats.items(), key=lambda x: -x[1]):
    print(f"  {c:<12} {n}")
