const statusEl = document.querySelector("#connectionStatus");
const vehicleCountEl = document.querySelector("#vehicleCount");
const lastRefreshEl = document.querySelector("#lastRefresh");
const databaseStatusEl = document.querySelector("#databaseStatus");
const vehicleListEl = document.querySelector("#vehicleList");
const emptyStateEl = document.querySelector("#emptyState");
const teslamateLinkEl = document.querySelector("#teslamateLink");
const grafanaLinkEl = document.querySelector("#grafanaLink");
const tokenStorageKey = "teslamateDashboardToken";

const miles = (km) => typeof km === "number" ? `${(km * 0.621371).toFixed(1)} mi` : "-";
const fixed = (input, suffix = "", digits = 0) => typeof input === "number" ? `${input.toFixed(digits)}${suffix}` : "-";
const escapeHtml = (input) => String(input ?? "-").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#039;"
})[char]);
const value = (input) => escapeHtml(input ?? "-");
const dateTime = (input) => input ? new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
}).format(new Date(input)) : "-";
const shortDate = (input) => input ? new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric"
}).format(new Date(input)) : "-";
const timeOnly = (input) => input ? new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
}).format(new Date(input)) : "-";

function wireServiceLinks() {
  const { protocol, hostname } = window.location;
  teslamateLinkEl.href = `${protocol}//${hostname}:4000`;
  grafanaLinkEl.href = `${protocol}//${hostname}:3001`;
}

function batteryClass(percent) {
  if (typeof percent !== "number") return "";
  if (percent < 20) return "low";
  if (percent < 50) return "medium";
  return "";
}

function chargingText(charge) {
  if (!charge) return "No charge data";
  return value(charge.charging_state || (charge.plugged_in ? "Plugged in" : "Disconnected"));
}

function vehicleState(snapshot) {
  const chargingState = snapshot.charge?.charging_state;
  if (chargingState && chargingState !== "Disconnected") return chargingState;
  if (snapshot.position?.shift_state) return "Driving";
  return snapshot.state?.state || "Unknown";
}

function mapLink(position) {
  if (!position?.latitude || !position?.longitude) return "-";
  const href = `https://www.google.com/maps/search/?api=1&query=${position.latitude},${position.longitude}`;
  return `<a class="map-link" href="${href}" target="_blank" rel="noreferrer">Open map</a>`;
}

function trendText(snapshot) {
  const drives = snapshot.recentDrives || [];
  const totalKm = drives.reduce((sum, drive) => sum + (typeof drive.distance === "number" ? drive.distance : 0), 0);
  if (!totalKm) return "No recent drives";
  return `${miles(totalKm)} in recent trips`;
}

function renderKv(label, content) {
  return `
    <div class="kv">
      <span class="label">${value(label)}</span>
      <span class="value">${content}</span>
    </div>
  `;
}

