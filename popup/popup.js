// Constants for configuration
const CONFIG = {
  MAX_TIME_VALUE: 99,
  UPDATE_INTERVAL: 1000,
  DEFAULT_TIME_FORMAT: "24h",
  // In packed extensions Chrome fires alarms at most once every 30 seconds
  // and may delay them further (unpacked extensions are exempt). Each segment
  // ends with an alarm, so a shorter segment would be announced late.
  MIN_SEGMENT_SECONDS: 30,
  // Keeps every preset far below chrome.storage.sync's 8 KB per-item quota
  // (the worst case is about 3 KB).
  MAX_PRESET_NAME_LENGTH: 50,
  MAX_SEGMENTS_PER_PRESET: 50,
  STORAGE_KEYS: {
    SETTINGS: "settings",
    PRESET_PREFIX: "preset_",
    LEGACY_PRESETS: "presets",
    LEGACY_SETTINGS: "settings",
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
      progressBar: document.querySelector(".timer-progress-bar"),
      message: document.getElementById("timer_message"),
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
      message: document.getElementById("presets_message"),
      errors: {
        name: document.getElementById("preset_name_error"),
        segment: document.getElementById("segment_error"),
        segments: document.getElementById("segments_error"),
      },
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

// Presets and settings live in chrome.storage.sync so they follow the user's
// Google account. A write that hits a sync quota falls back to
// chrome.storage.local, so every read merges both areas.
const Storage = {
  isQuotaError(error) {
    return /quota/i.test(error?.message || "");
  },

  presetKey(presetId) {
    return `${CONFIG.STORAGE_KEYS.PRESET_PREFIX}${presetId}`;
  },

  async getItems(keys) {
    const [syncItems, localItems] = await Promise.all([
      chrome.storage.sync.get(keys),
      chrome.storage.local.get(keys),
    ]);
    return { ...syncItems, ...localItems };
  },

  async setItems(items) {
    try {
      await chrome.storage.sync.set(items);
    } catch (error) {
      if (!this.isQuotaError(error)) throw error;

      const entries = Object.entries(items);
      if (entries.length === 1) {
        await chrome.storage.local.set(items);
        return;
      }
      // Retry one by one so only the items that don't fit stay local-only.
      for (const [key, value] of entries) {
        await this.setItems({ [key]: value });
      }
      return;
    }
    // A local copy left by an earlier fallback would shadow the synced value.
    await chrome.storage.local.remove(Object.keys(items));
  },

  async getSettings() {
    const items = await this.getItems(CONFIG.STORAGE_KEYS.SETTINGS);
    return items[CONFIG.STORAGE_KEYS.SETTINGS] || {};
  },

  async setSettings(key, value) {
    const settings = await this.getSettings();
    settings[key] = value;
    await this.setItems({ [CONFIG.STORAGE_KEYS.SETTINGS]: settings });
  },

  async getPresets() {
    const items = await this.getItems(null);
    return Object.entries(items)
      .filter(([key]) => key.startsWith(CONFIG.STORAGE_KEYS.PRESET_PREFIX))
      .map(([, preset]) => preset)
      .sort((first, second) => (first.createdAt || 0) - (second.createdAt || 0));
  },

  async savePreset(preset) {
    await this.setItems({ [this.presetKey(preset.id)]: preset });
  },

  async deletePreset(presetId) {
    const key = this.presetKey(presetId);
    await Promise.all([
      chrome.storage.sync.remove(key),
      chrome.storage.local.remove(key),
    ]);
  },
};

// One-time move of v1.0 data from the popup's localStorage to chrome.storage.
// The old keys are removed only after the copies read back intact, so a run
// that fails or is interrupted loses nothing and retries on the next open.
const LegacyMigration = {
  readLegacyKey(key) {
    const rawValue = localStorage.getItem(key);
    if (rawValue === null) return { exists: false };
    try {
      return { exists: true, isReadable: true, value: JSON.parse(rawValue) };
    } catch (error) {
      return { exists: true, isReadable: false };
    }
  },

  isPresetLike(preset) {
    return (
      preset !== null &&
      typeof preset === "object" &&
      Array.isArray(preset.clocks)
    );
  },

  // Storage may hand objects back with their keys in a different order.
  toComparableJson(value) {
    return JSON.stringify(value, (key, nestedValue) =>
      nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)
        ? Object.fromEntries(
            Object.entries(nestedValue).sort(([first], [second]) =>
              first < second ? -1 : first > second ? 1 : 0
            )
          )
        : nestedValue
    );
  },

  collectPresets(legacyPresets, itemsToWrite) {
    const presets = legacyPresets.value ?? [];
    if (!Array.isArray(presets) || !presets.every(this.isPresetLike)) {
      return false;
    }

    const usedIds = new Set();
    presets.forEach((preset, index) => {
      // Presets are stored by id, so a missing or repeated id would lose one.
      // The replacement depends only on the data, so a retried run reuses it.
      if (typeof preset.id !== "string" || usedIds.has(preset.id)) {
        preset.id = `${typeof preset.id === "string" ? preset.id : "legacy"}-${index}`;
      }
      usedIds.add(preset.id);
      itemsToWrite[Storage.presetKey(preset.id)] = preset;
    });
    return true;
  },

  async collectSettings(legacySettings, itemsToWrite) {
    const settings = legacySettings.value;
    if (settings !== null && (typeof settings !== "object" || Array.isArray(settings))) {
      return false;
    }

    const settingsKey = CONFIG.STORAGE_KEYS.SETTINGS;
    const storedItems = await Storage.getItems(settingsKey);
    // Settings that already arrived through sync win over this device's old copy.
    if (settings && !storedItems[settingsKey]) {
      itemsToWrite[settingsKey] = settings;
    }
    return true;
  },

  async run() {
    const { LEGACY_PRESETS, LEGACY_SETTINGS } = CONFIG.STORAGE_KEYS;
    const legacyPresets = this.readLegacyKey(LEGACY_PRESETS);
    const legacySettings = this.readLegacyKey(LEGACY_SETTINGS);
    const itemsToWrite = {};
    const legacyKeysToRemove = [];

    // Values v1.0 itself couldn't have read are left where they are.
    if (legacyPresets.isReadable && this.collectPresets(legacyPresets, itemsToWrite)) {
      legacyKeysToRemove.push(LEGACY_PRESETS);
    }
    if (
      legacySettings.isReadable &&
      (await this.collectSettings(legacySettings, itemsToWrite))
    ) {
      legacyKeysToRemove.push(LEGACY_SETTINGS);
    }
    if (legacyKeysToRemove.length === 0) return;

    const keysToVerify = Object.keys(itemsToWrite);
    if (keysToVerify.length > 0) {
      await Storage.setItems(itemsToWrite);
      const storedItems = await Storage.getItems(keysToVerify);
      const isIntact = keysToVerify.every(
        (key) =>
          this.toComparableJson(storedItems[key]) ===
          this.toComparableJson(itemsToWrite[key])
      );
      if (!isIntact) throw new Error("Migrated data did not read back intact");
    }

    legacyKeysToRemove.forEach((key) => localStorage.removeItem(key));
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
  timeFormat: CONFIG.DEFAULT_TIME_FORMAT,

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
      ELEMENTS.timer.clock.textContent = this.formatTime(
        now.getHours(),
        now.getMinutes(),
        this.timeFormat
      );
    } catch (error) {
      console.error("Error updating clock:", error);
    }
  },

  async toggleTimeFormat() {
    this.timeFormat = this.timeFormat === "12h" ? "24h" : "12h";
    this.updateClock();
    try {
      await Storage.setSettings("timeFormat", this.timeFormat);
    } catch (error) {
      console.error("Error saving time format:", error);
    }
  },

  async startClockUpdate() {
    try {
      const settings = await Storage.getSettings();
      this.timeFormat = settings.timeFormat || CONFIG.DEFAULT_TIME_FORMAT;
    } catch (error) {
      console.error("Error loading settings:", error);
    }
    this.updateClock();
    setInterval(() => this.updateClock(), CONFIG.UPDATE_INTERVAL);
  },
};

