// --- State ---
let menuData = null;
let promoData = null;
let couponData = null;
let selected = {}; // { displayName: quantity }
let activeGroup = null;
let itemCatalog = {}; // normName -> { name, price, combos }
let displayGroups = []; // [{ key, label, items: [{name, price, combos}] }]

// Normalize name for dedup (same logic as optimizer.js)
function normName(s) {
  return s.replace(/鷄/g, "雞").replace(/\s+/g, "").replace(/\.$/g, "");
}

// Escape string for use in onclick single-quoted attribute
function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// --- Data Loading ---
async function loadData() {
  const [menuResp, promoResp, couponResp] = await Promise.all([
    fetch("data/menu.json"),
    fetch("data/promotions.json"),
    fetch("data/coupons.json"),
  ]);
  menuData = await menuResp.json();
  promoData = await promoResp.json();
  couponData = await couponResp.json();
  buildCatalog();
  renderCategories();
}

// --- Build deduplicated item catalog ---
// Pass 1: Deduplicate items across all categories, track source categories.
// Pass 2: Classify each item by name keywords into type-based display groups.
// Pass 3: Sort within each group so similar items are adjacent.
function buildCatalog() {
  itemCatalog = {};
  const cats = menuData.categories;
  const catKeys = Object.keys(cats).filter(k => k !== "combo_tiers");

  // Pass 1: Deduplicate
  for (const catKey of catKeys) {
    for (const item of (cats[catKey].items || [])) {
      const nk = normName(item.name);
      const cleanName = item.name.replace(/鷄/g, "雞").replace(/\.$/, "");

      if (!itemCatalog[nk]) {
        itemCatalog[nk] = {
          name: cleanName, price: item.price,
          combos: item.combos || null, srcCats: [catKey],
        };
      } else {
        if (item.price < itemCatalog[nk].price) itemCatalog[nk].price = item.price;
        if (item.combos && !itemCatalog[nk].combos) itemCatalog[nk].combos = item.combos;
        if (!itemCatalog[nk].srcCats.includes(catKey)) itemCatalog[nk].srcCats.push(catKey);
      }
    }
  }

  // Pass 2: Classify by item type
  const BREAKFAST_CATS = new Set([
    "breakfast_combos_v2", "breakfast_singles", "breakfast_platters",
    "breakfast_sides", "breakfast_combos",
  ]);
  const DRINK_KW = ["可樂", "雪碧", "紅茶", "綠茶", "咖啡", "那堤", "奶茶",
    "柳丁", "鮮乳", "鮮奶", "奶昔", "檸檬", "蜂蜜", "卡布奇諾", "濃縮", "礦泉水"];

  const groups = {
    burger: [], chicken: [], breakfast: [], sides: [], drinks: [],
    sharing: [], happy: [], delivery: [],
  };

  for (const item of Object.values(itemCatalog)) {
    const n = normName(item.name);
    const src = item.srcCats;
    const onlyBreakfast = src.every(c => BREAKFAST_CATS.has(c));
    const onlyDelivery = src.every(c => c === "breakfast_combos");

    let g;
    if (onlyDelivery) g = "delivery";
    else if (n.includes("分享盒") || n.includes("分享餐") || src.includes("sharing_box")) g = "sharing";
    else if (src.includes("happy_meal")) g = "happy";
    // Breakfast platters that contain chicken keywords (before chicken check)
    else if (onlyBreakfast && (n.includes("鬆餅") || n.includes("早餐") || n.includes("餐盤"))) g = "breakfast";
    // 炸雞雞塊
    else if (n.includes("雞塊") || n.includes("雞翅") ||
             ((n.includes("雞腿") || n.includes("辣雞")) && !n.includes("堡")) ||
             n.includes("炸雞") || n.includes("BHC")) g = "chicken";
    // Breakfast-specific burgers (滿福堡, 蛋堡, 焙果 — always breakfast, even from limited categories)
    else if (n.includes("滿福堡") || n.includes("蛋堡") || n.includes("焙果")) g = "breakfast";
    // 漢堡
    else if (n.includes("大麥克") || n.includes("麥香雞") || n.includes("麥香魚") || n.includes("堡"))
      g = onlyBreakfast ? "breakfast" : "burger";
    else if (onlyBreakfast) g = "breakfast";
    else if (DRINK_KW.some(k => n.includes(k)) || src.some(c => c === "drinks")) g = "drinks";
    else g = "sides";

    groups[g].push(item);
  }

  // Pass 3: Sort by name, then by price
  for (const items of Object.values(groups)) {
    items.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "zh-TW");
      return cmp !== 0 ? cmp : a.price - b.price;
    });
  }

  // Build displayGroups
  const GROUP_META = [
    { key: "burger", label: "漢堡" },
    { key: "chicken", label: "炸雞雞塊" },
    { key: "breakfast", label: "早餐" },
    { key: "sides", label: "點心" },
    { key: "drinks", label: "飲料" },
    { key: "sharing", label: "分享盒" },
    { key: "happy", label: "兒童餐" },
    { key: "delivery", label: "歡樂送" },
  ];

  displayGroups = GROUP_META
    .filter(g => groups[g.key].length > 0)
    .map(g => ({ key: g.key, label: g.label, items: groups[g.key] }));
}

// --- Rendering ---
function renderCategories() {
  const tabs = document.getElementById("categoryTabs");

  tabs.innerHTML = displayGroups.map(g =>
    `<button class="category-tab" data-cat="${g.key}" onclick="selectCategory('${g.key}')">${g.label}</button>`
  ).join("");

  if (displayGroups.length > 0) selectCategory(displayGroups[0].key);
}

