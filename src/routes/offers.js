import { Router } from "express";
import db from "../db.js";

const router = Router();

router.post("/", (req, res) => {
  const {
    load_id,
    mc_number,
    carrier_name,
    offered_rate,
    counter_rate,
    final_rate,
    agreed_rate,
    status = "pending",
    rounds,
    negotiation_rounds,
    call_outcome,
    classifier_outcome,
    carrier_sentiment,
    realtime_sentiment,
    equipment_type,
    lanes_requested,
    key_objections,
    notes,
  } = req.body;

  if (!load_id || !mc_number || offered_rate == null) {
    return res.status(400).json({
      error: "load_id, mc_number, and offered_rate are required",
    });
  }

  const load = db.prepare("SELECT * FROM loads WHERE load_id = ?").get(load_id);
  if (!load) return res.status(404).json({ error: "Load not found" });

  const resolvedFinalRate = final_rate ?? agreed_rate ?? null;
  const resolvedRounds = rounds ?? negotiation_rounds ?? 1;
  const resolvedOutcome = call_outcome || classifier_outcome || null;
  const resolvedSentiment = carrier_sentiment || realtime_sentiment || null;

  const result = db.prepare(`
    INSERT INTO offers
      (load_id, mc_number, carrier_name, offered_rate, counter_rate,
       final_rate, status, rounds, call_outcome, carrier_sentiment,
       equipment_type, lanes_requested, key_objections, notes)
    VALUES
      (@load_id, @mc_number, @carrier_name, @offered_rate, @counter_rate,
       @final_rate, @status, @rounds, @call_outcome, @carrier_sentiment,
       @equipment_type, @lanes_requested, @key_objections, @notes)
  `).run({
    load_id,
    mc_number,
    carrier_name: carrier_name || null,
    offered_rate,
    counter_rate: counter_rate ?? null,
    final_rate: resolvedFinalRate,
    status,
    rounds: resolvedRounds,
    call_outcome: resolvedOutcome,
    carrier_sentiment: resolvedSentiment,
    equipment_type: equipment_type || null,
    lanes_requested: lanes_requested || null,
    key_objections: key_objections || null,
    notes: notes || null,
  });

  if (status === "accepted" && resolvedFinalRate) {
    db.prepare("UPDATE loads SET status = 'booked' WHERE load_id = ?").run(load_id);
  }

  res.status(201).json({
    id: result.lastInsertRowid,
    load_id,
    mc_number,
    status,
  });
});

router.post("/finalize", (req, res) => {
  const { mc_number, classifier_outcome, realtime_sentiment } = req.body;

  if (!mc_number) {
    return res.status(400).json({ error: "mc_number is required" });
  }

  const latest = db
    .prepare("SELECT * FROM offers WHERE mc_number = ? ORDER BY created_at DESC LIMIT 1")
    .get(mc_number);

  if (!latest) {
    return res.status(404).json({ error: "No offers found for this MC number" });
  }

  db.prepare(`
    UPDATE offers
    SET call_outcome = COALESCE(@call_outcome, call_outcome),
        carrier_sentiment = COALESCE(@carrier_sentiment, carrier_sentiment)
    WHERE id = @id
  `).run({
    id: latest.id,
    call_outcome: classifier_outcome || null,
    carrier_sentiment: realtime_sentiment || null,
  });

  res.json({
    id: latest.id,
    mc_number,
    classifier_outcome,
    realtime_sentiment,
    updated: true,
  });
});

router.get("/", (req, res) => {
  const { load_id, mc_number, status, limit = 50 } = req.query;

  let sql = "SELECT * FROM offers WHERE 1=1";
  const params = {};

  if (load_id) {
    sql += " AND load_id = @load_id";
    params.load_id = load_id;
  }
  if (mc_number) {
    sql += " AND mc_number = @mc_number";
    params.mc_number = mc_number;
  }
  if (status) {
    sql += " AND status = @status";
    params.status = status;
  }

  sql += " ORDER BY created_at DESC LIMIT @limit";
  params.limit = Math.min(Number(limit), 100);

  const offers = db.prepare(sql).all(params);
  res.json({ count: offers.length, offers });
});

export default router;