// Timer Management with state handling
const TimerManager = {
  timer: null,
  endTime: null,
  totalDuration: null,
  presets: [],
  isRunning: false,

  getPresetDuration(presetId) {
    try {
      const preset = this.presets.find((p) => p.id === presetId);

      if (!preset) return null;

      // Calculate total milliseconds from all clocks in the preset
      return preset.clocks.reduce((total, clock) => {
        const hours = (clock.hours || 0) * 60 * 60 * 1000;
        const minutes = (clock.minutes || 0) * 60 * 1000;
        const seconds = (clock.seconds || 0) * 1000;
        return total + hours + minutes + seconds;
      }, 0);
    } catch (error) {
      console.error("Error calculating preset duration:", error);
      return null;
    }
  },

  async loadPresets() {
    try {
      const [presets, { selectedPresetId }] = await Promise.all([
        Storage.getPresets(),
        chrome.storage.local.get("selectedPresetId"),
      ]);
      this.presets = presets;
      const presetSelect = ELEMENTS.timer.presetSelect;

      presetSelect.innerHTML = '<option value="">Select preset</option>';

      this.presets.forEach((preset) => {
        const option = document.createElement("option");
        option.value = preset.id;
        option.textContent = preset.name;
        presetSelect.appendChild(option);
      });

      if (this.presets.some((preset) => preset.id === selectedPresetId)) {
        presetSelect.value = selectedPresetId;
      }
    } catch (error) {
      console.error("Error loading presets:", error);
    }
    this.updateStartButtonState();
  },

  restoreTimerState() {
    chrome.storage.local.get(
      [
        "isRunning",
        "endTime",
        "totalDuration",
        "timerProgress",
        "clocks",
        "selectedPresetId",
      ],
      (result) => {
        if (result.isRunning && result.endTime) {
          this.endTime = result.endTime;
          this.totalDuration = result.totalDuration;
          this.updateCountdown();
          this.timer = setInterval(() => this.updateCountdown(), 1000);
          this.updateToggleButton(true);

          // Redraw points if timer is running and we have clocks data
          if (result.clocks) {
            this.drawPresetPoints(result.clocks);
          }
        } else if (result.timerProgress !== undefined) {
          this.updateCircleProgress(result.timerProgress);
          this.updateToggleButton(false);
        }
      }
    );
  },

  // Resolves once the service worker confirms the command. Rejects when it
  // can't be reached, reports a failure, or answers without a response.
  sendTimerCommand(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response?.success) {
          reject(new Error(response?.error || "No response from the service worker"));
        } else {
          resolve(response);
        }
      });
    });
  },

  showCommandError(action, error) {
    console.error(`${action} failed:`, error);
    this.showTimerMessage(
      "Couldn't reach the timer. Close and reopen this popup, then try again.",
      { isError: true }
    );
  },

  async startTimer(duration) {
    const selectedPresetId = ELEMENTS.timer.presetSelect.value;
    const preset = this.presets.find((p) => p.id === selectedPresetId);

    if (!preset) return;

    try {
      await this.sendTimerCommand({
        action: "startTimer",
        duration: duration,
        presetName: preset.name,
        clocks: preset.clocks,
      });
    } catch (error) {
      this.showCommandError("startTimer", error);
      return;
    }

    // Draw points on the circle when the timer starts
    this.drawPresetPoints(preset.clocks);
    this.updateToggleButton(true);
    this.startCountdownUpdate();
  },

  drawPresetPoints(clocks) {
    const circle = ELEMENTS.timer.progressBar;
    if (!circle) return;

    const svgNamespace = "http://www.w3.org/2000/svg";
    const centerX = circle.cx.baseVal.value;
    const centerY = circle.cy.baseVal.value;
    const radius = circle.r.baseVal.value;

    // Clear existing points and labels
    const existingElements = document.querySelectorAll(
      ".preset-point, .preset-point-label"
    );
    existingElements.forEach((element) => element.remove());

    // Calculate total duration
    const totalDuration = clocks.reduce((total, clock) => {
      const clockMs =
        (clock.hours * 3600 + clock.minutes * 60 + clock.seconds) * 1000;
      return total + clockMs;
    }, 0);

    let accumulatedTime = 0;

    clocks.forEach((clock) => {
      // Add current clock duration to accumulated time
      const clockMs =
        (clock.hours * 3600 + clock.minutes * 60 + clock.seconds) * 1000;
      accumulatedTime += clockMs;

      // Calculate position based on accumulated time
      const position = accumulatedTime / totalDuration;

      // Calculate angle (start from top and go clockwise)
      const angle = -position * 2 * Math.PI;

      // Create point
      const point = document.createElementNS(svgNamespace, "circle");
      const pointX = centerX + radius * Math.cos(angle);
      const pointY = centerY + radius * Math.sin(angle);

      point.setAttribute("class", "preset-point");
      point.setAttribute("cx", pointX);
      point.setAttribute("cy", pointY);
      point.setAttribute("r", 5);
      point.setAttribute("fill", "rgb(234 179 8)");

      // Create label with foreignObject for better text handling
      const foreignObject = document.createElementNS(
        svgNamespace,
        "foreignObject"
      );
      const labelRadius = radius + 25;
      const labelX = centerX + labelRadius * Math.cos(angle);
      const labelY = centerY + labelRadius * Math.sin(angle);

      // Calculate accumulated hours, minutes and seconds for the label
      const totalHours = Math.floor(accumulatedTime / (1000 * 60 * 60));
      const totalMinutes = Math.floor(
        (accumulatedTime % (1000 * 60 * 60)) / (1000 * 60)
      );
      const totalSeconds = Math.floor((accumulatedTime % (1000 * 60)) / 1000);
      const timeText = `${Utils.padNumber(totalHours)}:${Utils.padNumber(
        totalMinutes
      )}:${Utils.padNumber(totalSeconds)}`;

      // Calculate label width and height
      const labelWidth = 20;
      const labelHeight = 60;

      // Position foreignObject
      foreignObject.setAttribute("x", labelX - labelWidth / 2);
      foreignObject.setAttribute("y", labelY - labelHeight / 2);
      foreignObject.setAttribute("width", labelWidth);
      foreignObject.setAttribute("height", labelHeight);

      // Create div inside foreignObject for the text
      const div = document.createElement("div");
      div.classList.add("preset-point-label");
      div.textContent = timeText;

      foreignObject.appendChild(div);

      // Add elements to SVG
      circle.parentNode.appendChild(point);
      circle.parentNode.appendChild(foreignObject);
    });
  },

  async stopTimer() {
    try {
      await this.sendTimerCommand({ action: "stopTimer" });
    } catch (error) {
      this.showCommandError("stopTimer", error);
      return;
    }

    this.showIdleState();

    if (ELEMENTS.timer.presetSelect) {
      ELEMENTS.timer.presetSelect.value = "";
    }
  },

  showIdleState() {
    clearInterval(this.timer);
    this.timer = null;
    ELEMENTS.timer.countdownDisplay.textContent = "00:00";
    this.updateCircleProgress(0);
    this.updateToggleButton(false);

    // Remove all preset points
    const existingPoints = document.querySelectorAll(
      ".preset-point, .preset-point-label"
    );
    existingPoints.forEach((point) => point.remove());
  },

  startCountdownUpdate() {
    this.updateCountdown();
    this.timer = setInterval(() => this.updateCountdown(), 1000);
  },

  updateCountdown() {
    chrome.storage.local.get(
      ["endTime", "totalDuration", "clocks"],
      (result) => {
        const timeLeft = result.endTime ? result.endTime - Date.now() : 0;

        // Only the view changes here. The service worker's countdown alarm
        // completes the run; sending stopTimer would cancel its notification.
        if (timeLeft <= 0) {
          this.showIdleState();
          return;
        }

        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

        ELEMENTS.timer.countdownDisplay.textContent = `${Utils.padNumber(
          hours
        )}:${Utils.padNumber(minutes)}:${Utils.padNumber(seconds)}`;

        const progress = (timeLeft / result.totalDuration) * 100;

        this.updateCircleProgress(progress);
      }
    );
  },

  updateCircleProgress(percentage) {
    const circle = ELEMENTS.timer.progressBar;
    if (!circle) return;

    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (percentage / 100) * circumference;

    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = offset;

    // Store the progress state
    chrome.storage.local.set({ timerProgress: percentage });
  },

  toggleTimer() {
    chrome.storage.local.get(["isRunning", "endTime"], (result) => {
      // Past its end time a run is finished, even if its alarm hasn't fired yet.
      if (result.isRunning && result.endTime > Date.now()) {
        this.stopTimer();
      } else {
        const selectedPresetId = ELEMENTS.timer.presetSelect.value;
        const duration =
          selectedPresetId && this.getPresetDuration(selectedPresetId);
        // Start is disabled in these cases; this covers a click that raced a change.
        if (!duration) {
          this.updateStartButtonState();
          return;
        }

        this.startTimer(duration);
      }
    });
  },

  updateToggleButton(isRunning) {
    const button = ELEMENTS.timer.toggleButton;
    if (!button) return;
    this.isRunning = isRunning;
    button.textContent = isRunning ? "Stop" : "Start";
    this.updateStartButtonState();
  },

  showTimerMessage(text, { isError = false } = {}) {
    ELEMENTS.timer.message.textContent = text;
    ELEMENTS.timer.message.classList.toggle("error", isError);
  },

  // Start needs a selected preset with a duration. Stop is always available.
  updateStartButtonState() {
    const button = ELEMENTS.timer.toggleButton;
    if (this.isRunning) {
      button.disabled = false;
      this.showTimerMessage("");
      return;
    }

    const selectedPresetId = ELEMENTS.timer.presetSelect.value;
    if (this.presets.length === 0) {
      button.disabled = true;
      this.showTimerMessage("Create a preset on the Presets tab to start.");
    } else if (!selectedPresetId) {
      button.disabled = true;
      this.showTimerMessage("Select a preset to start.");
    } else if (!this.getPresetDuration(selectedPresetId)) {
      button.disabled = true;
      this.showTimerMessage("This preset has no duration. Select another one.", {
        isError: true,
      });
    } else {
      button.disabled = false;
      this.showTimerMessage("");
    }
  },
};

