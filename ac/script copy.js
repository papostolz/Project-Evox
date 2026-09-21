// Temperature Logic
let currentTemp = 0;
let hasRequestedRealTemp = false;
const tempDisplay = document.querySelector(".temp-display");
const tempButtons = document.querySelectorAll(".temp-btn");

const TEMP_MIN = 16;
const TEMP_MAX = 30;

function clampTemp(value) {
  return Math.max(TEMP_MIN, Math.min(TEMP_MAX, value));
}

function renderTemp() {
  tempDisplay.innerText =
    currentTemp === null ? "..." : currentTemp + "°C";
}

function setTempControlsEnabled(enabled) {
  tempButtons.forEach((btn) => {
    btn.disabled = !enabled;
    btn.classList.toggle("disabled", !enabled);
  });
}

function adjustTemp(amount) {
  if (!isPowerOn) {
    return; // AC is off - ignore, UI should already be greyed out
  }

  if (currentTemp === null) {
    return;
  }

  currentTemp = clampTemp(currentTemp + amount);
  renderTemp();

  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-temp-${amount > 0 ? "up" : "down"}`,
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
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

// Power Toggle Logic
let isPowerOn = false;
const toggleKnob = document.getElementById("toggleKnob");
const powerIcon = document.getElementById("powerIcon");

function togglePower(status) {
  isPowerOn = status === "on";
  if (isPowerOn) {
    toggleKnob.style.left = "25px";
    toggleKnob.style.right = "unset";
    powerIcon.classList.add("active");
    powerIcon.style.background = "#f27b40";
  } else {
    toggleKnob.style.left = "2px";
    toggleKnob.style.right = "unset";
    powerIcon.classList.remove("active");
    powerIcon.style.background = "#666";
  }
  setTempControlsEnabled(isPowerOn);
}

// Mode Selection Logic
function selectMode(element) {
  // Remove active class from all items
  document.querySelectorAll(".mode-item").forEach((item) => {
    item.classList.remove("active");
  });
  // Add active class to clicked item
  element.classList.add("active");
}

function getNextOccurrence(targetTime) {
  const now = new Date();
  const [hours, minutes] = targetTime.split(":").map(Number);

  // Create a date object for "today" at the target time
  let target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  // If the target time has already passed today, move to tomorrow
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  // Format: DD-MM-YYYY/HH:mm
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
  const info = {
    date: nextClosest,
    device,
    type: action,
  };
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-login-action&action=${JSON.stringify(info)}`,
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json(); // Parses JSON response into native JavaScript objects
    })
    .then((data) => {
      console.log(data);
      if (data.message === "Success") {
        console.log("Done");
        if (custom) {
          document.getElementById("spinner2").style.opacity = "0";
          document.getElementById("timePopup").classList.remove("active");
        }
      }
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
    });
}

// Time Selection Logic
function selectTime(element) {
  if (element.parentElement.classList.contains("turn-off-by")) {
    document
      .querySelectorAll(".schedule-scroll.turn-off-by .time-chip")
      .forEach((chip) => {
        chip.classList.remove("active");
      });
    if (element.innerText === "Off") {
      removeAllActions("off");
    } else {
      processSchedule("off", element.innerText);
    }
  } else if (element.parentElement.classList.contains("turn-on-by")) {
    document
      .querySelectorAll(".schedule-scroll.turn-on-by .time-chip")
      .forEach((chip) => {
        chip.classList.remove("active");
      });
    if (element.innerText === "Off") {
      removeAllActions("on");
    } else {
      processSchedule("on", element.innerText);
    }
  }

  element.classList.add("active");
}

