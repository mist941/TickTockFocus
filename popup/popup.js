const CONFIG = {
  UPDATE_INTERVAL: 1000,
  DEFAULT_TIME_FORMAT: "24h",
  MIN_SEGMENT_SECONDS: 30,
  SEGMENT_FIELD_LIMITS: {
    hours: { min: 0, max: 23, label: "Hours" },
    minutes: { min: 0, max: 59, label: "Minutes" },
    seconds: { min: 0, max: 59, label: "Seconds" },
  },
  POINT_LABEL: {
    OFFSET: 16,
    CHARACTER_WIDTH: 6.2,
    HEIGHT: 13,
    GAP: 2,
  },
  MAX_PRESET_NAME_LENGTH: 50,
  MAX_SEGMENTS_PER_PRESET: 50,
  MAX_SYNC_RETRIES_PER_OPEN: 10,
  PRESETS_RELOAD_DELAY_MS: 150,
  STORAGE_KEYS: {
    SETTINGS: "settings",
    PRESET_PREFIX: "preset_",
    LEGACY_PRESETS: "presets",
    LEGACY_SETTINGS: "settings",
    END_TIME: "endTime",
  },
};

const ELEMENTS = new Proxy(
  {
    timer: {
      toggleButton: document.getElementById("timer_toggle"),
      countdownDisplay: document.getElementById("countdown"),
      clock: document.getElementById("clock"),
      presetSelect: document.getElementById("preset_select"),
      progressBar: document.querySelector(".timer-progress-bar"),
      presetPoints: document.querySelector(".preset-points"),
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
      segmentsStatus: document.getElementById("segments_status"),
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

const Utils = {
  padNumber: (num, size = 2) => String(num).padStart(size, "0"),

  getSegmentDurationMs: (clock) =>
    ((clock.hours || 0) * 3600 + (clock.minutes || 0) * 60 + (clock.seconds || 0)) *
    1000,

  getClocksDurationMs: (clocks) =>
    clocks.reduce((total, clock) => total + Utils.getSegmentDurationMs(clock), 0),

  hasShortSegments: (clocks) =>
    clocks.some(
      (clock) => Utils.getSegmentDurationMs(clock) < CONFIG.MIN_SEGMENT_SECONDS * 1000
    ),

  formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((value) => Utils.padNumber(value)).join(":");
  },

  boxesOverlap: (first, second) =>
    first.left < second.right &&
    second.left < first.right &&
    first.top < second.bottom &&
    second.top < first.bottom,

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

const Storage = {
  isQuotaError(error) {
    return /quota/i.test(error?.message || "");
  },

  isWriteRateError(error) {
    return /MAX_WRITE_OPERATIONS_PER_(MINUTE|HOUR)/.test(error?.message || "");
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
      for (const [key, value] of entries) {
        await this.setItems({ [key]: value });
      }
      return;
    }
    await chrome.storage.local.remove(Object.keys(items));
  },

  async retryLocalOnlyItems() {
    const localItems = await chrome.storage.local.get(null);
    const keysToRetry = Object.keys(localItems)
      .filter(
        (key) =>
          key.startsWith(CONFIG.STORAGE_KEYS.PRESET_PREFIX) ||
          key === CONFIG.STORAGE_KEYS.SETTINGS
      )
      .slice(0, CONFIG.MAX_SYNC_RETRIES_PER_OPEN);

    for (const key of keysToRetry) {
      try {
        await chrome.storage.sync.set({ [key]: localItems[key] });
      } catch (error) {
        if (this.isWriteRateError(error)) return;
        if (this.isQuotaError(error)) continue;
        throw error;
      }
      await chrome.storage.local.remove(key);
    }
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
    if (settings && !storedItems[settingsKey]) {
      itemsToWrite[settingsKey] = settings;
    }
    return true;
  },

  async removeTimerProgress() {
    const { timerProgress } = await chrome.storage.local.get("timerProgress");
    if (timerProgress !== undefined) {
      await chrome.storage.local.remove("timerProgress");
    }
  },

  async run() {
    await this.removeTimerProgress();

    const { LEGACY_PRESETS, LEGACY_SETTINGS } = CONFIG.STORAGE_KEYS;
    const legacyPresets = this.readLegacyKey(LEGACY_PRESETS);
    const legacySettings = this.readLegacyKey(LEGACY_SETTINGS);
    const itemsToWrite = {};
    const legacyKeysToRemove = [];

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

const TabManager = {
  switchTab(tabName, { focusTab = false } = {}) {
    try {
      ELEMENTS.tabs.list.forEach((tab) => {
        const isSelected = tab.dataset.tab === tabName;
        tab.setAttribute("aria-selected", String(isSelected));
        tab.tabIndex = isSelected ? 0 : -1;
        if (isSelected && focusTab) tab.focus();
      });

      ELEMENTS.tabs.contents.forEach((panel) => {
        panel.hidden = panel.dataset.tab !== tabName;
      });
    } catch (error) {
      console.error("Error switching tab:", error);
    }
  },

  handleTabKeydown(event) {
    const tabs = [...ELEMENTS.tabs.list];
    const currentIndex = tabs.indexOf(event.currentTarget);
    const lastIndex = tabs.length - 1;
    const targetIndexByKey = {
      ArrowRight: currentIndex === lastIndex ? 0 : currentIndex + 1,
      ArrowLeft: currentIndex === 0 ? lastIndex : currentIndex - 1,
      Home: 0,
      End: lastIndex,
    };
    if (!Object.hasOwn(targetIndexByKey, event.key)) return;

    event.preventDefault();
    const targetTab = tabs[targetIndexByKey[event.key]];
    this.switchTab(targetTab.dataset.tab, { focusTab: true });
  },

  initializeTabs() {
    ELEMENTS.tabs.list.forEach((tab) => {
      tab.addEventListener("click", () => this.switchTab(tab.dataset.tab));
      tab.addEventListener("keydown", (event) => this.handleTabKeydown(event));
    });
    this.switchTab("timer");
  },
};

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

  async loadTimeFormat() {
    try {
      const settings = await Storage.getSettings();
      this.timeFormat = settings.timeFormat || CONFIG.DEFAULT_TIME_FORMAT;
    } catch (error) {
      console.error("Error loading settings:", error);
    }
    this.updateClock();
  },

  async startClockUpdate() {
    await this.loadTimeFormat();
    setInterval(() => this.updateClock(), CONFIG.UPDATE_INTERVAL);
  },
};

const TimerManager = {
  countdownIntervalId: null,
  endTime: null,
  totalDuration: null,
  presets: [],
  isRunning: false,

  getPresetDuration(presetId) {
    try {
      const preset = this.presets.find((p) => p.id === presetId);

      if (!preset) return null;

      return Utils.getClocksDurationMs(preset.clocks);
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
      } else if (selectedPresetId) {
        await chrome.storage.local.remove("selectedPresetId");
      }
    } catch (error) {
      console.error("Error loading presets:", error);
    }
    this.updateStartButtonState();
  },

  restoreTimerState() {
    chrome.storage.local.get(
      ["isRunning", "endTime", "totalDuration", "clocks"],
      (result) => {
        if (result.isRunning && result.endTime) {
          this.endTime = result.endTime;
          this.totalDuration = result.totalDuration;
          this.startCountdownUpdate();
          this.updateToggleButton(true);

          if (result.clocks) {
            this.drawPresetPoints(result.clocks);
          }
        } else {
          this.showIdleState();
        }
      }
    );
  },

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

    this.drawPresetPoints(preset.clocks);
    this.updateToggleButton(true);
    this.startCountdownUpdate();
  },

  createSvgElement(tag, attributes) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes).forEach(([name, value]) =>
      element.setAttribute(name, value)
    );
    return element;
  },

  clearPresetPoints() {
    ELEMENTS.timer.presetPoints.replaceChildren();
  },

  layoutPointLabel(text, angle, center, radius) {
    const { OFFSET, CHARACTER_WIDTH, HEIGHT, GAP } = CONFIG.POINT_LABEL;
    const x = center.x + (radius + OFFSET) * Math.sin(angle);
    const y = center.y - (radius + OFFSET) * Math.cos(angle);
    const horizontalDirection = Math.sin(angle);
    let anchor = "middle";
    if (horizontalDirection > 0.3) anchor = "start";
    if (horizontalDirection < -0.3) anchor = "end";

    const width = text.length * CHARACTER_WIDTH;
    const anchorShift = { start: 0, middle: width / 2, end: width }[anchor];
    const box = {
      left: x - anchorShift - GAP,
      right: x - anchorShift + width + GAP,
      top: y - HEIGHT / 2 - GAP,
      bottom: y + HEIGHT / 2 + GAP,
    };

    const element = this.createSvgElement("text", {
      class: "preset-point-label",
      x,
      y,
      "text-anchor": anchor,
    });
    element.textContent = text;
    return { element, box };
  },

  drawPresetPoints(clocks) {
    this.clearPresetPoints();
    const circle = ELEMENTS.timer.progressBar;
    const center = { x: circle.cx.baseVal.value, y: circle.cy.baseVal.value };
    const radius = circle.r.baseVal.value;
    const totalDuration = Utils.getClocksDurationMs(clocks);
    if (totalDuration <= 0) return;

    const placedLabelBoxes = [];
    let accumulatedTime = 0;

    clocks.forEach((clock) => {
      accumulatedTime += Utils.getSegmentDurationMs(clock);
      if (accumulatedTime >= totalDuration) return;

      const angle = (accumulatedTime / totalDuration) * 2 * Math.PI;
      ELEMENTS.timer.presetPoints.append(
        this.createSvgElement("circle", {
          class: "preset-point",
          cx: center.x + radius * Math.sin(angle),
          cy: center.y - radius * Math.cos(angle),
          r: 5,
        })
      );

      const label = this.layoutPointLabel(
        Utils.formatDuration(accumulatedTime),
        angle,
        center,
        radius
      );
      if (placedLabelBoxes.some((box) => Utils.boxesOverlap(box, label.box))) {
        return;
      }
      placedLabelBoxes.push(label.box);
      ELEMENTS.timer.presetPoints.append(label.element);
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
  },

  showIdleState() {
    this.stopCountdownUpdate();
    ELEMENTS.timer.countdownDisplay.textContent = Utils.formatDuration(0);
    this.updateCircleProgress(0);
    this.updateToggleButton(false);
    this.clearPresetPoints();
  },

  startCountdownUpdate() {
    this.stopCountdownUpdate();
    this.updateCountdown();
    this.countdownIntervalId = setInterval(
      () => this.updateCountdown(),
      CONFIG.UPDATE_INTERVAL
    );
  },

  stopCountdownUpdate() {
    clearInterval(this.countdownIntervalId);
    this.countdownIntervalId = null;
  },

  updateCountdown() {
    chrome.storage.local.get(
      ["endTime", "totalDuration", "clocks"],
      (result) => {
        const timeLeft = result.endTime ? result.endTime - Date.now() : 0;

        if (timeLeft <= 0) {
          this.showIdleState();
          return;
        }

        ELEMENTS.timer.countdownDisplay.textContent = Utils.formatDuration(timeLeft);
        this.updateCircleProgress(timeLeft / result.totalDuration);
      }
    );
  },

  updateCircleProgress(remainingFraction) {
    const circle = ELEMENTS.timer.progressBar;
    if (!circle) return;

    const circumference = 2 * Math.PI * circle.r.baseVal.value;
    const isEmpty = remainingFraction <= 0;
    circle.classList.toggle("is-empty", isEmpty);
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = isEmpty
      ? 0
      : -(1 - remainingFraction) * circumference;
  },

  toggleTimer() {
    chrome.storage.local.get(["isRunning", "endTime"], (result) => {
      if (result.isRunning && result.endTime > Date.now()) {
        this.stopTimer();
      } else {
        const selectedPresetId = ELEMENTS.timer.presetSelect.value;
        const duration =
          selectedPresetId && this.getPresetDuration(selectedPresetId);
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
    this.updatePresetSelectState();
    this.updateStartButtonState();
  },

  updatePresetSelectState() {
    const { presetSelect, toggleButton } = ELEMENTS.timer;
    const hadFocus = document.activeElement === presetSelect;
    presetSelect.disabled = this.isRunning;
    if (this.isRunning && hadFocus) toggleButton.focus();
  },

  selectPreset(presetId) {
    ELEMENTS.timer.presetSelect.value = presetId;
    chrome.storage.local.set({ selectedPresetId: presetId });
    this.updateStartButtonState();
  },

  showTimerMessage(text, { isError = false } = {}) {
    ELEMENTS.timer.message.textContent = text;
    ELEMENTS.timer.message.classList.toggle("error", isError);
  },

  updateStartButtonState() {
    const button = ELEMENTS.timer.toggleButton;
    if (this.isRunning) {
      button.disabled = false;
      this.showTimerMessage("");
      return;
    }

    const selectedPresetId = ELEMENTS.timer.presetSelect.value;
    const selectedPreset = this.presets.find((preset) => preset.id === selectedPresetId);
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
    } else if (Utils.hasShortSegments(selectedPreset.clocks)) {
      button.disabled = false;
      this.showTimerMessage(
        `Some segments are shorter than ${CONFIG.MIN_SEGMENT_SECONDS} seconds, so their notifications may arrive late.`
      );
    } else {
      button.disabled = false;
      this.showTimerMessage("");
    }
  },
};

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
    ELEMENTS.preset.segmentsStatus.textContent = "";
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
    ELEMENTS.preset.inputs.name.focus();
  },

  hideForm() {
    ELEMENTS.preset.form.style.display = "none";
    ELEMENTS.preset.header.style.display = "block";
    this.clearForm();
    this.clearFieldErrors();
    ELEMENTS.preset.createButton.focus();
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

      const clocks = clockItems.map((item, index) => ({
        position: index,
        hours: Number(item.dataset.hours),
        minutes: Number(item.dataset.minutes),
        seconds: Number(item.dataset.seconds),
      }));

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

  limitInputLength(input, field) {
    const digits = input.value.replace(/\D/g, "").slice(0, 2);
    const { max } = CONFIG.SEGMENT_FIELD_LIMITS[field];
    input.value = digits === "" ? "" : String(Math.min(Number(digits), max));
  },

  createPresetItem(hours, minutes, seconds) {
    const presetItem = Utils.createElementWithClass("li", "preset-item");
    presetItem.draggable = true;
    Object.assign(presetItem.dataset, { hours, minutes, seconds });

    [hours, minutes, seconds].forEach((value, index) => {
      if (index > 0) presetItem.append(":");
      const timeItem = Utils.createElementWithClass("div", "preset-clock-item");
      timeItem.textContent = Utils.padNumber(value);
      presetItem.append(timeItem);
    });

    const actions = Utils.createElementWithClass("div", "preset-item-actions");
    [
      ["up", "↑"],
      ["down", "↓"],
    ].forEach(([direction, arrow]) => {
      const moveButton = Utils.createElementWithClass("button", "preset-move-btn");
      moveButton.type = "button";
      moveButton.dataset.direction = direction;
      moveButton.textContent = arrow;
      actions.append(moveButton);
    });

    const removeButton = Utils.createElementWithClass("button", "preset-remove-btn");
    removeButton.type = "button";
    removeButton.textContent = "×";
    actions.append(removeButton);
    presetItem.append(actions);
    return presetItem;
  },

  getSegmentDurationText(item) {
    const { hours, minutes, seconds } = item.dataset;
    return [hours, minutes, seconds].map((value) => Utils.padNumber(value)).join(":");
  },

  updateSegmentControls() {
    const items = [...ELEMENTS.preset.list.querySelectorAll(".preset-item")];
    const setLabel = (button, label) => {
      button.setAttribute("aria-label", label);
      button.title = label;
    };

    items.forEach((item, index) => {
      const position = index + 1;
      const [moveUpButton, moveDownButton] = item.querySelectorAll(".preset-move-btn");
      setLabel(moveUpButton, `Move segment ${position} up`);
      setLabel(moveDownButton, `Move segment ${position} down`);
      moveUpButton.disabled = index === 0;
      moveDownButton.disabled = index === items.length - 1;
      setLabel(
        item.querySelector(".preset-remove-btn"),
        `Remove segment ${position} (${this.getSegmentDurationText(item)})`
      );
    });
  },

  moveSegment(item, direction) {
    if (direction === "up" && item.previousElementSibling) {
      item.after(item.previousElementSibling);
    } else if (direction === "down" && item.nextElementSibling) {
      item.before(item.nextElementSibling);
    } else {
      return;
    }
    this.updateSegmentControls();

    if (item.querySelector(`[data-direction="${direction}"]`).disabled) {
      const otherDirection = direction === "up" ? "down" : "up";
      item.querySelector(`[data-direction="${otherDirection}"]`).focus();
    }

    const items = [...ELEMENTS.preset.list.querySelectorAll(".preset-item")];
    ELEMENTS.preset.segmentsStatus.textContent = `Segment ${this.getSegmentDurationText(
      item
    )} moved to position ${items.indexOf(item) + 1} of ${items.length}.`;
  },

  readSegmentInputs() {
    const { hours, minutes, seconds } = ELEMENTS.preset.inputs;
    return {
      hours: Number(hours.value) || 0,
      minutes: Number(minutes.value) || 0,
      seconds: Number(seconds.value) || 0,
    };
  },

  validateSegment(segment) {
    for (const [field, { min, max, label }] of Object.entries(
      CONFIG.SEGMENT_FIELD_LIMITS
    )) {
      const value = segment[field];
      if (!Number.isInteger(value) || value < min || value > max) {
        return `${label} must be between ${min} and ${max}.`;
      }
    }

    const { hours, minutes, seconds } = segment;
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
    this.initializeSegmentItem(presetItem);
    this.updateSegmentControls();
    this.showFieldError("segment", "");
    this.showFieldError("segments", "");
  },

  initializeSegmentItem(item) {
    const dragEvents = {
      dragstart: (e) => e.target.classList.add("dragging"),
      dragend: (e) => {
        e.target.classList.remove("dragging");
        this.updateSegmentControls();
      },
    };

    Object.entries(dragEvents).forEach(([event, handler]) => {
      item.addEventListener(event, handler);
    });

    item.querySelectorAll(".preset-move-btn").forEach((moveButton) => {
      moveButton.addEventListener("click", () =>
        this.moveSegment(item, moveButton.dataset.direction)
      );
    });

    const removeBtn = item.querySelector(".preset-remove-btn");
    removeBtn.addEventListener("click", () => {
      const neighbour = item.nextElementSibling || item.previousElementSibling;
      const nextFocus = neighbour
        ? neighbour.querySelector(".preset-remove-btn")
        : ELEMENTS.preset.inputs.hours;
      item.remove();
      this.updateSegmentControls();
      nextFocus.focus();
    });
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

    Object.entries(CONFIG.SEGMENT_FIELD_LIMITS).forEach(([field, { min, max }]) => {
      const input = ELEMENTS.preset.inputs[field];
      if (!input) return;

      input.min = String(min);
      input.max = String(max);

      input.addEventListener("keypress", (e) => {
        if ([".", ",", "e", "E", "+", "-"].includes(e.key)) e.preventDefault();
      });

      input.addEventListener("input", () => {
        this.limitInputLength(input, field);
        this.showFieldError("segment", "");
      });
    });
  },

  async loadSavedPresets() {
    try {
      const presetsList = document.querySelector(".saved-presets-list");
      const presets = await Storage.getPresets();

      const focusedButton = presetsList.contains(document.activeElement)
        ? document.activeElement
        : null;
      const focusedPresetId = focusedButton?.closest(".saved-preset-item").dataset.presetId;
      let buttonToRefocus = null;

      presetsList.innerHTML = "";

      presets.forEach((preset, index) => {
        const presetItem = document.createElement("li");
        presetItem.className = "saved-preset-item";
        presetItem.dataset.presetId = preset.id;

        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.className = "saved-preset-name";
        selectButton.textContent = preset.name;
        selectButton.title = "Select on the Timer tab";
        selectButton.addEventListener("click", () =>
          this.openOnTimerTab(preset.id)
        );

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "saved-preset-delete";
        deleteButton.textContent = "×";
        deleteButton.setAttribute("aria-label", `Delete preset ${preset.name}`);
        deleteButton.title = deleteButton.getAttribute("aria-label");

        deleteButton.addEventListener("click", () => {
          this.deletePreset(preset.id, index);
        });

        if (preset.id === focusedPresetId) {
          buttonToRefocus = focusedButton.classList.contains("saved-preset-delete")
            ? deleteButton
            : selectButton;
        }

        presetItem.appendChild(selectButton);
        presetItem.appendChild(deleteButton);
        presetsList.appendChild(presetItem);
      });

      buttonToRefocus?.focus();
    } catch (error) {
      console.error("Error loading saved presets:", error);
      this.showMessage("Couldn't load your presets. Reopen the popup to try again.");
    }
  },

  openOnTimerTab(presetId) {
    if (!TimerManager.isRunning) TimerManager.selectPreset(presetId);
    TabManager.switchTab("timer");
    const { presetSelect, toggleButton } = ELEMENTS.timer;
    (presetSelect.disabled ? toggleButton : presetSelect).focus();
  },

  async deletePreset(presetId, listIndex) {
    try {
      await Storage.deletePreset(presetId);
      this.showMessage("");
      await this.loadSavedPresets();

      const presetItems = document.querySelectorAll(".saved-preset-item");
      const itemInPlace = presetItems[Math.min(listIndex, presetItems.length - 1)];
      if (itemInPlace) {
        itemInPlace.querySelector(".saved-preset-delete").focus();
      } else if (ELEMENTS.preset.form.style.display === "block") {
        ELEMENTS.preset.addButton.focus();
      } else {
        ELEMENTS.preset.createButton.focus();
      }

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

const StorageWatcher = {
  presetsReloadTimeoutId: null,

  handleChanges(changes, areaName) {
    const changedKeys = Object.keys(changes);
    if (changedKeys.some((key) => key.startsWith(CONFIG.STORAGE_KEYS.PRESET_PREFIX))) {
      this.schedulePresetsReload();
    }
    if (changedKeys.includes(CONFIG.STORAGE_KEYS.SETTINGS)) {
      ClockManager.loadTimeFormat();
    }
    if (areaName === "local" && ("isRunning" in changes || "endTime" in changes)) {
      TimerManager.restoreTimerState();
    }
  },

  schedulePresetsReload() {
    clearTimeout(this.presetsReloadTimeoutId);
    this.presetsReloadTimeoutId = setTimeout(async () => {
      await PresetFormManager.loadSavedPresets();
      await TimerManager.loadPresets();
    }, CONFIG.PRESETS_RELOAD_DELAY_MS);
  },

  initialize() {
    chrome.storage.onChanged.addListener((changes, areaName) =>
      this.handleChanges(changes, areaName)
    );
  },
};

const initializeApp = async () => {
  try {
    TabManager.initializeTabs();

    ELEMENTS.timer.clock.addEventListener("click", () => {
      ClockManager.toggleTimeFormat();
    });

    ELEMENTS.timer.toggleButton?.addEventListener("click", () =>
      TimerManager.toggleTimer()
    );

    ELEMENTS.timer.presetSelect?.addEventListener("change", (e) => {
      TimerManager.selectPreset(e.target.value);
    });

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

    try {
      await LegacyMigration.run();
    } catch (error) {
      console.error("Error migrating presets from localStorage:", error);
      PresetFormManager.showMessage(
        "Couldn't move your presets from the previous version. They're still on this device; reopen the popup to try again."
      );
    }

    try {
      await Storage.retryLocalOnlyItems();
    } catch (error) {
      console.error("Error moving local-only items to sync:", error);
    }

    StorageWatcher.initialize();

    await ClockManager.startClockUpdate();
    await PresetFormManager.loadSavedPresets();
    await TimerManager.loadPresets();
    TimerManager.restoreTimerState();
  } catch (error) {
    console.error("Error initializing app:", error);
  }
};

document.addEventListener("DOMContentLoaded", initializeApp);
