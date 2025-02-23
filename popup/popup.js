// Constants for configuration
const CONFIG = {
  MAX_TIME_VALUE: 99,
  UPDATE_INTERVAL: 1000,
  DEFAULT_TIME_FORMAT: "24h",
  STORAGE_KEYS: {
    SETTINGS: "settings",
    PRESETS: "presets",
    END_TIME: "endTime",
  },
};

// DOM Elements - Using a proxy to handle missing elements
const ELEMENTS = new Proxy(
  {
    timer: {
      minutesInput: document.getElementById("minutes"),
      startButton: document.getElementById("start"),
      stopButton: document.getElementById("stop"),
      countdownDisplay: document.getElementById("countdown"),
      clock: document.getElementById("clock"),
    },
    preset: {
      header: document.querySelector(".preset-header"),
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
      list: document.querySelector(".clock-presets-list"),
    },
    tabs: {
      list: document.querySelectorAll(".tab"),
      contents: document.querySelectorAll(".tab-content"),
    },
  },
  {
    get: (target, prop) => {
      if (!target[prop]) {
        console.error(`Missing element: ${prop}`);
        return null;
      }
      return target[prop];
    },
  }
);

// Utility functions
const Utils = {
  padNumber: (num, size = 2) => String(num).padStart(size, "0"),

  validateTimeInput: (value) => {
    const numValue = parseInt(value);
    return (
      !isNaN(numValue) && numValue >= 0 && numValue <= CONFIG.MAX_TIME_VALUE
    );
  },

  createElementWithClass: (tag, className) => {
    const element = document.createElement(tag);
    element.className = className;
    return element;
  },

  generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  },
};

