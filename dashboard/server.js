import express from "express";
import pg from "pg";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const dashboardToken = process.env.DASHBOARD_TOKEN || "";
const dashboardUsername = process.env.DASHBOARD_USERNAME || "soolihjing@icloud.com";
const defaultPasswordHash = "a963512a6a78060c4ec324cd7ba05485:4707ce4138e9f915e70595b4ff2fe37b37da9a80337bf036550b4c2c15cd1d38380b9f45aaae77ed6b149ac4cadfd96f3c5f7513bed8fbf15d24db3e1c1817cf";
const dashboardPasswordHash = process.env.DASHBOARD_PASSWORD_HASH || defaultPasswordHash;
const sessionSecret = process.env.DASHBOARD_SESSION_SECRET || process.env.ENCRYPTION_KEY || process.env.POSTGRES_PASSWORD || "change-this-dashboard-secret";
const sessionCookie = "tm_dashboard_session";

const pool = new Pool({
  host: process.env.DATABASE_HOST || "database",
  port: Number(process.env.DATABASE_PORT || 5432),
  user: process.env.DATABASE_USER || "teslamate",
  password: process.env.DATABASE_PASS || process.env.POSTGRES_PASSWORD,
  database: process.env.DATABASE_NAME || "teslamate",
  max: 5,
  idleTimeoutMillis: 30000
});

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [decodeURIComponent(key), decodeURIComponent(rest.join("="))];
  }));
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readSession(req) {
  const token = parseCookies(req)[sessionCookie];
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    if (payload.username !== dashboardUsername) return null;
    return payload;
  } catch {
    return null;
  }
}

function verifyPassword(password) {
  const [salt, stored] = dashboardPasswordHash.split(":");
  if (!salt || !stored) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  if (Buffer.byteLength(candidate, "hex") !== Buffer.byteLength(stored, "hex")) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(stored, "hex"));
}

function hasBearerAccess(req) {
  return dashboardToken && req.get("authorization") === `Bearer ${dashboardToken}`;
}

function isAuthenticated(req) {
  return hasBearerAccess(req) || Boolean(readSession(req));
}

function setSessionCookie(res, remember) {
  const maxAge = remember ? 1000 * 60 * 60 * 24 * 30 : undefined;
  const exp = remember ? Date.now() + maxAge : undefined;
  const token = signSession({ username: dashboardUsername, exp });
  const parts = [
    `${sessionCookie}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (maxAge) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  if (process.env.DASHBOARD_SECURE_COOKIE === "true") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

app.get("/login", (req, res) => {
  if (isAuthenticated(req)) {
    res.redirect("/");
    return;
  }
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const remember = req.body.remember === "on";

  if (username === dashboardUsername.toLowerCase() && verifyPassword(password)) {
    setSessionCookie(res, remember);
    res.redirect("/");
    return;
  }

  res.redirect("/login?error=1");
});

app.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.redirect("/login");
});

app.use((req, res, next) => {
  if (req.path === "/login" || req.path === "/styles.css" || req.path === "/manifest.webmanifest") {
    next();
    return;
  }
  if (isAuthenticated(req)) {
    next();
    return;
  }
  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.redirect("/login");
});

app.use("/api", (req, res, next) => {
  if (isAuthenticated(req)) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
});

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: "5m"
}));

async function tableColumns(client, tableName) {
  const { rows } = await client.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = $1`,
    [tableName]
  );

  return new Set(rows.map((row) => row.column_name));
}

async function hasTable(client, tableName) {
  const { rows } = await client.query(
    `select 1
       from information_schema.tables
      where table_schema = 'public'
        and table_name = $1
      limit 1`,
    [tableName]
  );
  return rows.length > 0;
}

function selectList(columns, wanted) {
  return wanted
    .filter((column) => columns.has(column))
    .map((column) => `"${column}"`)
    .join(", ");
}

function columnExpr(columns, tableAlias, column, fallback = "null") {
  return columns.has(column) ? `${tableAlias}."${column}"` : `${fallback} as "${column}"`;
}

async function maybeLatest(client, tableName, wantedColumns, whereSql = "", params = []) {
  const columns = await tableColumns(client, tableName);
  if (!columns.size || !columns.has("date")) {
    return null;
  }

  if (whereSql.includes('"car_id"') && !columns.has("car_id")) {
    whereSql = "";
    params = [];
  }

  const fields = selectList(columns, wantedColumns);
  if (!fields) {
    return null;
  }

  const { rows } = await client.query(
    `select ${fields}
       from "${tableName}"
      ${whereSql}
      order by "date" desc
      limit 1`,
    params
  );

  return rows[0] || null;
}

