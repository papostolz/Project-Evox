/* =========================================================
   Evox AC — behaviour layer
   Same DOM wiring as before. Only the fetch targets have
   changed: everything that used to go to
   https://data.evoxs.xyz/house?...&method=X now goes to
   https://your-server/ac/... on the new Express server.
   ========================================================= */

const API_BASE = "https://ac.evoxs.xyz";
const REQUEST_TIMEOUT_MS = 10000;

let storage = {};

// ---------------------------------------------------------
// Shared request helpers
// ---------------------------------------------------------
// Centralising credential handling + fetch here means every
// call below gets the same protections for free: a bad/missing
// login never throws an uncaught error mid-click, and a stuck
// network request can't hang the UI forever.
function hasCredentials() {
  return Boolean(storage && storage.email && storage.username && storage.pswd);
}

function getPassword() {
  try {
    return atob(storage.pswd);
  } catch (error) {
    console.error("Stored password is not valid, please log in again:", error);
    return null;
  }
}

// Builds "email=...&username=...&password=...&<extra>" or null
// if we don't have usable credentials yet, so callers can bail
// out before ever touching the network.
function authQuery(extra = {}) {
  if (!hasCredentials()) return null;
  const password = getPassword();
  if (password === null) return null;
  return new URLSearchParams({
    email: storage.email,
    username: storage.username,
    password,
    ...extra,
  }).toString();
}

async function fetchJSON(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Network response was not ok (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Wraps a polling function so a slow response can't cause a
// second, overlapping call to stack up on top of it every time
// the interval fires (previously every poller just fired every
// 3s regardless of whether the last request had finished).
function startPolling(fn, intervalMs) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } finally {
      running = false;
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}

// ---------------------------------------------------------
// Temperature
// ---------------------------------------------------------
let currentTemp = null; // null = "unknown yet", never a real temperature
const TEMP_MIN = 16;
const TEMP_MAX = 30;

const tempDisplay = document.getElementById("tempDisplay");
const dialProgress = document.getElementById("dialProgress");
const tempButtons = document.querySelectorAll(".temp-btn");
const DIAL_CIRCUMFERENCE = 282.7; // 2 * PI * r(45), matches the SVG below

function clampTemp(value) {
  return Math.max(TEMP_MIN, Math.min(TEMP_MAX, value));
}

function renderTemp() {
  tempDisplay.innerText = currentTemp === null ? "…" : currentTemp + "°";

  if (currentTemp === null) return;
  const ratio = (currentTemp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
  const offset = DIAL_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, ratio)));
  dialProgress.style.strokeDashoffset = offset;
}

function setTempControlsEnabled(enabled) {
  tempButtons.forEach((btn) => {
    btn.disabled = !enabled;
    btn.classList.toggle("disabled", !enabled);
  });
}

async function adjustTemp(amount) {
  if (!isPowerOn) return; // AC is off - ignore, UI is already greyed out
  if (currentTemp === null) return; // don't guess a baseline before we know the real value

  const query = authQuery();
  if (!query) return;

  const previousTemp = currentTemp;
  currentTemp = clampTemp(currentTemp + amount);
  renderTemp();

  try {
    const data = await fetchJSON(
      `${API_BASE}/ac/temp-${amount > 0 ? "up" : "down"}?${query}`,
    );
    console.log(data);
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
    currentTemp = previousTemp;
    renderTemp();
  }
}

async function updateTemp() {
  const query = authQuery();
  if (!query) return;
  try {
    const data = await fetchJSON(`${API_BASE}/ac/temp?${query}`);
    currentTemp = data.message;
    renderTemp();
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
  }
}

// ---------------------------------------------------------
// Power
// ---------------------------------------------------------
let isPowerOn = false;
let powerRequestInFlight = false;
const toggleSwitch = document.getElementById("toggleSwitch");
const powerIcon = document.getElementById("powerIcon");
const powerSub = document.getElementById("powerSub");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const headerStatus = document.querySelector(".header-status");
const powerSpinner = document.getElementById("spinner");

