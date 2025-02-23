chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "countdown") {
    chrome.storage.local.get(["alarmInfo"], (result) => {
      if (result.alarmInfo) {
        const { presetName, clockIndex, totalClocks } = result.alarmInfo;

        const isLastClock = clockIndex === totalClocks - 1;
        const message = isLastClock
          ? `Timer "${presetName}" completed!`
          : `Clock ${clockIndex + 1} of "${presetName}" completed!`;

        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon/chronometer.png",
          title: "Timer Complete",
          message: message,
          priority: 2,
        });
      }
    });
  }
});
