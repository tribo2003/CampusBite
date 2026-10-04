/**
 * RescuePlate impact engine  (no DOM, no dependencies; browser + Node)
 *
 * INPUT  entries = [{ date: "2026-10-03", item: "pizza_slice", qty: 12 }, ...]
 *        One entry per confirmed pickup. Pass ONLY quantities actually picked up
 *        (not listed, not reserved). `item` must be an item_id from food_factors.csv.
 *
 * MAIN API
 *   RescueImpact.report(entries, "week" | "month" | "all", today?)
 *     -> { range, totals, previous, change, runRate, series, byItem }
 *   RescueImpact.chartConfigs(report, colors?)
 *     -> { cumulativeCo2e, dailyMeals, mealsByItem }   (Chart.js v4 configs)
 *   RescueImpact.summarize(entries)   -> totals for any list of entries
 *   RescueImpact.entryImpact(itemId, qty)
 *
 * METHOD (per entry)
 *   kg       = qty * grams_per_unit / 1000
 *   meals    = kg / 0.5443                      (1 meal = 1.2 lb; USDA / Feeding America)
 *   co2e_kg  = kg * 0.5953                      (EPA WARM v15 food donation, low-end:
 *                                                0.54 MTCO2e per short ton = avoided landfill only)
 *   miles    = co2e_kg / 0.4                    (EPA: ~400 g CO2 per mile, passenger vehicle)
 *   Drinks (type "drink") are counted in cups only: no kg, meals or CO2e are claimed
 *   (mostly water, usually poured out rather than landfilled).
 *
 * ASSUMPTIONS: food would otherwise be thrown away; grams_per_unit values are team estimates.
 */