function togglePower(status) {
  isPowerOn = status === "on";

  toggleSwitch.setAttribute("aria-checked", String(isPowerOn));
  powerIcon.classList.toggle("active", isPowerOn);
  powerSub.innerText = isPowerOn ? "On" : "Off";
  statusText.innerText = isPowerOn ? "On" : "Off";
  headerStatus.classList.toggle("on", isPowerOn);

  setTempControlsEnabled(isPowerOn);
}

async function switchPower() {
  if (powerRequestInFlight) return; // ignore rapid double-taps of the switch
  const query = authQuery();
  if (!query) return;

  powerRequestInFlight = true;
  powerSpinner.classList.add("visible");
  try {
    const data = await fetchJSON(`${API_BASE}/ac/toggle?${query}`);
    console.log(data);
    togglePower(isPowerOn ? "off" : "on");
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
  } finally {
    powerSpinner.classList.remove("visible");
    powerRequestInFlight = false;
  }
}

async function getStatus() {
  const query = authQuery();
  if (!query) return;
  try {
    const data = await fetchJSON(`${API_BASE}/ac/status?${query}`);
    if (data.message === "ON" && !isPowerOn) {
      togglePower("on");
    } else if (data.message === "OFF" && isPowerOn) {
      togglePower("off");
    }
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
  }
}

// ---------------------------------------------------------
// Mode selection
// Buttons call changeMode() live by default. Tapping the
// "Set" badge switches the grid into a one-shot "hardcode"
// state (pulsing border, see .mode-grid.set in the CSS) where
// the next mode you tap is saved with setMode() instead, then
// wiring automatically reverts back to live changeMode().
// ---------------------------------------------------------
const modeParent = document.getElementById("mode-parent");
const setModeBadge = document.getElementById("setMode");

function setActiveMode(mode) {
  const normalized = mode ? String(mode).toLowerCase() : null;
  modeParent.querySelectorAll(".mode-item").forEach((item) => {
    const isActive = normalized !== null && item.dataset.mode === normalized;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-pressed", String(isActive));
  });
}

function getActiveModeName() {
  const active = modeParent.querySelector(".mode-item.active");
  return active ? active.dataset.mode : null;
}

async function changeMode(mode) {
  const previousMode = getActiveModeName();
  const query = authQuery();
  if (!query) return;

  setActiveMode(mode); // optimistic, matches the pattern used for temp/power
  try {
    const data = await fetchJSON(`${API_BASE}/ac/mode/${mode}?${query}`);
    console.log("Set Mode data:", data);
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
    setActiveMode(previousMode); // revert on failure
  }
}

async function setMode(mode) {
  const query = authQuery();
  if (query) {
    setActiveMode(mode);
    try {
      const data = await fetchJSON(`${API_BASE}/ac/setMode/${mode}?${query}`);
      console.log("Hardcode Mode data:", data);
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
    }
  }
  setModeBadge.click(); // exit "set" state, restore live-change wiring
}

// get current mode and show it on frontend, if no mode then dont have any element active in the modes tab
async function getMode() {
  const query = authQuery();
  if (!query) return;
  try {
    const data = await fetchJSON(`${API_BASE}/ac/getMode?${query}`);
    const mode = data && data.message ? String(data.message).toLowerCase() : null;
    setActiveMode(mode === "none" || mode === "" ? null : mode);
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
  }
}

function wireModeButtons(kind) {
  modeParent.querySelectorAll(".mode-item").forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.getAttribute("data-mode").toLowerCase();
      if (kind === "set") {
        setMode(mode);
      } else {
        changeMode(mode);
      }
    };
  });
}

wireModeButtons("change"); // live control is the default, even before "Set" is ever pressed

setModeBadge.addEventListener("click", () => {
  const enteringSetMode = !modeParent.classList.contains("set");
  wireModeButtons(enteringSetMode ? "set" : "change");
  modeParent.classList.toggle("set", enteringSetMode);
});

