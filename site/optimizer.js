/**
 * McDonald's order optimizer.
 * Strategies: combo meals, 1+1, sweetheart card (甜心卡), coupons.
 */

function findBestCombinations(order, menuData, promoData, couponData) {

  // === Utilities ===

  // Normalize: 鷄→雞, strip whitespace
  function norm(s) {
    return s.replace(/鷄/g, "雞").replace(/\s+/g, "").replace(/\.$/g, "");
  }

  // Fuzzy match: does order item name match a promo item name?
  function fuzzyMatch(orderName, promoName) {
    var a = norm(orderName);
    var b = norm(promoName);
    // Exact after normalization
    if (a === b) return true;
    // One contains the other (handles "麥克雞塊(6塊)" vs "六塊麥克雞塊")
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
    // Special cases: nuggets with different count format
    // "六塊麥克雞塊" ↔ "麥克雞塊(6塊)"
    // "四塊麥克雞塊" ↔ "麥克雞塊(4塊)"
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

  // Check if an order item matches any name in a promo group
  function matchesGroup(orderName, groupNames) {
    for (var i = 0; i < groupNames.length; i++) {
      if (fuzzyMatch(orderName, groupNames[i])) return true;
    }
    return false;
  }

  // === Combo tier definitions ===

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

  // === Main logic ===

  var results = [];
  var singleTotal = 0;
  for (var i = 0; i < order.length; i++) {
    singleTotal += order[i].price * order[i].quantity;
  }

  function addResult(label, totalPrice, steps, extras, isUpgrade) {
    if (isUpgrade) {
      var threshold = singleTotal <= 130 ? 50 : singleTotal * 0.3;
      if (totalPrice > singleTotal + threshold) return;
    }
    results.push({
      label: label,
      totalPrice: totalPrice,
      steps: steps,
      extras: extras || null,
      isUpgrade: isUpgrade,
    });
  }

  // --- Strategy 1: Combo meals (套餐) ---

  var comboableItems = order.filter(function(o) { return o.combos; });

  for (var ci = 0; ci < comboableItems.length; ci++) {
    var mainItem = comboableItems[ci];
    var tierKeys = Object.keys(mainItem.combos);

    for (var ti = 0; ti < tierKeys.length; ti++) {
      var tier = tierKeys[ti];
      var comboPrice = mainItem.combos[tier];
      var tierDef = TIER_CONTENTS[tier];
      if (!tierDef) continue;

      var coveredIndices = [];
      var tierItemsMatched = [];
      for (var t = 0; t < tierDef.items.length; t++) tierItemsMatched.push(false);

      for (var oi = 0; oi < order.length; oi++) {
        if (order[oi].name === mainItem.name) continue;
        for (var t = 0; t < tierDef.items.length; t++) {
          if (!tierItemsMatched[t] && matchesTierItem(order[oi].name, tierDef.items[t])) {
            tierItemsMatched[t] = true;
            coveredIndices.push(oi);
            break;
          }
        }
      }

      var totalPrice = comboPrice;
      var steps = [];
      var coveredDescs = tierDef.items.map(function(t) { return t.desc; });
      steps.push(mainItem.name + " " + tier + "套餐 — $" + comboPrice + "（含" + coveredDescs.join("+") + "）");

      if (mainItem.quantity > 1) {
        var extraCost = (mainItem.quantity - 1) * mainItem.price;
        totalPrice += extraCost;
        steps.push(mainItem.name + " 單點 x" + (mainItem.quantity - 1) + " — $" + extraCost);
      }

      for (var oi = 0; oi < order.length; oi++) {
        if (order[oi].name === mainItem.name) continue;
        if (coveredIndices.indexOf(oi) >= 0) {
          steps.push(order[oi].name + " — 套餐已含");
          if (order[oi].quantity > 1) {
            var extra = (order[oi].quantity - 1) * order[oi].price;
            totalPrice += extra;
            steps.push(order[oi].name + " 單點 x" + (order[oi].quantity - 1) + " — $" + extra);
          }
        } else {
          var cost = order[oi].price * order[oi].quantity;
          totalPrice += cost;
          steps.push(order[oi].name + " 單點 x" + order[oi].quantity + " — $" + cost);
        }
      }

      var extras = [];
      for (var t = 0; t < tierDef.items.length; t++) {
        if (!tierItemsMatched[t]) extras.push(tierDef.items[t].desc);
      }
      var extrasStr = extras.length > 0 ? extras.join("、") : null;

      addResult(
        mainItem.name + " " + tier + "套餐",
        totalPrice, steps, extrasStr,
        totalPrice > singleTotal
      );
    }
  }

  // --- Strategy 2: 1+1 promotions ---

  var promotions = (promoData && promoData.promotions) || [];

  for (var pi = 0; pi < promotions.length; pi++) {
    var promo = promotions[pi];
    if (promo.type !== "pick_combo") continue;

    var groupANames = promo.groups.group_a.map(function(i) { return i.name; });
    var groupBNames = (promo.groups.group_b_priced || []).map(function(i) { return i.name; })
      .concat(promo.groups.group_b_names || []);
    // B group is mostly drinks — also match by drink keywords
    var allGroupBCheck = function(name) {
      return matchesGroup(name, groupBNames) || isDrink(name);
    };

    var inA = order.filter(function(o) { return matchesGroup(o.name, groupANames); });
    var inB = order.filter(function(o) { return allGroupBCheck(o.name); });

    // Case 1: Both A and B items in order → use 1+1 to cover both
    if (inA.length > 0 && inB.length > 0) {
      var totalA = 0, totalB = 0;
      for (var j = 0; j < inA.length; j++) totalA += inA[j].quantity;
      for (var j = 0; j < inB.length; j++) totalB += inB[j].quantity;
      var pairsCount = Math.min(totalA, totalB);

      var totalPrice = pairsCount * promo.price;
      var steps = [promo.name + "（含小杯飲料）x" + pairsCount + " — $" + (pairsCount * promo.price)];

      var remainingA = totalA - pairsCount;
      for (var j = 0; j < inA.length && remainingA > 0; j++) {
        var leftover = Math.min(inA[j].quantity, remainingA);
        if (leftover > 0) {
          totalPrice += leftover * inA[j].price;
          steps.push(inA[j].name + " 單點 x" + leftover + " — $" + (leftover * inA[j].price));
          remainingA -= leftover;
        }
      }
      var remainingB = totalB - pairsCount;
      for (var j = 0; j < inB.length && remainingB > 0; j++) {
        var leftover = Math.min(inB[j].quantity, remainingB);
        if (leftover > 0) {
          totalPrice += leftover * inB[j].price;
          steps.push(inB[j].name + " 單點 x" + leftover + " — $" + (leftover * inB[j].price));
          remainingB -= leftover;
        }
      }

      // Non-promo items
      for (var j = 0; j < order.length; j++) {
        var o = order[j];
        if (!matchesGroup(o.name, groupANames) && !allGroupBCheck(o.name)) {
          totalPrice += o.price * o.quantity;
          steps.push(o.name + " 單點 x" + o.quantity + " — $" + (o.price * o.quantity));
        }
      }

      addResult(promo.name, totalPrice, steps, null, totalPrice > singleTotal);
    }

    // Case 2: Only A in order → suggest adding a drink (B) for upgrade
    if (inA.length > 0 && inB.length === 0) {
      for (var ai = 0; ai < inA.length; ai++) {
        var item = inA[ai];
        var totalPrice = promo.price;
        // Other items (including extra quantity of A item)
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
          totalPrice, steps, "小杯飲料",
          true // always an upgrade since we're adding something
        );
        break; // just show one suggestion per promo
      }
    }

    // Case 3: Only B (drink) in order → suggest adding an A item for upgrade
    if (inB.length > 0 && inA.length === 0) {
      // Show cheapest A group options
      var aItems = promo.groups.group_a.slice().sort(function(a, b) { return a.price - b.price; });
      // Show up to 3 options
      var shown = 0;
      for (var ai = 0; ai < aItems.length && shown < 3; ai++) {
        var aItem = aItems[ai];
        var totalPrice = promo.price;
        // Remaining drinks beyond the first
        var drinkItem = inB[0];
        if (drinkItem.quantity > 1) {
          totalPrice += (drinkItem.quantity - 1) * drinkItem.price;
        }
        // Other non-drink items
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
          totalPrice, steps, aItem.name,
          true
        );
        shown++;
      }
    }
  }

  // --- Strategy 3: Sweetheart card (甜心卡) ---
  // buy_a_get_b_free: pay full price for A group item, get B group item free

  for (var pi = 0; pi < promotions.length; pi++) {
    var promo = promotions[pi];
    if (promo.type !== "buy_a_get_b_free") continue;

    var groupANames = promo.group_a.map(function(i) { return i.name; });
    var groupBNames = promo.group_b.map(function(i) { return i.name; });

    var inA = order.filter(function(o) { return matchesGroup(o.name, groupANames); });
    var inB = order.filter(function(o) { return matchesGroup(o.name, groupBNames); });

    // Case 1: Have both A and B → B is free
    if (inA.length > 0 && inB.length > 0) {
      var aItem = inA[0];
      var bItem = inB[0];
      var pairsCount = Math.min(
        inA.reduce(function(s, o) { return s + o.quantity; }, 0),
        inB.reduce(function(s, o) { return s + o.quantity; }, 0)
      );

      var totalPrice = 0;
      var steps = [];

      // A items: pay full price
      var aUsed = pairsCount;
      for (var j = 0; j < inA.length; j++) {
        var fullQty = inA[j].quantity;
        totalPrice += fullQty * inA[j].price;
        steps.push(inA[j].name + " x" + fullQty + " — $" + (fullQty * inA[j].price) + "（甜心卡 A 群）");
        aUsed -= fullQty;
      }

      // B items: first pairsCount are free
      var bFree = pairsCount;
      for (var j = 0; j < inB.length; j++) {
        var freeQty = Math.min(inB[j].quantity, bFree);
        var paidQty = inB[j].quantity - freeQty;
        if (freeQty > 0) {
          steps.push(inB[j].name + " x" + freeQty + " — 免費（甜心卡）");
        }
        if (paidQty > 0) {
          totalPrice += paidQty * inB[j].price;
          steps.push(inB[j].name + " 單點 x" + paidQty + " — $" + (paidQty * inB[j].price));
        }
        bFree -= freeQty;
      }

      // Other items
      for (var j = 0; j < order.length; j++) {
        var o = order[j];
        if (!matchesGroup(o.name, groupANames) && !matchesGroup(o.name, groupBNames)) {
          totalPrice += o.price * o.quantity;
          steps.push(o.name + " 單點 x" + o.quantity + " — $" + (o.price * o.quantity));
        }
      }

      addResult("甜心卡", totalPrice, steps, null, totalPrice > singleTotal);
    }

    // Case 2: Only have A item → suggest getting a free B item (upgrade)
    if (inA.length > 0 && inB.length === 0) {
      var bItems = promo.group_b;
      for (var bi = 0; bi < Math.min(bItems.length, 3); bi++) {
        var bItem = bItems[bi];
        var steps = ["甜心卡：買 " + inA[0].name + " 送 " + bItem.name];
        // Total = same as current (A is already being bought), just +0
        var totalPrice = singleTotal; // no extra cost, you get B free
        for (var j = 0; j < order.length; j++) {
          steps.push(order[j].name + " x" + order[j].quantity + " — $" + (order[j].price * order[j].quantity));
        }
        addResult(
          "甜心卡（送" + bItem.name + "）",
          totalPrice, steps, bItem.name, true
        );
      }
    }

    // Case 3: Only have B item → suggest buying cheapest A to get B free
    // This is the key bidirectional case
    if (inB.length > 0 && inA.length === 0) {
      var aOptions = promo.group_a.slice().sort(function(a, b) { return a.price - b.price; });
      for (var ai = 0; ai < Math.min(aOptions.length, 3); ai++) {
        var aOpt = aOptions[ai];
        var bItem = inB[0];
        // Pay A price, B is free → total = A price + rest of order - B price
        var totalPrice = aOpt.price;
        var steps = ["甜心卡：買 " + aOpt.name + "($" + aOpt.price + ") 送 " + bItem.name];
        // B item is free (one unit)
        if (bItem.quantity > 1) {
          totalPrice += (bItem.quantity - 1) * bItem.price;
          steps.push(bItem.name + " 單點 x" + (bItem.quantity - 1) + " — $" + ((bItem.quantity - 1) * bItem.price));
        }
        // Other items
        for (var j = 0; j < order.length; j++) {
          if (order[j].name !== bItem.name) {
            totalPrice += order[j].price * order[j].quantity;
            steps.push(order[j].name + " 單點 x" + order[j].quantity + " — $" + (order[j].price * order[j].quantity));
          }
        }
        addResult(
          "甜心卡（買" + aOpt.name + "送" + bItem.name + "）",
          totalPrice, steps, aOpt.name,
          totalPrice > singleTotal
        );
      }
    }
  }

  // --- Strategy 4: Coupons (BOGO + fixed bundles) ---

  var coupons = (couponData && couponData.coupons) || [];

  for (var ci = 0; ci < coupons.length; ci++) {
    var coupon = coupons[ci];

    if (coupon.type === "bogo") {
      // BOGO: buy 2 of same item for coupon price
      for (var oi = 0; oi < order.length; oi++) {
        var o = order[oi];
        if (fuzzyMatch(o.name, coupon.item) && o.quantity >= 2) {
          var pairs = Math.floor(o.quantity / 2);
          var leftover = o.quantity - pairs * 2;
          var totalPrice = pairs * coupon.price + leftover * o.price;
          // Add other items
          var steps = [];
          steps.push(coupon.name + "（" + coupon.code + "）x" + pairs + " — $" + (pairs * coupon.price));
          if (leftover > 0) {
            totalPrice += 0; // already counted
            steps.push(o.name + " 單點 x" + leftover + " — $" + (leftover * o.price));
          }
          for (var j = 0; j < order.length; j++) {
            if (j !== oi) {
              totalPrice += order[j].price * order[j].quantity;
              steps.push(order[j].name + " 單點 x" + order[j].quantity + " — $" + (order[j].price * order[j].quantity));
            }
          }
          addResult(
            coupon.name + "（" + coupon.code + "）",
            totalPrice, steps, null,
            totalPrice > singleTotal
          );
        }
      }
      // BOGO upgrade: user has 1 → suggest getting 2
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
            totalPrice, steps, o.name + " x1",
            true
          );
        }
      }
    }

    if (coupon.type === "fixed_bundle") {
      // Fixed bundle: check if user's order items match bundle contents
      var bundleItems = coupon.items.slice(); // copy
      // Expand order: each unit as a separate entry for matching
      var orderExpanded = [];
      for (var oi = 0; oi < order.length; oi++) {
        for (var q = 0; q < order[oi].quantity; q++) {
          orderExpanded.push({ idx: oi, name: order[oi].name, price: order[oi].price });
        }
      }

      // Try to match each bundle item to an order item
      var bundleMatched = [];
      for (var bi = 0; bi < bundleItems.length; bi++) bundleMatched.push(-1);
      var orderUsed = [];
      for (var ei = 0; ei < orderExpanded.length; ei++) orderUsed.push(false);

      for (var bi = 0; bi < bundleItems.length; bi++) {
        var slot = bundleItems[bi];
        var isDrinkSlot = typeof slot === "string" && slot.indexOf("drink:") === 0;
        var drinkMax = isDrinkSlot ? parseInt(slot.split(":")[1]) : 0;

        for (var ei = 0; ei < orderExpanded.length; ei++) {
          if (orderUsed[ei]) continue;
          var oName = orderExpanded[ei].name;
          var oPrice = orderExpanded[ei].price;

          if (isDrinkSlot) {
            if (isDrink(oName) && oPrice <= drinkMax) {
              bundleMatched[bi] = ei;
              orderUsed[ei] = true;
              break;
            }
          } else {
            if (fuzzyMatch(oName, slot)) {
              bundleMatched[bi] = ei;
              orderUsed[ei] = true;
              break;
            }
          }
        }
      }

      var matchedCount = 0;
      for (var bi = 0; bi < bundleMatched.length; bi++) {
        if (bundleMatched[bi] >= 0) matchedCount++;
      }

      // Need at least 2 items matched to be relevant
      if (matchedCount < 2) continue;

      // Calculate total: coupon price + unmatched order items at single price
      var totalPrice = coupon.price;
      var steps = [];
      var coveredNames = [];
      for (var bi = 0; bi < bundleItems.length; bi++) {
        if (bundleMatched[bi] >= 0) {
          coveredNames.push(orderExpanded[bundleMatched[bi]].name);
        }
      }
      steps.push(coupon.name + "（" + coupon.code + "）— $" + coupon.price + "（含" + coveredNames.join("+") + "）");

      // Unmatched bundle items = extras the user gets
      var extras = [];
      for (var bi = 0; bi < bundleItems.length; bi++) {
        if (bundleMatched[bi] < 0) {
          extras.push(bundleItems[bi]);
        }
      }

      // Unmatched order items = need to add at single price
      for (var ei = 0; ei < orderExpanded.length; ei++) {
        if (!orderUsed[ei]) {
          totalPrice += orderExpanded[ei].price;
        }
      }
      // Group unmatched order items for display
      var unmatchedByIdx = {};
      for (var ei = 0; ei < orderExpanded.length; ei++) {
        if (!orderUsed[ei]) {
          var idx = orderExpanded[ei].idx;
          unmatchedByIdx[idx] = (unmatchedByIdx[idx] || 0) + 1;
        }
      }
      for (var idx in unmatchedByIdx) {
        var cnt = unmatchedByIdx[idx];
        steps.push(order[idx].name + " 單點 x" + cnt + " — $" + (cnt * order[idx].price));
      }

      var extrasStr = extras.length > 0 ? extras.join("、") : null;
      var isUpgrade = totalPrice > singleTotal;

      addResult(
        coupon.name + "（" + coupon.code + "）",
        totalPrice, steps, extrasStr,
        isUpgrade
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
