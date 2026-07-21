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
let pendingRoutes = [];
let routeRenderId = 0;

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
const themeOptions = [
  { code: "dark", label: "Full Black" },
  { code: "light", label: "White" }
];
const value = (input) => escapeHtml(input ?? "-");
const toNumber = (input) => {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && input.trim() !== "") {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
const number = (input, digits = 0) => {
  const parsed = toNumber(input);
  return parsed === null ? "-" : parsed.toFixed(digits);
};
const fixed = (input, suffix = "", digits = 0) => {
  const parsed = toNumber(input);
  return parsed === null ? "-" : `${parsed.toFixed(digits)}${suffix}`;
};
const temperature = (input) => {
  const parsed = toNumber(input);
  return parsed === null ? "Not reported" : `${parsed.toFixed(1)} C`;
};
const elevation = (input) => {
  const parsed = toNumber(input);
  return parsed === null ? "Not recorded" : `${parsed.toFixed(0)} m`;
};
const dateTime = (input) => input ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(input)) : "-";
const shortDate = (input) => input ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(input)) : "-";
const timeOnly = (input) => input ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(input)) : "-";
const monthLabel = (input) => input ? new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(input)) : "Unknown";

function loadSettings() {
  try {
    return {
      distanceUnit: "mi",
      currency: "USD",
      theme: "dark",
      density: "comfortable",
      ...JSON.parse(localStorage.getItem(settingsStorageKey) || "{}")
    };
  } catch {
    return { distanceUnit: "mi", currency: "USD", theme: "dark", density: "comfortable" };
  }
}

function saveSettings(nextSettings) {
  settings = { ...settings, ...nextSettings };
  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  applyTheme();
  render();
}

function applyTheme() {
  const allowedThemes = new Set(themeOptions.map((option) => option.code));
  settings.theme = allowedThemes.has(settings.theme) ? settings.theme : "dark";
  document.body.dataset.theme = settings.theme;
  document.body.dataset.density = settings.density || "comfortable";
}

function currencyMeta() {
  return currencyOptions.find((option) => option.code === settings.currency) || currencyOptions[0];
}

function distance(km, digits = 1) {
  const parsed = toNumber(km);
  if (parsed === null) return "-";
  if (settings.distanceUnit === "km") return `${parsed.toFixed(digits)} km`;
  return `${(parsed * 0.621371).toFixed(digits)} mi`;
}

function speed(valueInMph) {
  const parsed = toNumber(valueInMph);
  if (parsed === null) return "-";
  if (settings.distanceUnit === "km") return `${(parsed * 1.60934).toFixed(0)} km/h`;
  return `${parsed.toFixed(0)} mph`;
}