// ---------------------------------------------------------
// Fan speed (Auto / Turbo)
// ---------------------------------------------------------
let isTurboOn = false;
let turboRequestInFlight = false;
const fanModeBadge = document.getElementById("fanModeBadge");
const fanAutoBtn = document.getElementById("fanAuto");
const fanTurboBtn = document.getElementById("fanTurbo");

function applyTurboState(turboOn) {
  isTurboOn = turboOn;
  fanAutoBtn.classList.toggle("active", !turboOn);
  fanAutoBtn.setAttribute("aria-pressed", String(!turboOn));
  fanTurboBtn.classList.toggle("active", turboOn);
  fanTurboBtn.setAttribute("aria-pressed", String(turboOn));
  fanModeBadge.innerText = turboOn ? "Turbo" : "Auto";
}

async function getTurbo() {
  const query = authQuery();
  if (!query) return;
  try {
    const data = await fetchJSON(`${API_BASE}/ac/get-turbo?${query}`);
    applyTurboState(data.message === true || data.message === "true");
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
  }
}

async function toggleTurbo(wantTurboOn) {
  if (wantTurboOn === isTurboOn || turboRequestInFlight) return;
  const query = authQuery();
  if (!query) return;

  turboRequestInFlight = true;
  applyTurboState(wantTurboOn); // optimistic
  try {
    const data = await fetchJSON(`${API_BASE}/ac/turbo?${query}`);
    console.log(data);
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
    applyTurboState(!wantTurboOn); // revert on failure
  } finally {
    turboRequestInFlight = false;
  }
}

fanAutoBtn.addEventListener("click", () => toggleTurbo(false));
fanTurboBtn.addEventListener("click", () => toggleTurbo(true));

// ---------------------------------------------------------
// Schedules
// ---------------------------------------------------------
function getNextOccurrence(targetTime) {
  const now = new Date();
  const [hours, minutes] = targetTime.split(":").map(Number);

  let target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const day = String(target.getDate()).padStart(2, "0");
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const year = target.getFullYear();
  const hh = String(target.getHours()).padStart(2, "0");
  const mm = String(target.getMinutes()).padStart(2, "0");

  return `${day}-${month}-${year}/${hh}:${mm}`;
}

async function processSchedule(action, time, custom, device = "ac") {
  if (!hasCredentials()) return;
  const password = getPassword();
  if (password === null) return;

  const nextClosest = !custom ? getNextOccurrence(time) : time;
  console.log(`Scheduling ${device} to turn ${action} at ${nextClosest}`);
  const info = { date: nextClosest, device, type: action };

  try {
    const data = await fetchJSON(`${API_BASE}/ac/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: storage.email,
        password,
        username: storage.username,
        action: info,
      }),
    });
    console.log(data);
    if (data.message === "Success") {
      console.log("Done");
      if (custom) {
        sheetStatus.classList.remove("visible");
        closeSheet();
      }
    }
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
  }
}

async function removeAllActions(type) {
  if (!hasCredentials()) return;
  const password = getPassword();
  if (password === null) return;

  try {
    const data = await fetchJSON(`${API_BASE}/ac/actions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: storage.email,
        password,
        username: storage.username,
        action: type,
      }),
    });
    console.log(data);
    if (data.message === "Success") console.log("All actions removed");
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
  }
}

function selectTime(chip) {
  const group = chip.closest(".schedule-scroll");
  const isOff = group.classList.contains("turn-off-by");
  const isOn = group.classList.contains("turn-on-by");
  if (!isOff && !isOn) return;

  group
    .querySelectorAll(".time-chip")
    .forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");

  const time = chip.dataset.time;
  if (time === "Off") {
    removeAllActions(isOff ? "off" : "on");
  } else {
    processSchedule(isOff ? "off" : "on", time);
  }
}