async function maybeRecent(client, tableName, wantedColumns, dateColumn, whereSql = "", params = [], limit = 10) {
  const columns = await tableColumns(client, tableName);
  if (!columns.size || !columns.has(dateColumn)) {
    return [];
  }

  if (whereSql.includes('"car_id"') && !columns.has("car_id")) {
    whereSql = "";
    params = [];
  }

  const fields = selectList(columns, wantedColumns);
  if (!fields) {
    return [];
  }

  const { rows } = await client.query(
    `select ${fields}
       from "${tableName}"
      ${whereSql}
      order by "${dateColumn}" desc
      limit $${params.length + 1}`,
    [...params, limit]
  );

  return rows;
}

async function getCars(client) {
  const columns = await tableColumns(client, "cars");
  const fields = selectList(columns, [
    "id",
    "eid",
    "vid",
    "vin",
    "name",
    "model",
    "trim_badging",
    "marketing_name",
    "exterior_color",
    "wheel_type",
    "spoiler_type",
    "display_priority",
    "efficiency",
    "inserted_at",
    "updated_at"
  ]);

  if (!fields) {
    return [];
  }

  const orderBy = columns.has("display_priority") ? `"display_priority" nulls last, "id"` : `"id"`;
  const { rows } = await client.query(`select ${fields} from "cars" order by ${orderBy}`);
  return rows;
}

async function getLatestChargeProcess(client, carId) {
  const columns = await tableColumns(client, "charging_processes");
  if (!columns.size) {
    return null;
  }

  const carFilter = columns.has("car_id") ? `where "car_id" = $1` : "";
  const params = columns.has("car_id") ? [carId] : [];
  const dateColumn = columns.has("start_date") ? "start_date" : "id";
  const fields = selectList(columns, [
    "id",
    "start_date",
    "end_date",
    "address_id",
    "position_id",
    "charge_energy_added",
    "cost",
    "duration_min"
  ]);

  if (!fields) {
    return null;
  }

  const { rows } = await client.query(
    `select ${fields}
       from "charging_processes"
      ${carFilter}
      order by "${dateColumn}" desc
      limit 1`,
    params
  );

  return rows[0] || null;
}

async function getLatestState(client, carId) {
  const columns = await tableColumns(client, "states");
  if (!columns.size || !columns.has("start_date")) {
    return null;
  }

  const fields = selectList(columns, [
    "start_date",
    "end_date",
    "state"
  ]);
  if (!fields) {
    return null;
  }

  const whereSql = columns.has("car_id") ? `where "car_id" = $1` : "";
  const params = columns.has("car_id") ? [carId] : [];
  const { rows } = await client.query(
    `select ${fields}
       from "states"
      ${whereSql}
      order by "start_date" desc
      limit 1`,
    params
  );

  return rows[0] || null;
}

async function getRecentChargeSessions(client, carId, limit = 60) {
  const columns = await tableColumns(client, "charging_processes");
  if (!columns.size) {
    return [];
  }

  const dateColumn = columns.has("start_date") ? "start_date" : "id";
  const fields = selectList(columns, [
    "id",
    "start_date",
    "end_date",
    "address_id",
    "geofence_id",
    "position_id",
    "charge_energy_added",
    "charge_energy_used",
    "cost",
    "duration_min",
    "start_battery_level",
    "end_battery_level",
    "start_ideal_range_km",
    "end_ideal_range_km",
    "outside_temp_avg"
  ]);
  if (!fields) {
    return [];
  }

  const whereSql = columns.has("car_id") ? `where "car_id" = $1` : "";
  const params = columns.has("car_id") ? [carId] : [];
  const { rows } = await client.query(
    `select ${fields}
      from "charging_processes"
      ${whereSql}
      order by "${dateColumn}" desc
      limit $${params.length + 1}`,
    [...params, limit]
  );

  return rows;
}

