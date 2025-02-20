document.addEventListener("DOMContentLoaded", () => {
  const minutesInput = document.getElementById("minutes");
  const startButton = document.getElementById("start");
  const stopButton = document.getElementById("stop");
  const countdownDisplay = document.getElementById("countdown");
  const clock = document.getElementById("clock");

  function getSettings() {
    try {
      const settings = localStorage.getItem("settings");
      return settings ? JSON.parse(settings) : {};
    } catch (error) {
      console.error(error);
      return {};
    }
  }

  function setSettings(key, value) {
    const settings = getSettings();
    settings[key] = value;
    localStorage.setItem("settings", JSON.stringify(settings));
  }

  function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, "0");

    const amPm = hours >= 12 ? "PM" : "AM";

    hours = hours % 12 || 12;

    clock.textContent = `${hours}:${minutes} ${amPm}`;
  }

  function updateCountdown() {
    chrome.storage.local.get(["endTime"], (result) => {
      if (!result.endTime) return;

      const remaining = result.endTime - Date.now();
      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        countdownDisplay.textContent = `${minutes}:${
          seconds < 10 ? "0" : ""
        }${seconds}`;
        setTimeout(updateCountdown, 1000);
      } else {
        countdownDisplay.textContent = "00:00";
      }
    });
  }

  startButton.addEventListener("click", () => {
    const minutes = parseInt(minutesInput.value);
    if (isNaN(minutes) || minutes <= 0) return;

    const endTime = Date.now() + minutes * 60000;
    chrome.storage.local.set({ endTime });
    chrome.alarms.create("countdown", { periodInMinutes: 1 });

    updateCountdown();
  });

  stopButton.addEventListener("click", () => {
    chrome.storage.local.remove("endTime");
    chrome.alarms.clear("countdown");
    countdownDisplay.textContent = "00:00";
  });

  clock.addEventListener("click", () => {
    const timeFormat = getSettings().timeFormat;
    if (timeFormat === "12h") {
      setSettings("timeFormat", "24h");
    } else {
      setSettings("timeFormat", "12h");
    }
  });

  setInterval(updateClock, 1000);
  updateCountdown();
  updateClock();
});