(function (root) {
  "use strict";

  const KG_PER_SHORT_TON = 907.18474;
  const KG_PER_MEAL = 1.2 * 0.45359237;                       // 0.5443
  const CO2E_PER_KG = (0.54 * 1000) / KG_PER_SHORT_TON;       // 0.5953 kg CO2e per kg food
  const KG_CO2_PER_MILE = 0.4;

  // item_id, item_name, unit, grams_per_unit (null for drinks), type
  const ITEMS = [{"id": "pizza_slice", "name": "Pizza", "unit": "slices", "grams_per_unit": 110.0, "type": "food"}, {"id": "taco", "name": "Tacos", "unit": "pieces", "grams_per_unit": 100.0, "type": "food"}, {"id": "mac_cheese", "name": "Mac & cheese", "unit": "servings (~1 cup)", "grams_per_unit": 200.0, "type": "food"}, {"id": "boxed_lunch", "name": "Boxed lunch", "unit": "boxes", "grams_per_unit": 450.0, "type": "food"}, {"id": "sandwich", "name": "Sandwich", "unit": "pieces", "grams_per_unit": 220.0, "type": "food"}, {"id": "chicken", "name": "Wings/tenders", "unit": "pieces", "grams_per_unit": 45.0, "type": "food"}, {"id": "pasta", "name": "Pasta", "unit": "servings", "grams_per_unit": 250.0, "type": "food"}, {"id": "donut", "name": "Donuts", "unit": "pieces", "grams_per_unit": 65.0, "type": "food"}, {"id": "bagel", "name": "Bagels", "unit": "pieces", "grams_per_unit": 105.0, "type": "food"}, {"id": "cookie", "name": "Cookies", "unit": "pieces", "grams_per_unit": 35.0, "type": "food"}, {"id": "salad", "name": "Salad", "unit": "servings", "grams_per_unit": 200.0, "type": "food"}, {"id": "fruit", "name": "Fruit", "unit": "pieces", "grams_per_unit": 150.0, "type": "food"}, {"id": "coffee", "name": "Coffee", "unit": "cups (12 oz)", "grams_per_unit": null, "type": "drink"}, {"id": "tea", "name": "Tea", "unit": "cups (12 oz)", "grams_per_unit": null, "type": "drink"}, {"id": "milk", "name": "Milk", "unit": "cartons (8 oz)", "grams_per_unit": null, "type": "drink"}];
  const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

  // ---------- core conversion ----------
  function entryImpact(itemId, qty) {
    const it = BY_ID[itemId];
    if (!it) throw new Error("Unknown item_id: " + itemId);
    if (!(qty > 0)) return { kg: 0, meals: 0, co2e: 0, drinks: 0 };
    if (it.type === "drink") return { kg: 0, meals: 0, co2e: 0, drinks: qty };
    const kg = (it.grams_per_unit * qty) / 1000;
    return { kg, meals: kg / KG_PER_MEAL, co2e: kg * CO2E_PER_KG, drinks: 0 };
  }

  function summarize(entries) {
    const t = { kg: 0, meals: 0, co2e: 0, drinks: 0 };
    for (const e of entries) {
      const r = entryImpact(e.item, e.qty);
      t.kg += r.kg; t.meals += r.meals; t.co2e += r.co2e; t.drinks += r.drinks;
    }
    t.miles = t.co2e / KG_CO2_PER_MILE;
    return t;
  }

  // ---------- dates (local time, "YYYY-MM-DD") ----------
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  /** name: "week" (Mon-today), "month" (1st-today), "all" (first entry-today) */
  function getRange(name, entries, today) {
    const end = startOfDay(today || new Date());
    let start;
    if (name === "week") start = addDays(end, -((end.getDay() + 6) % 7));
    else if (name === "month") start = new Date(end.getFullYear(), end.getMonth(), 1);
    else if (name === "all") {
      const ds = entries.map((e) => e.date).sort();
      start = ds.length ? parse(ds[0]) : end;
    } else throw new Error('range must be "week", "month" or "all"');
    return { name, start, end, days: Math.round((end - start) / 864e5) + 1 };
  }

  /** Same number of elapsed days in the previous week/month (fair comparison). null for "all". */
  function previousRange(r) {
    let start;
    if (r.name === "week") start = addDays(r.start, -7);
    else if (r.name === "month") start = new Date(r.start.getFullYear(), r.start.getMonth() - 1, 1);
    else return null;
    return { name: r.name, start, end: addDays(start, r.days - 1), days: r.days };
  }

  const inRange = (entries, a, b) => entries.filter((e) => e.date >= fmt(a) && e.date <= fmt(b));
  const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

  // ---------- full report for one range ----------
  function report(entries, rangeName, today) {
    const range = getRange(rangeName, entries, today);
    const cur = inRange(entries, range.start, range.end);
    const totals = summarize(cur);

    const pr = previousRange(range);
    const previous = pr ? summarize(inRange(entries, pr.start, pr.end)) : null;
    const change = previous && {
      meals: pct(totals.meals, previous.meals), co2e: pct(totals.co2e, previous.co2e),
      kg: pct(totals.kg, previous.kg), drinks: pct(totals.drinks, previous.drinks),
    };

    // run-rate from the last 14 days (independent of selected range)
    const end = range.end;
    const l14 = summarize(inRange(entries, addDays(end, -13), end));
    const runRate = {
      mealsPerWeek: l14.meals / 2, co2ePerWeek: l14.co2e / 2,
      co2ePerYearProjection: (l14.co2e / 2) * 52, // projection only, label it as such
    };

    // daily + cumulative series for charts
    const dates = Array.from({ length: range.days }, (_, i) => fmt(addDays(range.start, i)));
    const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
    const dailyMeals = dates.map(() => 0), dailyCo2e = dates.map(() => 0);
    const byItemMap = {};
    for (const e of cur) {
      const r = entryImpact(e.item, e.qty), i = idx[e.date];
      dailyMeals[i] += r.meals; dailyCo2e[i] += r.co2e;
      const b = (byItemMap[e.item] = byItemMap[e.item] || { item: e.item, name: BY_ID[e.item].name, qty: 0, kg: 0, meals: 0, co2e: 0, drinks: 0 });
      b.qty += e.qty; b.kg += r.kg; b.meals += r.meals; b.co2e += r.co2e; b.drinks += r.drinks;
    }
    let a = 0, b = 0;
    const series = {
      dates, labels: dates.map((d) => d.slice(5)), dailyMeals, dailyCo2e,
      cumCo2e: dailyCo2e.map((v) => (a += v)), cumMeals: dailyMeals.map((v) => (b += v)),
    };
    const byItem = Object.values(byItemMap).sort((x, y) => y.meals - x.meals);
    return { range: { ...range, start: fmt(range.start), end: fmt(range.end) }, totals, previous, change, runRate, series, byItem };
  }

  // ---------- Chart.js v4 configs (pass to new Chart(canvas, cfg)) ----------
  function chartConfigs(rep, colors) {
    const c = Object.assign({ main: "#2f8f5b", text: "#66736b" }, colors);
    const s = rep.series, foodItems = rep.byItem.filter((x) => x.meals > 0);
    const base = { maintainAspectRatio: false };
    const xAxis = { ticks: { maxTicksLimit: 8, color: c.text }, grid: { display: false } };
    const yAxis = { beginAtZero: true, ticks: { color: c.text } };
    return {
      cumulativeCo2e: {
        type: "line",
        data: { labels: s.labels, datasets: [{ label: "CO2e avoided (kg)", data: s.cumCo2e, borderColor: c.main, backgroundColor: c.main + "33", fill: true, pointRadius: s.labels.length < 3 ? 5 : 0, tension: 0.25 }] },
        options: { ...base, interaction: { mode: "index", intersect: false }, scales: { x: xAxis, y: yAxis }, plugins: { legend: { display: false } } },
      },
      dailyMeals: {
        type: "bar",
        data: { labels: s.labels, datasets: [{ label: "Meals", data: s.dailyMeals.map((v) => +v.toFixed(1)), backgroundColor: c.main }] },
        options: { ...base, scales: { x: xAxis, y: yAxis }, plugins: { legend: { display: false } } },
      },
      mealsByItem: {
        type: "bar",
        data: { labels: foodItems.map((x) => x.name), datasets: [{ label: "Meals", data: foodItems.map((x) => +x.meals.toFixed(1)), backgroundColor: c.main }] },
        options: { ...base, indexAxis: "y", scales: { x: { beginAtZero: true, ticks: { color: c.text } }, y: { grid: { display: false }, ticks: { color: c.text } } }, plugins: { legend: { display: false } } },
      },
    };
  }

  // ---------- personal page ----------
  // Same math as the community view; entries are just filtered to one user
  // (WHERE user_id = ? AND status = 'picked_up'). Entries may carry extra fields (id, listing_id...).
  const MILESTONES = { meals: [1, 10, 25, 50, 100, 250, 500], co2e: [1, 5, 10, 25, 50, 100] };

  function milestoneProgress(value, list) {
    const achieved = list.filter((t) => value >= t);
    const next = list.find((t) => value < t);
    const prev = achieved.length ? achieved[achieved.length - 1] : 0;
    return { achieved, next: next === undefined ? null : next, progress: next === undefined ? 1 : (value - prev) / (next - prev) };
  }

  /** Consecutive weeks (Mon-Sun) with at least one pickup. Current week not yet empty-penalised. */
  function weeklyStreak(entries, today) {
    const wk = (d) => fmt(addDays(d, -((d.getDay() + 6) % 7)));
    const weeks = new Set(entries.map((e) => wk(parse(e.date))));
    let w = parse(wk(startOfDay(today || new Date())));
    if (!weeks.has(fmt(w))) w = addDays(w, -7);
    let n = 0;
    while (weeks.has(fmt(w))) { n++; w = addDays(w, -7); }
    return n;
  }

  /**
   * personalReport(userEntries, "week"|"month"|"all", today?, communityTotals?)
   *   communityTotals = summarize(allEntries) (optional, enables "your share")
   * Returns everything report() returns, plus:
   *   lifetime {kg, meals, co2e, miles, drinks}  all-time totals (the 4 headline metrics)
   *   pickups, firstPickup, weeklyStreak
   *   milestones {meals, co2e} -> {achieved[], next, progress 0..1}
   *   communityShare {meals, co2e} in % (null if no community totals)
   *   recent[]  last 10 pickups with per-pickup impact
   */
  function personalReport(entries, rangeName, today, community) {
    const rep = report(entries, rangeName, today);
    const lifetime = summarize(entries);
    const share = community ? {
      meals: community.meals > 0 ? (lifetime.meals / community.meals) * 100 : null,
      co2e: community.co2e > 0 ? (lifetime.co2e / community.co2e) * 100 : null,
    } : null;
    const recent = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 10)
      .map((e) => ({ ...e, name: BY_ID[e.item].name, unit: BY_ID[e.item].unit, ...entryImpact(e.item, e.qty) }));
    return {
      ...rep, lifetime, pickups: entries.length,
      firstPickup: entries.length ? entries.map((e) => e.date).sort()[0] : null,
      weeklyStreak: weeklyStreak(entries, today),
      milestones: { meals: milestoneProgress(lifetime.meals, MILESTONES.meals), co2e: milestoneProgress(lifetime.co2e, MILESTONES.co2e) },
      communityShare: share, recent,
    };
  }

  const api = { personalReport, weeklyStreak, ITEMS, KG_PER_MEAL, CO2E_PER_KG, KG_CO2_PER_MILE, entryImpact, summarize, getRange, previousRange, report, chartConfigs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RescueImpact = api;
})(typeof window !== "undefined" ? window : globalThis);
