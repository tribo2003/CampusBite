/**
 * RescueImpact - personal page extension.  Load AFTER impact.js.
 * Adds RescueImpact.personalReport(...) and RescueImpact.weeklyStreak(...).
 * Same calculation as the community view; entries are filtered to one user
 * (WHERE user_id = ? AND status = 'picked_up').
 *   entries = [{ date: "2026-10-03", item: "pizza_slice", qty: 12 }, ...]
 */
(function (root) {
  "use strict";
  const R = typeof module !== "undefined" && module.exports ? require("./impact.js") : root.RescueImpact;
  if (!R) throw new Error("Load impact.js before impact_personal.js");
  const { ITEMS, entryImpact, summarize, report, formatMass, formatCount, displayTotals, addDays, startOfDay } = R;
  const fmt = R.fmtDate, parse = R.parseDate;
  const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

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
   *   lifetime / lifetimeDisplay   all-time totals; lifetimeDisplay has g-or-kg text ready to print
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
      .map((e) => { const r = entryImpact(e.item, e.qty); return { ...e, name: BY_ID[e.item].name, unit: BY_ID[e.item].unit, ...r, display: { kg: formatMass(r.kg), co2e: formatMass(r.co2e), meals: formatCount(r.meals, "meals") } }; });
    return {
      ...rep, lifetime, lifetimeDisplay: displayTotals(lifetime), pickups: entries.length,
      firstPickup: entries.length ? entries.map((e) => e.date).sort()[0] : null,
      weeklyStreak: weeklyStreak(entries, today),
      milestones: { meals: milestoneProgress(lifetime.meals, MILESTONES.meals), co2e: milestoneProgress(lifetime.co2e, MILESTONES.co2e) },
      communityShare: share, recent,
    };
  }

  R.personalReport = personalReport;
  R.weeklyStreak = weeklyStreak;
  if (typeof module !== "undefined" && module.exports) module.exports = R;
})(typeof window !== "undefined" ? window : globalThis);
