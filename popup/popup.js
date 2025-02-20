document.addEventListener("DOMContentLoaded", () => {
  const minutesInput = document.getElementById("minutes");
  const startButton = document.getElementById("start");
  const stopButton = document.getElementById("stop");
  const countdownDisplay = document.getElementById("countdown");
  const clock = document.getElementById("clock");
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");

  function getSettings() {
    try {
      const settings = localStorage.getItem("settings");
      return settings ? JSON.parse(settings) : {};
    } catch (error) {
      console.error(error);
      return {};
    }
  }

  function switchTab(tabName) {
    // Hide all content divs
    tabContents.forEach((content) => {
      content.style.display = "none";
    });

    // Remove active class from all tabs
    tabs.forEach((tab) => {
      tab.classList.remove("active");
    });

    // Show selected content and activate corresponding tab
    const selectedTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
    const selectedContent = document.querySelector(
      `.tab-content[data-tab="${tabName}"]`
    );

    if (selectedTab && selectedContent) {
      selectedContent.style.display = "block";
      selectedTab.classList.add("active");
    }
  }

  // Add click event listeners to tabs
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      switchTab(tab.dataset.tab);
    });
  });

  function setSettings(key, value) {
    const settings = getSettings();
    settings[key] = value;
    localStorage.setItem("settings", JSON.stringify(settings));
  }

  function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, "0");

    let amPm = "";

    if (getSettings().timeFormat === "12h") {
      hours = hours % 12 || 12;
      amPm = hours >= 12 ? "AM" : "PM";
    }

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
    updateClock();
  });

  setInterval(updateClock, 1000);
  switchTab("timer");
  updateCountdown();
  updateClock();
});
