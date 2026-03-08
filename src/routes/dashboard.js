import { Router } from "express";
import db, { LOADS_TABLE, OFFERS_TABLE } from "../db.js";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const router = Router();

const num = (v) => { const x = Number(v); return isNaN(x) ? 0 : x; };

function deduplicateBySession(offerList) {
  const groups = {};
  for (const o of offerList) {
    const key = o.session_id || `${o.mc_number}|${o.load_id}|${o.created_at?.slice(0, 10)}`;
    if (!groups[key] || new Date(o.created_at) > new Date(groups[key].created_at)) {
      groups[key] = o;
    }
  }
  return Object.values(groups);
}

router.get("/metrics", async (_req, res) => {
  try {
    const [{ Items: rawLoads }, { Items: rawOffers }] = await Promise.all([
      db.send(new ScanCommand({ TableName: LOADS_TABLE })),
      db.send(new ScanCommand({ TableName: OFFERS_TABLE })),
    ]);

    const loads = (rawLoads || []).map(l => ({
      ...l,
      loadboard_rate: num(l.loadboard_rate),
      miles: num(l.miles),
      lat: l.lat != null ? Number(l.lat) : null,
      lng: l.lng != null ? Number(l.lng) : null,
    }));

    const verifications = (rawOffers || []).filter(o => o.type === "verify");
    const allOffers = (rawOffers || []).filter(o => o.type !== "verify").map(o => ({
      ...o,
      offered_rate: num(o.offered_rate),
      counter_rate: num(o.counter_rate),
      final_rate: num(o.final_rate),
      rounds: num(o.rounds),
      duration: num(o.duration),
    }));

    const calls = deduplicateBySession(allOffers);
    const accepted = calls.filter(c => c.status === "accepted");
    const totalCalls = Math.max(verifications.length, calls.length);

    let totalSavings = 0, savingsCount = 0;
    for (const c of accepted) {
      const load = loads.find(l => l.load_id === c.load_id);
      if (load && c.final_rate > 0) {
        totalSavings += load.loadboard_rate - c.final_rate;
        savingsCount++;
      }
    }

    const withDuration = calls.filter(c => c.duration > 0);
    const avgDuration = withDuration.length > 0
      ? Math.round(withDuration.reduce((s, c) => s + c.duration, 0) / withDuration.length)
      : 0;

    const getOutcome = c => c.call_result || c.call_outcome || "";
    const verifiedCount = verifications.length > 0
      ? verifications.filter(v => v.verified === true).length
      : totalCalls;
    const noMatch = calls.filter(c => ["no_match", "no_loads_available"].includes(getOutcome(c))).length;
    const loadsFound = Math.max(verifiedCount - noMatch, calls.length);
    const sessionOfferCounts = {};
    for (const o of allOffers) {
      const key = o.session_id || `${o.mc_number}|${o.load_id}|${o.created_at?.slice(0, 10)}`;
      sessionOfferCounts[key] = (sessionOfferCounts[key] || 0) + 1;
    }
    const negotiated = calls.filter(c => {
      const key = c.session_id || `${c.mc_number}|${c.load_id}|${c.created_at?.slice(0, 10)}`;
      return (sessionOfferCounts[key] || 0) > 1 || num(c.rounds) > 1;
    }).length;

    const roundDist = {};
    for (const c of calls) {
      if (!c.rounds && c.rounds !== 0) continue;
      const r = Math.min(num(c.rounds) || 1, 3);
      const key = String(r);
      roundDist[key] = (roundDist[key] || 0) + 1;
    }

    let avgLoadboard = 0, avgOffer = 0, avgFinal = 0, waterCount = 0;
    for (const c of accepted) {
      const load = loads.find(l => l.load_id === c.load_id);
      if (load && c.final_rate > 0 && c.offered_rate > 0) {
        avgLoadboard += load.loadboard_rate;
        avgOffer += c.offered_rate;
        avgFinal += c.final_rate;
        waterCount++;
      }
    }
    if (waterCount > 0) {
      avgLoadboard = Math.round(avgLoadboard / waterCount);
      avgOffer = Math.round(avgOffer / waterCount);
      avgFinal = Math.round(avgFinal / waterCount);
    }

    const outcomeCount = {};
    for (const c of calls) {
      const o = getOutcome(c) || c.status || "unknown";
      outcomeCount[o] = (outcomeCount[o] || 0) + 1;
    }
    const outcomeBreakdown = Object.entries(outcomeCount)
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count);

    const laneStats = {};
    for (const c of calls) {
      const load = loads.find(l => l.load_id === c.load_id);
      if (!load) continue;
      const key = `${load.origin} → ${load.destination}`;
      if (!laneStats[key]) laneStats[key] = { lane: key, deals: 0, booked: 0, savings: 0, total_final: 0 };
      laneStats[key].deals++;
      if (c.status === "accepted" && c.final_rate > 0) {
        laneStats[key].booked++;
        laneStats[key].total_final += c.final_rate;
        laneStats[key].savings += load.loadboard_rate - c.final_rate;
      }
    }
    const topLanes = Object.values(laneStats)
      .map(l => ({ ...l, avg_final: l.booked > 0 ? Math.round(l.total_final / l.booked) : 0 }))
      .sort((a, b) => b.deals - a.deals)
      .slice(0, 8);

    const verifyNames = {};
    for (const v of verifications) {
      if (v.carrier_name && v.mc_number) verifyNames[v.mc_number] = v.carrier_name;
    }

    const carrierStats = {};
    for (const c of calls) {
      const mc = c.mc_number;
      if (!carrierStats[mc]) carrierStats[mc] = { mc_number: mc, carrier_name: verifyNames[mc] || null, calls: 0, bookings: 0 };
      carrierStats[mc].calls++;
      if (c.carrier_name) carrierStats[mc].carrier_name = c.carrier_name;
      if (c.status === "accepted") carrierStats[mc].bookings++;
    }
    const topCarriers = Object.values(carrierStats)
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 8);

    const recent = [...calls]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 15)
      .map(c => {
        const load = loads.find(l => l.load_id === c.load_id);
        return {
          status: c.status,
          mc_number: c.mc_number,
          carrier_name: c.carrier_name || verifyNames[c.mc_number] || null,
          lane: load ? `${load.origin} → ${load.destination}` : c.lanes_requested || "—",
          offered_rate: c.offered_rate,
          final_rate: c.final_rate,
          rounds: c.rounds,
          duration: c.duration,
          call_result: c.call_result || c.call_outcome || null,
          user_behavior: c.user_behavior || null,
          carrier_sentiment: c.sentiment || c.carrier_sentiment || null,
          created_at: c.created_at,
        };
      });

    const sentimentCount = {};
    for (const c of calls) {
      const s = c.sentiment || c.carrier_sentiment;
      if (s && s !== "true" && s !== "false") {
        sentimentCount[s] = (sentimentCount[s] || 0) + 1;
      }
    }
    const sentimentBreakdown = Object.entries(sentimentCount)
      .map(([sentiment, count]) => ({ sentiment, count }))
      .sort((a, b) => b.count - a.count);

    const equipmentCount = {};
    for (const c of calls) {
      if (c.equipment_type) {
        equipmentCount[c.equipment_type] = (equipmentCount[c.equipment_type] || 0) + 1;
      }
    }
    const equipmentBreakdown = Object.entries(equipmentCount)
      .map(([equipment, count]) => ({ equipment, count }))
      .sort((a, b) => b.count - a.count);

    const behaviorCount = {};
    for (const c of calls) {
      if (c.user_behavior) {
        behaviorCount[c.user_behavior] = (behaviorCount[c.user_behavior] || 0) + 1;
      }
    }
    const behaviorBreakdown = Object.entries(behaviorCount)
      .map(([behavior, count]) => ({ behavior, count }))
      .sort((a, b) => b.count - a.count);

    const loadMap = loads
      .filter(l => l.lat != null && l.lng != null)
      .map(l => ({
        load_id: l.load_id,
        origin: l.origin,
        destination: l.destination,
        lat: l.lat,
        lng: l.lng,
        status: l.status,
        loadboard_rate: l.loadboard_rate,
        equipment_type: l.equipment_type,
        pickup_datetime: l.pickup_datetime || null,
      }));

    res.json({
      kpis: {
        total_calls: totalCalls,
        booking_rate_pct: totalCalls > 0 ? +((accepted.length / totalCalls) * 100).toFixed(1) : 0,
        total_savings: Math.round(totalSavings),
        avg_savings: savingsCount > 0 ? Math.round(totalSavings / savingsCount) : 0,
        avg_call_duration_sec: avgDuration,
      },
      funnel: { total_calls: totalCalls, verified: verifiedCount, loads_found: loadsFound, negotiated, booked: accepted.length },
      negotiation: {
        avg_rounds: calls.length > 0 ? +(calls.reduce((s, c) => s + num(c.rounds), 0) / calls.length).toFixed(1) : 0,
        avg_loadboard_rate: avgLoadboard,
        avg_our_offer: avgOffer,
        avg_final_rate: avgFinal,
        round_distribution: roundDist,
      },
      outcome_breakdown: outcomeBreakdown,
      sentiment_breakdown: sentimentBreakdown,
      equipment_breakdown: equipmentBreakdown,
      user_behavior_breakdown: behaviorBreakdown,
      top_lanes: topLanes,
      top_carriers: topCarriers,
      recent_activity: recent,
      load_map: loadMap,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
