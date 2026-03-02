import { Router } from "express";
import db from "../db.js";

const router = Router();

const DEADHEAD_RADIUS = 1500;

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocode(place) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "happyrobot-api/0.1 (freight-load-search)" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

router.get("/", async (req, res) => {
  const {
    origin,
    destination,
    equipment_type,
    min_rate,
    max_rate,
    status,
    pickup_date,
    limit = 50,
  } = req.query;

  let useGeo = false;
  let carrierCoords = null;

  if (origin) {
    try {
      carrierCoords = await geocode(origin);
      if (carrierCoords) useGeo = true;
    } catch {
      /* fallback to LIKE */
    }
  }

  let sql = "SELECT * FROM loads WHERE 1=1";
  const params = {};

  if (origin && !useGeo) {
    sql += " AND origin LIKE @origin";
    params.origin = `%${origin}%`;
  }
  if (destination) {
    sql += " AND destination LIKE @destination";
    params.destination = `%${destination}%`;
  }
  if (equipment_type) {
    sql += " AND LOWER(equipment_type) = LOWER(@equipment_type)";
    params.equipment_type = equipment_type;
  }
  if (min_rate) {
    sql += " AND loadboard_rate >= @min_rate";
    params.min_rate = Number(min_rate);
  }
  if (max_rate) {
    sql += " AND loadboard_rate <= @max_rate";
    params.max_rate = Number(max_rate);
  }
  if (status) {
    sql += " AND status = @status";
    params.status = status;
  } else {
    sql += " AND status = 'available'";
  }
  if (pickup_date) {
    sql += " AND DATE(pickup_datetime) = @pickup_date";
    params.pickup_date = pickup_date;
  }

  if (useGeo) {
    sql += " AND lat IS NOT NULL AND lng IS NOT NULL";
  }

  sql += " ORDER BY pickup_datetime ASC LIMIT @limit";
  params.limit = Math.min(Number(limit), 100);

  let loads = db.prepare(sql).all(params);

  if (useGeo) {
    loads = loads
      .map((load) => ({
        ...load,
        deadhead_miles: Math.round(
          haversine(carrierCoords.lat, carrierCoords.lng, load.lat, load.lng)
        ),
      }))
      .filter((load) => load.deadhead_miles <= DEADHEAD_RADIUS)
      .sort((a, b) => a.deadhead_miles - b.deadhead_miles);
  }

  loads = loads.map((load) => ({
    ...load,
    offer_rate: Math.round(load.loadboard_rate * 0.95),
    max_rate: Math.round(load.loadboard_rate * 1.10),
  }));

  res.json({ count: loads.length, loads });
});

router.get("/:id", (req, res) => {
  const load = db.prepare("SELECT * FROM loads WHERE load_id = ?").get(req.params.id);
  if (!load) return res.status(404).json({ error: "Load not found" });
  res.json(load);
});

export default router;
