// DOM Elements
const ELEMENTS = {
  timer: {
    minutesInput: document.getElementById("minutes"),
    startButton: document.getElementById("start"),
    stopButton: document.getElementById("stop"),
    countdownDisplay: document.getElementById("countdown"),
    clock: document.getElementById("clock"),
  },
  preset: {
    createButton: document.getElementById("create_preset"),
    form: document.getElementById("preset_form"),
    cancelButton: document.getElementById("cancel_preset"),
    addButton: document.getElementById("add_preset"),
    inputs: {
      name: document.getElementById("preset_name"),
      hours: document.getElementById("preset_hours"),
      minutes: document.getElementById("preset_minutes"),
      seconds: document.getElementById("preset_seconds"),
    },
  },
  tabs: {
    list: document.querySelectorAll(".tab"),
    contents: document.querySelectorAll(".tab-content"),
  },
};

// Local Storage Operations
const Storage = {
  getSettings() {
    try {
      const settings = localStorage.getItem("settings");
      return settings ? JSON.parse(settings) : {};
    } catch (error) {
      console.error("Error reading settings:", error);
      return {};
    }
  },

  setSettings(key, value) {
    const settings = this.getSettings();
    settings[key] = value;
    localStorage.setItem("settings", JSON.stringify(settings));
  },

  getPresets() {
    try {
      const presets = localStorage.getItem("presets");
      return presets ? JSON.parse(presets) : [];
    } catch (error) {
      console.error("Error reading presets:", error);
      return [];
    }
  },

  savePreset(preset) {
    const presets = this.getPresets();
    localStorage.setItem("presets", JSON.stringify([...presets, preset]));
  },
};

// Tab Management
const TabManager = {
  switchTab(tabName) {
    ELEMENTS.tabs.contents.forEach((content) => {
      content.style.display = "none";
    });

    ELEMENTS.tabs.list.forEach((tab) => {
      tab.classList.remove("active");
    });

    const selectedTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
    const selectedContent = document.querySelector(
      `.tab-content[data-tab="${tabName}"]`
    );

    if (selectedTab && selectedContent) {
      selectedContent.style.display = "block";
      selectedTab.classList.add("active");
    }
  },

  initializeTabs() {
    ELEMENTS.tabs.list.forEach((tab) => {
      tab.addEventListener("click", () => this.switchTab(tab.dataset.tab));
    });
    this.switchTab("timer"); // Set initial tab
  },
};

// Clock Management
const ClockManager = {
  updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, "0");
    let amPm = "";

    if (Storage.getSettings().timeFormat === "12h") {
      hours = hours % 12 || 12;
      amPm = hours >= 12 ? "AM" : "PM";
    }

    ELEMENTS.timer.clock.textContent = `${hours}:${minutes} ${amPm}`;
  },

  toggleTimeFormat() {
    const currentFormat = Storage.getSettings().timeFormat;
    Storage.setSettings("timeFormat", currentFormat === "12h" ? "24h" : "12h");
    this.updateClock();
  },

  startClockUpdate() {
    this.updateClock();
    setInterval(() => this.updateClock(), 1000);
  },
};

// Timer Management
const TimerManager = {
  updateCountdown() {
    chrome.storage.local.get(["endTime"], (result) => {
      if (!result.endTime) return;

      const remaining = result.endTime - Date.now();
      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        ELEMENTS.timer.countdownDisplay.textContent = `${minutes}:${seconds
          .toString()
          .padStart(2, "0")}`;
        setTimeout(() => this.updateCountdown(), 1000);
      } else {
        ELEMENTS.timer.countdownDisplay.textContent = "00:00";
      }
    });
  },

  startTimer() {
    const minutes = parseInt(ELEMENTS.timer.minutesInput.value);
    if (isNaN(minutes) || minutes <= 0) return;

    const endTime = Date.now() + minutes * 60000;
    chrome.storage.local.set({ endTime });
    chrome.alarms.create("countdown", { periodInMinutes: 1 });
    this.updateCountdown();
  },

  stopTimer() {
    chrome.storage.local.remove("endTime");
    chrome.alarms.clear("countdown");
    ELEMENTS.timer.countdownDisplay.textContent = "00:00";
  },
};

// Preset Form Management
const PresetFormManager = {
  clearForm() {
    Object.values(ELEMENTS.preset.inputs).forEach((input) => {
      input.value = "";
    });
  },

  showForm() {
    ELEMENTS.preset.form.style.display = "block";
  },

  hideForm() {
    ELEMENTS.preset.form.style.display = "none";
    ELEMENTS.preset.createButton.style.display = "block";
    this.clearForm();
  },

  savePreset() {
    const preset = {
      name: ELEMENTS.preset.inputs.name.value,
      hours: ELEMENTS.preset.inputs.hours.value,
      minutes: ELEMENTS.preset.inputs.minutes.value,
      seconds: ELEMENTS.preset.inputs.seconds.value,
    };
    Storage.savePreset(preset);
    this.hideForm();
  },

  limitInputLength(input) {
    // Remove any decimal points and non-numeric characters
    input.value = input.value.replace(/[^\d]/g, "");

    if (input.value.length > 2) {
      input.value = input.value.slice(0, 2);
    }
    // Ensure the value doesn't exceed 99
    if (parseInt(input.value) > 99) {
      input.value = "99";
    }
  },

  initializeInputLimits() {
    const clockInputs = [
      ELEMENTS.preset.inputs.hours,
      ELEMENTS.preset.inputs.minutes,
      ELEMENTS.preset.inputs.seconds,
    ];

    clockInputs.forEach((input) => {
      // Prevent decimal point input
      input.addEventListener("keypress", (e) => {
        if (e.key === "." || e.key === ",") {
          e.preventDefault();
        }
      });

      input.addEventListener("input", () => this.limitInputLength(input));
    });
  },
};

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  // Initialize tabs
  TabManager.initializeTabs();

  // Initialize clock
  ClockManager.startClockUpdate();

  // Initialize timer countdown
  TimerManager.updateCountdown();

  // Event Listeners
  ELEMENTS.timer.startButton.addEventListener("click", () =>
    TimerManager.startTimer()
  );
  ELEMENTS.timer.stopButton.addEventListener("click", () =>
    TimerManager.stopTimer()
  );
  ELEMENTS.timer.clock.addEventListener("click", () =>
    ClockManager.toggleTimeFormat()
  );

  // Preset form events
  ELEMENTS.preset.createButton.addEventListener("click", () =>
    PresetFormManager.showForm()
  );
  ELEMENTS.preset.cancelButton.addEventListener("click", () =>
    PresetFormManager.hideForm()
  );
  ELEMENTS.preset.addButton.addEventListener("click", () =>
    PresetFormManager.savePreset()
  );

  // Initialize input limitations
  PresetFormManager.initializeInputLimits();
});
