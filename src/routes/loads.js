import { Router } from "express";
import db, { LOADS_TABLE } from "../db.js";
import { ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

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
      /* fallback to LIKE logic implemented in JS later */
    }
  }

  try {
    // For a small dataset, we'll scan and filter in memory.
    // In production with large data, you'd use GSI/Query or OpenSearch.
    const { Items } = await db.send(new ScanCommand({ TableName: LOADS_TABLE }));
    let loads = Items || [];

    // Apply filters
    if (origin && !useGeo) {
      loads = loads.filter(l => l.origin?.toLowerCase().includes(origin.toLowerCase()));
    }
    if (destination) {
      loads = loads.filter(l => l.destination?.toLowerCase().includes(destination.toLowerCase()));
    }
    if (equipment_type) {
      loads = loads.filter(l => l.equipment_type?.toLowerCase() === equipment_type.toLowerCase());
    }
    if (min_rate) {
      loads = loads.filter(l => l.loadboard_rate >= Number(min_rate));
    }
    if (max_rate) {
      loads = loads.filter(l => l.loadboard_rate <= Number(max_rate));
    }
    if (status) {
      loads = loads.filter(l => l.status === status);
    } else {
      loads = loads.filter(l => l.status === 'available');
    }
    if (pickup_date) {
      loads = loads.filter(l => l.pickup_datetime && l.pickup_datetime.slice(0, 10) >= pickup_date);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      loads = loads.filter(l => !l.pickup_datetime || l.pickup_datetime.slice(0, 10) >= today);
    }
    if (useGeo) {
      loads = loads.filter(l => l.lat != null && l.lng != null);
    }

    // Sort by pickup_datetime ASC
    loads.sort((a, b) => new Date(a.pickup_datetime) - new Date(b.pickup_datetime));

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

    // Apply limit
    loads = loads.slice(0, Math.min(Number(limit), 100));

    loads = loads.map(load => {
      const offerRate = Math.round(Number(load.loadboard_rate) * 0.85);
      const deadhead = load.deadhead_miles || 0;
      const totalMiles = Number(load.miles) + deadhead;
      const effectiveRpm = totalMiles > 0 ? (offerRate / totalMiles).toFixed(2) : 0;

      return {
        ...load,
        offer_rate: offerRate,
        effective_rpm: Number(effectiveRpm),
      };
    });

    loads = loads.slice(0, 5);

    const search_meta = {
      geo_search: useGeo,
      radius_miles: useGeo ? DEADHEAD_RADIUS : null,
      origin_searched: origin || null,
    };
    if (useGeo && loads.length === 0) {
      search_meta.note = `No loads found within ${DEADHEAD_RADIUS} miles of ${origin}. The entire region has been searched — do not retry with nearby cities.`;
    }

    res.json({ count: loads.length, search_meta, loads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch loads" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { Item } = await db.send(new GetCommand({
      TableName: LOADS_TABLE,
      Key: { load_id: req.params.id }
    }));
    if (!Item) return res.status(404).json({ error: "Load not found" });
    res.json(Item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch load" });
  }
});

export default router;
