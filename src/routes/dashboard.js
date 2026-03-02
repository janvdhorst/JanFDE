import { Router } from "express";
import db from "../db.js";

const router = Router();

router.get("/metrics", (_req, res) => {
  const loadStats = db.prepare(`
    SELECT
      COUNT(*) AS total_loads,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) AS booked,
      ROUND(AVG(loadboard_rate), 2) AS avg_rate,
      ROUND(AVG(miles), 0) AS avg_miles
    FROM loads
  `).get();

  const offerStats = db.prepare(`
    SELECT
      COUNT(*) AS total_offers,
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
      ROUND(AVG(offered_rate), 2) AS avg_offered_rate,
      ROUND(AVG(final_rate), 2) AS avg_final_rate,
      ROUND(AVG(rounds), 1) AS avg_negotiation_rounds
    FROM offers
  `).get();

  const sentimentBreakdown = db.prepare(`
    SELECT
      carrier_sentiment AS sentiment,
      COUNT(*) AS count
    FROM offers
    WHERE carrier_sentiment IS NOT NULL
    GROUP BY carrier_sentiment
    ORDER BY count DESC
  `).all();

  const outcomeBreakdown = db.prepare(`
    SELECT
      call_outcome AS outcome,
      COUNT(*) AS count
    FROM offers
    WHERE call_outcome IS NOT NULL
    GROUP BY call_outcome
    ORDER BY count DESC
  `).all();

  const topLanes = db.prepare(`
    SELECT
      origin,
      destination,
      COUNT(*) AS offer_count,
      ROUND(AVG(loadboard_rate), 2) AS avg_list_rate,
      ROUND(AVG(o.offered_rate), 2) AS avg_offered
    FROM offers o
    JOIN loads l ON o.load_id = l.load_id
    GROUP BY origin, destination
    ORDER BY offer_count DESC
    LIMIT 10
  `).all();

  const conversionRate =
    offerStats.total_offers > 0
      ? ((offerStats.accepted / offerStats.total_offers) * 100).toFixed(1)
      : "0.0";

  res.json({
    loads: loadStats,
    offers: {
      ...offerStats,
      conversion_rate_pct: Number(conversionRate),
    },
    sentiment_breakdown: sentimentBreakdown,
    outcome_breakdown: outcomeBreakdown,
    top_lanes: topLanes,
  });
});

export default router;