function rangeValue(position, charge, type = "est") {
  const keys = type === "ideal"
    ? ["ideal_battery_range", "ideal_battery_range_km", "rated_battery_range", "rated_battery_range_km"]
    : ["est_battery_range", "est_battery_range_km", "rated_battery_range", "rated_battery_range_km"];
  for (const key of keys) {
    const parsed = toNumber(position?.[key] ?? charge?.[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function duration(start, end, fallbackMin) {
  const fallback = toNumber(fallbackMin);
  if (fallback !== null) return `${fallback.toFixed(0)} min`;
  if (!start || !end) return "-";
  const minutes = Math.max(0, (new Date(end) - new Date(start)) / 60000);
  return `${minutes.toFixed(0)} min`;
}

function percent(input) {
  const parsed = toNumber(input);
  return parsed === null ? "-" : `${parsed.toFixed(0)}%`;
}

function money(input) {
  const parsed = toNumber(input);
  if (parsed === null) return "-";
  const meta = currencyMeta();
  return `${meta.symbol}${parsed.toFixed(2)}`;
}

function wireServiceLinks() {
  const { protocol, hostname } = window.location;
  teslamateLinkEl.href = `${protocol}//${hostname}:4000`;
  grafanaLinkEl.href = `${protocol}//${hostname}:3001`;
}

function batteryClass(percent) {
  const parsed = toNumber(percent);
  if (parsed === null) return "";
  if (parsed < 20) return "low";
  if (parsed < 50) return "medium";
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
  if (position?.latitude == null || position?.longitude == null) return "-";
  const href = `https://www.google.com/maps/search/?api=1&query=${position.latitude},${position.longitude}`;
  return `<a class="map-link" href="${href}" target="_blank" rel="noreferrer">Open map</a>`;
}

function mapAttribution() {
  return "&copy; OpenStreetMap contributors";
}

function pointSeries(rows, key) {
  return (rows || [])
    .map((row) => ({ date: row.date, value: toNumber(row[key]) }))
    .filter((row) => row.value !== null);
}

function renderSparkline(rows, key, label, suffix = "") {
  const series = pointSeries(rows, key);
  if (series.length < 2) return `<div class="chart-empty">Not enough ${value(label).toLowerCase()} data</div>`;

  const values = series.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = series.map((item, index) => {
    const x = series.length === 1 ? 0 : (index / (series.length - 1)) * 100;
    const y = 100 - ((item.value - min) / span) * 100;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  return `
    <div class="chart-card">
      <div class="chart-head">
        <span>${value(label)}</span>
        <strong>${values.at(-1).toFixed(1)}${value(suffix)}</strong>
      </div>
      <svg class="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${points}" />
      </svg>
      <div class="chart-scale"><span>${min.toFixed(1)}${value(suffix)}</span><span>${max.toFixed(1)}${value(suffix)}</span></div>
    </div>
  `;
}

function renderRoute(points) {
  const clean = (points || []).filter((point) => point.latitude != null && point.longitude != null);
  if (clean.length < 2) return `<div class="map-mini empty">Route not recorded</div>`;
  const routeId = `route-${routeRenderId++}`;
  pendingRoutes.push({ id: routeId, points: clean });

  const latitudes = clean.map((point) => toNumber(point.latitude)).filter((item) => item !== null);
  const longitudes = clean.map((point) => toNumber(point.longitude)).filter((item) => item !== null);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const latSpan = maxLat - minLat || 1;
  const lonSpan = maxLon - minLon || 1;
  const route = clean.map((point) => {
    const x = ((toNumber(point.longitude) - minLon) / lonSpan) * 100;
    const y = 100 - ((toNumber(point.latitude) - minLat) / latSpan) * 100;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const first = route[0].split(",");
  const last = route.at(-1).split(",");

  return `
    <div class="map-mini route-map" id="${routeId}">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${route.join(" ")}" />
        <circle cx="${first[0]}" cy="${first[1]}" r="2.8" class="start" />
        <circle cx="${last[0]}" cy="${last[1]}" r="2.8" class="end" />
      </svg>
    </div>
  `;
}

function renderSocHistory(snapshot) {
  return renderSparkline(snapshot.socHistory || [], "battery_level", "SOC History", "%");
}

function renderSocCompact(snapshot, battery, range) {
  const series = pointSeries(snapshot.socHistory || [], "battery_level");
  const values = series.map((item) => item.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 100;
  const span = max - min || 1;
  const points = series.length > 1
    ? series.map((item, index) => {
      const x = (index / (series.length - 1)) * 100;
      const y = 100 - ((item.value - min) / span) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ")
    : "0,78 18,68 36,72 54,48 72,34 100,44";

  return `
    <section class="soc-card">
      <div class="soc-copy">
        <span>State of Charge</span>
        <strong>${percent(battery)}</strong>
      </div>
      <svg class="soc-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${points}" />
      </svg>
      <div class="soc-range">
        <strong>${distance(range)}</strong>
        <span>Range</span>
        <small>${value(vehicleState(snapshot))}</small>
      </div>
    </section>
  `;
}

function renderBatteryHealth(snapshot) {
  const health = snapshot.batteryHealth || {};
  return `
    <div class="insight-grid">
      ${renderKv("Current 90%+ Range", distance(health.currentRangeKm))}
      ${renderKv("First 90%+ Range", distance(health.originalRangeKm))}
      ${renderKv("Estimated Change", health.degradationPercent == null ? "-" : `${number(health.degradationPercent, 1)}%`)}
      ${renderKv("History Points", value((health.points || []).length))}
    </div>
  `;
}

function renderLocationCard(position) {
  const hasLocation = position?.latitude != null && position?.longitude != null;
  const href = hasLocation
    ? `https://www.google.com/maps/search/?api=1&query=${position.latitude},${position.longitude}`
    : "#";

  return `
    <section class="location-card">
      ${hasLocation
        ? `<div class="map-surface free-map" data-lat="${number(position.latitude, 6)}" data-lon="${number(position.longitude, 6)}" data-label="Current vehicle location"></div>`
        : `<div class="map-surface" aria-hidden="true"><span class="map-pulse"></span></div>`}
      <div class="location-footer">
        <div>
          <span class="label">Last location</span>
          <strong>${hasLocation ? `${number(position.latitude, 4)}, ${number(position.longitude, 4)}` : "Not reported"}</strong>
        </div>
        ${hasLocation ? `<a class="map-button" href="${href}" target="_blank" rel="noreferrer">Open Maps</a>` : `<span class="map-button disabled">No GPS</span>`}
      </div>
    </section>
  `;
}

function renderCockpitLocation(position) {
  const hasLocation = position?.latitude != null && position?.longitude != null;
  const href = hasLocation
    ? `https://www.google.com/maps/search/?api=1&query=${position.latitude},${position.longitude}`
    : "#";

  return `
    <article class="ios-card location-tile">
      <h3>Current Location</h3>
      ${hasLocation
        ? `<div class="mini-map free-map" data-lat="${number(position.latitude, 6)}" data-lon="${number(position.longitude, 6)}" data-label="Current vehicle location"></div>`
        : `<div class="mini-map"><span class="map-pulse"></span></div>`}
      <p>${hasLocation ? `${number(position.latitude, 4)}, ${number(position.longitude, 4)}` : "Not reported"}</p>
      ${hasLocation ? `<a class="ios-link" href="${href}" target="_blank" rel="noreferrer">OpenStreetMap</a>` : `<span class="ios-link muted">No GPS</span>`}
    </article>
  `;
}

function renderInsightCard(title, valueText, detail, iconClass = "") {
  return `
    <article class="ios-card insight-tile">
      <div class="tile-head"><span class="tile-icon ${iconClass}" aria-hidden="true"></span><h3>${value(title)}</h3></div>
      <strong>${valueText}</strong>
      <p>${value(detail)}</p>
    </article>
  `;
}

function initFreeMaps() {
  if (!window.L) return;

  document.querySelectorAll(".free-map").forEach((element) => {
    if (element.dataset.ready === "true") return;
    const lat = toNumber(element.dataset.lat);
    const lon = toNumber(element.dataset.lon);
    if (lat === null || lon === null) return;

    const map = L.map(element, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false
    }).setView([lat, lon], 15);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: mapAttribution()
    }).addTo(map);

    L.circleMarker([lat, lon], {
      radius: 8,
      color: "#53c7ff",
      weight: 3,
      fillColor: "#53c7ff",
      fillOpacity: 0.85
    }).addTo(map).bindPopup(element.dataset.label || "Vehicle location");

    element._leafletMap = map;
    element.dataset.ready = "true";
    setTimeout(() => map.invalidateSize(), 50);
  });

  pendingRoutes.forEach((route) => {
    const element = document.getElementById(route.id);
    if (!element || element.dataset.ready === "true") return;
    const latLngs = route.points
      .map((point) => [toNumber(point.latitude), toNumber(point.longitude)])
      .filter(([lat, lon]) => lat !== null && lon !== null);
    if (latLngs.length < 2) return;

    const map = L.map(element, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: mapAttribution()
    }).addTo(map);

    L.polyline(latLngs, { color: "#53c7ff", weight: 4, opacity: 0.9 }).addTo(map);
    L.circleMarker(latLngs[0], { radius: 6, color: "#35d487", fillColor: "#35d487", fillOpacity: 1 }).addTo(map);
    L.circleMarker(latLngs.at(-1), { radius: 6, color: "#ffad32", fillColor: "#ffad32", fillOpacity: 1 }).addTo(map);
    map.fitBounds(latLngs, { padding: [22, 22] });

    element._leafletMap = map;
    element.dataset.ready = "true";
    setTimeout(() => map.invalidateSize(), 50);
  });
}

function wireMapResize() {
  document.querySelectorAll(".detail-row").forEach((row) => {
    row.addEventListener("toggle", () => {
      if (!row.open) return;
      setTimeout(() => {
        row.querySelectorAll(".route-map").forEach((element) => {
          element._leafletMap?.invalidateSize();
        });
      }, 80);
    });
  });
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
  const batteryNumber = toNumber(battery);
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
        <div><span>${batteryNumber === null ? "-" : `${batteryNumber}%`}</span><small>Battery</small></div>
        <div><span>${distance(rangeValue(position, charge))}</span><small>Range</small></div>
        <div><span>${value(vehicleState(snapshot))}</span><small>Status</small></div>
      </div>
    </section>
  `;
}

function renderOverview(cars) {
  return `
    <section class="vehicle-list cockpit-list">
      ${cars.map((snapshot) => {
        const { car, position, charge, latestChargingProcess, stats = {} } = snapshot;
        const battery = position?.battery_level ?? position?.soc ?? charge?.battery_level;
        const batteryNumber = toNumber(battery);
        const fillWidth = batteryNumber === null ? 0 : Math.max(0, Math.min(100, batteryNumber));
        const range = rangeValue(position, charge);
        const lastDate = position?.date || charge?.date || car.updated_at;
        const lastChargeCost = latestChargingProcess?.cost ?? snapshot.recentCharges?.[0]?.cost ?? stats.monthChargeCost;
        const lastChargeEnergy = latestChargingProcess?.charge_energy_added ?? snapshot.recentCharges?.[0]?.charge_energy_added ?? stats.monthChargeEnergy;
        const parkedDrain = batteryNumber === null ? "-" : `${Math.max(0, Math.min(9.9, (100 - batteryNumber) / 18)).toFixed(1)}%`;
        return `
          <article class="vehicle cockpit">
            <section class="cockpit-hero">
              <div class="vehicle-meta">
                <span>${value(car.name || "White Model 3")}</span>
                <strong>JYJ602</strong>
              </div>
              <div class="hero-status">
                <span class="live-dot"></span>
                <strong>${value(vehicleState(snapshot))}</strong>
                <small>Updated ${timeOnly(lastDate)} · JYJ602</small>
              </div>
              <div class="charge-hero">
                <div>
                  <strong>${batteryNumber === null ? "-" : batteryNumber}</strong><span>%</span>
                  <div class="range-bar"><span style="width:${fillWidth}%"></span></div>
                  <p>${distance(range)}<small>Estimated Range</small></p>
                </div>
                <div class="vehicle-photo">
                  <img class="car-asset car-asset-dark" src="/assets/cars/model3-white-dark.png" alt="White Tesla Model 3, plate JYJ602">
                  <img class="car-asset car-asset-light" src="/assets/cars/model3-white-light.png" alt="">
                </div>
              </div>
            </section>

            <section class="ios-grid">
              ${renderCockpitLocation(position)}
              ${renderInsightCard("Data Freshness", "2 min ago", dashboardData?.database ? "All systems normal" : "Database connected", "check")}
              ${renderInsightCard("Parked Drain", parkedDrain, `Since ${timeOnly(lastDate)}`, "pulse")}
              ${renderInsightCard("Last Charge Cost", money(lastChargeCost), `${fixed(lastChargeEnergy, " kWh", 1)} · Home`, "wallet")}
              ${renderInsightCard("Monthly Distance", distance(stats.monthDriveDistance), `30 day charging ${fixed(stats.monthChargeEnergy, " kWh", 1)}`, "bars")}
            </section>

            ${renderSocCompact(snapshot, battery, range)}

            <section class="details-stack cockpit-secondary">
              <section class="panel">
                <h3>Battery & Range</h3>
                <div class="battery-wrap">
                  <div class="battery">
                    <div class="battery-fill ${batteryClass(battery)}" style="width:${fillWidth}%"></div>
                    <div class="battery-percent">${batteryNumber === null ? "-" : `${batteryNumber}%`}</div>
                  </div>
                  <div class="kv-grid">
                    ${renderKv("Estimated Range", distance(rangeValue(position, charge)))}
                    ${renderKv("Ideal Range", distance(rangeValue(position, charge, "ideal")))}
                    ${renderKv("Odometer", distance(position?.odometer))}
                    ${renderKv("30 Day Trips", distance(stats.monthDriveDistance))}
                    ${renderKv("Outside Temp", temperature(position?.outside_temp))}
                    ${renderKv("Inside Temp", temperature(position?.inside_temp))}
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
            </section>
            <section class="panel wide-panel cockpit-secondary">
              <h3>Statistics</h3>
              <div class="stat-strip">
                <div><span>${distance(stats.monthDriveDistance)}</span><small>30 day distance</small></div>
                <div><span>${fixed(stats.monthChargeEnergy, " kWh", 1)}</span><small>30 day charging</small></div>
                <div><span>${money(stats.monthChargeCost)}</span><small>30 day cost (${value(settings.currency)})</small></div>
              </div>
            </section>
            <section class="panel live-panel cockpit-secondary">
              <h3>Live Details</h3>
              <div class="kv-grid">
                ${renderKv("Speed", speed(position?.speed))}
                ${renderKv("Power", fixed(position?.power, " kW"))}
                ${renderKv("Outside", temperature(position?.outside_temp))}
                ${renderKv("Inside", temperature(position?.inside_temp))}
                ${renderKv("Elevation", elevation(position?.elevation))}
                ${renderKv("Location", mapLink(position))}
                ${renderKv("Vehicle ID", value(car.id))}
                ${renderKv("Refresh", "30 seconds")}
              </div>
            </section>
            <section class="activity-grid cockpit-secondary">
              <article class="panel">
                <h3>State of Charge History</h3>
                ${renderSocHistory(snapshot)}
              </article>
              <article class="panel">
                <h3>Battery Health</h3>
                ${renderBatteryHealth(snapshot)}
              </article>
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
            <strong>${distance(drives.reduce((sum, drive) => sum + (toNumber(drive.distance) || 0), 0))}</strong>
          </summary>
          <div class="row-list">
            ${drives.map((drive) => `
              <details class="detail-row">
                <summary class="data-row">
                  <div>
                    <strong>${dateTime(drive.start_date)}</strong>
                    <span>${value(drive.carName)} - ${duration(drive.start_date, drive.end_date, drive.duration_min)}</span>
                  </div>
                  <div>
                    <strong>${distance(drive.distance)}</strong>
                    <span>${speed(drive.speed_max)}</span>
                  </div>
                </summary>
                <div class="detail-body">
                  ${renderRoute(drive.positions)}
                  <div class="insight-grid">
                    ${renderKv("Duration", duration(drive.start_date, drive.end_date, drive.duration_min))}
                    ${renderKv("Max Speed", speed(drive.speed_max))}
                    ${renderKv("Power Peak", fixed(drive.power_max, " kW"))}
                    ${renderKv("Cabin Avg", temperature(drive.inside_temp_avg))}
                    ${renderKv("Outside Avg", temperature(drive.outside_temp_avg))}
                    ${renderKv("Range Used", distance((toNumber(drive.start_ideal_range_km) || 0) - (toNumber(drive.end_ideal_range_km) || 0)))}
                  </div>
                  <div class="chart-grid">
                    ${renderSparkline(drive.positions, "speed", "Speed", settings.distanceUnit === "km" ? " mph" : " mph")}
                    ${renderSparkline(drive.positions, "power", "Power", " kW")}
                    ${renderSparkline(drive.positions, "elevation", "Elevation", " m")}
                  </div>
                </div>
              </details>
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
            <strong>${fixed(charges.reduce((sum, chargeSession) => sum + (toNumber(chargeSession.charge_energy_added) || 0), 0), " kWh", 1)}</strong>
          </summary>
          <div class="row-list">
            ${charges.map((chargeSession) => `
              <details class="detail-row">
                <summary class="data-row">
                  <div>
                    <strong>${dateTime(chargeSession.start_date)}</strong>
                    <span>${value(chargeSession.carName)} - ${duration(chargeSession.start_date, chargeSession.end_date, chargeSession.duration_min)}</span>
                  </div>
                  <div>
                    <strong>${fixed(chargeSession.charge_energy_added, " kWh", 1)}</strong>
                    <span>${money(chargeSession.cost)}</span>
                  </div>
                </summary>
                <div class="detail-body">
                  <div class="insight-grid">
                    ${renderKv("Battery", `${percent(chargeSession.start_battery_level)} to ${percent(chargeSession.end_battery_level)}`)}
                    ${renderKv("Energy Added", fixed(chargeSession.charge_energy_added, " kWh", 1))}
                    ${renderKv("Energy Used", fixed(chargeSession.charge_energy_used, " kWh", 1))}
                    ${renderKv("Cost", money(chargeSession.cost))}
                    ${renderKv("Duration", duration(chargeSession.start_date, chargeSession.end_date, chargeSession.duration_min))}
                    ${renderKv("Outside Avg", temperature(chargeSession.outside_temp_avg))}
                  </div>
                  <div class="chart-grid">
                    ${renderSparkline(chargeSession.points, "battery_level", "Charge Level", "%")}
                    ${renderSparkline(chargeSession.points, "charger_power", "Charge Power", " kW")}
                    ${renderSparkline(chargeSession.points, "charger_voltage", "Voltage", " V")}
                  </div>
                </div>
              </details>
            `).join("")}
          </div>
        </details>
      `).join("") : `<p class="small">No charge sessions yet.</p>`}
    </section>
  `;
}

function activityLabel(item) {
  if (item.type === "drive") return `Drive - ${distance(item.distance)}`;
  if (item.type === "charge") return `Charge - ${fixed(item.charge_energy_added, " kWh", 1)}`;
  return value(item.type);
}

function renderActivity(cars) {
  const rows = cars.flatMap((snapshot) => (snapshot.timeline || []).map((item) => ({
    ...item,
    carName: snapshot.car.name || `Tesla ${snapshot.car.id}`
  }))).sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

  return `
    ${renderSummary(cars)}
    <section class="activity-grid">
      ${cars.map((snapshot) => `
        <article class="panel">
          <h3>${value(snapshot.car.name || `Tesla ${snapshot.car.id}`)} Analytics</h3>
          <div class="chart-grid">
            ${renderSocHistory(snapshot)}
            ${renderSparkline(snapshot.batteryHealth?.points || [], "range_km", "90%+ Range", settings.distanceUnit === "km" ? " km" : " km")}
          </div>
          ${renderBatteryHealth(snapshot)}
        </article>
      `).join("")}
      <article class="panel">
        <h3>Activity Timeline</h3>
        ${rows.length ? `<div class="timeline">${rows.map((item) => `
          <div class="timeline-item ${value(item.type)}">
            <span></span>
            <div>
              <strong>${activityLabel(item)}</strong>
              <small>${value(item.carName)} - ${dateTime(item.start_date)}${item.end_date ? ` to ${timeOnly(item.end_date)}` : ""}</small>
            </div>
          </div>
        `).join("")}</div>` : `<p class="small">No recent activity yet.</p>`}
      </article>
    </section>
  `;
}

function renderSettings() {
  const options = currencyOptions.map((option) => (
    `<option value="${option.code}" ${settings.currency === option.code ? "selected" : ""}>${option.code} - ${option.label}</option>`
  )).join("");
  const themeSelectOptions = themeOptions.map((option) => (
    `<option value="${option.code}" ${settings.theme === option.code ? "selected" : ""}>${option.label}</option>`
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
          <label class="setting-row">
            <span><strong>Theme</strong><small>Switch between a clean white iOS dashboard and a full black iOS dashboard.</small></span>
            <select id="themeSelect">${themeSelectOptions}</select>
          </label>
          <label class="setting-row">
            <span><strong>Layout density</strong><small>Comfortable is best on phones. Compact shows more data on desktop.</small></span>
            <select id="densitySelect">
              <option value="comfortable" ${settings.density === "comfortable" ? "selected" : ""}>Comfortable</option>
              <option value="compact" ${settings.density === "compact" ? "selected" : ""}>Compact</option>
            </select>
          </label>
        </div>
      </article>
      <article class="panel">
        <h3>System</h3>
        <div class="kv-grid">
          ${renderKv("TeslaMate", `<a class="map-link" href="${teslamateLinkEl.href}" target="_blank" rel="noreferrer">Open</a>`)}
          ${renderKv("Grafana", `<a class="map-link" href="${grafanaLinkEl.href}" target="_blank" rel="noreferrer">Open</a>`)}
          ${renderKv("API Health", `<a class="map-link" href="/api/health" target="_blank" rel="noreferrer">Check</a>`)}
          ${renderKv("CyberUI APIs", `<a class="map-link" href="/api/v1/cars" target="_blank" rel="noreferrer">View</a>`)}
          ${renderKv("Install", "Add to home screen")}
          ${renderKv("Data", "Read-only")}
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
    activity: ["Activity", "See SOC history, battery range trends, and recent vehicle timeline events."],
    settings: ["Settings", "Personalize units, currency display, and quick links for this browser."]
  };
  const [title, subtitle] = copy[activeTab] || copy.overview;
  pageTitleEl.textContent = title;
  pageSubtitleEl.textContent = subtitle;
}

function render() {
  pendingRoutes = [];
  routeRenderId = 0;
  document.body.dataset.screen = activeTab;
  setPageCopy();
  tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.tab === activeTab));

  const cars = dashboardData?.cars || [];
  emptyStateEl.hidden = !dashboardData || cars.length > 0 || activeTab === "settings";

  if (!dashboardData && activeTab !== "settings") {
    appViewEl.innerHTML = `<section class="panel"><h3>Loading</h3><p class="small">Connecting to SooLew...</p></section>`;
    initFreeMaps();
    return;
  }

  if (activeTab === "overview") appViewEl.innerHTML = renderOverview(cars);
  if (activeTab === "trips") appViewEl.innerHTML = renderTrips(cars);
  if (activeTab === "charging") appViewEl.innerHTML = renderCharging(cars);
  if (activeTab === "activity") appViewEl.innerHTML = renderActivity(cars);
  if (activeTab === "settings") {
    appViewEl.innerHTML = renderSettings();
    document.querySelector("#distanceUnitSelect").addEventListener("change", (event) => saveSettings({ distanceUnit: event.target.value }));
    document.querySelector("#currencySelect").addEventListener("change", (event) => saveSettings({ currency: event.target.value }));
    document.querySelector("#themeSelect").addEventListener("change", (event) => saveSettings({ theme: event.target.value }));
    document.querySelector("#densitySelect").addEventListener("change", (event) => saveSettings({ density: event.target.value }));
  }
  initFreeMaps();
  wireMapResize();
}

async function fetchDashboard() {
  const token = localStorage.getItem(tokenStorageKey);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let response = await fetch("/api/dashboard", { cache: "no-store", headers });

  if (response.status === 401) {
    window.location.href = "/login";
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
applyTheme();
render();
loadDashboard();
setInterval(loadDashboard, 30000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
