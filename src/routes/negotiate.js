import { Router } from "express";
import db, { LOADS_TABLE, OFFERS_TABLE } from "../db.js";
import { GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const router = Router();

const FLOOR_PCT = 0.85;
const STEP2_PCT = 0.90;
const TARGET_PCT = 0.95;
const CEILING_PCT = 1.00;
const MAX_ROUNDS = 3;

function buildLadder(loadboardRate) {
  return {
    floor: Math.round(loadboardRate * FLOOR_PCT),
    step2: Math.round(loadboardRate * STEP2_PCT),
    target: Math.round(loadboardRate * TARGET_PCT),
    ceiling: Math.round(loadboardRate * CEILING_PCT),
  };
}

router.post("/", async (req, res) => {
  const { load_id, mc_number, carrier_rate } = req.body;

  if (!load_id || !mc_number) {
    return res.status(400).json({ error: "load_id and mc_number are required" });
  }

  try {
    const { Item: load } = await db.send(new GetCommand({
      TableName: LOADS_TABLE,
      Key: { load_id }
    }));

    if (!load) return res.status(404).json({ error: "Load not found" });
    if (load.status !== "available") {
      return res.json({ action: "unavailable", message: "This load is no longer available." });
    }

    const { Items: priorOffers } = await db.send(new ScanCommand({
      TableName: OFFERS_TABLE,
      FilterExpression: "load_id = :lid AND mc_number = :mc",
      ExpressionAttributeValues: { ":lid": load_id, ":mc": mc_number }
    }));

    const round = (priorOffers?.length || 0) + 1;
    const rate = Number(load.loadboard_rate);
    const { floor, step2, target, ceiling } = buildLadder(rate);

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
        message: `Accept $${carrierRate}. It's at or below our opening offer.`,
      });
    }

    // round counts prior log_offer records + 1.
    // The prompt always calls log_offer BEFORE negotiate, so:
    //   round 2 = 1st counter, round 3 = 2nd counter, round 4 = 3rd counter

    if (round <= 2) {
      if (carrierRate <= step2) {
        return res.json({
          action: "accept",
          rate: carrierRate,
          load_id,
          round,
          message: `Accept $${carrierRate}. It's at or below our next step.`,
        });
      }
      return res.json({
        action: "counter",
        rate: step2,
        carrier_rate: carrierRate,
        load_id,
        round,
        next_round: round + 1,
        message: `Counter at $${step2}. Never accept on the first counter — always negotiate.`,
      });
    }

    if (round === 3) {
      if (carrierRate <= target) {
        return res.json({
          action: "accept",
          rate: carrierRate,
          load_id,
          round,
          message: `Accept $${carrierRate}. Carrier is at or below our target.`,
        });
      }
      return res.json({
        action: "counter",
        rate: target,
        carrier_rate: carrierRate,
        load_id,
        round,
        next_round: 4,
        message: `Counter at $${target}. Push back — this is a strong offer.`,
      });
    }

    if (round === 4) {
      if (carrierRate <= ceiling) {
        return res.json({
          action: "accept",
          rate: carrierRate,
          load_id,
          round,
          message: `Accept $${carrierRate}. It's within our limit.`,
        });
      }
      return res.json({
        action: "final_offer",
        rate: ceiling,
        carrier_rate: carrierRate,
        load_id,
        round,
        message: `Final offer at $${ceiling}. Carrier wants $${carrierRate} which is above market. If they won't take $${ceiling}, suggest a different lane.`,
      });
    }

    if (carrierRate <= ceiling) {
      return res.json({
        action: "accept",
        rate: carrierRate,
        load_id,
        round,
        message: `Accept $${carrierRate}. We've exhausted negotiation rounds and it's within our limit.`,
      });
    }

    return res.json({
      action: "final_offer",
      rate: ceiling,
      carrier_rate: carrierRate,
      load_id,
      round,
      message: `Final offer at $${ceiling}. Carrier wants $${carrierRate}. This is our absolute maximum — take it or try a different lane.`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
