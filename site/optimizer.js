/**
 * McDonald's order optimizer.
 * Phase 1: single items + combo meals (套餐) + 1+1 promotions.
 */

function findBestCombinations(order, menuData, promoData) {
  // --- Combo tier content mapping ---
  var TIER_CONTENTS = {
    A: {
      label: "A經典配餐",
      items: [
        { isFries: true, desc: "中薯" },
        { desc: "38元飲品", isDrink: true },
      ],
    },
    B: {
      label: "B清爽配餐",
      items: [
        { keywords: ["四季沙拉"], desc: "四季沙拉" },
        { desc: "38元飲品", isDrink: true },
      ],
    },
    C: {
      label: "C勁脆配餐",
      items: [
        { keywords: ["麥脆鷄腿", "麥脆雞腿", "麥脆鷄", "麥脆雞"], desc: "麥脆雞腿" },
        { desc: "38元飲品", isDrink: true },
      ],
    },
    D: {
      label: "D炫冰配餐",
      items: [
        { keywords: ["OREO冰炫風"], desc: "OREO冰炫風" },
        { isFries: true, desc: "小薯" },
        { desc: "38元飲品", isDrink: true },
      ],
    },
    E: {
      label: "E豪吃配餐",
      items: [
        { isNuggets: true, desc: "6塊麥克雞塊" },
        { isFries: true, desc: "小薯" },
        { desc: "38元飲品", isDrink: true },
      ],
    },
    F: {
      label: "F地瓜配餐",
      items: [
        { keywords: ["金黃地瓜條", "地瓜條"], desc: "金黃地瓜條" },
        { desc: "38元飲品", isDrink: true },
      ],
    },
  };

  var DRINK_KEYWORDS = ["可樂", "雪碧", "紅茶", "綠茶", "咖啡", "那堤", "奶茶", "柳丁", "鮮乳", "鮮奶"];

  function matchesTierItem(orderItemName, tierItem) {
    if (tierItem.isDrink) {
      return DRINK_KEYWORDS.some(function(k) { return orderItemName.indexOf(k) >= 0; });
    }
    // Fries: any size matches (小/中/大 all count)
    if (tierItem.isFries) {
      return orderItemName.indexOf("薯條") >= 0;
    }
    // Nuggets: any size matches (4/6/10 all count)
    if (tierItem.isNuggets) {
      return orderItemName.indexOf("鷄塊") >= 0 || orderItemName.indexOf("雞塊") >= 0;
    }
    if (!tierItem.keywords) return false;
    return tierItem.keywords.some(function(k) { return orderItemName.indexOf(k) >= 0; });
  }

  var results = [];
  var singleTotal = 0;
  for (var i = 0; i < order.length; i++) {
    singleTotal += order[i].price * order[i].quantity;
  }

  var comboableItems = order.filter(function(o) { return o.combos; });

  if (comboableItems.length === 0) return results;

  // --- Strategy 1: Combo meals ---
  for (var ci = 0; ci < comboableItems.length; ci++) {
    var mainItem = comboableItems[ci];
    var comboPrices = mainItem.combos;
    var tierKeys = Object.keys(comboPrices);

    for (var ti = 0; ti < tierKeys.length; ti++) {
      var tier = tierKeys[ti];
      var comboPrice = comboPrices[tier];
      var tierDef = TIER_CONTENTS[tier];
      if (!tierDef) continue;

      // Check which other ordered items are covered by this combo tier
      var coveredIndices = [];
      var tierItemsMatched = [];
      for (var t = 0; t < tierDef.items.length; t++) {
        tierItemsMatched.push(false);
      }

      for (var oi = 0; oi < order.length; oi++) {
        if (order[oi].name === mainItem.name) continue;
        for (var t = 0; t < tierDef.items.length; t++) {
          if (!tierItemsMatched[t] && matchesTierItem(order[oi].name, tierDef.items[t])) {
            tierItemsMatched[t] = true;
            coveredIndices.push(oi);
            break; // one order item matches one tier item
          }
        }
      }

      // Calculate total price
      var totalPrice = comboPrice;
      var steps = [];
      var coveredDescs = [];
      for (var t = 0; t < tierDef.items.length; t++) {
        coveredDescs.push(tierDef.items[t].desc);
      }
      steps.push(mainItem.name + " " + tier + "套餐 — $" + comboPrice + "（含" + coveredDescs.join("+") + "）");

      // Main item extra quantity
      if (mainItem.quantity > 1) {
        var extraCost = (mainItem.quantity - 1) * mainItem.price;
        totalPrice += extraCost;
        steps.push(mainItem.name + " 單點 x" + (mainItem.quantity - 1) + " — $" + extraCost);
      }

      // Other items
      for (var oi = 0; oi < order.length; oi++) {
        if (order[oi].name === mainItem.name) continue;

        if (coveredIndices.indexOf(oi) >= 0) {
          // Covered by combo (1 unit)
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

      // Extras: tier items not matched by any order
      var extras = [];
      for (var t = 0; t < tierDef.items.length; t++) {
        if (!tierItemsMatched[t]) extras.push(tierDef.items[t].desc);
      }

      if (totalPrice <= singleTotal) {
        results.push({
          label: mainItem.name + " " + tier + "套餐",
          totalPrice: totalPrice,
          steps: steps,
          extras: extras.length > 0 ? extras.join("、") : null,
          isUpgrade: false,
        });
      } else {
        var threshold = singleTotal <= 130 ? 50 : singleTotal * 0.3;
        if (totalPrice <= singleTotal + threshold) {
          results.push({
            label: mainItem.name + " " + tier + "套餐",
            totalPrice: totalPrice,
            steps: steps,
            extras: extras.length > 0 ? extras.join("、") : null,
            isUpgrade: true,
          });
        }
      }
    }
  }

  // --- Strategy 2: 1+1 promotions ---
  var promotions = (promoData && promoData.promotions) || [];
  for (var pi = 0; pi < promotions.length; pi++) {
    var promo = promotions[pi];
    if (promo.type !== "pick_combo") continue;

    var groupANames = promo.groups.group_a.map(function(i) { return i.name; });
    var groupBNames = promo.groups.group_b_priced.map(function(i) { return i.name; })
      .concat(promo.groups.group_b_names);

    var inA = order.filter(function(o) { return groupANames.indexOf(o.name) >= 0; });
    var inB = order.filter(function(o) { return groupBNames.indexOf(o.name) >= 0; });

    if (inA.length > 0 && inB.length > 0) {
      var totalA = 0, totalB = 0;
      for (var j = 0; j < inA.length; j++) totalA += inA[j].quantity;
      for (var j = 0; j < inB.length; j++) totalB += inB[j].quantity;
      var pairsCount = Math.min(totalA, totalB);

      var totalPrice = pairsCount * promo.price;
      var steps = [promo.name + " x" + pairsCount + " — $" + (pairsCount * promo.price)];

      var remainingA = totalA - pairsCount;
      var remainingB = totalB - pairsCount;

      for (var j = 0; j < inA.length && remainingA > 0; j++) {
        var leftover = Math.min(inA[j].quantity, remainingA);
        if (leftover > 0) {
          totalPrice += leftover * inA[j].price;
          steps.push(inA[j].name + " 單點 x" + leftover + " — $" + (leftover * inA[j].price));
          remainingA -= leftover;
        }
      }
      for (var j = 0; j < inB.length && remainingB > 0; j++) {
        var leftover = Math.min(inB[j].quantity, remainingB);
        if (leftover > 0) {
          totalPrice += leftover * inB[j].price;
          steps.push(inB[j].name + " 單點 x" + leftover + " — $" + (leftover * inB[j].price));
          remainingB -= leftover;
        }
      }

      for (var j = 0; j < order.length; j++) {
        var o = order[j];
        if (groupANames.indexOf(o.name) < 0 && groupBNames.indexOf(o.name) < 0) {
          totalPrice += o.price * o.quantity;
          steps.push(o.name + " 單點 x" + o.quantity + " — $" + (o.price * o.quantity));
        }
      }

      if (totalPrice < singleTotal) {
        results.push({ label: promo.name, totalPrice: totalPrice, steps: steps, isUpgrade: false });
      } else {
        var threshold = singleTotal <= 130 ? 50 : singleTotal * 0.3;
        if (totalPrice <= singleTotal + threshold && totalPrice !== singleTotal) {
          results.push({ label: promo.name, totalPrice: totalPrice, steps: steps, isUpgrade: true });
        }
      }
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
