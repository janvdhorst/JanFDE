import { Router } from "express";
import db, { OFFERS_TABLE } from "../db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";

const router = Router();
const FMCSA_KEY = process.env.FMCSA_API_KEY;
const FMCSA_BASE = "https://mobile.fmcsa.dot.gov/qc/services";

function mockCarrier(mc) {
  const blocked = ["999999", "000000"];
  const verified = !blocked.includes(mc);
  return {
    mc_number: mc,
    verified,
    dot_number: `DOT-${mc}`,
    legal_name: `Carrier MC-${mc} LLC`,
    dba_name: null,
    allowed_to_operate: verified,
    insurance_on_file: verified,
    phone: "555-000-0000",
    address: { street: "123 Main St", city: "Anytown", state: "TX", zip: "75001", country: "US" },
    reason: verified ? "Carrier is authorized to operate" : "Carrier is NOT authorized to operate",
    _source: "mock",
  };
}

async function queryFmcsa(mc) {
  const url = `${FMCSA_BASE}/carriers/docket-number/${mc}?webKey=${FMCSA_KEY}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

  if (response.status === 404) {
    return { mc_number: mc, verified: false, reason: "MC number not found in FMCSA database", _source: "fmcsa" };
  }
  if (!response.ok) return null;

  const data = await response.json();
  const carrier = data?.content?.[0]?.carrier;
  if (!carrier) {
    return { mc_number: mc, verified: false, reason: "No carrier record found", _source: "fmcsa" };
  }

  const allowed = carrier.allowedToOperate === "Y";
  return {
    mc_number: mc,
    verified: allowed,
    dot_number: carrier.dotNumber,
    legal_name: carrier.legalName,
    dba_name: carrier.dbaName || null,
    allowed_to_operate: allowed,
    insurance_on_file: carrier.bipdInsuranceOnFile === "Y",
    phone: carrier.phyPhone || null,
    address: {
      street: carrier.phyStreet,
      city: carrier.phyCity,
      state: carrier.phyState,
      zip: carrier.phyZipcode,
      country: carrier.phyCountry,
    },
    reason: allowed ? "Carrier is authorized to operate" : "Carrier is NOT authorized to operate",
    _source: "fmcsa",
  };
}

router.get("/verify/:mc_number", async (req, res) => {
  const cleaned = req.params.mc_number.replace(/\D/g, "");
  if (!cleaned) return res.status(400).json({ error: "Invalid MC number" });

  let result;
  if (FMCSA_KEY) {
    try {
      result = await queryFmcsa(cleaned);
    } catch (err) {
      console.error(`FMCSA lookup failed for MC ${cleaned}, falling back to mock:`, err.message);
    }
  }
  if (!result) result = mockCarrier(cleaned);

  try {
    await db.send(new PutCommand({
      TableName: OFFERS_TABLE,
      Item: {
        id: `verify-${cleaned}-${Date.now()}`,
        type: "verify",
        mc_number: cleaned,
        carrier_name: result.legal_name || result.dba_name || null,
        verified: result.verified,
        created_at: new Date().toISOString(),
      },
    }));
  } catch (err) {
    console.error("Failed to log verification:", err.message);
  }

  res.json(result);
});

export default router;
