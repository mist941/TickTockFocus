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
        throw new Error(`Tab ${tabName} not found`);
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
        setTimeout(() => this.updateCountdown(), CONFIG.UPDATE_INTERVAL);
      } else {
        this.resetTimer();
      }
    });
  },

  startTimer() {
    const minutes = parseInt(ELEMENTS.timer.minutesInput.value);
    if (!Utils.validateTimeInput(minutes)) return;

    const endTime = Date.now() + minutes * 60000;
    chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.END_TIME]: endTime });
    chrome.alarms.create("countdown", { periodInMinutes: 1 });
    this.updateCountdown();
  },

  resetTimer() {
    ELEMENTS.timer.countdownDisplay.textContent = "00:00";
  },

  stopTimer() {
    chrome.storage.local.remove(CONFIG.STORAGE_KEYS.END_TIME);
    chrome.alarms.clear("countdown");
    this.resetTimer();
  },
};

// Preset Form Management with improved validation and error handling
const PresetFormManager = {
  clearForm() {
    Object.values(ELEMENTS.preset.inputs).forEach((input) => {
      if (input) input.value = "";
    });
  },

  showForm() {
    ELEMENTS.preset.form.style.display = "block";
    ELEMENTS.preset.createButton.style.display = "none";
  },

  hideForm() {
    ELEMENTS.preset.form.style.display = "none";
    ELEMENTS.preset.createButton.style.display = "block";
    this.clearForm();
  },

  async savePreset() {
    try {
      const preset = {
        name: ELEMENTS.preset.inputs.name.value,
        hours: ELEMENTS.preset.inputs.hours.value,
        minutes: ELEMENTS.preset.inputs.minutes.value,
        seconds: ELEMENTS.preset.inputs.seconds.value,
      };

      if (!this.validatePreset(preset)) {
        throw new Error("Invalid preset data");
      }

      await Storage.savePreset(preset);
      this.hideForm();
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
      input.value = input.value.slice(0, 2);
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
      <div class="preset-clock-item">${Utils.padNumber(hours)}</div>
      <div class="preset-clock-item">${Utils.padNumber(minutes)}</div>
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

    this.clearForm();
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

  initializeEventListeners() {
    const addClockButton = document.getElementById("add_preset_clock");
    if (addClockButton) {
      addClockButton.addEventListener("click", () =>
        this.addClockToPresetsList()
      );
    }

    this.initializePresetsList();
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
