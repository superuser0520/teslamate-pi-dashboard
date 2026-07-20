const statusEl = document.querySelector("#connectionStatus");
const vehicleCountEl = document.querySelector("#vehicleCount");
const lastRefreshEl = document.querySelector("#lastRefresh");
const databaseStatusEl = document.querySelector("#databaseStatus");
const vehicleListEl = document.querySelector("#vehicleList");
const emptyStateEl = document.querySelector("#emptyState");
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
const timeOnly = (input) => input ? new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
}).format(new Date(input)) : "-";

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

function renderVehicle(snapshot) {
  const { car, position, charge, latestChargingProcess, recentDrives } = snapshot;
  const battery = position?.battery_level ?? position?.soc ?? charge?.battery_level;
  const fillWidth = typeof battery === "number" ? Math.max(0, Math.min(100, battery)) : 0;
  const model = [car.model, car.trim_badging].filter(Boolean).join(" ") || "Vehicle";

  return `
    <article class="vehicle">
      <div class="vehicle-header">
        <div class="vehicle-title">
          <h2>${value(car.name || `Tesla ${car.id}`)}</h2>
          <p>${value(model)} - Last data ${dateTime(position?.date || charge?.date || car.updated_at)}</p>
        </div>
        <p class="small">Vehicle ID ${value(car.id)}</p>
      </div>

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
              ${renderKv("Vehicle State", value(vehicleState(snapshot)))}
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
            ${renderKv("Last Session", latestChargingProcess?.start_date ? dateTime(latestChargingProcess.start_date) : "-")}
            ${renderKv("Cost", typeof latestChargingProcess?.cost === "number" ? `$${latestChargingProcess.cost.toFixed(2)}` : "-")}
          </div>
        </section>
      </div>

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

loadDashboard();
setInterval(loadDashboard, 30000);