// Preset Form Management with improved validation and error handling
const PresetFormManager = {
  showMessage(text) {
    ELEMENTS.preset.message.textContent = text;
  },

  getFieldInputs(field) {
    const { name, hours, minutes, seconds } = ELEMENTS.preset.inputs;
    const inputsByField = {
      name: [name],
      segment: [hours, minutes, seconds],
      segments: [],
    };
    return inputsByField[field];
  },

  showFieldError(field, text) {
    ELEMENTS.preset.errors[field].textContent = text;
    this.getFieldInputs(field).forEach((input) => {
      if (text) {
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-invalid");
      }
    });
  },

  clearFieldErrors() {
    Object.keys(ELEMENTS.preset.errors).forEach((field) =>
      this.showFieldError(field, "")
    );
  },

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
    this.clearFieldErrors();
  },

  async savePreset() {
    try {
      const presetName = ELEMENTS.preset.inputs.name.value.trim();
      const clockItems = Array.from(
        ELEMENTS.preset.list.querySelectorAll(".preset-item")
      );

      let nameError = "";
      if (!presetName) {
        nameError = "Enter a preset name.";
      } else if (presetName.length > CONFIG.MAX_PRESET_NAME_LENGTH) {
        nameError = `Use at most ${CONFIG.MAX_PRESET_NAME_LENGTH} characters.`;
      }
      const segmentsError =
        clockItems.length === 0 ? "Add at least one segment." : "";

      this.showFieldError("name", nameError);
      this.showFieldError("segments", segmentsError);
      if (nameError) {
        ELEMENTS.preset.inputs.name.focus();
        return;
      }
      if (segmentsError) {
        ELEMENTS.preset.inputs.hours.focus();
        return;
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
      this.showMessage("");
      this.hideForm();
      await this.loadSavedPresets();
      await TimerManager.loadPresets();
    } catch (error) {
      console.error("Error saving preset:", error);
      this.showMessage("Couldn't save the preset. Try again.");
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

  readSegmentInputs() {
    const { hours, minutes, seconds } = ELEMENTS.preset.inputs;
    return {
      hours: Number(hours.value) || 0,
      minutes: Number(minutes.value) || 0,
      seconds: Number(seconds.value) || 0,
    };
  },

  validateSegment({ hours, minutes, seconds }) {
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    if (totalSeconds === 0) {
      return "Enter a duration longer than 00:00:00.";
    }
    if (totalSeconds < CONFIG.MIN_SEGMENT_SECONDS) {
      return `Each segment must be at least ${CONFIG.MIN_SEGMENT_SECONDS} seconds long.`;
    }
    return "";
  },

  addClockToPresetsList() {
    const segmentCount = ELEMENTS.preset.list.querySelectorAll(".preset-item").length;
    if (segmentCount >= CONFIG.MAX_SEGMENTS_PER_PRESET) {
      this.showFieldError(
        "segments",
        `A preset can have at most ${CONFIG.MAX_SEGMENTS_PER_PRESET} segments.`
      );
      return;
    }

    const segment = this.readSegmentInputs();
    const segmentError = this.validateSegment(segment);
    if (segmentError) {
      this.showFieldError("segment", segmentError);
      return;
    }

    const presetItem = this.createPresetItem(
      segment.hours,
      segment.minutes,
      segment.seconds
    );
    ELEMENTS.preset.list.appendChild(presetItem);

    this.clearClocks();
    this.initializeDragAndDrop(presetItem);
    this.showFieldError("segment", "");
    this.showFieldError("segments", "");
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
    ELEMENTS.preset.inputs.name.maxLength = CONFIG.MAX_PRESET_NAME_LENGTH;
    ELEMENTS.preset.inputs.name.addEventListener("input", () =>
      this.showFieldError("name", "")
    );

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

      input.addEventListener("input", () => {
        this.limitInputLength(input);
        this.showFieldError("segment", "");
      });
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

        deleteButton.addEventListener("click", () => {
          this.deletePreset(preset.id);
        });

        presetItem.appendChild(nameSpan);
        presetItem.appendChild(deleteButton);
        presetsList.appendChild(presetItem);
      });
    } catch (error) {
      console.error("Error loading saved presets:", error);
      this.showMessage("Couldn't load your presets. Reopen the popup to try again.");
    }
  },

  async deletePreset(presetId) {
    try {
      await Storage.deletePreset(presetId);
      this.showMessage("");
      await this.loadSavedPresets();
      await TimerManager.loadPresets();
    } catch (error) {
      console.error("Error deleting preset:", error);
      this.showMessage("Couldn't delete the preset. Try again.");
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
  },
};

