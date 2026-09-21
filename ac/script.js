/* =========================================================
   Evox AC — behaviour layer
   Every fetch URL, method name, query parameter and
   localStorage key below is unchanged from the original
   script.js. Only the DOM wiring (how these functions talk
   to the page) has been rebuilt for the new markup.
   ========================================================= */

let storage = {};

// ---------------------------------------------------------
// Temperature
// ---------------------------------------------------------
let currentTemp = 0;
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

function adjustTemp(amount) {
  if (!isPowerOn) return; // AC is off - ignore, UI is already greyed out
  if (currentTemp === null) return;

  currentTemp = clampTemp(currentTemp + amount);
  renderTemp();

  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-temp-${amount > 0 ? "up" : "down"}`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then((data) => {
      console.log(data);
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
      if (currentTemp !== null) {
        currentTemp = clampTemp(currentTemp - amount);
        renderTemp();
      }
    });
}

function updateTemp() {
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-temp`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then((data) => {
      currentTemp = data.message;
      renderTemp();
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
    });
}

// ---------------------------------------------------------
// Power
// ---------------------------------------------------------
let isPowerOn = false;
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

function switchPower() {
  powerSpinner.classList.add("visible");
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-login-toggle`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then((data) => {
      powerSpinner.classList.remove("visible");
      console.log(data);
      togglePower(isPowerOn ? "off" : "on");
    })
    .catch((error) => {
      powerSpinner.classList.remove("visible");
      console.error("There was a problem with the fetch operation:", error);
    });
}

function getStatus() {
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-login-status`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then((data) => {
      console.log(data);
      if (data.message === "ON" && !isPowerOn) {
        togglePower("on");
      } else if (data.message === "OFF" && isPowerOn) {
        togglePower("off");
      }
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
    });
}

// ---------------------------------------------------------
// Mode selection (client-side only, as in the original —
// no request is sent when a mode is chosen)
// ---------------------------------------------------------
function selectMode(button) {
  document.querySelectorAll(".mode-item").forEach((item) => {
    item.classList.remove("active");
    item.setAttribute("aria-pressed", "false");
  });
  button.classList.add("active");
  button.setAttribute("aria-pressed", "true");
}

// ---------------------------------------------------------
// Fan speed (client-side only, as in the original — the
// slider never sent a request; only how it's operated changed,
// from an unlabelled drag-only div to a real, keyboard- and
// screen-reader-operable <input type="range">)
// ---------------------------------------------------------
const fanSpeed = document.getElementById("fanSpeed");

function renderFanSpeed() {
  fanSpeed.style.setProperty("--fill", `${fanSpeed.value}%`);
  fanSpeed.setAttribute("aria-valuetext", `${fanSpeed.value} percent`);
}

fanSpeed.addEventListener("input", renderFanSpeed);

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

function processSchedule(action, time, custom, device = "ac") {
  const nextClosest = !custom ? getNextOccurrence(time) : time;
  console.log(`Scheduling ${device} to turn ${action} at ${nextClosest}`);
  const info = { date: nextClosest, device, type: action };

  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-login-action&action=${JSON.stringify(info)}`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then((data) => {
      console.log(data);
      if (data.message === "Success") {
        console.log("Done");
        if (custom) {
          sheetStatus.classList.remove("visible");
          closeSheet();
        }
      }
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
    });
}

function removeAllActions(type) {
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-login-removeActions&action=${type}`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then((data) => {
      console.log(data);
      if (data.message === "Success") console.log("All actions removed");
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
    });
}

function selectTime(chip) {
  const group = chip.closest(".schedule-scroll");
  const isOff = group.classList.contains("turn-off-by");
  const isOn = group.classList.contains("turn-on-by");
  if (!isOff && !isOn) return;

  group.querySelectorAll(".time-chip").forEach((c) => c.classList.remove("active"));
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
  addBtn.dataset.schedule = container.classList.contains("turn-off-by") ? "off" : "on";
  addBtn.setAttribute(
    "aria-label",
    container.classList.contains("turn-off-by") ? "Add a custom turn-off time" : "Add a custom turn-on time",
  );
  addBtn.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 12H20M12 4V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  container.appendChild(addBtn);
}

function getActiveSchedules() {
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-login-getActiveActions`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then((data) => {
      console.log(data);
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
        console.log(`Scheduled Action: Turn ${details.action} the ${details.device} at ${time}`);
      });

      rebuildScheduleRow(document.getElementById("turn-off-by"), offTime);
      rebuildScheduleRow(document.getElementById("turn-on-by"), onTime);
      console.log("Active schedules:", data.message);
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
    });
}

// ---------------------------------------------------------
// Lock
// ---------------------------------------------------------
function fixLock() {
  const el = document.getElementById("lock-btn");
  el.innerText = "Fixing…";
  el.disabled = true;
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-fixLock`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then(() => {
      el.innerText = "Fix Lock";
      el.disabled = false;
    })
    .catch((error) => {
      el.innerText = "Fix Lock [F]";
      el.disabled = false;
      console.error("There was a problem with the fetch operation:", error);
    });
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
  if (e.key === "Escape" && timePopup.classList.contains("active")) closeSheet();
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
// (mode grid, schedule chips, add buttons)
// ---------------------------------------------------------
document.addEventListener("click", (e) => {
  const modeItem = e.target.closest(".mode-item");
  if (modeItem) return selectMode(modeItem);

  const chip = e.target.closest(".time-chip");
  if (chip) return selectTime(chip);

  const addBtn = e.target.closest(".add-btn");
  if (addBtn) return openSchedule(addBtn);
});

document.getElementById("tempUp").addEventListener("click", () => adjustTemp(1));
document.getElementById("tempDown").addEventListener("click", () => adjustTemp(-1));
document.getElementById("tempRefresh").addEventListener("click", () => updateTemp());
toggleSwitch.addEventListener("click", switchPower);
document.getElementById("lock-btn").addEventListener("click", fixLock);

function goEpsilon() {
  window.open("../evox-epsilon-beta", "_blank");
}
document.getElementById("goEpsilon").addEventListener("click", goEpsilon);
document.getElementById("reloadApp").addEventListener("click", () => window.location.reload());

// ---------------------------------------------------------
// Boot
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  renderFanSpeed();

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

  if (lc.username && lc.email && lc.pswd) {
    fetch(
      `https://data.evoxs.xyz/house?email=${lc.email}&password=${atob(lc.pswd)}&username=${lc.username}&method=ac-login-check`,
    )
      .then((response) => {
        if (!response.ok) throw new Error("Network response was not ok");
        return response.json();
      })
      .then((data) => {
        if (data.status === "ok") {
          console.log("User is logged in");
          loadIt.style.opacity = "0";
          setTimeout(() => {
            loadIt.style.display = "none";
          }, 400);

          getStatus();
          setInterval(getStatus, 3000);
          updateTemp();
          getActiveSchedules();
          setInterval(getActiveSchedules, 3000);
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
      });
  } else {
    console.log("No credentials found in localStorage");
    goEpsilonBtn.hidden = false;
    reloadAppBtn.hidden = false;
    connectText.innerHTML =
      "You are not logged in.<br>Please login to Evox Epsilon to access this application.";
  }
});