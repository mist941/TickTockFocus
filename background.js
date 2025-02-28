// Add timer management to background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startTimer") {
    const { duration, presetName, clocks } = request;

    // Clear any existing alarms
    chrome.alarms.clear("countdown", () => {
      // Create new alarm for the entire timer
      chrome.alarms.create("countdown", {
        when: Date.now() + duration,
      });

      // Create alarms for each individual clock
      let accumulatedTime = 0;
      clocks.forEach((clock, index) => {
        // Calculate time in milliseconds for this clock
        const clockMs =
          (clock.hours * 3600 + clock.minutes * 60 + clock.seconds) * 1000;
        accumulatedTime += clockMs;

        // Create alarm for this clock
        chrome.alarms.create(`clock_${index}`, {
          when: Date.now() + accumulatedTime,
        });
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
    // Clear the main countdown alarm
    chrome.alarms.clear("countdown", () => {
      // Clear all individual clock alarms
      chrome.storage.local.get(["clocks"], (result) => {
        if (result.clocks) {
          result.clocks.forEach((_, index) => {
            chrome.alarms.clear(`clock_${index}`);
          });
        }

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
    });

    return true; // Keep message channel open for async response
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "countdown") {
    chrome.storage.local.get(["presetName", "clocks"], (result) => {
      // Show notification for the entire preset completion
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
  } else if (alarm.name.startsWith("clock_")) {
    // This is a notification for an individual clock within the preset
    chrome.storage.local.get(["presetName"], (result) => {
      const clockIndex = parseInt(alarm.name.split("_")[1]);

      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/chronometer.png",
        title: "Clock Milestone Reached",
        message: `Point #${clockIndex + 1} in "${
          result.presetName
        }" completed!`,
        priority: 2,
      });
    });
  }
});