function renderDrives(drives = []) {
  if (!drives.length) {
    return `<p class="small">No recent drives yet.</p>`;
  }

  return `
    <table class="table">
      <thead>
        <tr>
          <th>Start</th>
          <th>Distance</th>
          <th>Max Speed</th>
        </tr>
      </thead>
      <tbody>
        ${drives.map((drive) => `
          <tr>
            <td>${dateTime(drive.start_date)}</td>
            <td>${miles(drive.distance)}</td>
            <td>${fixed(drive.speed_max, " mph")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderCharges(charges = []) {
  if (!charges.length) {
    return `<p class="small">No recent charge sessions yet.</p>`;
  }

  return `
    <table class="table">
      <thead>
        <tr>
          <th>Start</th>
          <th>Energy</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        ${charges.map((chargeSession) => `
          <tr>
            <td>${dateTime(chargeSession.start_date)}</td>
            <td>${fixed(chargeSession.charge_energy_added, " kWh", 1)}</td>
            <td>${typeof chargeSession.cost === "number" ? `$${chargeSession.cost.toFixed(2)}` : "-"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderStatTiles(stats = {}) {
  return `
    <div class="stat-strip">
      <div>
        <span>${miles(stats.monthDriveDistance)}</span>
        <small>30 day distance</small>
      </div>
      <div>
        <span>${fixed(stats.monthChargeEnergy, " kWh", 1)}</span>
        <small>30 day charging</small>
      </div>
      <div>
        <span>${typeof stats.monthChargeCost === "number" ? `$${stats.monthChargeCost.toFixed(2)}` : "-"}</span>
        <small>30 day cost</small>
      </div>
    </div>
  `;
}

function renderVehicle(snapshot) {
  const { car, position, charge, latestChargingProcess, recentCharges, recentDrives, stats } = snapshot;
  const battery = position?.battery_level ?? position?.soc ?? charge?.battery_level;
  const fillWidth = typeof battery === "number" ? Math.max(0, Math.min(100, battery)) : 0;
  const model = [car.model, car.trim_badging].filter(Boolean).join(" ") || "Vehicle";
  const state = vehicleState(snapshot);
  const lastDate = position?.date || charge?.date || car.updated_at;

  return `
    <article class="vehicle">
      <section class="vehicle-hero">
        <div class="vehicle-title">
          <p class="eyebrow">${value(model)}</p>
          <h2>${value(car.name || `Tesla ${car.id}`)}</h2>
          <p>Last seen ${dateTime(lastDate)}</p>
        </div>
        <div class="vehicle-visual" aria-hidden="true">
          <div class="car-roof"></div>
          <div class="car-body"></div>
          <div class="car-glass"></div>
        </div>
        <div class="hero-stats">
          <div>
            <span>${typeof battery === "number" ? `${battery}%` : "-"}</span>
            <small>Battery</small>
          </div>
          <div>
            <span>${miles(position?.est_battery_range)}</span>
            <small>Range</small>
          </div>
          <div>
            <span>${value(state)}</span>
            <small>Status</small>
          </div>
        </div>
      </section>

      <div class="vehicle-grid">
        <section class="panel">
          <h3>Battery & Range</h3>
          <div class="battery-wrap">
            <div class="battery">
              <div class="battery-fill ${batteryClass(battery)}" style="width:${fillWidth}%"></div>
              <div class="battery-percent">${typeof battery === "number" ? `${battery}%` : "-"}</div>
            </div>
            <div class="kv-grid">
              ${renderKv("Estimated Range", miles(position?.est_battery_range))}
              ${renderKv("Ideal Range", miles(position?.ideal_battery_range ?? position?.rated_battery_range))}
              ${renderKv("Odometer", miles(position?.odometer))}
              ${renderKv("Recent Trips", value(trendText(snapshot)))}
            </div>
          </div>
        </section>

        <section class="panel">
          <h3>Charging</h3>
          <div class="kv-grid">
            ${renderKv("State", chargingText(charge))}
            ${renderKv("Limit", fixed(charge?.charge_limit_soc, "%"))}
            ${renderKv("Power", fixed(charge?.charger_power, " kW"))}
            ${renderKv("Added", fixed(charge?.charge_energy_added, " kWh", 1))}
            ${renderKv("Last Session", latestChargingProcess?.start_date ? shortDate(latestChargingProcess.start_date) : "-")}
            ${renderKv("Cost", typeof latestChargingProcess?.cost === "number" ? `$${latestChargingProcess.cost.toFixed(2)}` : "-")}
          </div>
        </section>
      </div>

      <section class="panel wide-panel">
        <h3>Statistics</h3>
        ${renderStatTiles(stats)}
      </section>

      <div class="activity-grid">
        <section class="panel">
          <h3>Live Details</h3>
          <div class="kv-grid">
            ${renderKv("Speed", fixed(position?.speed, " mph"))}
            ${renderKv("Power", fixed(position?.power, " kW"))}
            ${renderKv("Outside", fixed(position?.outside_temp, " C", 1))}
            ${renderKv("Inside", fixed(position?.inside_temp, " C", 1))}
            ${renderKv("Elevation", fixed(position?.elevation, " m"))}
            ${renderKv("Location", mapLink(position))}
          </div>
        </section>

        <section class="panel">
          <h3>Recent Drives</h3>
          ${renderDrives(recentDrives)}
        </section>

        <section class="panel">
          <h3>Charge Sessions</h3>
          ${renderCharges(recentCharges)}
        </section>

        <section class="panel">
          <h3>Self Hosted</h3>
          <div class="kv-grid">
            ${renderKv("Data Source", "TeslaMate Postgres")}
            ${renderKv("Privacy", "Local server")}
            ${renderKv("Refresh", "30 seconds")}
            ${renderKv("Vehicle ID", value(car.id))}
          </div>
        </section>
      </div>
    </article>
  `;
}

async function fetchDashboard() {
  const token = localStorage.getItem(tokenStorageKey);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let response = await fetch("/api/dashboard", { cache: "no-store", headers });

  if (response.status === 401) {
    const entered = window.prompt("Dashboard token");
    if (entered) {
      localStorage.setItem(tokenStorageKey, entered);
      response = await fetch("/api/dashboard", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${entered}` }
      });
    }
  }

  return response;
}

async function loadDashboard() {
  try {
    const response = await fetchDashboard();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const cars = data.cars || [];

    statusEl.textContent = "Online";
    statusEl.className = "status-pill online";
    vehicleCountEl.textContent = String(cars.length);
    lastRefreshEl.textContent = timeOnly(data.generatedAt);
    databaseStatusEl.textContent = data.database || "connected";
    emptyStateEl.hidden = cars.length > 0;
    vehicleListEl.innerHTML = cars.map(renderVehicle).join("");
  } catch (error) {
    statusEl.textContent = "Error";
    statusEl.className = "status-pill error";
    databaseStatusEl.textContent = "error";
    vehicleListEl.innerHTML = "";
    emptyStateEl.hidden = false;
    emptyStateEl.querySelector("h2").textContent = "Dashboard unavailable";
    emptyStateEl.querySelector("p").textContent = error.message;
  }
}

wireServiceLinks();
loadDashboard();
setInterval(loadDashboard, 30000);