// Local Storage Operations with error handling
const Storage = {
  async get(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`Error reading ${key}:`, error);
      return null;
    }
  },

  async set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Error saving ${key}:`, error);
      return false;
    }
  },

  async getSettings() {
    return (await this.get(CONFIG.STORAGE_KEYS.SETTINGS)) || {};
  },

  async setSettings(key, value) {
    const settings = await this.getSettings();
    settings[key] = value;
    return this.set(CONFIG.STORAGE_KEYS.SETTINGS, settings);
  },

  async getPresets() {
    return (await this.get(CONFIG.STORAGE_KEYS.PRESETS)) || [];
  },

  async savePreset(preset) {
    const presets = await this.getPresets();
    return this.set(CONFIG.STORAGE_KEYS.PRESETS, [...presets, preset]);
  },
};

// Tab Management with error handling
const TabManager = {
  switchTab(tabName) {
    try {
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

      if (!selectedTab || !selectedContent) {
        return;
      }

      selectedContent.style.display = "block";
      selectedTab.classList.add("active");
    } catch (error) {
      console.error("Error switching tab:", error);
    }
  },

  initializeTabs() {
    ELEMENTS.tabs.list.forEach((tab) => {
      tab.addEventListener("click", () => this.switchTab(tab.dataset.tab));
    });
    this.switchTab("timer");
  },
};

// Clock Management with time handling
const ClockManager = {
  formatTime(hours, minutes, format) {
    const formattedHours = format === "12h" ? hours % 12 || 12 : hours;
    const amPm = format === "12h" ? (hours >= 12 ? "PM" : "AM") : "";
    return `${Utils.padNumber(formattedHours)}:${Utils.padNumber(
      minutes
    )} ${amPm}`;
  },

  async updateClock() {
    try {
      const now = new Date();
      const settings = await Storage.getSettings();
      const timeFormat = settings.timeFormat || CONFIG.DEFAULT_TIME_FORMAT;

      ELEMENTS.timer.clock.textContent = this.formatTime(
        now.getHours(),
        now.getMinutes(),
        timeFormat
      );
    } catch (error) {
      console.error("Error updating clock:", error);
    }
  },

  async toggleTimeFormat() {
    const settings = await Storage.getSettings();
    const newFormat = settings.timeFormat === "12h" ? "24h" : "12h";
    await Storage.setSettings("timeFormat", newFormat);
    await this.updateClock();
  },

  startClockUpdate() {
    this.updateClock();
    setInterval(() => this.updateClock(), CONFIG.UPDATE_INTERVAL);
  },
};

// Timer Management with state handling
const TimerManager = {
  totalTime: 0,
  remainingTime: 0,
  timerInterval: null,

  updateCircleProgress(percentage) {
    const circle = document.querySelector(".timer-progress-bar");
    const circumference = 2 * Math.PI * 90; // 2πr
    const offset = circumference - (percentage / 100) * circumference;
    circle.style.strokeDashoffset = offset;
  },

  updateCountdown() {
    chrome.storage.local.get([CONFIG.STORAGE_KEYS.END_TIME], (result) => {
      if (!result.endTime) return;

      const remaining = result.endTime - Date.now();
      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        ELEMENTS.timer.countdownDisplay.textContent = `${Utils.padNumber(
          minutes
        )}:${Utils.padNumber(seconds)}`;

        // Calculate and update progress
        const percentage = (remaining / this.totalTime) * 100;
        this.updateCircleProgress(percentage);

        setTimeout(() => this.updateCountdown(), CONFIG.UPDATE_INTERVAL);
      } else {
        this.resetTimer();
      }
    });
  },

  startTimer() {
    const minutes = parseInt(ELEMENTS.timer.minutesInput.value);
    if (!Utils.validateTimeInput(minutes)) return;

    this.totalTime = minutes * 60000; // Convert to milliseconds
    const endTime = Date.now() + this.totalTime;

    chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.END_TIME]: endTime });
    chrome.alarms.create("countdown", { periodInMinutes: 1 });

    // Reset circle progress
    this.updateCircleProgress(100);
    this.updateCountdown();
  },

  resetTimer() {
    ELEMENTS.timer.countdownDisplay.textContent = "00:00";
    this.updateCircleProgress(0);
    this.totalTime = 0;
  },

  stopTimer() {
    chrome.storage.local.remove(CONFIG.STORAGE_KEYS.END_TIME);
    chrome.alarms.clear("countdown");
    this.resetTimer();
  },

  async loadPresets() {
    const presetSelect = document.getElementById("preset_select");

    try {
      const presets = await Storage.getPresets();

      presetSelect.innerHTML = '<option value="">Select preset</option>';

      presets.forEach((preset) => {
        const option = document.createElement("option");
        option.value = preset.id;
        option.textContent = preset.name;
        presetSelect.appendChild(option);
      });

      presetSelect.addEventListener("change", () => {
        const selectedPreset = presets.find((p) => p.id === presetSelect.value);
        if (selectedPreset?.clocks?.[0]) {
          const firstClock = selectedPreset.clocks[0];
          // Convert all values to seconds for precise calculation
          const totalSeconds =
            firstClock.hours * 3600 +
            firstClock.minutes * 60 +
            firstClock.seconds;
          // Convert back to minutes with decimal points for precise timing
          ELEMENTS.timer.minutesInput.value = (totalSeconds / 60).toFixed(2);
        }
      });
    } catch (error) {
      console.error("Error loading presets:", error);
    }
  },
};

// Preset Form Management with improved validation and error handling
const PresetFormManager = {
  clearClocksList() {
    ELEMENTS.preset.list.innerHTML = "";
  },

  clearForm() {
    Object.values(ELEMENTS.preset.inputs).forEach((input) => {
      if (input) input.value = "";
    });
    this.clearClocksList();
  },

  clearClocks() {
    ELEMENTS.preset.inputs.hours.value = "";
    ELEMENTS.preset.inputs.minutes.value = "";
    ELEMENTS.preset.inputs.seconds.value = "";
  },

  showForm() {
    ELEMENTS.preset.form.style.display = "block";
    ELEMENTS.preset.header.style.display = "none";
  },

  hideForm() {
    ELEMENTS.preset.form.style.display = "none";
    ELEMENTS.preset.header.style.display = "block";
    this.clearForm();
  },

  async savePreset() {
    try {
      const presetName = ELEMENTS.preset.inputs.name.value.trim();
      if (!presetName) {
        throw new Error("Preset name is required");
      }

      const clockItems = Array.from(
        ELEMENTS.preset.list.querySelectorAll(".preset-item")
      );
      if (clockItems.length === 0) {
        throw new Error("Add at least one clock to the preset");
      }

      const clocks = clockItems.map((item, index) => {
        const timeItems = item.querySelectorAll(".preset-clock-item");
        return {
          position: index,
          hours: parseInt(timeItems[0].textContent) || 0,
          minutes: parseInt(timeItems[1].textContent) || 0,
          seconds: parseInt(timeItems[2].textContent) || 0,
        };
      });

      const preset = {
        id: Utils.generateUUID(),
        name: presetName,
        clocks: clocks,
        createdAt: Date.now(),
      };

      await Storage.savePreset(preset);
      this.hideForm();
      await this.loadSavedPresets();
      if (TimerManager.loadPresets) {
        await TimerManager.loadPresets();
      }
    } catch (error) {
      console.error("Error saving preset:", error);
    }
  },

  validatePreset(preset) {
    return (
      preset.name &&
      Utils.validateTimeInput(preset.hours) &&
      Utils.validateTimeInput(preset.minutes) &&
      Utils.validateTimeInput(preset.seconds)
    );
  },

  limitInputLength(input) {
    input.value = input.value.replace(/[^\d]/g, "");

    if (input.value.length > 2) {
      input.value.slice(0, 2);
    }

    const numValue = parseInt(input.value);
    if (numValue > CONFIG.MAX_TIME_VALUE) {
      input.value = String(CONFIG.MAX_TIME_VALUE);
    }
  },

  createPresetItem(hours, minutes, seconds) {
    const presetItem = Utils.createElementWithClass("div", "preset-item");
    presetItem.draggable = true;
    presetItem.innerHTML = `
      <div class="preset-clock-item">${Utils.padNumber(hours)}</div>:
      <div class="preset-clock-item">${Utils.padNumber(minutes)}</div>:
      <div class="preset-clock-item">${Utils.padNumber(seconds)}</div>
      <button class="preset-remove-btn">×</button>
    `;
    return presetItem;
  },

  addClockToPresetsList() {
    const hours = ELEMENTS.preset.inputs.hours.value || "0";
    const minutes = ELEMENTS.preset.inputs.minutes.value || "0";
    const seconds = ELEMENTS.preset.inputs.seconds.value || "0";

    const presetItem = this.createPresetItem(hours, minutes, seconds);
    ELEMENTS.preset.list.appendChild(presetItem);

    this.clearClocks();
    this.initializeDragAndDrop(presetItem);
  },

  initializeDragAndDrop(item) {
    const dragEvents = {
      dragstart: (e) => e.target.classList.add("dragging"),
      dragend: (e) => e.target.classList.remove("dragging"),
    };

    Object.entries(dragEvents).forEach(([event, handler]) => {
      item.addEventListener(event, handler);
    });

    const removeBtn = item.querySelector(".preset-remove-btn");
    removeBtn.addEventListener("click", () => item.remove());
  },

  initializePresetsList() {
    ELEMENTS.preset.list.addEventListener("dragover", (e) => {
      e.preventDefault();
      const draggingItem = document.querySelector(".dragging");
      if (!draggingItem) return;

      const siblings = [
        ...ELEMENTS.preset.list.querySelectorAll(".preset-item:not(.dragging)"),
      ];
      const nextSibling = siblings.find((sibling) => {
        const box = sibling.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });

      ELEMENTS.preset.list.insertBefore(draggingItem, nextSibling);
    });
  },

  initializeInputLimits() {
    const clockInputs = [
      ELEMENTS.preset.inputs.hours,
      ELEMENTS.preset.inputs.minutes,
      ELEMENTS.preset.inputs.seconds,
    ];

    clockInputs.forEach((input) => {
      if (!input) return;

      input.addEventListener("keypress", (e) => {
        if ([".", ","].includes(e.key)) e.preventDefault();
      });

      input.addEventListener("input", () => this.limitInputLength(input));
    });
  },

  async loadSavedPresets() {
    try {
      const presetsList = document.querySelector(".saved-presets-list");
      const presets = await Storage.getPresets();

      presetsList.innerHTML = "";

      presets.forEach((preset) => {
        const presetItem = document.createElement("div");
        presetItem.className = "saved-preset-item";
        presetItem.dataset.presetId = preset.id;

        const nameSpan = document.createElement("span");
        nameSpan.className = "saved-preset-name";
        nameSpan.textContent = preset.name;

        const deleteButton = document.createElement("button");
        deleteButton.className = "saved-preset-delete";
        deleteButton.innerHTML = "×";
        deleteButton.title = "Delete preset";

        deleteButton.addEventListener("click", async () => {
          await this.deletePreset(preset.id);
        });

        presetItem.appendChild(nameSpan);
        presetItem.appendChild(deleteButton);
        presetsList.appendChild(presetItem);
      });
    } catch (error) {
      console.error("Error loading saved presets:", error);
    }
  },

  async deletePreset(presetId) {
    try {
      const presets = await Storage.getPresets();
      const updatedPresets = presets.filter((p) => p.id !== presetId);
      await Storage.set(CONFIG.STORAGE_KEYS.PRESETS, updatedPresets);
      await this.loadSavedPresets();
      if (TimerManager.loadPresets) {
        await TimerManager.loadPresets();
      }
    } catch (error) {
      console.error("Error deleting preset:", error);
    }
  },

  initializeEventListeners() {
    const addClockButton = document.getElementById("add_preset_clock");
    if (addClockButton) {
      addClockButton.addEventListener("click", () =>
        this.addClockToPresetsList()
      );
    }

    this.initializePresetsList();
    this.loadSavedPresets();
  },
};

// Initialize Application with error handling
const initializeApp = async () => {
  try {
    TabManager.initializeTabs();
    ClockManager.startClockUpdate();
    TimerManager.updateCountdown();

    // Timer event listeners
    ELEMENTS.timer.startButton?.addEventListener("click", () =>
      TimerManager.startTimer()
    );
    ELEMENTS.timer.stopButton?.addEventListener("click", () =>
      TimerManager.stopTimer()
    );
    ELEMENTS.timer.clock?.addEventListener("click", () =>
      ClockManager.toggleTimeFormat()
    );

    // Preset form event listeners
    ELEMENTS.preset.createButton?.addEventListener("click", () =>
      PresetFormManager.showForm()
    );
    ELEMENTS.preset.cancelButton?.addEventListener("click", () =>
      PresetFormManager.hideForm()
    );
    ELEMENTS.preset.addButton?.addEventListener("click", () =>
      PresetFormManager.savePreset()
    );

    PresetFormManager.initializeInputLimits();
    PresetFormManager.initializeEventListeners();
  } catch (error) {
    console.error("Error initializing app:", error);
  }
};

document.addEventListener("DOMContentLoaded", initializeApp);
