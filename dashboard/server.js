import express from "express";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const dashboardToken = process.env.DASHBOARD_TOKEN || "";

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

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: "5m"
}));

app.use("/api", (req, res, next) => {
  if (!dashboardToken) {
    next();
    return;
  }

  const expected = `Bearer ${dashboardToken}`;
  if (req.get("authorization") === expected) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
});

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

function selectList(columns, wanted) {
  return wanted
    .filter((column) => columns.has(column))
    .map((column) => `"${column}"`)
    .join(", ");
}

async function maybeLatest(client, tableName, wantedColumns, whereSql = "", params = []) {
  const columns = await tableColumns(client, tableName);
  if (!columns.size || !columns.has("date")) {
    return null;
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
    "name",
    "model",
    "trim_badging",
    "efficiency",
    "inserted_at",
    "updated_at"
  ]);

  if (!fields) {
    return [];
  }

  const { rows } = await client.query(`select ${fields} from "cars" order by "id"`);
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

async function getRecentChargeSessions(client, carId) {
  const columns = await tableColumns(client, "charging_processes");
  if (!columns.size) {
    return [];
  }

  const dateColumn = columns.has("start_date") ? "start_date" : "id";
  const fields = selectList(columns, [
    "id",
    "start_date",
    "end_date",
    "charge_energy_added",
    "cost",
    "duration_min",
    "start_battery_level",
    "end_battery_level",
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
    [...params, 8]
  );

  return rows;
}

function sumNumbers(rows, key) {
  return rows.reduce((sum, row) => sum + (typeof row[key] === "number" ? row[key] : 0), 0);
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
        "ideal_battery_range",
        "rated_battery_range",
        "outside_temp",
        "inside_temp",
        "elevation",
        "shift_state"
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
        "plugged_in"
      ], carWhere, [car.id]);

      const drives = await maybeRecent(client, "drives", [
        "id",
        "start_date",
        "end_date",
        "distance",
        "duration_min",
        "start_ideal_range_km",
        "end_ideal_range_km",
        "outside_temp_avg",
        "inside_temp_avg",
        "speed_max",
        "power_max"
      ], "start_date", carWhere, [car.id], 8);

      const chargingProcess = await getLatestChargeProcess(client, car.id);
      const recentCharges = await getRecentChargeSessions(client, car.id);
      const state = await getLatestState(client, car.id);
      const driveStats = await getDriveStats(client, car.id);
      const chargeStats = await getChargeStats(client, car.id);

      return {
        car,
        state,
        position,
        charge,
        latestChargingProcess: chargingProcess,
        recentCharges,
        recentDrives: drives,
        stats: {
          recentDriveDistance: sumNumbers(drives, "distance"),
          recentChargeEnergy: sumNumbers(recentCharges, "charge_energy_added"),
          recentChargeCost: sumNumbers(recentCharges, "cost"),
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

app.listen(port, () => {
  console.log(`TeslaMate dashboard listening on ${port}`);
});
