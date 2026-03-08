import express from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import "./db.js";
import "./seed.js";
import loadsRouter from "./routes/loads.js";
import carrierRouter from "./routes/carrier.js";
import offersRouter from "./routes/offers.js";
import dashboardRouter from "./routes/dashboard.js";
import negotiateRouter from "./routes/negotiate.js";
import timezoneRouter from "./routes/timezone.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY_SECRET;

app.use(express.json());
app.use(express.static(join(__dirname, "..", "public")));

function authenticate(req, res, next) {
  console.log("API_KEY", API_KEY);
  if (!API_KEY) return next();
  if (req.path === "/health") return next();
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  console.log("headers", req.headers);
  const provided = bearer || req.headers["x-api-key"] || req.query.api_key;
  if (provided !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.use(authenticate);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.json({
    service: "happyrobot-api",
    version: "0.1.0",
    endpoints: {
      loads: "GET /loads",
      load_detail: "GET /loads/:id",
      carrier_verify: "GET /carrier/verify/:mc_number",
      offers: "GET|POST /offers, POST /offers/finalize",
      negotiate: "POST /negotiate",
      timezone: "GET /timezone?city=Chicago,IL",
      dashboard: "GET /dashboard/metrics",
      health: "GET /health",
    },
  });
});

app.use("/loads", loadsRouter);
app.use("/carrier", carrierRouter);
app.use("/offers", offersRouter);
app.use("/negotiate", negotiateRouter);
app.use("/dashboard", dashboardRouter);
app.use("/timezone", timezoneRouter);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Listening on port ${PORT}`);
});
