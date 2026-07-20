const statusEl = document.querySelector("#connectionStatus");
const appViewEl = document.querySelector("#appView");
const emptyStateEl = document.querySelector("#emptyState");
const teslamateLinkEl = document.querySelector("#teslamateLink");
const grafanaLinkEl = document.querySelector("#grafanaLink");
const pageTitleEl = document.querySelector("#pageTitle");
const pageSubtitleEl = document.querySelector("#pageSubtitle");
const tabButtons = [...document.querySelectorAll(".tab-button")];

const tokenStorageKey = "teslamateDashboardToken";
const settingsStorageKey = "teslamateDashboardSettings";

let dashboardData = null;
let activeTab = "overview";
let settings = loadSettings();

const currencyOptions = [
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "SGD", label: "Singapore Dollar", symbol: "S$" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "CAD", label: "Canadian Dollar", symbol: "C$" },
  { code: "MYR", label: "Malaysian Ringgit", symbol: "RM" },
  { code: "JPY", label: "Japanese Yen", symbol: "¥" }
];

const escapeHtml = (input) => String(input ?? "-").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#039;"
})[char]);
const value = (input) => escapeHtml(input ?? "-");
const number = (input, digits = 0) => typeof input === "number" ? input.toFixed(digits) : "-";
const fixed = (input, suffix = "", digits = 0) => typeof input === "number" ? `${input.toFixed(digits)}${suffix}` : "-";
const dateTime = (input) => input ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(input)) : "-";
const shortDate = (input) => input ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(input)) : "-";
const timeOnly = (input) => input ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(input)) : "-";
const monthLabel = (input) => input ? new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(input)) : "Unknown";

function loadSettings() {
  try {
    return {
      distanceUnit: "mi",
      currency: "USD",
      ...JSON.parse(localStorage.getItem(settingsStorageKey) || "{}")
    };
  } catch {
    return { distanceUnit: "mi", currency: "USD" };
  }
}

function saveSettings(nextSettings) {
  settings = { ...settings, ...nextSettings };
  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  render();
}

function currencyMeta() {
  return currencyOptions.find((option) => option.code === settings.currency) || currencyOptions[0];
}

function distance(km, digits = 1) {
  if (typeof km !== "number") return "-";
  if (settings.distanceUnit === "km") return `${km.toFixed(digits)} km`;
  return `${(km * 0.621371).toFixed(digits)} mi`;
}

function speed(valueInMph) {
  if (typeof valueInMph !== "number") return "-";
  if (settings.distanceUnit === "km") return `${(valueInMph * 1.60934).toFixed(0)} km/h`;
  return `${valueInMph.toFixed(0)} mph`;
}

function money(input) {
  if (typeof input !== "number") return "-";
  const meta = currencyMeta();
  return `${meta.symbol}${input.toFixed(2)}`;
}

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

function groupByMonth(rows, dateKey) {
  return rows.reduce((groups, row) => {
    const key = monthLabel(row[dateKey]);
    groups[key] ||= [];
    groups[key].push(row);
    return groups;
  }, {});
}

function renderKv(label, content) {
  return `
    <div class="kv">
      <span class="label">${value(label)}</span>
      <span class="value">${content}</span>
    </div>
  `;
}

function renderSummary(cars) {
  return `
    <section class="summary-grid">
      <article class="metric"><span>Vehicles</span><strong>${cars.length}</strong></article>
      <article class="metric"><span>Last Refresh</span><strong>${timeOnly(dashboardData?.generatedAt)}</strong></article>
      <article class="metric"><span>Database</span><strong>${value(dashboardData?.database || "connected")}</strong></article>
    </section>
  `;
}

function renderVehicleHero(snapshot) {
  const { car, position, charge } = snapshot;
  const battery = position?.battery_level ?? position?.soc ?? charge?.battery_level;
  const model = [car.model, car.trim_badging].filter(Boolean).join(" ") || "Vehicle";
  const lastDate = position?.date || charge?.date || car.updated_at;

  return `
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
        <div><span>${typeof battery === "number" ? `${battery}%` : "-"}</span><small>Battery</small></div>
        <div><span>${distance(position?.est_battery_range)}</span><small>Range</small></div>
        <div><span>${value(vehicleState(snapshot))}</span><small>Status</small></div>
      </div>
    </section>
  `;
}

