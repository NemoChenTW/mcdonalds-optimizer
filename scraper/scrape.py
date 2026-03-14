"""Scrape McDonald's Taiwan menu from cpok.tw → data/*.yaml + site/data/*.json"""
import json
import re
from io import StringIO
from pathlib import Path
from typing import Optional

import pandas as pd
import requests
import yaml


URL = "https://cpok.tw/29621"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
DATA_DIR = Path(__file__).parent.parent / "data"
SITE_DATA_DIR = Path(__file__).parent.parent / "site" / "data"


def fetch_tables() -> list:
    resp = requests.get(URL, headers=HEADERS, timeout=30)
    resp.encoding = "utf-8"
    return pd.read_html(StringIO(resp.text))


def parse_price(text: str) -> Optional[int]:
    if not isinstance(text, str):
        return None
    m = re.search(r"\+?(\d+)元", text)
    return int(m.group(1)) if m else None


def clean_name(name: str) -> str:
    return re.sub(r"^(NEW|停售)\s*", "", name).strip()


# --- Table parsers ---

def parse_main_menu(table: pd.DataFrame) -> list:
    """Tables with: item | single price | combo A | combo B | ..."""
    items = []
    cols = table.columns.tolist()

    for _, row in table.iterrows():
        raw_name = str(row.iloc[0]).strip()
        if "停售" in raw_name or not raw_name or raw_name == "nan":
            continue

        name = clean_name(raw_name)
        price = parse_price(str(row.iloc[1]))
        if price is None:
            continue

        item = {"name": name, "price": price}

        combos = {}
        for col_idx in range(2, len(cols)):
            col_name = str(cols[col_idx])
            combo_price = parse_price(str(row.iloc[col_idx]))
            if combo_price:
                combo_match = re.search(r"([A-F])套餐", col_name)
                if combo_match:
                    combos[combo_match.group(1)] = combo_price
        if combos:
            item["combos"] = combos

        items.append(item)
    return items


def parse_simple_menu(table: pd.DataFrame) -> list:
    """Tables with: item | price."""
    items = []
    for _, row in table.iterrows():
        raw_name = str(row.iloc[0]).strip()
        if "停售" in raw_name or not raw_name or raw_name == "nan":
            continue
        name = clean_name(raw_name)
        price = parse_price(str(row.iloc[1]))
        if price is None:
            continue
        items.append({"name": name, "price": price})
    return items


def parse_combo_tiers(table: pd.DataFrame) -> list:
    """Combo add-on tier table (A經典配餐, B清爽配餐, etc.)."""
    tiers = []
    for _, row in table.iterrows():
        name = str(row.iloc[0]).strip()
        add_price = parse_price(str(row.iloc[1]))
        contents = str(row.iloc[2]).strip() if len(row) > 2 else ""
        if add_price:
            tiers.append({"name": name, "add_price": add_price, "contents": contents})
    return tiers


def parse_one_plus_one(table: pd.DataFrame) -> dict:
    """1+1 tables where items are crammed in single cells."""
    cell_a = str(table.iloc[0, 0])
    cell_b = str(table.iloc[0, 1])

    def extract_items(text: str) -> list:
        items = []
        for m in re.finditer(r"([\u4e00-\u9fffA-Za-z0-9]+(?:\([^)]*\))?)單點(\d+)元", text):
            items.append({"name": m.group(1), "price": int(m.group(2))})
        for m in re.finditer(r"([\u4e00-\u9fffA-Za-z0-9]+(?:\([^)]*\))?)\s+\(單點(\d+)元\)", text):
            items.append({"name": m.group(1), "price": int(m.group(2))})
        for m in re.finditer(r"【([^】]+?)(\d+)元】", text):
            items.append({"name": m.group(1), "price": int(m.group(2))})
        return items

    def extract_names(text: str) -> list:
        names = []
        for name in re.split(r"\s+", text):
            name = name.strip()
            if name and "元" not in name and "【" not in name and "】" not in name:
                names.append(name)
        return names

    return {
        "group_a": extract_items(cell_a),
        "group_b_priced": extract_items(cell_b),
        "group_b_names": extract_names(cell_b),
    }


# --- Header-based table matching (robust against index shifts) ---

# (header_keyword, secondary_col_keyword, category_key, label, parser)
HEADER_RULES = [
    ("過年", None, "limited_cny", "過年限定", parse_main_menu),
    ("快閃", None, "limited_flash", "快閃限定", parse_main_menu),
    ("期間限定", None, "limited_seasonal", "期間限定", parse_main_menu),
    ("新品", None, "new_items", "新品", parse_simple_menu),
    ("早餐菜單", None, "breakfast_singles", "早餐單品", parse_main_menu),
    ("新菜單", None, "new_menu", "新菜單", parse_main_menu),
    ("超值套餐", None, "combo_tiers", "套餐加價表", parse_combo_tiers),
    ("主餐菜單", None, "main_menu", "主餐菜單", parse_main_menu),
    ("極選系列", None, "premium_menu", "極選系列", parse_main_menu),
    ("沙拉菜單", None, "salad", "沙拉", parse_main_menu),
    ("分享盒", None, "sharing_box", "分享盒", parse_simple_menu),
    ("點心和拼盤", None, "sides", "點心", parse_simple_menu),
    ("Happy Meal", None, "happy_meal", "兒童餐", parse_simple_menu),
    ("深夜食堂", None, "late_night", "深夜食堂", parse_simple_menu),
    ("早餐套餐", "超值早餐", "breakfast_combos", "早餐套餐", parse_main_menu),
    ("早餐套餐", "指定飲料", "breakfast_combos_v2", "早餐套餐v2", parse_main_menu),
    ("早安餐盤", None, "breakfast_platters", "早安餐盤", parse_main_menu),
    ("點心品項", None, "breakfast_sides", "早餐點心", parse_simple_menu),
    ("McCafé", None, "mccafe", "McCafé", parse_simple_menu),
    ("飲料", None, "drinks", "飲料", parse_simple_menu),
]


