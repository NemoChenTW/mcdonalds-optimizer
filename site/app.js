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
// Merge original categories into display groups. Each item appears once.
// Items are assigned to the first group where they're encountered.
// Price uses the minimum across all occurrences. Combos data is merged.
function buildCatalog() {
  const GROUPS = [
    { key: "main", label: "主餐", cats: ["main_menu", "premium_menu", "new_menu"] },
    { key: "breakfast", label: "早餐", cats: ["breakfast_combos_v2", "breakfast_singles", "breakfast_platters"] },
    { key: "limited", label: "期間限定", cats: ["limited_seasonal", "limited_cny", "limited_flash", "new_items"] },
    { key: "sides", label: "點心", cats: ["sides", "nugget_combos", "breakfast_sides", "salad"] },
    { key: "drinks", label: "飲料", cats: ["drinks", "mccafe"] },
    { key: "sharing", label: "分享盒", cats: ["sharing_box"] },
    { key: "happy", label: "兒童餐", cats: ["happy_meal"] },
    { key: "delivery", label: "歡樂送", cats: ["breakfast_combos"] },
  ];

  itemCatalog = {};
  displayGroups = [];
  const cats = menuData.categories;

  for (const group of GROUPS) {
    const groupItems = [];

    for (const catKey of group.cats) {
      if (!cats[catKey]) continue;
      for (const item of (cats[catKey].items || [])) {
        const nk = normName(item.name);
        const cleanName = item.name.replace(/鷄/g, "雞").replace(/\.$/, "");

        if (!itemCatalog[nk]) {
          const entry = { name: cleanName, price: item.price, combos: item.combos || null };
          itemCatalog[nk] = entry;
          groupItems.push(entry);
        } else {
          // Duplicate: keep lower price, merge combos
          if (item.price < itemCatalog[nk].price) {
            itemCatalog[nk].price = item.price;
          }
          if (item.combos && !itemCatalog[nk].combos) {
            itemCatalog[nk].combos = item.combos;
          }
        }
      }
    }

    if (groupItems.length > 0) {
      displayGroups.push({ key: group.key, label: group.label, items: groupItems });
    }
  }
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
          <div class="upgrade-cost">+$${extraCost} → ${r.label}</div>
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
