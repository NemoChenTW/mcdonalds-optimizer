/**
 * McDonald's order optimizer.
 * Deal-based DFS search: generates all applicable deals, then finds the
 * cheapest combination that covers every item in the order.
 */

function findBestCombinations(order, menuData, promoData, couponData) {

  // === Utilities (unchanged) ===

  function norm(s) {
    return s.replace(/鷄/g, "雞").replace(/\s+/g, "").replace(/\.$/g, "");
  }

  function fuzzyMatch(orderName, promoName) {
    var a = norm(orderName);
    var b = norm(promoName);
    if (a === b) return true;
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
    var numMap = {"四": "4", "六": "6", "十": "10", "4": "4", "6": "6", "10": "10"};
    var nuggetA = a.match(/(?:(\S)塊)?麥克雞塊(?:\((\d+)塊\))?/);
    var nuggetB = b.match(/(?:(\S)塊)?麥克雞塊(?:\((\d+)塊\))?/);
    if (nuggetA && nuggetB) {
      var countA = numMap[nuggetA[1]] || nuggetA[2] || "";
      var countB = numMap[nuggetB[1]] || nuggetB[2] || "";
      if (countA && countB && countA === countB) return true;
    }
    return false;
  }

  var DRINK_KEYWORDS = ["可樂", "雪碧", "紅茶", "綠茶", "咖啡", "那堤", "奶茶", "柳丁", "鮮乳", "鮮奶", "奶昔"];

  function isDrink(name) {
    return DRINK_KEYWORDS.some(function(k) { return name.indexOf(k) >= 0; });
  }

  function matchesGroup(orderName, groupNames) {
    for (var i = 0; i < groupNames.length; i++) {
      if (fuzzyMatch(orderName, groupNames[i])) return true;
    }
    return false;
  }

  var TIER_CONTENTS = {
    A: { label: "A經典配餐", items: [
      { isFries: true, desc: "中薯" },
      { desc: "38元飲品", isDrink: true },
    ]},
    B: { label: "B清爽配餐", items: [
      { keywords: ["四季沙拉"], desc: "四季沙拉" },
      { desc: "38元飲品", isDrink: true },
    ]},
    C: { label: "C勁脆配餐", items: [
      { keywords: ["麥脆雞腿", "麥脆鷄腿", "麥脆雞", "麥脆鷄"], desc: "麥脆雞腿" },
      { desc: "38元飲品", isDrink: true },
    ]},
    D: { label: "D炫冰配餐", items: [
      { keywords: ["OREO冰炫風"], desc: "OREO冰炫風" },
      { isFries: true, desc: "小薯" },
      { desc: "38元飲品", isDrink: true },
    ]},
    E: { label: "E豪吃配餐", items: [
      { isNuggets: true, desc: "6塊麥克雞塊" },
      { isFries: true, desc: "小薯" },
      { desc: "38元飲品", isDrink: true },
    ]},
    F: { label: "F地瓜配餐", items: [
      { keywords: ["金黃地瓜條", "地瓜條"], desc: "金黃地瓜條" },
      { desc: "38元飲品", isDrink: true },
    ]},
  };

  function matchesTierItem(orderItemName, tierItem) {
    if (tierItem.isDrink) return isDrink(orderItemName);
    if (tierItem.isFries) return orderItemName.indexOf("薯條") >= 0;
    if (tierItem.isNuggets) return norm(orderItemName).indexOf("雞塊") >= 0;
    if (!tierItem.keywords) return false;
    return tierItem.keywords.some(function(k) { return orderItemName.indexOf(k) >= 0; });
  }

  function lookupMenuPrice(searchName) {
    var cats = menuData.categories;
    for (var catKey in cats) {
      if (catKey === "combo_tiers") continue;
      var items = cats[catKey].items || [];
      for (var i = 0; i < items.length; i++) {
        if (fuzzyMatch(searchName, items[i].name)) return items[i].price;
      }
    }
    return null;
  }

  function getMinDrinkPrice() {
    var minPrice = Infinity;
    var cats = menuData.categories;
    for (var catKey in cats) {
      if (catKey === "combo_tiers") continue;
      var items = cats[catKey].items || [];
      for (var i = 0; i < items.length; i++) {
        if (isDrink(items[i].name) && items[i].price < minPrice) {
          minPrice = items[i].price;
        }
      }
    }
    return minPrice === Infinity ? 0 : minPrice;
  }

  function tierItemRetailPrice(tierItem) {
    if (tierItem.isDrink) return getMinDrinkPrice();
    if (tierItem.isFries) return lookupMenuPrice(tierItem.desc === "中薯" ? "薯條(中)" : "薯條(小)") || 0;
    if (tierItem.isNuggets) return lookupMenuPrice("麥克雞塊(6塊)") || 0;
    if (tierItem.keywords && tierItem.keywords.length > 0) return lookupMenuPrice(tierItem.keywords[0]) || 0;
    return lookupMenuPrice(tierItem.desc) || 0;
  }

  // === Compute baseline ===

  var singleTotal = 0;
  for (var i = 0; i < order.length; i++) {
    singleTotal += order[i].price * order[i].quantity;
  }

  // Build flat unit array: remaining[i] = quantity of order[i]
  var remaining = [];
  for (var i = 0; i < order.length; i++) {
    remaining.push(order[i].quantity);
  }

  // ============================================================
  // Phase 1: Generate Deals
  // ============================================================

  var allDeals = [];

  // --- 1a. Single-item deals (fallback: buy one unit at menu price) ---
  function genSingleDeals() {
    for (var i = 0; i < order.length; i++) {
      allDeals.push({
        label: order[i].name + " 單點",
        cost: order[i].price,
        consumes: [i],
        steps: [order[i].name + " 單點 x1 — $" + order[i].price],
        extras: null,
        isUpgrade: false,
        needsSplit: false,
        strategyType: "single"
      });
    }
  }

  // --- 1b. BOGO coupon deals (A01-A11) ---
  function genBogoCouponDeals() {
    var coupons = (couponData && couponData.coupons) || [];
    for (var ci = 0; ci < coupons.length; ci++) {
      var coupon = coupons[ci];
      if (coupon.type !== "bogo") continue;

      for (var oi = 0; oi < order.length; oi++) {
        if (!fuzzyMatch(order[oi].name, coupon.item)) continue;
        if (order[oi].quantity < 2) continue;

        // One deal covers 2 units of the same item
        allDeals.push({
          label: coupon.name + "（" + coupon.code + "）",
          cost: coupon.price,
          consumes: [oi, oi],
          steps: [coupon.name + "（" + coupon.code + "）x1 — $" + coupon.price],
          extras: null,
          isUpgrade: false,
          needsSplit: false,
          strategyType: "bogo_coupon"
        });
      }
    }
  }

  // --- 1c. Fixed bundle coupon deals (B12-F41) ---
  function genFixedBundleDeals() {
    var coupons = (couponData && couponData.coupons) || [];
    for (var ci = 0; ci < coupons.length; ci++) {
      var coupon = coupons[ci];
      if (coupon.type !== "fixed_bundle") continue;

      var bundleItems = coupon.items;

      // Try to match each bundle slot to an order item
      // We need to find which order indices this bundle can consume
      // Use greedy matching with backtracking-lite: try all assignments
      var slotMatches = []; // slotMatches[s] = list of order indices that can fill slot s
      for (var s = 0; s < bundleItems.length; s++) {
        var slot = bundleItems[s];
        var isDrinkSlot = typeof slot === "string" && slot.indexOf("drink:") === 0;
        var drinkMax = isDrinkSlot ? parseInt(slot.split(":")[1]) : 0;
        var matches = [];
        for (var oi = 0; oi < order.length; oi++) {
          if (isDrinkSlot) {
            if (isDrink(order[oi].name) && order[oi].price <= drinkMax) {
              matches.push(oi);
            }
          } else {
            if (fuzzyMatch(order[oi].name, slot)) {
              matches.push(oi);
            }
          }
        }
        slotMatches.push(matches);
      }

      // Greedily assign: for each slot, pick first available order index
      // that still has remaining units. Try to maximize matched count.
      var consumes = [];
      var used = []; // track how many units of each order index are used
      for (var oi = 0; oi < order.length; oi++) used.push(0);

      var matchedCount = 0;
      var extras = [];
      for (var s = 0; s < bundleItems.length; s++) {
        var found = false;
        for (var m = 0; m < slotMatches[s].length; m++) {
          var oi = slotMatches[s][m];
          if (used[oi] < order[oi].quantity) {
            consumes.push(oi);
            used[oi]++;
            matchedCount++;
            found = true;
            break;
          }
        }
        if (!found) {
          // This bundle slot isn't covered by order — it's an extra
          extras.push(bundleItems[s]);
        }
      }

      if (matchedCount < 2) continue;

      var coveredNames = [];
      for (var c = 0; c < consumes.length; c++) {
        coveredNames.push(order[consumes[c]].name);
      }
      var extrasStr = extras.length > 0 ? extras.join("、") : null;

      allDeals.push({
        label: coupon.name + "（" + coupon.code + "）",
        cost: coupon.price,
        consumes: consumes,
        steps: [coupon.name + "（" + coupon.code + "）— $" + coupon.price + "（含" + coveredNames.join("+") + "）"],
        extras: extrasStr,
        isUpgrade: false,
        needsSplit: false,
        strategyType: "fixed_bundle"
      });
    }
  }

  // --- 1d. 1+1 deals ---
  function genOneOneDeals() {
    var promotions = (promoData && promoData.promotions) || [];
    for (var pi = 0; pi < promotions.length; pi++) {
      var promo = promotions[pi];
      if (promo.type !== "pick_combo") continue;

      var groupANames = promo.groups.group_a.map(function(i) { return i.name; });
      var groupBNames = (promo.groups.group_b_priced || []).map(function(i) { return i.name; })
        .concat(promo.groups.group_b_names || []);

      // For each A item × B item pair in the order, emit a deal
      for (var ai = 0; ai < order.length; ai++) {
        if (!matchesGroup(order[ai].name, groupANames)) continue;
        for (var bi = 0; bi < order.length; bi++) {
          if (bi === ai) continue;
          if (!matchesGroup(order[bi].name, groupBNames) && !isDrink(order[bi].name)) continue;

          allDeals.push({
            label: promo.name,
            cost: promo.price,
            consumes: [ai, bi],
            steps: [promo.name + "（" + order[ai].name + " + " + order[bi].name + "）— $" + promo.price],
            extras: null,
            isUpgrade: false,
            needsSplit: false,
            strategyType: "one_one"
          });
        }
      }
    }
  }

  // --- 1e. Sweetheart card deals ---
  function genSweetheartDeals() {
    var promotions = (promoData && promoData.promotions) || [];
    for (var pi = 0; pi < promotions.length; pi++) {
      var promo = promotions[pi];
      if (promo.type !== "buy_a_get_b_free") continue;

      var groupANames = promo.group_a.map(function(i) { return i.name; });
      var groupBNames = promo.group_b.map(function(i) { return i.name; });

      // For each A item × B item pair in the order
      for (var ai = 0; ai < order.length; ai++) {
        if (!matchesGroup(order[ai].name, groupANames)) continue;
        for (var bi = 0; bi < order.length; bi++) {
          if (bi === ai) continue;
          if (!matchesGroup(order[bi].name, groupBNames)) continue;

          // Cost = A's price (B is free)
          allDeals.push({
            label: "甜心卡",
            cost: order[ai].price,
            consumes: [ai, bi],
            steps: [
              order[ai].name + " — $" + order[ai].price + "（甜心卡 A 群）",
              order[bi].name + " — 免費（甜心卡）"
            ],
            extras: null,
            isUpgrade: false,
            needsSplit: false,
            strategyType: "sweetheart",
            sweetA: ai,
            sweetB: bi
          });
        }

        // A can also pair with itself if it's in both groups
        if (matchesGroup(order[ai].name, groupBNames) && order[ai].quantity >= 2) {
          allDeals.push({
            label: "甜心卡",
            cost: order[ai].price,
            consumes: [ai, ai],
            steps: [
              order[ai].name + " — $" + order[ai].price + "（甜心卡 A 群）",
              order[ai].name + " — 免費（甜心卡）"
            ],
            extras: null,
            isUpgrade: false,
            needsSplit: false,
            strategyType: "sweetheart",
            sweetA: ai,
            sweetB: ai
          });
        }
      }

      // Small drink → medium upgrade via sweetheart card
      // e.g. 雪碧(小) can upgrade to 雪碧(中) (group A) and pair with a group B item for free
      for (var ai = 0; ai < order.length; ai++) {
        var oName = order[ai].name;
        if (matchesGroup(oName, groupANames)) continue;
        if (oName.indexOf("(小)") < 0) continue;

        var medName = oName.replace("(小)", "(中)");
        var medGroupA = null;
        for (var g = 0; g < promo.group_a.length; g++) {
          if (fuzzyMatch(medName, promo.group_a[g].name)) {
            medGroupA = promo.group_a[g];
            break;
          }
        }
        if (!medGroupA) continue;

        // Pair upgraded drink with each group B item in order
        for (var bi = 0; bi < order.length; bi++) {
          if (bi === ai) continue;
          if (!matchesGroup(order[bi].name, groupBNames)) continue;

          allDeals.push({
            label: "甜心卡",
            cost: medGroupA.price,
            consumes: [ai, bi],
            steps: [
              medGroupA.name + " — $" + medGroupA.price + "（甜心卡 A 群，" + oName + " 升級）",
              order[bi].name + " — 免費（甜心卡）"
            ],
            extras: null,
            isUpgrade: false,
            needsSplit: false,
            strategyType: "sweetheart",
            sweetA: ai,
            sweetB: bi
          });
        }

        // Self-pairing: medium version in both groups, qty >= 2
        if (matchesGroup(medGroupA.name, groupBNames) && order[ai].quantity >= 2) {
          allDeals.push({
            label: "甜心卡",
            cost: medGroupA.price,
            consumes: [ai, ai],
            steps: [
              medGroupA.name + " — $" + medGroupA.price + "（甜心卡 A 群，" + oName + " 升級）",
              medGroupA.name + " — 免費（甜心卡，" + oName + " 升級）"
            ],
            extras: null,
            isUpgrade: false,
            needsSplit: false,
            strategyType: "sweetheart",
            sweetA: ai,
            sweetB: ai
          });
        }
      }
    }
  }

  // --- 1f. Combo meal deals ---
  function genComboDeals() {
    for (var mi = 0; mi < order.length; mi++) {
      if (!order[mi].combos) continue;
      var mainItem = order[mi];
      var tierKeys = Object.keys(mainItem.combos);

      for (var ti = 0; ti < tierKeys.length; ti++) {
        var tier = tierKeys[ti];
        var comboPrice = mainItem.combos[tier];
        var tierDef = TIER_CONTENTS[tier];
        if (!tierDef) continue;

        // Try to match tier side items to order items
        // For each tier item, find which order indices can fill it
        var tierSlotOptions = [];
        for (var t = 0; t < tierDef.items.length; t++) {
          var options = [];
          for (var oi = 0; oi < order.length; oi++) {
            if (oi === mi) continue;
            if (matchesTierItem(order[oi].name, tierDef.items[t])) {
              options.push(oi);
            }
          }
          tierSlotOptions.push(options);
        }

        // Greedy assignment of tier slots
        var consumes = [mi]; // main item always consumed
        var usedForTier = {};
        var coveredDescs = tierDef.items.map(function(t) { return t.desc; });
        var extraDescs = [];

        for (var t = 0; t < tierDef.items.length; t++) {
          var found = false;
          for (var o = 0; o < tierSlotOptions[t].length; o++) {
            var oi = tierSlotOptions[t][o];
            var usedCount = usedForTier[oi] || 0;
            if (usedCount < order[oi].quantity) {
              consumes.push(oi);
              usedForTier[oi] = usedCount + 1;
              found = true;
              break;
            }
          }
          if (!found) {
            extraDescs.push(tierDef.items[t].desc);
          }
        }

        var stepDesc = mainItem.name + " " + tier + "套餐 — $" + comboPrice + "（含" + coveredDescs.join("+") + "）";
        var extrasStr = extraDescs.length > 0 ? extraDescs.join("、") : null;

        allDeals.push({
          label: mainItem.name + " " + tier + "套餐",
          cost: comboPrice,
          consumes: consumes,
          steps: [stepDesc],
          extras: extrasStr,
          isUpgrade: extrasStr !== null,
          needsSplit: false,
          strategyType: "combo"
        });
      }
    }
  }

  // Generate all deals
  genSingleDeals();
  genBogoCouponDeals();
  genFixedBundleDeals();
  genOneOneDeals();
  genSweetheartDeals();
  genComboDeals();

  // ============================================================
  // Phase 2: DFS Search
  // ============================================================

  // Pre-index: for each order index, which deals consume it?
  var dealsByIndex = [];
  for (var i = 0; i < order.length; i++) dealsByIndex.push([]);
  for (var d = 0; d < allDeals.length; d++) {
    var seen = {};
    for (var c = 0; c < allDeals[d].consumes.length; c++) {
      var idx = allDeals[d].consumes[c];
      if (!seen[idx]) {
        dealsByIndex[idx].push(d);
        seen[idx] = true;
      }
    }
  }

  var bestCost = singleTotal;
  var bestSolutions = []; // array of deal-index arrays

  function dfs(rem, costSoFar, dealsUsed) {
    // Prune
    if (costSoFar > bestCost) return;

    // Find leftmost index with remaining > 0
    var pivot = -1;
    for (var i = 0; i < rem.length; i++) {
      if (rem[i] > 0) { pivot = i; break; }
    }

    // All covered
    if (pivot < 0) {
      if (costSoFar < bestCost) {
        bestCost = costSoFar;
        bestSolutions = [dealsUsed.slice()];
      } else if (costSoFar === bestCost) {
        bestSolutions.push(dealsUsed.slice());
      }
      return;
    }

    // Try each deal that consumes pivot
    var candidates = dealsByIndex[pivot];
    for (var c = 0; c < candidates.length; c++) {
      var di = candidates[c];
      var deal = allDeals[di];

      // Check if deal is satisfiable by remaining
      var consumeCounts = {};
      var ok = true;
      for (var j = 0; j < deal.consumes.length; j++) {
        var idx = deal.consumes[j];
        consumeCounts[idx] = (consumeCounts[idx] || 0) + 1;
      }
      for (var idx in consumeCounts) {
        if (consumeCounts[idx] > rem[idx]) { ok = false; break; }
      }
      if (!ok) continue;

      // Apply deal
      for (var idx in consumeCounts) rem[idx] -= consumeCounts[idx];
      dealsUsed.push(di);

      dfs(rem, costSoFar + deal.cost, dealsUsed);

      // Undo
      dealsUsed.pop();
      for (var idx in consumeCounts) rem[idx] += consumeCounts[idx];
    }
  }

  var startRem = remaining.slice();
  dfs(startRem, 0, []);

  // ============================================================
  // Phase 3: Result Assembly
  // ============================================================

  var results = [];

  function addResult(label, totalPrice, steps, extras, isUpgrade, needsSplit, extrasRetailPrice) {
    if (isUpgrade) {
      var threshold = singleTotal <= 130 ? 50 : singleTotal * 0.3;
      if (totalPrice > singleTotal + threshold) return;
      if (extrasRetailPrice != null && totalPrice - bestCost > extrasRetailPrice) return;
    }
    results.push({
      label: label,
      totalPrice: totalPrice,
      steps: steps,
      extras: extras || null,
      isUpgrade: isUpgrade,
      needsSplit: needsSplit || false,
    });
  }

  // Build results from DFS solutions
  for (var si = 0; si < bestSolutions.length; si++) {
    var sol = bestSolutions[si];
    var steps = [];
    var labels = [];
    var allExtras = [];
    var hasSweetheart = false;
    var sweetPairs = {}; // track sweetheart A->B pairs for needsSplit

    // Consolidate: group deals by type and merge
    var singleSteps = [];
    var dealSteps = [];

    for (var di = 0; di < sol.length; di++) {
      var deal = allDeals[sol[di]];
      if (deal.strategyType === "single") {
        singleSteps.push(deal);
      } else {
        dealSteps.push(deal);
        if (deal.extras) allExtras.push(deal.extras);
        if (deal.strategyType === "sweetheart") {
          hasSweetheart = true;
          var pairKey = deal.sweetA + ":" + deal.sweetB;
          sweetPairs[pairKey] = (sweetPairs[pairKey] || 0) + 1;
        }
      }
    }

    // Determine needsSplit: same sweetheart A×B pair used more than once
    var needsSplit = false;
    for (var pk in sweetPairs) {
      if (sweetPairs[pk] > 1) { needsSplit = true; break; }
    }

    // Build label from non-single deals
    var labelParts = [];
    var seenLabels = {};
    for (var di = 0; di < dealSteps.length; di++) {
      var lbl = dealSteps[di].label;
      if (!seenLabels[lbl]) {
        seenLabels[lbl] = 0;
      }
      seenLabels[lbl]++;
    }
    for (var lbl in seenLabels) {
      if (seenLabels[lbl] > 1) {
        labelParts.push(lbl + " x" + seenLabels[lbl]);
      } else {
        labelParts.push(lbl);
      }
    }

    // Add deal steps
    // Consolidate same-label deal steps (e.g., multiple BOGO coupons)
    var stepCounts = {};
    for (var di = 0; di < dealSteps.length; di++) {
      var deal = dealSteps[di];
      for (var s = 0; s < deal.steps.length; s++) {
        steps.push(deal.steps[s]);
      }
    }

    // Consolidate single items: group by order index
    var singleByIdx = {};
    for (var di = 0; di < singleSteps.length; di++) {
      var deal = singleSteps[di];
      var idx = deal.consumes[0];
      singleByIdx[idx] = (singleByIdx[idx] || 0) + 1;
    }
    for (var idx in singleByIdx) {
      var cnt = singleByIdx[idx];
      var item = order[idx];
      steps.push(item.name + " 單點 x" + cnt + " — $" + (cnt * item.price));
    }

    var resultLabel;
    if (labelParts.length === 0) {
      resultLabel = "全部單點";
    } else if (labelParts.length === 1) {
      resultLabel = labelParts[0];
    } else {
      resultLabel = labelParts.join(" + ");
    }

    var extrasStr = allExtras.length > 0 ? allExtras.join("、") : null;
    var isUpgrade = extrasStr !== null && dealSteps.some(function(d) { return d.isUpgrade; });

    addResult(resultLabel, bestCost, steps, extrasStr, isUpgrade, needsSplit);
    // Only keep first solution for exact match (avoid duplicates)
    break;
  }

  // ============================================================
  // Upgrade deals: strategies that add items not in the order
  // ============================================================

  var promotions = (promoData && promoData.promotions) || [];
  var coupons = (couponData && couponData.coupons) || [];

  // --- Upgrade: 1+1 with missing B (add drink) ---
  for (var pi = 0; pi < promotions.length; pi++) {
    var promo = promotions[pi];
    if (promo.type !== "pick_combo") continue;

    var groupANames = promo.groups.group_a.map(function(i) { return i.name; });
    var groupBNames = (promo.groups.group_b_priced || []).map(function(i) { return i.name; })
      .concat(promo.groups.group_b_names || []);

    var inA = order.filter(function(o) { return matchesGroup(o.name, groupANames); });
    var inB = order.filter(function(o) { return matchesGroup(o.name, groupBNames) || isDrink(o.name); });

    // Only A → suggest adding drink
    if (inA.length > 0 && inB.length === 0) {
      for (var ai = 0; ai < inA.length; ai++) {
        var item = inA[ai];
        var totalPrice = promo.price;
        if (item.quantity > 1) {
          totalPrice += (item.quantity - 1) * item.price;
        }
        for (var j = 0; j < order.length; j++) {
          if (order[j].name !== item.name) {
            totalPrice += order[j].price * order[j].quantity;
          }
        }
        var steps = [
          promo.name + "（" + item.name + " + 小杯飲料）— $" + promo.price,
        ];
        if (item.quantity > 1) {
          steps.push(item.name + " 單點 x" + (item.quantity - 1) + " — $" + ((item.quantity - 1) * item.price));
        }
        for (var j = 0; j < order.length; j++) {
          if (order[j].name !== item.name) {
            steps.push(order[j].name + " 單點 x" + order[j].quantity + " — $" + (order[j].price * order[j].quantity));
          }
        }
        addResult(
          promo.name + "（加小杯飲料）",
          totalPrice, steps, "小杯飲料", true, false, getMinDrinkPrice()
        );
        break;
      }
    }

    // Only B (drink) → suggest adding A item
    if (inB.length > 0 && inA.length === 0) {
      var aItems = promo.groups.group_a.slice().sort(function(a, b) { return a.price - b.price; });
      var shown = 0;
      for (var ai = 0; ai < aItems.length && shown < 3; ai++) {
        var aItem = aItems[ai];
        var totalPrice = promo.price;
        var drinkItem = inB[0];
        if (drinkItem.quantity > 1) {
          totalPrice += (drinkItem.quantity - 1) * drinkItem.price;
        }
        for (var j = 0; j < order.length; j++) {
          if (order[j].name !== drinkItem.name) {
            totalPrice += order[j].price * order[j].quantity;
          }
        }
        var steps = [
          promo.name + "（" + aItem.name + " + " + drinkItem.name + "）— $" + promo.price,
        ];
        for (var j = 0; j < order.length; j++) {
          if (order[j].name !== drinkItem.name) {
            steps.push(order[j].name + " 單點 x" + order[j].quantity + " — $" + (order[j].price * order[j].quantity));
          }
        }
        addResult(
          promo.name + "（加" + aItem.name + "）",
          totalPrice, steps, aItem.name, true, false, aItem.price
        );
        shown++;
      }
    }
  }

  // --- Upgrade: Sweetheart card — only A → suggest free B ---
  for (var pi = 0; pi < promotions.length; pi++) {
    var promo = promotions[pi];
    if (promo.type !== "buy_a_get_b_free") continue;

    var groupANames = promo.group_a.map(function(i) { return i.name; });
    var groupBNames = promo.group_b.map(function(i) { return i.name; });

    var inA = order.filter(function(o) { return matchesGroup(o.name, groupANames); });
    var inB = order.filter(function(o) { return matchesGroup(o.name, groupBNames); });

    if (inA.length > 0 && inB.length === 0) {
      var bItems = promo.group_b;
      for (var bi = 0; bi < Math.min(bItems.length, 3); bi++) {
        var bItem = bItems[bi];
        var steps = ["甜心卡：買 " + inA[0].name + " 送 " + bItem.name];
        var totalPrice = singleTotal;
        for (var j = 0; j < order.length; j++) {
          steps.push(order[j].name + " x" + order[j].quantity + " — $" + (order[j].price * order[j].quantity));
        }
        addResult(
          "甜心卡（送" + bItem.name + "）",
          totalPrice, steps, bItem.name, true, false, bItem.price
        );
      }
    }

    // Only B → suggest buying cheapest A to get B free
    if (inB.length > 0 && inA.length === 0) {
      var aOptions = promo.group_a.slice().sort(function(a, b) { return a.price - b.price; });
      for (var ai = 0; ai < Math.min(aOptions.length, 3); ai++) {
        var aOpt = aOptions[ai];
        var bItem = inB[0];
        var totalPrice = aOpt.price;
        var steps = ["甜心卡：買 " + aOpt.name + "($" + aOpt.price + ") 送 " + bItem.name];
        if (bItem.quantity > 1) {
          totalPrice += (bItem.quantity - 1) * bItem.price;
          steps.push(bItem.name + " 單點 x" + (bItem.quantity - 1) + " — $" + ((bItem.quantity - 1) * bItem.price));
        }
        for (var j = 0; j < order.length; j++) {
          if (order[j].name !== bItem.name) {
            totalPrice += order[j].price * order[j].quantity;
            steps.push(order[j].name + " 單點 x" + order[j].quantity + " — $" + (order[j].price * order[j].quantity));
          }
        }
        addResult(
          "甜心卡（買" + aOpt.name + "送" + bItem.name + "）",
          totalPrice, steps, aOpt.name,
          totalPrice > singleTotal, false, aOpt.price
        );
      }
    }
  }

  // --- Upgrade: BOGO coupon with qty=1 → suggest getting 2 ---
  for (var ci = 0; ci < coupons.length; ci++) {
    var coupon = coupons[ci];
    if (coupon.type !== "bogo") continue;

    for (var oi = 0; oi < order.length; oi++) {
      var o = order[oi];
      if (fuzzyMatch(o.name, coupon.item) && o.quantity === 1) {
        var totalPrice = coupon.price;
        var steps = [coupon.name + "（" + coupon.code + "）— $" + coupon.price];
        for (var j = 0; j < order.length; j++) {
          if (j !== oi) {
            totalPrice += order[j].price * order[j].quantity;
            steps.push(order[j].name + " 單點 x" + order[j].quantity + " — $" + (order[j].price * order[j].quantity));
          }
        }
        addResult(
          coupon.name + "（" + coupon.code + "）",
          totalPrice, steps, o.name + " x1", true, false, o.price
        );
      }
    }
  }

  // --- Upgrade: Combo meals that add extra sides ---
  for (var mi = 0; mi < order.length; mi++) {
    if (!order[mi].combos) continue;
    var mainItem = order[mi];
    var tierKeys = Object.keys(mainItem.combos);

    for (var ti = 0; ti < tierKeys.length; ti++) {
      var tier = tierKeys[ti];
      var comboPrice = mainItem.combos[tier];
      var tierDef = TIER_CONTENTS[tier];
      if (!tierDef) continue;

      // Check how many tier items are NOT in the order
      var extraCount = 0;
      for (var t = 0; t < tierDef.items.length; t++) {
        var found = false;
        for (var oi = 0; oi < order.length; oi++) {
          if (oi === mi) continue;
          if (matchesTierItem(order[oi].name, tierDef.items[t])) { found = true; break; }
        }
        if (!found) extraCount++;
      }

      // Only show as upgrade if it adds something
      if (extraCount === 0) continue;

      var totalPrice = comboPrice;
      var steps = [];
      var coveredDescs = tierDef.items.map(function(t) { return t.desc; });
      steps.push(mainItem.name + " " + tier + "套餐 — $" + comboPrice + "（含" + coveredDescs.join("+") + "）");

      if (mainItem.quantity > 1) {
        totalPrice += (mainItem.quantity - 1) * mainItem.price;
        steps.push(mainItem.name + " 單點 x" + (mainItem.quantity - 1) + " — $" + ((mainItem.quantity - 1) * mainItem.price));
      }

      var extras = [];
      for (var oi = 0; oi < order.length; oi++) {
        if (oi === mi) continue;
        totalPrice += order[oi].price * order[oi].quantity;
        steps.push(order[oi].name + " 單點 x" + order[oi].quantity + " — $" + (order[oi].price * order[oi].quantity));
      }
      var extrasPrice = 0;
      for (var t = 0; t < tierDef.items.length; t++) {
        var found = false;
        for (var oi = 0; oi < order.length; oi++) {
          if (oi === mi) continue;
          if (matchesTierItem(order[oi].name, tierDef.items[t])) { found = true; break; }
        }
        if (!found) {
          extras.push(tierDef.items[t].desc);
          extrasPrice += tierItemRetailPrice(tierDef.items[t]);
        }
      }

      addResult(
        mainItem.name + " " + tier + "套餐",
        totalPrice, steps, extras.join("、"), true, false, extrasPrice
      );
    }
  }

  // Deduplicate
  var seen = {};
  return results.filter(function(r) {
    var key = r.totalPrice + "::" + r.label;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}
