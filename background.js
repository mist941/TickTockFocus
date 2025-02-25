// Add timer management to background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startTimer") {
    const { duration, presetName, clocks } = request;

    // Clear any existing alarm
    chrome.alarms.clear("countdown", () => {
      // Create new alarm
      chrome.alarms.create("countdown", {
        when: Date.now() + duration,
      });

      // Store timer info
      chrome.storage.local.set(
        {
          isRunning: true,
          endTime: Date.now() + duration,
          totalDuration: duration,
          presetName: presetName,
          clocks,
        },
        () => {
          sendResponse({ success: true });
        }
      );
    });

    return true; // Keep message channel open for async response
  }

  if (request.action === "stopTimer") {
    chrome.alarms.clear("countdown", () => {
      chrome.storage.local.set(
        {
          isRunning: false,
          endTime: null,
          totalDuration: null,
          presetName: null,
        },
        () => {
          sendResponse({ success: true });
        }
      );
    });

    return true; // Keep message channel open for async response
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "countdown") {
    chrome.storage.local.get(["presetName"], (result) => {
      // Show notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/chronometer.png",
        title: "Timer Complete",
        message: `Timer "${result.presetName}" completed!`,
        priority: 2,
      });

      // Reset timer state
      chrome.storage.local.set({
        isRunning: false,
        endTime: null,
        totalDuration: null,
        presetName: null,
      });
    });
  }
});
