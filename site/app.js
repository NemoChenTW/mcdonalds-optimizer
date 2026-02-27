// --- State ---
let menuData = null;
let promoData = null;
let selected = {}; // { itemKey: quantity }
let activeCategory = null;

// --- Data Loading ---
async function loadData() {
  const [menuResp, promoResp] = await Promise.all([
    fetch("data/menu.json"),
    fetch("data/promotions.json"),
  ]);
  menuData = await menuResp.json();
  promoData = await promoResp.json();
  renderCategories();
}

// --- Rendering ---
function renderCategories() {
  const tabs = document.getElementById("categoryTabs");
  const cats = menuData.categories;
  // Filter out combo_tiers (it's metadata, not orderable items)
  const catKeys = Object.keys(cats).filter(k => k !== "combo_tiers");

  tabs.innerHTML = catKeys.map(key => {
    const cat = cats[key];
    return `<button class="category-tab" data-cat="${key}" onclick="selectCategory('${key}')">${cat.label}</button>`;
  }).join("");

  // Select first category
  if (catKeys.length > 0) selectCategory(catKeys[0]);
}

function selectCategory(key) {
  activeCategory = key;
  // Update tab styles
  document.querySelectorAll(".category-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.cat === key);
  });
  renderMenu(key);
}

function renderMenu(catKey) {
  const section = document.getElementById("menuSection");
  const items = menuData.categories[catKey]?.items || [];

  section.innerHTML = `<div class="menu-grid">${items.map((item, idx) => {
    const itemKey = `${catKey}::${idx}`;
    const qty = selected[itemKey] || 0;
    const isSelected = qty > 0;
    return `
      <div class="menu-item ${isSelected ? 'selected' : ''}" data-key="${itemKey}">
        <div class="item-info" onclick="addItem('${itemKey}')">
          <div class="item-name">${item.name}</div>
          <div class="item-price">$${item.price}</div>
        </div>
        ${isSelected ? `
          <div class="item-qty">
            <button class="qty-btn" onclick="changeQty('${itemKey}', -1)">-</button>
            <span class="qty-num">${qty}</span>
            <button class="qty-btn" onclick="changeQty('${itemKey}', 1)">+</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join("")}</div>`;
}

// --- Selection ---
function addItem(itemKey) {
  if (!selected[itemKey]) {
    selected[itemKey] = 1;
  }
  renderMenu(activeCategory);
  renderSelectionBar();
}

function changeQty(itemKey, delta) {
  selected[itemKey] = (selected[itemKey] || 0) + delta;
  if (selected[itemKey] <= 0) delete selected[itemKey];
  renderMenu(activeCategory);
  renderSelectionBar();
}

function renderSelectionBar() {
  const bar = document.getElementById("selectionBar");
  const list = document.getElementById("selectedList");
  const entries = Object.entries(selected);

  bar.classList.toggle("visible", entries.length > 0);

  list.innerHTML = entries.map(([key, qty]) => {
    const item = getItemByKey(key);
    return `<span class="selected-tag">${item.name} x${qty}</span>`;
  }).join("");
}

function getItemByKey(key) {
  const [catKey, idx] = key.split("::");
  return menuData.categories[catKey].items[parseInt(idx)];
}

// --- Optimization ---
function optimize() {
  const entries = Object.entries(selected);
  if (entries.length === 0) return;

  // Build order list
  const order = entries.map(([key, qty]) => {
    const item = getItemByKey(key);
    return { name: item.name, price: item.price, quantity: qty, combos: item.combos || null };
  });

  const results = findBestCombinations(order, menuData, promoData);
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

  // Sort by total price
  results.sort((a, b) => a.totalPrice - b.totalPrice);
  const bestPrice = results[0].totalPrice;

  // Separate exact coverage from upgrades
  const exactResults = results.filter(r => !r.isUpgrade);
  const upgradeResults = results.filter(r => r.isUpgrade);

  let html = "";

  // Always show single-order as baseline
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

  // Exact coverage results
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

  // Show baseline if it's not the best
  if (bestPrice < singleTotal) {
    html += baselineHtml;
  } else {
    html = baselineHtml + html;
  }

  // Upgrade suggestions
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