function renderOverview(cars) {
  return `
    ${renderSummary(cars)}
    <section class="vehicle-list">
      ${cars.map((snapshot) => {
        const { car, position, charge, latestChargingProcess, stats = {} } = snapshot;
        const battery = position?.battery_level ?? position?.soc ?? charge?.battery_level;
        const fillWidth = typeof battery === "number" ? Math.max(0, Math.min(100, battery)) : 0;
        return `
          <article class="vehicle">
            ${renderVehicleHero(snapshot)}
            <div class="vehicle-grid">
              <section class="panel">
                <h3>Battery & Range</h3>
                <div class="battery-wrap">
                  <div class="battery">
                    <div class="battery-fill ${batteryClass(battery)}" style="width:${fillWidth}%"></div>
                    <div class="battery-percent">${typeof battery === "number" ? `${battery}%` : "-"}</div>
                  </div>
                  <div class="kv-grid">
                    ${renderKv("Estimated Range", distance(position?.est_battery_range))}
                    ${renderKv("Ideal Range", distance(position?.ideal_battery_range ?? position?.rated_battery_range))}
                    ${renderKv("Odometer", distance(position?.odometer))}
                    ${renderKv("30 Day Trips", distance(stats.monthDriveDistance))}
                  </div>
                </div>
              </section>
              <section class="panel">
                <h3>Charging</h3>
                <div class="kv-grid">
                  ${renderKv("State", chargingText(charge))}
                  ${renderKv("Limit", fixed(charge?.charge_limit_soc, "%"))}
                  ${renderKv("Power", fixed(charge?.charger_power, " kW"))}
                  ${renderKv("Last Session", latestChargingProcess?.start_date ? shortDate(latestChargingProcess.start_date) : "-")}
                </div>
              </section>
            </div>
            <section class="panel wide-panel">
              <h3>Statistics</h3>
              <div class="stat-strip">
                <div><span>${distance(stats.monthDriveDistance)}</span><small>30 day distance</small></div>
                <div><span>${fixed(stats.monthChargeEnergy, " kWh", 1)}</span><small>30 day charging</small></div>
                <div><span>${money(stats.monthChargeCost)}</span><small>30 day cost (${value(settings.currency)})</small></div>
              </div>
            </section>
            <section class="panel">
              <h3>Live Details</h3>
              <div class="kv-grid">
                ${renderKv("Speed", speed(position?.speed))}
                ${renderKv("Power", fixed(position?.power, " kW"))}
                ${renderKv("Outside", fixed(position?.outside_temp, " C", 1))}
                ${renderKv("Inside", fixed(position?.inside_temp, " C", 1))}
                ${renderKv("Elevation", fixed(position?.elevation, " m"))}
                ${renderKv("Location", mapLink(position))}
                ${renderKv("Vehicle ID", value(car.id))}
                ${renderKv("Refresh", "30 seconds")}
              </div>
            </section>
          </article>
        `;
      }).join("")}
    </section>
  `;
}

function renderTrips(cars) {
  const rows = cars.flatMap((snapshot) => (snapshot.recentDrives || []).map((drive) => ({
    ...drive,
    carName: snapshot.car.name || `Tesla ${snapshot.car.id}`
  })));
  const grouped = groupByMonth(rows, "start_date");

  return `
    ${renderSummary(cars)}
    <section class="panel">
      <h3>Trips By Month</h3>
      ${rows.length ? Object.entries(grouped).map(([month, drives]) => `
        <details class="month-group" open>
          <summary>
            <span>${value(month)}</span>
            <strong>${distance(drives.reduce((sum, drive) => sum + (drive.distance || 0), 0))}</strong>
          </summary>
          <div class="row-list">
            ${drives.map((drive) => `
              <article class="data-row">
                <div>
                  <strong>${dateTime(drive.start_date)}</strong>
                  <span>${value(drive.carName)}${drive.duration_min ? ` - ${number(drive.duration_min)} min` : ""}</span>
                </div>
                <div>
                  <strong>${distance(drive.distance)}</strong>
                  <span>${speed(drive.speed_max)}</span>
                </div>
              </article>
            `).join("")}
          </div>
        </details>
      `).join("") : `<p class="small">No trips yet.</p>`}
    </section>
  `;
}