function removeAllActions(type) {
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-login-removeActions&action=${type}`,
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json(); // Parses JSON response into native JavaScript objects
    })
    .then((data) => {
      console.log(data);
      if (data.message === "Success") {
        console.log("All actions removed");
      }
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
    });
}

// Simple Slider Logic (Click to jump)
const sliderTrack = document.getElementById("sliderTrack");
const sliderFill = document.getElementById("sliderFill");
const sliderThumb = document.getElementById("sliderThumb");

let isDragging = false;

// Function to calculate percentage and update CSS
const updateSlider = (clientX) => {
  const rect = sliderTrack.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  let percentage = (offsetX / rect.width) * 100;

  // Constrain between 0 and 100
  percentage = Math.max(0, Math.min(100, percentage));

  sliderFill.style.width = `${percentage}%`;
  sliderThumb.style.left = `${percentage}%`;
};

// Start dragging (Mouse & Touch)
const startDragging = (e) => {
  isDragging = true;
  const clientX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX;
  updateSlider(clientX);
};

// Moving (Mouse & Touch)
const moveDragging = (e) => {
  if (!isDragging) return;

  // Prevent scrolling the page while sliding on mobile
  if (e.type.includes("touch")) e.preventDefault();

  const clientX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX;
  updateSlider(clientX);
};

// Stop dragging
const stopDragging = () => {
  isDragging = false;
};

// Desktop Events
sliderTrack.addEventListener("mousedown", startDragging);
window.addEventListener("mousemove", moveDragging);
window.addEventListener("mouseup", stopDragging);

// Mobile/Touch Events
sliderTrack.addEventListener("touchstart", startDragging, { passive: false });
window.addEventListener("touchmove", moveDragging, { passive: false });
window.addEventListener("touchend", stopDragging);

let storage = {};
document.addEventListener("DOMContentLoaded", () => {
  const lc = {
    username: localStorage.getItem("t50-username"),
    email: localStorage.getItem("t50-email"),
    pswd: localStorage.getItem("t50pswd"),
  };
  storage = lc;
  console.log("Storage Ready");
  if (lc.username && lc.email && lc.pswd) {
    fetch(
      `https://data.evoxs.xyz/house?email=${lc.email}&password=${atob(lc.pswd)}&username=${lc.username}&method=ac-login-check`,
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.json(); // Parses JSON response into native JavaScript objects
      })
      .then((data) => {
        if (data.status === "ok") {
          console.log("User is logged in");
          document.getElementById("loadIt").style.opacity = "0";
          setTimeout(() => {
            document.getElementById("loadIt").style.display = "none";
          }, 550);

          getStatus();
          setInterval(getStatus, 3000);
          updateTemp();
          getActiveSchedules();
          setInterval(getActiveSchedules, 3000);
        } else {
          console.log("Access Denied");
          document.getElementById("loaderAnim").style.display = "none";
          document.getElementById("goEpsilon").style.display = "flex";
          document.getElementById("reloadApp").style.display = "flex";
          document.getElementById("connectText").innerHTML =
            `Access Denied<br>Credentials are wrong, or you don't own this Evox application.`;
        }
      })
      .catch((error) => {
        console.error("There was a problem with the fetch operation:", error);
      });
  } else {
    console.log("No credentials found in localStorage");
    document.getElementById("loaderAnim").style.display = "none";
    document.getElementById("reloadApp").style.display = "flex";
    document.getElementById("goEpsilon").style.display = "flex";
    document.getElementById("connectText").innerHTML =
      `You are not logged in.<br>Please login to Evox Epsilon to access this application.`;
  }
});

function getStatus() {
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-login-status`,
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json(); // Parses JSON response into native JavaScript objects
    })
    .then((data) => {
      console.log(data);
      if (data.message === "ON" && !isPowerOn) {
        togglePower("on");
        isPowerOn = true;
      }
      // 2. If the API says OFF but our local state is ON -> Turn it OFF
      else if (data.message === "OFF" && isPowerOn) {
        togglePower("off");
        isPowerOn = false;
      }
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
    });
}

function fixLock() {
  const el = document.getElementById("lock-btn");
  el.innerText = "Fixing...";
  el.disabled = true;
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-fixLock`,
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json(); // Parses JSON response into native JavaScript objects
    })
    .then((data) => {
      el.innerText = "Fix Lock";
      el.disabled = false;
    })
    .catch((error) => {
      el.innerText = "Fix Lock [F]";
      el.disabled = false;
      console.error("There was a problem with the fetch operation:", error);
    });
}