def match_tables(tables):
    """Match tables to categories by header content instead of hardcoded index."""
    matched = {}  # key -> (index, table, label, parser)
    used = set()

    for keyword, secondary, key, label, parser in HEADER_RULES:
        for i, t in enumerate(tables):
            if i in used:
                continue
            col0 = str(t.columns[0])
            if keyword not in col0:
                continue
            if secondary:
                all_cols = " ".join(str(c) for c in t.columns)
                if secondary not in all_cols:
                    continue
            matched[key] = (i, t, label, parser)
            used.add(i)
            break

    # nugget_combos: header is just "主餐" (not "主餐菜單"), has combo columns
    for i, t in enumerate(tables):
        if i in used:
            continue
        col0 = str(t.columns[0]).strip()
        if col0 == "主餐" and len(t.columns) >= 5:
            matched["nugget_combos"] = (i, t, "雞塊套餐", parse_main_menu)
            used.add(i)
            break

    # 1+1 promotion tables
    promo_tables = {}
    for i, t in enumerate(tables):
        if i in used:
            continue
        col0 = str(t.columns[0])
        if "1+1=50" in col0:
            promo_tables["one_plus_one_50"] = (i, t)
            used.add(i)
        elif "69元" in col0:
            promo_tables["one_plus_one_69"] = (i, t)
            used.add(i)

    return matched, promo_tables, used


# --- Main ---

def scrape() -> dict:
    tables = fetch_tables()
    print(f"Fetched {len(tables)} tables")

    matched, promo_tables, used = match_tables(tables)

    # Report unmatched tables
    for i in range(len(tables)):
        if i not in used:
            col0 = str(tables[i].columns[0])
            print(f"  [skip] Table {i}: {col0}")

    # Load existing category metadata (e.g. valid_to) to preserve on re-scrape
    existing_meta = {}
    menu_yaml = DATA_DIR / "menu.yaml"
    if menu_yaml.exists():
        with open(menu_yaml, encoding="utf-8") as f:
            existing = yaml.safe_load(f)
        if existing and "categories" in existing:
            for k, v in existing["categories"].items():
                if "valid_to" in v:
                    existing_meta[k] = {"valid_to": str(v["valid_to"])}

    categories = {}
    for key, (idx, table, label, parser) in sorted(matched.items(), key=lambda x: x[1][0]):
        items = parser(table)
        if items:
            cat = {"label": label}
            if key in existing_meta:
                cat.update(existing_meta[key])
            cat["items"] = items
            categories[key] = cat
            print(f"  [{idx:2d}] {label}: {len(items)} items")

    promotions = []
    if "one_plus_one_50" in promo_tables:
        idx, t = promo_tables["one_plus_one_50"]
        promotions.append({
            "id": "one_plus_one_50",
            "type": "pick_combo",
            "name": "1+1=50",
            "price": 50,
            "groups": parse_one_plus_one(t),
        })
        print(f"  [{idx:2d}] 1+1=50")
    if "one_plus_one_69" in promo_tables:
        idx, t = promo_tables["one_plus_one_69"]
        promotions.append({
            "id": "one_plus_one_69",
            "type": "pick_combo",
            "name": "1+1=69 星級點",
            "price": 69,
            "groups": parse_one_plus_one(t),
        })
        print(f"  [{idx:2d}] 1+1=69")

    return {"categories": categories, "promotions": promotions}


def save(data: dict):
    DATA_DIR.mkdir(exist_ok=True)
    SITE_DATA_DIR.mkdir(exist_ok=True)

    menu = {"categories": data["categories"]}

    # --- Menu ---
    menu_yaml = DATA_DIR / "menu.yaml"
    with open(menu_yaml, "w", encoding="utf-8") as f:
        yaml.dump(menu, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    print(f"  menu    -> {menu_yaml}")

    menu_json = SITE_DATA_DIR / "menu.json"
    with open(menu_json, "w", encoding="utf-8") as f:
        json.dump(menu, f, ensure_ascii=False)
    print(f"  menu    -> {menu_json}")

    # --- Promotions: merge scraped 1+1 with manually-maintained entries ---
    promo_yaml = DATA_DIR / "promotions.yaml"
    scraped_promos = data["promotions"]
    scraped_ids = {p["id"] for p in scraped_promos}

    manual_promos = []
    if promo_yaml.exists():
        with open(promo_yaml, encoding="utf-8") as f:
            existing = yaml.safe_load(f)
        if existing and "promotions" in existing:
            for p in existing["promotions"]:
                if p.get("id") not in scraped_ids:
                    manual_promos.append(p)

    all_promos = scraped_promos + manual_promos
    promos = {"promotions": all_promos}

    with open(promo_yaml, "w", encoding="utf-8") as f:
        yaml.dump(promos, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    print(f"  promos  -> {promo_yaml}")

    promo_json = SITE_DATA_DIR / "promotions.json"
    with open(promo_json, "w", encoding="utf-8") as f:
        json.dump(promos, f, ensure_ascii=False)
    print(f"  promos  -> {promo_json}")


if __name__ == "__main__":
    print("Scraping McDonald's Taiwan menu...")
    data = scrape()
    print(f"  Promotions: {len(data['promotions'])}")
    save(data)
    print("Done!")