function selectCategory(key) {
  activeGroup = key;
  document.querySelectorAll(".category-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.cat === key);
  });
  renderMenu(key);
}

function renderMenu(groupKey) {
  const group = displayGroups.find(g => g.key === groupKey);
  if (!group) return;

  const section = document.getElementById("menuSection");
  section.innerHTML = `<div class="menu-grid">${group.items.map(item => {
    const qty = selected[item.name] || 0;
    const isSelected = qty > 0;
    return `
      <div class="menu-item ${isSelected ? 'selected' : ''}">
        <div class="item-info" onclick="addItem('${esc(item.name)}')">
          <div class="item-name">${item.name}</div>
          <div class="item-price">$${item.price}</div>
        </div>
        ${isSelected ? `
          <div class="item-qty">
            <button class="qty-btn" onclick="changeQty('${esc(item.name)}', -1)">−</button>
            <span class="qty-num">${qty}</span>
            <button class="qty-btn" onclick="changeQty('${esc(item.name)}', 1)">+</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join("")}</div>`;
}

// --- Selection ---
function addItem(name) {
  if (!selected[name]) selected[name] = 1;
  renderMenu(activeGroup);
  renderSelectionBar();
}

function changeQty(name, delta) {
  selected[name] = (selected[name] || 0) + delta;
  if (selected[name] <= 0) delete selected[name];
  renderMenu(activeGroup);
  renderSelectionBar();
}

function renderSelectionBar() {
  const bar = document.getElementById("selectionBar");
  const list = document.getElementById("selectedList");
  const entries = Object.entries(selected);

  bar.classList.toggle("visible", entries.length > 0);

  list.innerHTML = entries.map(([name, qty]) =>
    `<span class="selected-tag">
      <button class="qty-btn" onclick="changeQty('${esc(name)}', -1)">−</button>
      <span class="tag-label">${name} x${qty}</span>
      <button class="qty-btn" onclick="changeQty('${esc(name)}', 1)">+</button>
    </span>`
  ).join("");
}

function clearAll() {
  selected = {};
  document.getElementById("results").innerHTML = "";
  renderMenu(activeGroup);
  renderSelectionBar();
}

// --- Optimization ---
function optimize() {
  const entries = Object.entries(selected);
  if (entries.length === 0) return;

  const order = entries.map(([name, qty]) => {
    const nk = normName(name);
    const item = itemCatalog[nk];
    return { name: item.name, price: item.price, quantity: qty, combos: item.combos || null };
  });

  const results = findBestCombinations(order, menuData, promoData, couponData);
  renderResults(results, order);
  document.getElementById("results").scrollIntoView({ behavior: "smooth" });
}

function renderResults(results, order) {
  const container = document.getElementById("results");
  const singleTotal = order.reduce((sum, o) => sum + o.price * o.quantity, 0);

  if (results.length === 0) {
    container.innerHTML = `
      <div class="result-card">
        <div class="result-header">
          <span class="result-label">單點全部</span>
          <span class="result-price">$${singleTotal}</span>
        </div>
        <ul class="result-steps">
          ${order.map(o => `<li>${o.name} x${o.quantity} — $${o.price * o.quantity}</li>`).join("")}
        </ul>
      </div>
    `;
    return;
  }

  results.sort((a, b) => a.totalPrice - b.totalPrice);
  const bestPrice = results[0].totalPrice;

  const exactResults = results.filter(r => !r.isUpgrade);
  const upgradeResults = results.filter(r => r.isUpgrade);

  let html = "";

  const baselineHtml = `
    <div class="result-card">
      <div class="result-header">
        <span class="result-label">全部單點</span>
        <span class="result-price">$${singleTotal}</span>
      </div>
      <ul class="result-steps">
        ${order.map(o => `<li>${o.name} x${o.quantity} — $${o.price * o.quantity}</li>`).join("")}
      </ul>
    </div>
  `;

  exactResults.forEach((r, i) => {
    const isBest = r.totalPrice === bestPrice;
    const savings = singleTotal - r.totalPrice;
    html += `
      <div class="result-card ${isBest ? 'best' : ''}">
        <div class="result-header">
          <div>
            <span class="result-label">${r.label}</span>
            ${isBest ? '<span class="result-badge">最便宜</span>' : ''}
            ${r.needsSplit ? '<span class="result-badge split">需拆單</span>' : ''}
          </div>
          <span class="result-price">$${r.totalPrice}</span>
        </div>
        <ul class="result-steps">
          ${r.steps.map(s => `<li>${s}</li>`).join("")}
        </ul>
        ${savings > 0 ? `<div class="result-savings">比單點省 $${savings}</div>` : ''}
      </div>
    `;
  });

  if (bestPrice < singleTotal) {
    html += baselineHtml;
  } else {
    html = baselineHtml + html;
  }

  if (upgradeResults.length > 0) {
    html += `<div class="upgrade-section"><h3>多花一點，多拿一些</h3>`;
    upgradeResults.forEach(r => {
      const baseline = exactResults.length > 0 ? bestPrice : singleTotal;
      const extraCost = r.totalPrice - baseline;
      html += `
        <div class="upgrade-card">
          <div class="upgrade-cost">+$${extraCost} → ${r.label}${r.needsSplit ? ' <span class="result-badge split">需拆單</span>' : ''}</div>
          <div class="upgrade-extras">總計 $${r.totalPrice}</div>
          <ul class="result-steps">
            ${r.steps.map(s => `<li>${s}</li>`).join("")}
          </ul>
          ${r.extras ? `<div class="result-extras">額外獲得：${r.extras}</div>` : ''}
        </div>
      `;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

// --- Init ---
loadData();
