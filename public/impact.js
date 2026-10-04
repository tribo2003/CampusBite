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
 *   RescueImpact.formatMass(kg)       -> {value, unit: "g"|"kg", text}   (g below 1,000 g, kg from 1 kg)
 *   report().display.{meals,co2e,miles,kg}  -> ready-to-print {value, unit, text}; USE THESE for cards.
 *   Personal page: load impact_personal.js after this file (adds RescueImpact.personalReport).
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
  const ITEMS = [
    ["pizza_slice", "Pizza", "slices", 110, "food"],
    ["taco", "Tacos", "pieces", 100, "food"],
    ["mac_cheese", "Mac & cheese", "servings (~1 cup)", 200, "food"],
    ["boxed_lunch", "Boxed lunch", "boxes", 450, "food"],
    ["sandwich", "Sandwich", "pieces", 220, "food"],
    ["chicken", "Wings/tenders", "pieces", 45, "food"],
    ["pasta", "Pasta", "servings", 250, "food"],
    ["donut", "Donuts", "pieces", 65, "food"],
    ["bagel", "Bagels", "pieces", 105, "food"],
    ["cookie", "Cookies", "pieces", 35, "food"],
    ["salad", "Salad", "servings", 200, "food"],
    ["fruit", "Fruit", "pieces", 150, "food"],
    ["coffee", "Coffee", "cups (12 oz)", null, "drink"],
    ["tea", "Tea", "cups (12 oz)", null, "drink"],
    ["milk", "Milk", "cartons (8 oz)", null, "drink"],
  ].map(([id, name, unit, grams, type]) => ({ id, name, unit, grams_per_unit: grams, type }));
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

  // ---------- display formatting (unit auto-scaling) ----------
  /** kg -> {value, unit, text}. Shows grams below 1,000 g, kilograms from 1 kg up. */
  function formatMass(kg) {
    const g = kg * 1000;
    if (Math.round(g) < 1000) {
      const v = Math.round(g);
      return { value: v, unit: "g", text: v.toLocaleString("en-US") + " g" };
    }
    const d = kg < 10 ? 1 : 0;
    const v = +kg.toFixed(d);
    return { value: v, unit: "kg", text: v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) + " kg" };
  }

  /** Meals / miles: 1 decimal under 10, whole numbers above; tiny values show "<0.1". */
  function formatCount(v, unit) {
    const text = v > 0 && v < 0.1 ? "<0.1" : v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("en-US");
    return { value: v, unit, text };
  }

  /** The four headline metrics, ready to print. */
  function displayTotals(t) {
    return {
      meals: formatCount(t.meals, "meals"),
      co2e: formatMass(t.co2e),
      miles: formatCount(t.miles, "miles"),
      kg: formatMass(t.kg),
    };
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
    const display = {
      ...displayTotals(totals),
      runRate: {
        mealsPerWeek: formatCount(runRate.mealsPerWeek, "meals"),
        co2ePerWeek: formatMass(runRate.co2ePerWeek),
        co2ePerYearProjection: formatMass(runRate.co2ePerYearProjection),
      },
    };
    return { range: { ...range, start: fmt(range.start), end: fmt(range.end) }, totals, display, previous, change, runRate, series, byItem };
  }

  // ---------- Chart.js v4 configs (pass to new Chart(canvas, cfg)) ----------
  function chartConfigs(rep, colors) {
    const c = Object.assign({ main: "#2f8f5b", text: "#66736b" }, colors);
    const s = rep.series, foodItems = rep.byItem.filter((x) => x.meals > 0);
    const base = { maintainAspectRatio: false };
    const xAxis = { ticks: { maxTicksLimit: 8, color: c.text }, grid: { display: false } };
    const yAxis = { beginAtZero: true, ticks: { color: c.text } };
    // Plot the cumulative line in grams until it passes 1,000 g, then in kilograms.
    const maxC = Math.max(0, ...s.cumCo2e);
    const unit = Math.round(maxC * 1000) < 1000 ? "g" : "kg";
    const cumData = s.cumCo2e.map((v) => (unit === "g" ? +(v * 1000).toFixed(1) : +v.toFixed(3)));
    return {
      units: { cumulativeCo2e: unit },
      cumulativeCo2e: {
        type: "line",
        data: { labels: s.labels, datasets: [{ label: "CO₂ emission avoided (" + unit + ")", data: cumData, borderColor: c.main, backgroundColor: c.main + "33", fill: true, pointRadius: 0, tension: 0.25 }] },
        options: { ...base, interaction: { mode: "index", intersect: false }, scales: { x: xAxis, y: { ...yAxis, ticks: { color: c.text, callback: (v) => v + " " + unit } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ctx.parsed.y + " " + unit } } } },
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

  const api = { ITEMS, formatMass, formatCount, displayTotals, fmtDate: fmt, parseDate: parse, addDays, startOfDay, KG_PER_MEAL, CO2E_PER_KG, KG_CO2_PER_MILE, entryImpact, summarize, getRange, previousRange, report, chartConfigs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RescueImpact = api;
})(typeof window !== "undefined" ? window : globalThis);
