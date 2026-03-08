import { Router } from "express";
import db, { LOADS_TABLE, OFFERS_TABLE } from "../db.js";
import { GetCommand, PutCommand, UpdateCommand, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

const router = Router();

router.post("/", async (req, res) => {
  const {
    load_id,
    mc_number,
    carrier_name,
    session_id,
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

  try {
    const { Item: load } = await db.send(new GetCommand({
      TableName: LOADS_TABLE,
      Key: { load_id }
    }));

    if (!load) return res.status(404).json({ error: "Load not found" });

    const toNum = (v) => { if (v == null || v === "") return null; const n = Number(v); return isNaN(n) ? null : n; };
    const resolvedFinalRate = toNum(final_rate) ?? toNum(agreed_rate) ?? null;

    const { Items: priorOffers } = await db.send(new ScanCommand({
      TableName: OFFERS_TABLE,
      FilterExpression: "load_id = :lid AND mc_number = :mc",
      ExpressionAttributeValues: { ":lid": load_id, ":mc": mc_number }
    }));
    const resolvedRounds = (priorOffers?.length || 0) + 1;
    const resolvedOutcome = call_outcome || classifier_outcome || null;
    const resolvedSentiment = carrier_sentiment || realtime_sentiment || null;

    const id = uuidv4();
    const now = new Date().toISOString();

    await db.send(new PutCommand({
      TableName: OFFERS_TABLE,
      Item: {
        id,
        load_id,
        mc_number,
        carrier_name: carrier_name || null,
        session_id: session_id || null,
        offered_rate: toNum(offered_rate),
        counter_rate: toNum(counter_rate),
        final_rate: resolvedFinalRate,
        status,
        rounds: resolvedRounds,
        call_outcome: resolvedOutcome,
        carrier_sentiment: resolvedSentiment,
        equipment_type: equipment_type || null,
        lanes_requested: lanes_requested || null,
        key_objections: key_objections || null,
        notes: notes || null,
        created_at: now
      }
    }));

    if (status === "accepted" && resolvedFinalRate) {
      await db.send(new UpdateCommand({
        TableName: LOADS_TABLE,
        Key: { load_id },
        UpdateExpression: "SET #status = :s",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":s": "booked" }
      }));
    }

    res.status(201).json({
      id,
      load_id,
      mc_number,
      session_id: session_id || null,
      status,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/finalize", async (req, res) => {
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ error: "session_id is required" });
  }

  function toNum(v) { if (v == null || v === "") return null; const n = Number(v); return isNaN(n) ? null : n; }
  function toBool(v) { if (v === "true" || v === true) return true; if (v === "false" || v === false) return false; return null; }
  function toStr(v) { return v != null && v !== "" ? String(v) : null; }

  try {
    const { Items } = await db.send(new ScanCommand({
      TableName: OFFERS_TABLE,
      FilterExpression: "session_id = :sid",
      ExpressionAttributeValues: { ":sid": session_id }
    }));
    const sorted = (Items || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latest = sorted[0];

    if (!latest) {
      return res.status(404).json({ error: "No offer found for this session_id" });
    }

    const updateParts = [];
    const exprNames = {};
    const exprValues = {};

    function addField(attr, value) {
      if (value != null) {
        updateParts.push(`#${attr} = :${attr}`);
        exprNames[`#${attr}`] = attr;
        exprValues[`:${attr}`] = value;
      }
    }

    addField("duration", toNum(req.body.duration));
    addField("num_total_turns", toNum(req.body.num_total_turns));
    addField("num_user_turns", toNum(req.body.num_user_turns));
    addField("num_assistant_turns", toNum(req.body.num_assistant_turns));
    addField("num_tool_calls", toNum(req.body.num_tool_calls));
    addField("p70_latency_ms", toNum(req.body.p70_latency_ms));
    addField("p90_latency_ms", toNum(req.body.p90_latency_ms));
    addField("num_assistant_cut_messages", toNum(req.body.num_assistant_cut_messages));
    addField("assistant_cut_message_ratio", toNum(req.body.assistant_cut_message_ratio));
    addField("num_user_filler_messages", toNum(req.body.num_user_filler_messages));
    addField("user_filler_message_ratio", toNum(req.body.user_filler_message_ratio));
    addField("is_within_business_hours", toBool(req.body.is_within_business_hours));
    addField("sentiment", toStr(req.body.sentiment));
    addField("call_result", toStr(req.body.call_result));
    addField("user_behavior", toStr(req.body.user_behavior));
    addField("equipment_type", toStr(req.body.equipment_type));

    if (updateParts.length === 0) {
      return res.json({ id: latest.id, session_id, updated: false, message: "No fields to update" });
    }

    await db.send(new UpdateCommand({
      TableName: OFFERS_TABLE,
      Key: { id: latest.id },
      UpdateExpression: `SET ${updateParts.join(", ")}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues
    }));

    res.json({
      id: latest.id,
      session_id,
      updated: true,
      fields_updated: updateParts.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", async (req, res) => {
  const { load_id, mc_number, status, limit = 50 } = req.query;

  try {
    const { Items } = await db.send(new ScanCommand({ TableName: OFFERS_TABLE }));
    let offers = Items || [];

    if (load_id) {
      offers = offers.filter(o => o.load_id === load_id);
    }
    if (mc_number) {
      offers = offers.filter(o => o.mc_number === mc_number);
    }
    if (status) {
      offers = offers.filter(o => o.status === status);
    }

    offers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    offers = offers.slice(0, Math.min(Number(limit), 100));

    res.json({ count: offers.length, offers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
