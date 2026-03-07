import { Router } from "express";
import db, { LOADS_TABLE, OFFERS_TABLE } from "../db.js";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const router = Router();

function deduplicateOffers(offerList) {
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
    const [{ Items: loads }, { Items: offers }] = await Promise.all([
      db.send(new ScanCommand({ TableName: LOADS_TABLE })),
      db.send(new ScanCommand({ TableName: OFFERS_TABLE }))
    ]);

    const loadList = loads || [];
    const allOffers = offers || [];
    const calls = deduplicateOffers(allOffers);

    // ─── Load Stats ───
    let available = 0, booked = 0;
    for (const l of loadList) {
      if (l.status === 'available') available++;
      if (l.status === 'booked') booked++;
    }
    const loadsWithOffers = new Set(allOffers.map(o => o.load_id));

    // ─── Executive KPIs ───
    const totalCalls = calls.length;
    const acceptedCalls = calls.filter(c => c.status === 'accepted');
    const bookingRate = totalCalls > 0 ? +((acceptedCalls.length / totalCalls) * 100).toFixed(1) : 0;

    const revenueBooked = acceptedCalls.reduce((sum, c) => sum + (c.final_rate || 0), 0);

    let marginSum = 0, marginCount = 0;
    for (const c of acceptedCalls) {
      const load = loadList.find(l => l.load_id === c.load_id);
      if (load?.loadboard_rate && c.final_rate) {
        marginSum += (load.loadboard_rate - c.final_rate) / load.loadboard_rate;
        marginCount++;
      }
    }
    const avgMarginPreserved = marginCount > 0 ? +(marginSum / marginCount * 100).toFixed(1) : 0;

    const callsWithDuration = calls.filter(c => c.duration != null && c.duration > 0);
    const avgCallDuration = callsWithDuration.length > 0
      ? +(callsWithDuration.reduce((s, c) => s + c.duration, 0) / callsWithDuration.length).toFixed(0)
      : 0;

    const avgFinalRate = acceptedCalls.length > 0
      ? +(acceptedCalls.reduce((s, c) => s + (c.final_rate || 0), 0) / acceptedCalls.length).toFixed(2)
      : 0;

    const firstOfferAccepts = acceptedCalls.filter(c => (c.rounds || 1) === 1);
    const firstOfferAcceptRate = acceptedCalls.length > 0
      ? +((firstOfferAccepts.length / acceptedCalls.length) * 100).toFixed(1)
      : 0;

    const revenuePerCall = totalCalls > 0 ? +(revenueBooked / totalCalls).toFixed(2) : 0;

    // ─── Negotiation Stats ───
    const callsWithRounds = calls.filter(c => c.rounds != null);
    const avgRounds = callsWithRounds.length > 0
      ? +(callsWithRounds.reduce((s, c) => s + c.rounds, 0) / callsWithRounds.length).toFixed(1)
      : 0;

    let discountSum = 0, discountCount = 0;
    for (const c of acceptedCalls) {
      if (c.offered_rate && c.final_rate) {
        discountSum += c.final_rate - c.offered_rate;
        discountCount++;
      }
    }
    const avgDiscount = discountCount > 0 ? +(discountSum / discountCount).toFixed(2) : 0;

    const avgOfferedRate = calls.length > 0
      ? +(calls.reduce((s, c) => s + (c.offered_rate || 0), 0) / calls.length).toFixed(2)
      : 0;

    // ─── Rate Waterfall ───
    let avgLoadboardRate = 0, waterCount = 0;
    for (const c of acceptedCalls) {
      const load = loadList.find(l => l.load_id === c.load_id);
      if (load?.loadboard_rate) {
        avgLoadboardRate += load.loadboard_rate;
        waterCount++;
      }
    }
    avgLoadboardRate = waterCount > 0 ? +(avgLoadboardRate / waterCount).toFixed(2) : 0;

    // ─── Speed / Latency ───
    const callsWithLatency = calls.filter(c => c.p90_latency_ms != null && c.p90_latency_ms > 0);
    const avgP70 = callsWithLatency.length > 0
      ? +(callsWithLatency.reduce((s, c) => s + (c.p70_latency_ms || 0), 0) / callsWithLatency.length).toFixed(0)
      : 0;
    const avgP90 = callsWithLatency.length > 0
      ? +(callsWithLatency.reduce((s, c) => s + (c.p90_latency_ms || 0), 0) / callsWithLatency.length).toFixed(0)
      : 0;

    // ─── Interruption / Carrier Satisfaction ───
    const callsWithCuts = calls.filter(c => c.assistant_cut_message_ratio != null);
    const avgInterruptionRate = callsWithCuts.length > 0
      ? +(callsWithCuts.reduce((s, c) => s + c.assistant_cut_message_ratio, 0) / callsWithCuts.length * 100).toFixed(1)
      : 0;

    // ─── Calls by Hour ───
    const hourBuckets = Array(24).fill(0);
    for (const c of calls) {
      if (c.created_at) {
        const hour = new Date(c.created_at).getUTCHours();
        hourBuckets[hour]++;
      }
    }

    // ─── Call Result (from HappyRobot classifier, falls back to AI-reported) ───
    const outcomeCount = {};
    for (const c of calls) {
      const outcome = c.call_result || c.call_outcome || "unknown";
      outcomeCount[outcome] = (outcomeCount[outcome] || 0) + 1;
    }
    const outcomeBreakdown = Object.entries(outcomeCount)
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count);

    // ─── User Behavior / Call Quality (from HappyRobot classifier) ───
    const behaviorCount = {};
    for (const c of calls) {
      if (c.user_behavior) {
        behaviorCount[c.user_behavior] = (behaviorCount[c.user_behavior] || 0) + 1;
      }
    }
    const behaviorBreakdown = Object.entries(behaviorCount)
      .map(([behavior, count]) => ({ behavior, count }))
      .sort((a, b) => b.count - a.count);

    // ─── Sentiment (from HappyRobot classifier, falls back to AI-reported) ───
    const sentimentCount = {};
    for (const c of calls) {
      const sent = c.sentiment || c.carrier_sentiment;
      if (sent) {
        sentimentCount[sent] = (sentimentCount[sent] || 0) + 1;
      }
    }
    const sentimentBreakdown = Object.entries(sentimentCount)
      .map(([sentiment, count]) => ({ sentiment, count }))
      .sort((a, b) => b.count - a.count);

    // ─── Equipment Distribution ───
    const equipmentCount = {};
    for (const c of calls) {
      if (c.equipment_type) {
        equipmentCount[c.equipment_type] = (equipmentCount[c.equipment_type] || 0) + 1;
      }
    }
    const equipmentBreakdown = Object.entries(equipmentCount)
      .map(([equipment, count]) => ({ equipment, count }))
      .sort((a, b) => b.count - a.count);

    // ─── Top Objections ───
    const objectionCount = {};
    for (const c of calls) {
      if (c.key_objections) {
        objectionCount[c.key_objections] = (objectionCount[c.key_objections] || 0) + 1;
      }
    }
    const topObjections = Object.entries(objectionCount)
      .map(([objection, count]) => ({ objection, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // ─── Top Lanes ───
    const laneStats = {};
    for (const c of calls) {
      const load = loadList.find(l => l.load_id === c.load_id);
      if (load) {
        const key = `${load.origin}|${load.destination}`;
        if (!laneStats[key]) {
          laneStats[key] = { origin: load.origin, destination: load.destination, calls: 0, booked: 0, sum_final: 0, sum_list: 0 };
        }
        laneStats[key].calls++;
        laneStats[key].sum_list += (load.loadboard_rate || 0);
        if (c.status === 'accepted') {
          laneStats[key].booked++;
          laneStats[key].sum_final += (c.final_rate || 0);
        }
      }
    }
    const topLanes = Object.values(laneStats)
      .map(l => ({
        ...l,
        avg_list_rate: l.calls > 0 ? +(l.sum_list / l.calls).toFixed(2) : 0,
        avg_final_rate: l.booked > 0 ? +(l.sum_final / l.booked).toFixed(2) : 0,
      }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 10);

    // ─── Top Origin Cities ───
    const originCount = {};
    for (const c of calls) {
      const load = loadList.find(l => l.load_id === c.load_id);
      if (load?.origin) {
        originCount[load.origin] = (originCount[load.origin] || 0) + 1;
      }
    }
    const topOrigins = Object.entries(originCount)
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // ─── Repeat Callers ───
    const mcCallCount = {};
    for (const c of calls) {
      mcCallCount[c.mc_number] = (mcCallCount[c.mc_number] || 0) + 1;
    }
    const repeatCallers = Object.entries(mcCallCount).filter(([, count]) => count > 1);
    const repeatCallerRate = totalCalls > 0 && Object.keys(mcCallCount).length > 0
      ? +((repeatCallers.length / Object.keys(mcCallCount).length) * 100).toFixed(1)
      : 0;

    const topCarriers = Object.entries(mcCallCount)
      .map(([mc_number, call_count]) => {
        const carrierOffers = calls.filter(c => c.mc_number === mc_number);
        const bookings = carrierOffers.filter(c => c.status === 'accepted').length;
        const name = carrierOffers[0]?.carrier_name || null;
        return { mc_number, carrier_name: name, call_count, bookings };
      })
      .sort((a, b) => b.call_count - a.call_count)
      .slice(0, 10);

    // ─── Funnel ───
    const getOutcome = c => c.call_result || c.call_outcome || '';
    const funnelNotAuthorized = calls.filter(c => getOutcome(c) === 'not_authorized').length;
    const funnelNoMatch = calls.filter(c => ['no_match', 'no_loads_available'].includes(getOutcome(c))).length;
    const funnelVerified = totalCalls - funnelNotAuthorized;
    const funnelLoadsFound = funnelVerified - funnelNoMatch;
    const funnelOffered = funnelLoadsFound;
    const funnelNegotiated = calls.filter(c => (c.rounds || 0) > 1).length;
    const funnelBooked = acceptedCalls.length;

    // ─── Coverage ───
    const loadBoardCoverage = loadList.length > 0
      ? +((loadsWithOffers.size / loadList.length) * 100).toFixed(1)
      : 0;
    const emptyBoardRate = totalCalls > 0
      ? +((funnelNoMatch / totalCalls) * 100).toFixed(1)
      : 0;

    // ─── Off-hours ───
    const offHoursCalls = calls.filter(c => c.is_within_business_hours === false).length;
    const offHoursRate = totalCalls > 0 ? +((offHoursCalls / totalCalls) * 100).toFixed(1) : 0;

    res.json({
      kpis: {
        total_calls: totalCalls,
        booking_rate_pct: bookingRate,
        revenue_booked: revenueBooked,
        avg_margin_preserved_pct: avgMarginPreserved,
        avg_call_duration_sec: avgCallDuration,
        avg_final_rate: avgFinalRate,
        first_offer_accept_rate_pct: firstOfferAcceptRate,
        revenue_per_call: revenuePerCall,
      },
      negotiation: {
        avg_rounds: avgRounds,
        avg_discount_given: avgDiscount,
        avg_offered_rate: avgOfferedRate,
        avg_final_rate: avgFinalRate,
        avg_loadboard_rate: avgLoadboardRate,
      },
      speed: {
        avg_call_duration_sec: avgCallDuration,
        avg_p70_latency_ms: avgP70,
        avg_p90_latency_ms: avgP90,
        avg_interruption_rate_pct: avgInterruptionRate,
      },
      funnel: {
        total_calls: totalCalls,
        verified: funnelVerified,
        loads_found: funnelLoadsFound,
        offers_made: funnelOffered,
        negotiations: funnelNegotiated,
        booked: funnelBooked,
      },
      loads: {
        total: loadList.length,
        available,
        booked,
        board_coverage_pct: loadBoardCoverage,
        empty_board_rate_pct: emptyBoardRate,
      },
      calls_by_hour: hourBuckets,
      outcome_breakdown: outcomeBreakdown,
      user_behavior_breakdown: behaviorBreakdown,
      sentiment_breakdown: sentimentBreakdown,
      equipment_breakdown: equipmentBreakdown,
      top_objections: topObjections,
      top_lanes: topLanes,
      top_origins: topOrigins,
      top_carriers: topCarriers,
      carrier_intelligence: {
        repeat_caller_rate_pct: repeatCallerRate,
        unique_carriers: Object.keys(mcCallCount).length,
        repeat_callers: repeatCallers.length,
        off_hours_rate_pct: offHoursRate,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