// Initialize Application with error handling
const initializeApp = async () => {
  try {
    TabManager.initializeTabs();

    // Toggle time format
    ELEMENTS.timer.clock.addEventListener("click", () => {
      ClockManager.toggleTimeFormat();
    });

    // Replace separate start/stop listeners with single toggle
    ELEMENTS.timer.toggleButton?.addEventListener("click", () =>
      TimerManager.toggleTimer()
    );

    // Save selected preset when changed
    ELEMENTS.timer.presetSelect?.addEventListener("change", (e) => {
      chrome.storage.local.set({ selectedPresetId: e.target.value });
      TimerManager.updateStartButtonState();
    });

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

    // Presets and settings have to be in chrome.storage before anything reads them.
    try {
      await LegacyMigration.run();
    } catch (error) {
      console.error("Error migrating presets from localStorage:", error);
      PresetFormManager.showMessage(
        "Couldn't move your presets from the previous version. They're still on this device; reopen the popup to try again."
      );
    }

    await ClockManager.startClockUpdate();
    await PresetFormManager.loadSavedPresets();
    await TimerManager.loadPresets();
    TimerManager.restoreTimerState();
  } catch (error) {
    console.error("Error initializing app:", error);
  }
};

document.addEventListener("DOMContentLoaded", initializeApp);
