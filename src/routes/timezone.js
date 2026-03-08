import { Router } from "express";

const router = Router();

const STATE_TZ = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York",
  FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York",
  LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York",
  MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver",
  NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York",
  NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York",
  RI: "America/New_York", SC: "America/New_York", SD: "America/Chicago",
  TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver",
};

const STATE_NAMES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};

function resolveTimezone(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // Direct IANA timezone (e.g., "America/Chicago")
  try {
    Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch { /* not a valid IANA zone */ }

  // Parse "City, State" or just "State"
  const parts = trimmed.split(",").map(s => s.trim());
  const stateRaw = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  const upper = stateRaw.toUpperCase();

  if (STATE_TZ[upper]) return STATE_TZ[upper];

  const abbr = STATE_NAMES[stateRaw.toLowerCase()];
  if (abbr && STATE_TZ[abbr]) return STATE_TZ[abbr];

  return null;
}

function getLocalTime(tz) {
  const now = new Date();
  const fmt = (opts) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(now);

  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const zoneName = fmt({ timeZoneName: "short" }).split(", ").pop();

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);

  const dayOfWeek = fmt({ weekday: "long" });

  return { timezone: tz, zone_abbr: zoneName, local_date: date, local_time: time, day_of_week: dayOfWeek, tomorrow_date: tomorrowDate };
}

router.get("/", (req, res) => {
  const { city, tz } = req.query;
  const input = tz || city;

  if (!input) {
    return res.status(400).json({ error: "Provide 'city' (e.g., 'Chicago, IL') or 'tz' (e.g., 'America/Chicago')" });
  }

  const timezone = resolveTimezone(input);
  if (!timezone) {
    return res.status(404).json({ error: `Could not determine timezone for "${input}". Use "City, State" format or an IANA timezone.` });
  }

  res.json(getLocalTime(timezone));
});

export default router;