function sumNumbers(rows, key) {
  return rows.reduce((sum, row) => {
    const parsed = Number(row[key]);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
}

function sampleRows(rows, maxPoints = 120) {
  if (rows.length <= maxPoints) return rows;
  const stride = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % stride === 0);
}

async function getDrivePositions(client, driveId) {
  const columns = await tableColumns(client, "positions");
  if (!columns.has("drive_id") || !columns.has("date")) return [];

  const fields = selectList(columns, [
    "date",
    "latitude",
    "longitude",
    "speed",
    "power",
    "battery_level",
    "elevation",
    "outside_temp",
    "inside_temp",
    "tpms_pressure_fl",
    "tpms_pressure_fr",
    "tpms_pressure_rl",
    "tpms_pressure_rr"
  ]);
  if (!fields) return [];

  const { rows } = await client.query(
    `select ${fields}
       from "positions"
      where "drive_id" = $1
      order by "date" asc`,
    [driveId]
  );

  return sampleRows(rows, 160);
}

async function getChargePoints(client, chargeProcessId) {
  const columns = await tableColumns(client, "charges");
  if (!columns.has("charging_process_id") || !columns.has("date")) return [];

  const fields = selectList(columns, [
    "date",
    "battery_level",
    "usable_battery_level",
    "charger_power",
    "charger_voltage",
    "charger_actual_current",
    "ideal_battery_range_km",
    "rated_battery_range_km",
    "outside_temp"
  ]);
  if (!fields) return [];

  const { rows } = await client.query(
    `select ${fields}
       from "charges"
      where "charging_process_id" = $1
      order by "date" asc`,
    [chargeProcessId]
  );

  return sampleRows(rows, 160);
}

async function attachDriveDetails(client, drives, limit = 24) {
  return Promise.all(drives.map(async (drive, index) => ({
    ...drive,
    positions: index < limit ? await getDrivePositions(client, drive.id) : []
  })));
}

async function attachChargeDetails(client, charges, limit = 24) {
  return Promise.all(charges.map(async (charge, index) => ({
    ...charge,
    points: index < limit ? await getChargePoints(client, charge.id) : []
  })));
}

async function getSocHistory(client, carId, hours = 168) {
  const points = [];
  const positionColumns = await tableColumns(client, "positions");
  if (positionColumns.has("date") && (positionColumns.has("battery_level") || positionColumns.has("soc"))) {
    const batteryColumn = positionColumns.has("battery_level") ? "battery_level" : "soc";
    const rangeColumn = positionColumns.has("rated_battery_range_km") ? "rated_battery_range_km" : null;
    const where = positionColumns.has("car_id")
      ? `where "car_id" = $1 and "date" >= now() - ($2 || ' hours')::interval`
      : `where "date" >= now() - ($1 || ' hours')::interval`;
    const params = positionColumns.has("car_id") ? [carId, hours] : [hours];
    const { rows } = await client.query(
      `select "date", "${batteryColumn}" as "battery_level"${rangeColumn ? `, "${rangeColumn}" as "range_km"` : `, null as "range_km"`}
         from "positions"
        ${where}
        order by "date" asc`,
      params
    );
    points.push(...rows);
  }

  const chargeColumns = await tableColumns(client, "charges");
  const processColumns = await tableColumns(client, "charging_processes");
  if (chargeColumns.has("date") && chargeColumns.has("battery_level") && chargeColumns.has("charging_process_id") && processColumns.has("id")) {
    const carJoin = processColumns.has("car_id") ? `and cp."car_id" = $1` : "";
    const params = processColumns.has("car_id") ? [carId, hours] : [hours];
    const hoursParam = processColumns.has("car_id") ? "$2" : "$1";
    const rangeColumn = chargeColumns.has("rated_battery_range_km") ? `c."rated_battery_range_km"` : "null";
    const { rows } = await client.query(
      `select c."date", c."battery_level", ${rangeColumn} as "range_km"
         from "charges" c
         join "charging_processes" cp on cp."id" = c."charging_process_id"
        where c."date" >= now() - (${hoursParam} || ' hours')::interval
          ${carJoin}
        order by c."date" asc`,
      params
    );
    points.push(...rows);
  }

  points.sort((a, b) => new Date(a.date) - new Date(b.date));
  return sampleRows(points, 220);
}

async function getStateTimeline(client, carId, hours = 168) {
  const events = [];

  const statesColumns = await tableColumns(client, "states");
  if (statesColumns.has("start_date")) {
    const fields = selectList(statesColumns, ["start_date", "end_date", "state"]);
    const where = statesColumns.has("car_id")
      ? `where "car_id" = $1 and "start_date" >= now() - ($2 || ' hours')::interval`
      : `where "start_date" >= now() - ($1 || ' hours')::interval`;
    const params = statesColumns.has("car_id") ? [carId, hours] : [hours];
    const { rows } = await client.query(`select ${fields} from "states" ${where} order by "start_date" desc limit 80`, params);
    events.push(...rows.map((row) => ({ type: row.state || "state", start_date: row.start_date, end_date: row.end_date })));
  }

  const driveColumns = await tableColumns(client, "drives");
  if (driveColumns.has("start_date")) {
    const where = driveColumns.has("car_id")
      ? `where "car_id" = $1 and "start_date" >= now() - ($2 || ' hours')::interval`
      : `where "start_date" >= now() - ($1 || ' hours')::interval`;
    const params = driveColumns.has("car_id") ? [carId, hours] : [hours];
    const { rows } = await client.query(`select "id", "start_date", ${driveColumns.has("end_date") ? `"end_date"` : `null as "end_date"`}, ${driveColumns.has("distance") ? `"distance"` : `null as "distance"`} from "drives" ${where} order by "start_date" desc limit 80`, params);
    events.push(...rows.map((row) => ({ ...row, type: "drive" })));
  }

  const chargeColumns = await tableColumns(client, "charging_processes");
  if (chargeColumns.has("start_date")) {
    const where = chargeColumns.has("car_id")
      ? `where "car_id" = $1 and "start_date" >= now() - ($2 || ' hours')::interval`
      : `where "start_date" >= now() - ($1 || ' hours')::interval`;
    const params = chargeColumns.has("car_id") ? [carId, hours] : [hours];
    const { rows } = await client.query(`select "id", "start_date", ${chargeColumns.has("end_date") ? `"end_date"` : `null as "end_date"`}, ${chargeColumns.has("charge_energy_added") ? `"charge_energy_added"` : `null as "charge_energy_added"`} from "charging_processes" ${where} order by "start_date" desc limit 80`, params);
    events.push(...rows.map((row) => ({ ...row, type: "charge" })));
  }

  return events.sort((a, b) => new Date(b.start_date) - new Date(a.start_date)).slice(0, 120);
}

async function getBatteryHealth(client, carId) {
  const columns = await tableColumns(client, "charges");
  const processColumns = await tableColumns(client, "charging_processes");
  if (!columns.has("battery_level") || !columns.has("date") || !columns.has("charging_process_id") || !processColumns.has("id")) {
    return { points: [] };
  }

  const rangeColumn = columns.has("ideal_battery_range_km") ? "ideal_battery_range_km" : (columns.has("rated_battery_range_km") ? "rated_battery_range_km" : null);
  if (!rangeColumn) return { points: [] };

  const carJoin = processColumns.has("car_id") ? `and cp."car_id" = $1` : "";
  const params = processColumns.has("car_id") ? [carId] : [];
  const { rows } = await client.query(
    `select date(c."date") as "date",
            max(c."${rangeColumn}")::float as "range_km",
            max(c."battery_level")::float as "battery_level"
       from "charges" c
       join "charging_processes" cp on cp."id" = c."charging_process_id"
      where c."battery_level" >= 90 ${carJoin}
      group by date(c."date")
      order by date(c."date") desc
      limit 80`,
    params
  );

  const latest = rows[0]?.range_km || null;
  const oldest = rows.at(-1)?.range_km || null;
  return {
    currentRangeKm: latest,
    originalRangeKm: oldest,
    degradationPercent: latest && oldest ? (1 - latest / oldest) * 100 : null,
    points: rows.reverse()
  };
}

async function getDriveStats(client, carId) {
  const columns = await tableColumns(client, "drives");
  if (!columns.size || !columns.has("start_date")) {
    return { monthDriveDistance: 0 };
  }

  const distanceExpr = columns.has("distance") ? `coalesce(sum("distance"), 0)` : "0";
  const where = columns.has("car_id")
    ? `where "car_id" = $1 and "start_date" >= now() - interval '30 days'`
    : `where "start_date" >= now() - interval '30 days'`;
  const params = columns.has("car_id") ? [carId] : [];
  const { rows } = await client.query(
    `select ${distanceExpr}::float as "monthDriveDistance" from "drives" ${where}`,
    params
  );

  return rows[0] || { monthDriveDistance: 0 };
}

async function getChargeStats(client, carId) {
  const columns = await tableColumns(client, "charging_processes");
  if (!columns.size || !columns.has("start_date")) {
    return { monthChargeEnergy: 0, monthChargeCost: 0 };
  }

  const energyExpr = columns.has("charge_energy_added") ? `coalesce(sum("charge_energy_added"), 0)` : "0";
  const costExpr = columns.has("cost") ? `coalesce(sum("cost"), 0)` : "0";
  const where = columns.has("car_id")
    ? `where "car_id" = $1 and "start_date" >= now() - interval '30 days'`
    : `where "start_date" >= now() - interval '30 days'`;
  const params = columns.has("car_id") ? [carId] : [];
  const { rows } = await client.query(
    `select ${energyExpr}::float as "monthChargeEnergy",
            ${costExpr}::float as "monthChargeCost"
       from "charging_processes"
      ${where}`,
    params
  );

  return rows[0] || { monthChargeEnergy: 0, monthChargeCost: 0 };
}

async function getDashboard() {
  const client = await pool.connect();

  try {
    const cars = await getCars(client);
    const snapshots = await Promise.all(cars.map(async (car) => {
      const carWhere = `where "car_id" = $1`;

      const position = await maybeLatest(client, "positions", [
        "id",
        "date",
        "latitude",
        "longitude",
        "speed",
        "power",
        "odometer",
        "soc",
        "battery_level",
        "usable_battery_level",
        "est_battery_range",
        "est_battery_range_km",
        "ideal_battery_range",
        "ideal_battery_range_km",
        "rated_battery_range",
        "rated_battery_range_km",
        "outside_temp",
        "inside_temp",
        "elevation",
        "shift_state",
        "heading",
        "is_climate_on",
        "is_preconditioning",
        "locked",
        "sentry_mode",
        "tpms_pressure_fl",
        "tpms_pressure_fr",
        "tpms_pressure_rl",
        "tpms_pressure_rr"
      ], carWhere, [car.id]);

      const charge = await maybeLatest(client, "charges", [
        "date",
        "battery_level",
        "usable_battery_level",
        "charge_energy_added",
        "charger_power",
        "charger_voltage",
        "charger_actual_current",
        "charger_phases",
        "charge_limit_soc",
        "charging_state",
        "fast_charger_present",
        "conn_charge_cable",
        "plugged_in",
        "scheduled_charging_start_time",
        "ideal_battery_range_km",
        "rated_battery_range_km"
      ], carWhere, [car.id]);

      const drives = await maybeRecent(client, "drives", [
        "id",
        "start_date",
        "end_date",
        "start_address_id",
        "end_address_id",
        "start_geofence_id",
        "end_geofence_id",
        "start_position_id",
        "end_position_id",
        "distance",
        "duration_min",
        "start_ideal_range_km",
        "end_ideal_range_km",
        "start_rated_range_km",
        "end_rated_range_km",
        "outside_temp_avg",
        "inside_temp_avg",
        "speed_max",
        "power_max",
        "power_min"
      ], "start_date", carWhere, [car.id], 180);

      const chargingProcess = await getLatestChargeProcess(client, car.id);
      const recentCharges = await getRecentChargeSessions(client, car.id);
      const state = await getLatestState(client, car.id);
      const driveStats = await getDriveStats(client, car.id);
      const chargeStats = await getChargeStats(client, car.id);
      const detailedDrives = await attachDriveDetails(client, drives);
      const detailedCharges = await attachChargeDetails(client, recentCharges);
      const socHistory = await getSocHistory(client, car.id);
      const timeline = await getStateTimeline(client, car.id);
      const batteryHealth = await getBatteryHealth(client, car.id);

      return {
        car,
        state,
        position,
        charge,
        latestChargingProcess: chargingProcess,
        recentCharges: detailedCharges,
        recentDrives: detailedDrives,
        socHistory,
        timeline,
        batteryHealth,
        stats: {
          recentDriveDistance: sumNumbers(detailedDrives, "distance"),
          recentChargeEnergy: sumNumbers(detailedCharges, "charge_energy_added"),
          recentChargeCost: sumNumbers(detailedCharges, "cost"),
          ...driveStats,
          ...chargeStats
        }
      };
    }));

    return {
      generatedAt: new Date().toISOString(),
      database: "connected",
      cars: snapshots
    };
  } finally {
    client.release();
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard", async (_req, res) => {
  try {
    res.json(await getDashboard());
  } catch (error) {
    res.status(500).json({
      error: "Could not load TeslaMate data",
      detail: error.message
    });
  }
});

function ok(res, data) {
  res.json({ code: 200, message: "success", data });
}

app.get("/api/v1/cars", async (_req, res) => {
  const client = await pool.connect();
  try {
    ok(res, await getCars(client));
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get("/api/v1/cars/:id/status", async (req, res) => {
  try {
    const data = await getDashboard();
    const snapshot = data.cars.find((item) => String(item.car.id) === req.params.id);
    if (!snapshot) {
      res.status(404).json({ error: "Car not found" });
      return;
    }
    ok(res, snapshot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/cars/:id/drives", async (req, res) => {
  try {
    const data = await getDashboard();
    const snapshot = data.cars.find((item) => String(item.car.id) === req.params.id);
    ok(res, snapshot?.recentDrives || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/drives/:id", async (req, res) => {
  try {
    const data = await getDashboard();
    const drive = data.cars.flatMap((snapshot) => snapshot.recentDrives || []).find((item) => String(item.id) === req.params.id);
    if (!drive) {
      res.status(404).json({ error: "Drive not found" });
      return;
    }
    ok(res, drive);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/cars/:id/charges", async (req, res) => {
  try {
    const data = await getDashboard();
    const snapshot = data.cars.find((item) => String(item.car.id) === req.params.id);
    ok(res, snapshot?.recentCharges || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/charges/:id", async (req, res) => {
  try {
    const data = await getDashboard();
    const charge = data.cars.flatMap((snapshot) => snapshot.recentCharges || []).find((item) => String(item.id) === req.params.id);
    if (!charge) {
      res.status(404).json({ error: "Charge not found" });
      return;
    }
    ok(res, charge);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/drives/:id/positions", async (req, res) => {
  const client = await pool.connect();
  try {
    ok(res, await getDrivePositions(client, req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get("/api/v1/charges/:id/stats", async (req, res) => {
  const client = await pool.connect();
  try {
    ok(res, await getChargePoints(client, req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get("/api/v1/cars/:id/stats/soc-history", async (req, res) => {
  const client = await pool.connect();
  try {
    ok(res, await getSocHistory(client, req.params.id, Number(req.query.hours || 168)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get("/api/v1/cars/:id/stats/states-timeline", async (req, res) => {
  const client = await pool.connect();
  try {
    ok(res, await getStateTimeline(client, req.params.id, Number(req.query.hours || 168)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get("/api/v1/cars/:id/stats/battery", async (req, res) => {
  const client = await pool.connect();
  try {
    ok(res, await getBatteryHealth(client, req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get("/api/v1/cars/:id/stats/overview", async (req, res) => {
  try {
    const data = await getDashboard();
    const snapshot = data.cars.find((item) => String(item.car.id) === req.params.id);
    if (!snapshot) {
      res.status(404).json({ error: "Car not found" });
      return;
    }
    ok(res, {
      car: snapshot.car,
      state: snapshot.state,
      position: snapshot.position,
      charge: snapshot.charge,
      stats: snapshot.stats,
      batteryHealth: snapshot.batteryHealth
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/cars/:id/stats/efficiency", async (req, res) => {
  try {
    const data = await getDashboard();
    const snapshot = data.cars.find((item) => String(item.car.id) === req.params.id);
    const drives = snapshot?.recentDrives || [];
    const items = drives
      .filter((drive) => Number(drive.distance) > 0)
      .map((drive) => {
        const rangeUsed = Number(drive.start_ideal_range_km || 0) - Number(drive.end_ideal_range_km || 0);
        return {
          date: drive.start_date,
          distance: drive.distance,
          rangeUsed,
          efficiency: rangeUsed > 0 ? rangeUsed / Number(drive.distance) * 153 : null
        };
      });
    ok(res, items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/cars/:id/drives/stats_summary", async (req, res) => {
  try {
    const data = await getDashboard();
    const snapshot = data.cars.find((item) => String(item.car.id) === req.params.id);
    const drives = snapshot?.recentDrives || [];
    ok(res, {
      totalDistance: sumNumbers(drives, "distance"),
      driveCount: drives.length,
      maxSpeed: Math.max(0, ...drives.map((drive) => Number(drive.speed_max) || 0)),
      totalDuration: sumNumbers(drives, "duration_min")
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/cars/:id/charges/stats_summary", async (req, res) => {
  try {
    const data = await getDashboard();
    const snapshot = data.cars.find((item) => String(item.car.id) === req.params.id);
    const charges = snapshot?.recentCharges || [];
    ok(res, {
      totalEnergy: sumNumbers(charges, "charge_energy_added"),
      totalCost: sumNumbers(charges, "cost"),
      totalDuration: sumNumbers(charges, "duration_min"),
      totalCount: charges.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/auth/test", (_req, res) => {
  ok(res, { status: "ok", message: "API key is valid" });
});

app.get("/api/v1/settings", (_req, res) => {
  ok(res, { storage: "browser-local-storage", writable: false });
});

app.listen(port, () => {
  console.log(`TeslaMate dashboard listening on ${port}`);
});