function renderCharging(cars) {
  const rows = cars.flatMap((snapshot) => (snapshot.recentCharges || []).map((chargeSession) => ({
    ...chargeSession,
    carName: snapshot.car.name || `Tesla ${snapshot.car.id}`
  })));
  const grouped = groupByMonth(rows, "start_date");

  return `
    ${renderSummary(cars)}
    <section class="panel">
      <h3>Charging By Month</h3>
      ${rows.length ? Object.entries(grouped).map(([month, charges]) => `
        <details class="month-group" open>
          <summary>
            <span>${value(month)}</span>
            <strong>${fixed(charges.reduce((sum, chargeSession) => sum + (chargeSession.charge_energy_added || 0), 0), " kWh", 1)}</strong>
          </summary>
          <div class="row-list">
            ${charges.map((chargeSession) => `
              <article class="data-row">
                <div>
                  <strong>${dateTime(chargeSession.start_date)}</strong>
                  <span>${value(chargeSession.carName)}${chargeSession.duration_min ? ` - ${number(chargeSession.duration_min)} min` : ""}</span>
                </div>
                <div>
                  <strong>${fixed(chargeSession.charge_energy_added, " kWh", 1)}</strong>
                  <span>${money(chargeSession.cost)}</span>
                </div>
              </article>
            `).join("")}
          </div>
        </details>
      `).join("") : `<p class="small">No charge sessions yet.</p>`}
    </section>
  `;
}

function renderSettings() {
  const options = currencyOptions.map((option) => (
    `<option value="${option.code}" ${settings.currency === option.code ? "selected" : ""}>${option.code} - ${option.label}</option>`
  )).join("");

  return `
    <section class="settings-layout">
      <article class="panel">
        <h3>Display</h3>
        <div class="settings-list">
          <label class="setting-row">
            <span><strong>Distance unit</strong><small>Applies to range, odometer, speed, and trip distance.</small></span>
            <select id="distanceUnitSelect">
              <option value="mi" ${settings.distanceUnit === "mi" ? "selected" : ""}>Miles</option>
              <option value="km" ${settings.distanceUnit === "km" ? "selected" : ""}>Kilometers</option>
            </select>
          </label>
          <label class="setting-row">
            <span><strong>Currency</strong><small>Changes the display symbol for TeslaMate cost values. It does not convert exchange rates.</small></span>
            <select id="currencySelect">${options}</select>
          </label>
        </div>
      </article>
      <article class="panel">
        <h3>System</h3>
        <div class="kv-grid">
          ${renderKv("TeslaMate", `<a class="map-link" href="${teslamateLinkEl.href}" target="_blank" rel="noreferrer">Open</a>`)}
          ${renderKv("Grafana", `<a class="map-link" href="${grafanaLinkEl.href}" target="_blank" rel="noreferrer">Open</a>`)}
          ${renderKv("API Health", `<a class="map-link" href="/api/health" target="_blank" rel="noreferrer">Check</a>`)}
          ${renderKv("Data", "Self-hosted")}
        </div>
      </article>
    </section>
  `;
}

function setPageCopy() {
  const copy = {
    overview: ["Overview", "Your self-hosted Tesla companion, tuned for quick checks from any device."],
    trips: ["Trips", "Browse drive history grouped by month, with distance and speed in your preferred unit."],
    charging: ["Charging", "Review charge sessions by month, including energy and displayed cost."],
    settings: ["Settings", "Personalize units, currency display, and quick links for this browser."]
  };
  const [title, subtitle] = copy[activeTab] || copy.overview;
  pageTitleEl.textContent = title;
  pageSubtitleEl.textContent = subtitle;
}

function render() {
  setPageCopy();
  tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.tab === activeTab));

  const cars = dashboardData?.cars || [];
  emptyStateEl.hidden = !dashboardData || cars.length > 0 || activeTab === "settings";

  if (!dashboardData && activeTab !== "settings") {
    appViewEl.innerHTML = `<section class="panel"><h3>Loading</h3><p class="small">Connecting to TeslaMate...</p></section>`;
    return;
  }

  if (activeTab === "overview") appViewEl.innerHTML = renderOverview(cars);
  if (activeTab === "trips") appViewEl.innerHTML = renderTrips(cars);
  if (activeTab === "charging") appViewEl.innerHTML = renderCharging(cars);
  if (activeTab === "settings") {
    appViewEl.innerHTML = renderSettings();
    document.querySelector("#distanceUnitSelect").addEventListener("change", (event) => saveSettings({ distanceUnit: event.target.value }));
    document.querySelector("#currencySelect").addEventListener("change", (event) => saveSettings({ currency: event.target.value }));
  }
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    dashboardData = await response.json();
    statusEl.textContent = "Online";
    statusEl.className = "status-pill online";
    render();
  } catch (error) {
    statusEl.textContent = "Error";
    statusEl.className = "status-pill error";
    appViewEl.innerHTML = "";
    emptyStateEl.hidden = false;
    emptyStateEl.querySelector("h2").textContent = "Dashboard unavailable";
    emptyStateEl.querySelector("p").textContent = error.message;
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeTab = button.dataset.tab;
    render();
  });
});

wireServiceLinks();
render();
loadDashboard();
setInterval(loadDashboard, 30000);