function rebuildScheduleRow(container, activeCustomTime) {
  container.innerHTML = "";
  const defaults = ["Off", "13:00", "14:00", "15:00"];
  defaults.forEach((label) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "time-chip";
    chip.dataset.time = label;
    chip.textContent = label;
    if (label === "Off" && !activeCustomTime) chip.classList.add("active");
    container.appendChild(chip);
  });

  if (activeCustomTime) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "time-chip active";
    chip.dataset.time = activeCustomTime;
    chip.textContent = activeCustomTime;
    container.insertBefore(chip, container.firstChild.nextSibling);
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "add-btn";
  addBtn.dataset.schedule = container.classList.contains("turn-off-by")
    ? "off"
    : "on";
  addBtn.setAttribute(
    "aria-label",
    container.classList.contains("turn-off-by")
      ? "Add a custom turn-off time"
      : "Add a custom turn-on time",
  );
  addBtn.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 12H20M12 4V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  container.appendChild(addBtn);
}

async function getActiveSchedules() {
  const query = authQuery();
  if (!query) return;
  try {
    const data = await fetchJSON(`${API_BASE}/ac/actions?${query}`);
    if (data.message === "Failed to read actions") {
      console.log("No active schedules or failed to retrieve.");
      return;
    }

    let offTime = null;
    let onTime = null;
    Object.entries(data.message).forEach(([time, details]) => {
      if (details.device !== "ac") return;
      if (details.action === "off") offTime = time;
      else if (details.action === "on") onTime = time;
      console.log(
        `Scheduled Action: Turn ${details.action} the ${details.device} at ${time}`,
      );
    });

    rebuildScheduleRow(document.getElementById("turn-off-by"), offTime);
    rebuildScheduleRow(document.getElementById("turn-on-by"), onTime);
  } catch (error) {
    console.error("There was a problem with the fetch operation:", error);
  }
}

// ---------------------------------------------------------
// Lock
// ---------------------------------------------------------
async function fixLock() {
  const el = document.getElementById("lock-btn");
  const query = authQuery();
  if (!query) return;

  el.innerText = "Fixing…";
  el.disabled = true;
  try {
    await fetchJSON(`${API_BASE}/ac/fix-lock?${query}`);
    el.innerText = "Fix Lock";
  } catch (error) {
    el.innerText = "Fix Lock [F]";
    console.error("There was a problem with the fetch operation:", error);
  } finally {
    el.disabled = false;
  }
}

// ---------------------------------------------------------
// Schedule sheet
// ---------------------------------------------------------
const timePopup = document.getElementById("timePopup");
const scheduleLabel = document.getElementById("ac-schedule-label");
const displayBox = document.getElementById("display-container");
const pickerContainer = document.getElementById("picker-container");
const displayInput = document.getElementById("display");
const confirmBtn = document.getElementById("confirm-btn");
const dateInput = document.getElementById("date-input");
const timeInput = document.getElementById("time-input");
const sheetStatus = document.getElementById("spinner2");
const sheetClose = document.getElementById("sheetClose");
let lastFocusedElement = null;

function openSchedule(addBtn) {
  const kind = addBtn.dataset.schedule; // "on" | "off"
  scheduleLabel.innerText = kind === "on" ? "Turn On By" : "Turn Off By";
  scheduleLabel.dataset.kind = kind;

  displayInput.value = "Select date & time";
  pickerContainer.classList.add("hidden");
  displayBox.setAttribute("aria-expanded", "false");
  sheetStatus.classList.remove("visible");

  lastFocusedElement = addBtn;
  timePopup.classList.add("active");
  sheetClose.focus();
}

function closeSheet() {
  timePopup.classList.remove("active");
  if (lastFocusedElement) lastFocusedElement.focus();
}

sheetClose.addEventListener("click", closeSheet);
timePopup.addEventListener("click", (e) => {
  if (e.target === timePopup) closeSheet();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && timePopup.classList.contains("active"))
    closeSheet();
});

displayBox.addEventListener("click", () => {
  const isHidden = pickerContainer.classList.toggle("hidden");
  displayBox.setAttribute("aria-expanded", String(!isHidden));
});

