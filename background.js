chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "countdown") {
    chrome.storage.local.get(["endTime"], (result) => {
      if (!result.endTime) return;

      const remaining = result.endTime - Date.now();
      if (remaining <= 0) {
        chrome.storage.local.remove("endTime");
        chrome.notifications.create({
          type: "basic",
          title: "Timer finished",
          message: "Time expired!",
        });
      }
    });
  }
});
