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
      toggleButton: document.getElementById("timer_toggle"),
      countdownDisplay: document.getElementById("countdown"),
      clock: document.getElementById("clock"),
      presetSelect: document.getElementById("preset_select"),
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
  get(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`Error reading ${key}:`, error);
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Error saving ${key}:`, error);
      return false;
    }
  },

  getSettings() {
    return this.get(CONFIG.STORAGE_KEYS.SETTINGS) || {};
  },

  setSettings(key, value) {
    const settings = this.getSettings();
    settings[key] = value;
    return this.set(CONFIG.STORAGE_KEYS.SETTINGS, settings);
  },

  getPresets() {
    return this.get(CONFIG.STORAGE_KEYS.PRESETS) || [];
  },

  async savePreset(preset) {
    const presets = this.getPresets();
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

  updateClock() {
    try {
      const now = new Date();
      const settings = Storage.getSettings();
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

  toggleTimeFormat() {
    const settings = Storage.getSettings();
    const newFormat = settings.timeFormat === "12h" ? "24h" : "12h";
    Storage.setSettings("timeFormat", newFormat);
    this.updateClock();
  },

  startClockUpdate() {
    this.updateClock();
    setInterval(() => this.updateClock(), CONFIG.UPDATE_INTERVAL);
  },
};

// Timer Management with state handling
const TimerManager = {
  loadPresets() {
    try {
      const presets = Storage.getPresets();
      const presetSelect = ELEMENTS.timer.presetSelect;

      presetSelect.innerHTML = '<option value="">Select preset</option>';

      presets.forEach((preset) => {
        const option = document.createElement("option");
        option.value = preset.id;
        option.textContent = preset.name;
        presetSelect.appendChild(option);
      });
    } catch (error) {
      console.error("Error loading presets:", error);
    }
  },

  restoreSelectedPreset() {
    try {
      const { presetId } = chrome.storage.local.get("presetId");
      if (presetId && ELEMENTS.timer.presetSelect) {
        ELEMENTS.timer.presetSelect.value = presetId;
      }
    } catch (error) {
      console.error("Error restoring selected preset:", error);
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

  savePreset() {
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

      Storage.savePreset(preset);
      this.hideForm();
      this.loadSavedPresets();
      TimerManager.loadPresets();
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

  loadSavedPresets() {
    try {
      const presetsList = document.querySelector(".saved-presets-list");
      const presets = Storage.getPresets();

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

        deleteButton.addEventListener("click", () => {
          this.deletePreset(preset.id);
        });

        presetItem.appendChild(nameSpan);
        presetItem.appendChild(deleteButton);
        presetsList.appendChild(presetItem);
      });
    } catch (error) {
      console.error("Error loading saved presets:", error);
    }
  },

  deletePreset(presetId) {
    try {
      const presets = Storage.getPresets();
      const updatedPresets = presets.filter((p) => p.id !== presetId);
      Storage.set(CONFIG.STORAGE_KEYS.PRESETS, updatedPresets);
      this.loadSavedPresets();
      TimerManager.loadPresets();
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
const initializeApp = () => {
  try {
    TabManager.initializeTabs();
    ClockManager.startClockUpdate();
    TimerManager.loadPresets();
    TimerManager.restoreSelectedPreset();

    // Replace separate start/stop listeners with single toggle
    ELEMENTS.timer.toggleButton?.addEventListener("click", () =>
      TimerManager.toggleTimer()
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