confirmBtn.addEventListener("click", () => {
  const dateValue = dateInput.value; // YYYY-MM-DD
  const timeValue = timeInput.value; // HH:mm
  if (!dateValue || !timeValue) return;

  const [year, month, day] = dateValue.split("-");
  const customFormat = `${day}-${month}-${year}/${timeValue}`;
  displayInput.value = customFormat;

  pickerContainer.classList.add("hidden");
  displayBox.setAttribute("aria-expanded", "false");
  sheetStatus.classList.add("visible");

  // Fixed from the original: the comparison used to check the label
  // against an uppercased string ("Turn On By".toUpperCase()) while
  // the label itself is title case, so it always evaluated to false
  // and every custom schedule was silently saved as "off". Comparing
  // the stored kind directly restores the intended on/off behaviour.
  const onOff = scheduleLabel.dataset.kind === "on" ? "on" : "off";

  processSchedule(onOff, customFormat, true);
});

// ---------------------------------------------------------
// Event delegation for buttons that are re-rendered
// (schedule chips, add buttons — mode buttons are wired
// directly in wireModeButtons() since they need to switch
// between live-change and hardcode behaviour)
// ---------------------------------------------------------
document.addEventListener("click", (e) => {
  const chip = e.target.closest(".time-chip");
  if (chip) return selectTime(chip);

  const addBtn = e.target.closest(".add-btn");
  if (addBtn) return openSchedule(addBtn);
});

document
  .getElementById("tempUp")
  .addEventListener("click", () => adjustTemp(1));
document
  .getElementById("tempDown")
  .addEventListener("click", () => adjustTemp(-1));
document
  .getElementById("tempRefresh")
  .addEventListener("click", () => updateTemp());
toggleSwitch.addEventListener("click", switchPower);
document.getElementById("lock-btn").addEventListener("click", fixLock);

function goEpsilon() {
  window.open("../evox-epsilon-beta", "_blank");
}
document.getElementById("goEpsilon").addEventListener("click", goEpsilon);
document
  .getElementById("reloadApp")
  .addEventListener("click", () => window.location.reload());

// ---------------------------------------------------------
// Boot
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const lc = {
    username: localStorage.getItem("t50-username"),
    email: localStorage.getItem("t50-email"),
    pswd: localStorage.getItem("t50pswd"),
  };
  storage = lc;
  console.log("Storage Ready");

  const loadIt = document.getElementById("loadIt");
  const connectText = document.getElementById("connectText");
  const goEpsilonBtn = document.getElementById("goEpsilon");
  const reloadAppBtn = document.getElementById("reloadApp");

  // Don't let anyone poke the temperature buttons before we
  // actually know whether the unit is on.
  setTempControlsEnabled(false);

  if (!(lc.username && lc.email && lc.pswd)) {
    console.log("No credentials found in localStorage");
    goEpsilonBtn.hidden = false;
    reloadAppBtn.hidden = false;
    connectText.innerHTML =
      "You are not logged in.<br>Please login to Evox Epsilon to access this application.";
    return;
  }

  const query = authQuery();
  if (!query) {
    console.log("Stored credentials could not be read");
    goEpsilonBtn.hidden = false;
    reloadAppBtn.hidden = false;
    connectText.innerHTML =
      "Access Denied<br>Credentials are wrong, or you don't own this Evox application.";
    return;
  }

  fetchJSON(`${API_BASE}/ac/login-check?${query}`)
    .then((data) => {
      if (data.status === "ok") {
        console.log("User is logged in");
        loadIt.style.opacity = "0";
        setTimeout(() => {
          loadIt.style.display = "none";
        }, 400);

        startPolling(getTurbo, 3000);
        startPolling(getStatus, 3000);
        startPolling(getActiveSchedules, 3000);
        startPolling(getMode, 3000);
        updateTemp();
      } else {
        console.log("Access Denied");
        goEpsilonBtn.hidden = false;
        reloadAppBtn.hidden = false;
        connectText.innerHTML =
          "Access Denied<br>Credentials are wrong, or you don't own this Evox application.";
      }
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
      goEpsilonBtn.hidden = false;
      reloadAppBtn.hidden = false;
      connectText.innerHTML =
        "Couldn't reach Evox.<br>Check your connection and try again.";
    });
});
