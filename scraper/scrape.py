"""Scrape McDonald's Taiwan menu from cpok.tw → data/*.yaml"""
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


def fetch_tables() -> list[pd.DataFrame]:
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

def parse_main_menu(table: pd.DataFrame) -> list[dict]:
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


def parse_simple_menu(table: pd.DataFrame) -> list[dict]:
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


def parse_combo_tiers(table: pd.DataFrame) -> list[dict]:
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

    def extract_items(text: str) -> list[dict]:
        items = []
        # Two formats:
        #   "麥香鷄單點48元"  → name=麥香鷄, price=48
        #   "麥脆鷄腿1塊(原/辣味) (單點68元)" → name=麥脆鷄腿1塊(原/辣味), price=68
        # Format 1: name + 單點 + price
        for m in re.finditer(r"([\u4e00-\u9fffA-Za-z0-9]+(?:\([^)]*\))?)單點(\d+)元", text):
            items.append({"name": m.group(1), "price": int(m.group(2))})
        # Format 2: name + (單點price元) — with space before paren
        for m in re.finditer(r"([\u4e00-\u9fffA-Za-z0-9]+(?:\([^)]*\))?)\s+\(單點(\d+)元\)", text):
            items.append({"name": m.group(1), "price": int(m.group(2))})
        # Format 3: 【bracket items with price】
        for m in re.finditer(r"【([^】]+?)(\d+)元】", text):
            items.append({"name": m.group(1), "price": int(m.group(2))})
        return items

    def extract_names(text: str) -> list[str]:
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


# --- Main ---

TABLE_MAP = {
    0: ("limited_cny", "過年限定", parse_main_menu),
    1: ("limited_flash", "快閃限定", parse_main_menu),
    2: ("limited_seasonal", "期間限定", parse_main_menu),
    3: ("new_items", "新品", parse_simple_menu),
    4: ("breakfast_singles", "早餐單品", parse_main_menu),
    5: ("new_menu", "新菜單", parse_main_menu),
    8: ("combo_tiers", "套餐加價表", parse_combo_tiers),
    9: ("main_menu", "主餐菜單", parse_main_menu),
    10: ("premium_menu", "極選系列", parse_main_menu),
    11: ("salad", "沙拉", parse_main_menu),
    12: ("sharing_box", "分享盒", parse_simple_menu),
    13: ("nugget_combos", "雞塊套餐", parse_main_menu),
    14: ("sides", "點心", parse_simple_menu),
    15: ("happy_meal", "兒童餐", parse_simple_menu),
    18: ("breakfast_combos", "早餐套餐", parse_main_menu),
    19: ("breakfast_combos_v2", "早餐套餐v2", parse_main_menu),
    20: ("breakfast_platters", "早安餐盤", parse_main_menu),
    21: ("breakfast_sides", "早餐點心", parse_simple_menu),
    22: ("mccafe", "McCafé", parse_simple_menu),
    23: ("drinks", "飲料", parse_simple_menu),
}


def scrape() -> dict:
    tables = fetch_tables()
    print(f"Fetched {len(tables)} tables")

    categories = {}
    for idx, (key, label, parser) in TABLE_MAP.items():
        if idx < len(tables):
            items = parser(tables[idx])
            if items:
                categories[key] = {"label": label, "items": items}

    promotions = []
    if len(tables) > 6:
        promotions.append({
            "id": "one_plus_one_50",
            "type": "pick_combo",
            "name": "1+1=50",
            "price": 50,
            "groups": parse_one_plus_one(tables[6]),
        })
    if len(tables) > 7:
        promotions.append({
            "id": "one_plus_one_69",
            "type": "pick_combo",
            "name": "1+1=69 星級點",
            "price": 69,
            "groups": parse_one_plus_one(tables[7]),
        })

    return {"categories": categories, "promotions": promotions}


def save(data: dict):
    DATA_DIR.mkdir(exist_ok=True)

    menu_path = DATA_DIR / "menu.yaml"
    with open(menu_path, "w", encoding="utf-8") as f:
        yaml.dump(
            {"categories": data["categories"]},
            f, allow_unicode=True, default_flow_style=False, sort_keys=False,
        )
    print(f"  menu    → {menu_path}")

    promo_path = DATA_DIR / "promotions.yaml"
    with open(promo_path, "w", encoding="utf-8") as f:
        yaml.dump(
            {"promotions": data["promotions"]},
            f, allow_unicode=True, default_flow_style=False, sort_keys=False,
        )
    print(f"  promos  → {promo_path}")


if __name__ == "__main__":
    print("Scraping McDonald's Taiwan menu...")
    data = scrape()

    for key, cat in data["categories"].items():
        print(f"  {cat['label']}: {len(cat['items'])} items")
    print(f"  Promotions: {len(data['promotions'])}")

    save(data)
    print("Done!")