function updateTemp() {
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-temp`,
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
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

function getActiveSchedules() {
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-login-getActiveActions`,
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json(); // Parses JSON response into native JavaScript objects
    })
    .then((data) => {
      console.log(data);
      if (data.message !== "Failed to read actions") {
        document.getElementById("turn-off-by").innerHTML =
          `<div class="time-chip active" onclick="selectTime(this)">Off</div>
                    <div class="time-chip" onclick="selectTime(this)">13:00</div>
                    <div class="time-chip" onclick="selectTime(this)">14:00</div>
                    <div class="time-chip" onclick="selectTime(this)">15:00</div>
                    <div class="add-btn" onclick="openSchedule(this)"><svg xmlns="http://www.w3.org/2000/svg"
                            width="15px" height="15px" viewBox="0 0 24 24" fill="none">
                            <path d="M4 12H20M12 4V20" stroke="#000" stroke-width="2" stroke-linecap="round"
                                stroke-linejoin="round"></path>
                        </svg></div>`;
        document.getElementById("turn-on-by").innerHTML =
          `<div class="time-chip active" onclick="selectTime(this)">Off</div>
                    <div class="time-chip" onclick="selectTime(this)">13:00</div>
                    <div class="time-chip" onclick="selectTime(this)">14:00</div>
                    <div class="time-chip" onclick="selectTime(this)">15:00</div>
                    <div class="add-btn" onclick="openSchedule(this)"><svg xmlns="http://www.w3.org/2000/svg"
                            width="15px" height="15px" viewBox="0 0 24 24" fill="none">
                            <path d="M4 12H20M12 4V20" stroke="#000" stroke-width="2" stroke-linecap="round"
                                stroke-linejoin="round"></path>
                        </svg></div>`;
        Object.entries(data.message).forEach(([time, details]) => {
          if (details.device !== "ac") return; // Only process AC schedules for now
          if (details.action === "off") {
            const chips = Array.from(
              document.querySelectorAll("#turn-off-by .time-chip"),
            );
            const offChip = chips.find((el) => el.textContent.trim() === "Off");
            if (offChip) {
              offChip.remove();
            }
            document.getElementById("turn-off-by").innerHTML =
              `<div class="time-chip active" onclick="selectTime(this)">Off</div>
                    <div class="time-chip active">${time}</div>` +
              document.getElementById("turn-off-by").innerHTML;
          } else if (details.action === "on") {
            const chips = Array.from(
              document.querySelectorAll("#turn-on-by .time-chip"),
            );
            const offChip = chips.find((el) => el.textContent.trim() === "Off");
            if (offChip) {
              offChip.remove();
            }
            document.getElementById("turn-on-by").innerHTML =
              `<div class="time-chip active" onclick="selectTime(this)">Off</div>
                    <div class="time-chip active">${time}</div>` +
              document.getElementById("turn-on-by").innerHTML;
          }
          console.log(
            `Scheduled Action: Turn ${details.action} the ${details.device} at ${time}`,
          );
        });
        console.log("Active schedules:", data.message);
      } else {
        console.log("No active schedules or failed to retrieve.");
      }
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
    });
}

function goEpsilon() {
  window.open("../evox-epsilon-beta", "_blank");
}

function switchPower() {
  document.getElementById("spinner").style.opacity = "1";
  fetch(
    `https://data.evoxs.xyz/house?email=${storage.email}&password=${atob(storage.pswd)}&username=${storage.username}&method=ac-login-toggle`,
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json(); // Parses JSON response into native JavaScript objects
    })
    .then((data) => {
      document.getElementById("spinner").style.opacity = "0";
      console.log(data);
      if (isPowerOn === true) {
        togglePower("off");
      } else {
        togglePower("on");
      }
    })
    .catch((error) => {
      console.error("There was a problem with the fetch operation:", error);
    });
}

const displayBox = document.getElementById("display-container");
const pickerContainer = document.getElementById("picker-container");
const displayInput = document.getElementById("display");
const confirmBtn = document.getElementById("confirm-btn");

displayBox.addEventListener("click", () => {
  pickerContainer.classList.toggle("hidden");
});

const dateInput = document.getElementById("date-input");
const timeInput = document.getElementById("time-input");

confirmBtn.addEventListener("click", () => {
  const dateValue = document.getElementById("date-input").value; // Expected YYYY-MM-DD
  const timeValue = document.getElementById("time-input").value; // Expected HH:mm

  if (dateValue && timeValue) {
    // 1. Parse the date components
    const [year, month, day] = dateValue.split("-");

    // 2. Construct the custom string: DD-MM-YYYY/HH:mm
    const customFormat = `${day}-${month}-${year}/${timeValue}`;

    // 3. Update the display
    displayInput.value = customFormat;

    pickerContainer.classList.add("hidden");
    document.getElementById("spinner2").style.opacity = "1";

    const onOff =
      document.getElementById("ac-schedule-label").innerText ===
      "Turn On By".toUpperCase()
        ? "on"
        : "off";

    // Use the new customFormat or stick to timeValue depending on what processSchedule expects
    processSchedule(onOff, customFormat, true);
  }
});

const timePopup = document.getElementById("timePopup");
function openSchedule(el) {
  if (el.parentElement.classList.contains("turn-on-by")) {
    document.getElementById("ac-schedule-label").innerText = "Turn On By";
  } else if (el.parentElement.classList.contains("turn-off-by")) {
    document.getElementById("ac-schedule-label").innerText = "Turn Off By";
  } else {
    return;
  }
  timePopup.classList.add("active");
}
