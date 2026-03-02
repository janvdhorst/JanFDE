import { Router } from "express";
import db from "../db.js";

const router = Router();

const INITIAL_DISCOUNT = 0.05;
const MAX_PREMIUM = 0.10;
const MAX_ROUNDS = 4;

function calcFloor(loadboardRate) {
  return Math.round(loadboardRate * (1 - INITIAL_DISCOUNT));
}

function calcCeiling(loadboardRate) {
  return Math.round(loadboardRate * (1 + MAX_PREMIUM));
}

router.post("/", (req, res) => {
  const { load_id, mc_number, carrier_rate } = req.body;

  if (!load_id || !mc_number) {
    return res.status(400).json({ error: "load_id and mc_number are required" });
  }

  const load = db.prepare("SELECT * FROM loads WHERE load_id = ?").get(load_id);
  if (!load) return res.status(404).json({ error: "Load not found" });
  if (load.status !== "available") {
    return res.json({ action: "unavailable", message: "This load is no longer available." });
  }

  const priorOffers = db
    .prepare("SELECT COUNT(*) AS cnt FROM offers WHERE load_id = ? AND mc_number = ?")
    .get(load_id, mc_number);
  const round = (priorOffers?.cnt || 0) + 1;

  const floor = calcFloor(load.loadboard_rate);
  const ceiling = calcCeiling(load.loadboard_rate);

  if (!carrier_rate) {
    return res.json({
      action: "offer",
      rate: floor,
      load_id,
      round: 1,
      message: `Offer $${floor} to the carrier.`,
    });
  }

  const carrierRate = Number(carrier_rate);

  if (carrierRate <= floor) {
    return res.json({
      action: "accept",
      rate: carrierRate,
      load_id,
      round,
      message: `Accept $${carrierRate}. It's at or below our initial offer.`,
    });
  }

  if (carrierRate <= ceiling) {
    if (round >= MAX_ROUNDS) {
      return res.json({
        action: "accept",
        rate: carrierRate,
        load_id,
        round,
        message: `Accept $${carrierRate}. We've reached round ${round} and it's within our ceiling.`,
      });
    }

    const progress = Math.min(round / MAX_ROUNDS, 0.8);
    const counterRate = Math.round(floor + (carrierRate - floor) * progress);

    if (carrierRate - counterRate < 50) {
      return res.json({
        action: "accept",
        rate: carrierRate,
        load_id,
        round,
        message: `Accept $${carrierRate}. The gap is too small to keep negotiating.`,
      });
    }

    return res.json({
      action: "counter",
      rate: counterRate,
      carrier_rate: carrierRate,
      load_id,
      round,
      next_round: round + 1,
      message: `Counter at $${counterRate}. Carrier asked for $${carrierRate}.`,
    });
  }

  if (round >= MAX_ROUNDS) {
    return res.json({
      action: "final_offer",
      rate: ceiling,
      carrier_rate: carrierRate,
      load_id,
      round,
      message: `Final offer at $${ceiling}. Carrier wants $${carrierRate} which is above our max. If they won't take $${ceiling}, suggest trying a different load or transferring to a rep.`,
    });
  }

  const aggression = Math.min(round / MAX_ROUNDS, 0.7);
  const counterRate = Math.round(floor + (ceiling - floor) * aggression);

  return res.json({
    action: "counter",
    rate: counterRate,
    carrier_rate: carrierRate,
    load_id,
    round,
    next_round: round + 1,
    message: `Counter at $${counterRate}. Carrier wants $${carrierRate} which is above our max of $${ceiling}. Try to bring them down.`,
  });
});

export default router;
