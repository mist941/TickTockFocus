const COUNTDOWN_ALARM = "countdown";
const SEGMENT_ALARM_PREFIX = "clock_";
const RUN_STATE_RESET = {
  isRunning: false,
  endTime: null,
  totalDuration: null,
  presetName: null,
  clocks: null,
};

// Message and alarm handlers run one at a time, so an alarm can't interleave
// with a start or stop and act on the wrong run.
let lifecycleQueue = Promise.resolve();
function runExclusive(task) {
  const result = lifecycleQueue.then(task);
  lifecycleQueue = result.catch(() => {});
  return result;
}

function getSegmentDurationMs(clock) {
  return (clock.hours * 3600 + clock.minutes * 60 + clock.seconds) * 1000;
}

async function showNotification(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/chronometer.png",
      title,
      message,
      priority: 2,
    });
  } catch (error) {
    console.error("Couldn't show notification:", error);
  }
}

async function clearTimerAlarms() {
  const alarms = await chrome.alarms.getAll();
  const timerAlarms = alarms.filter(
    (alarm) =>
      alarm.name === COUNTDOWN_ALARM ||
      alarm.name.startsWith(SEGMENT_ALARM_PREFIX)
  );
  await Promise.all(timerAlarms.map((alarm) => chrome.alarms.clear(alarm.name)));
}

async function completeTimer() {
  const { presetName } = await chrome.storage.local.get("presetName");
  await clearTimerAlarms();
  await chrome.storage.local.set(RUN_STATE_RESET);
  await showNotification("Timer Complete", `Timer "${presetName}" completed!`);
}

async function startTimer({ duration, presetName, clocks }) {
  // Alarms can fire late, so the previous run may have ended without its
  // countdown alarm firing yet. Complete it first so restarting can't swallow
  // its "Timer Complete" notification.
  const previousRun = await chrome.storage.local.get(["isRunning", "endTime"]);
  if (previousRun.isRunning && previousRun.endTime <= Date.now()) {
    await completeTimer();
  }

  await clearTimerAlarms();

  const startTime = Date.now();
  const endTime = startTime + duration;
  await chrome.alarms.create(COUNTDOWN_ALARM, { when: endTime });

  // The last segment ends together with the countdown alarm, which announces it.
  let accumulatedTime = 0;
  for (const [index, clock] of clocks.slice(0, -1).entries()) {
    accumulatedTime += getSegmentDurationMs(clock);
    await chrome.alarms.create(`${SEGMENT_ALARM_PREFIX}${index}`, {
      when: startTime + accumulatedTime,
    });
  }

  await chrome.storage.local.set({
    isRunning: true,
    endTime,
    totalDuration: duration,
    presetName,
    clocks,
  });
}

async function stopTimer() {
  await clearTimerAlarms();
  await chrome.storage.local.set(RUN_STATE_RESET);
}

async function handleAlarm(alarm) {
  const run = await chrome.storage.local.get([
    "isRunning",
    "endTime",
    "totalDuration",
    "presetName",
  ]);

  // Ignore alarms left over from a run that was stopped, completed or replaced.
  const runStartTime = run.endTime - run.totalDuration;
  if (!run.isRunning || alarm.scheduledTime < runStartTime) return;

  if (alarm.name === COUNTDOWN_ALARM) {
    await completeTimer();
  } else if (alarm.name.startsWith(SEGMENT_ALARM_PREFIX)) {
    const clockIndex = Number(alarm.name.slice(SEGMENT_ALARM_PREFIX.length));
    await showNotification(
      "Clock Milestone Reached",
      `Point #${clockIndex + 1} in "${run.presetName}" completed!`
    );
  }
}

const MESSAGE_HANDLERS = new Map([
  ["startTimer", startTimer],
  ["stopTimer", stopTimer],
]);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS.get(request?.action);
  if (!handler) return false;

  runExclusive(() => handler(request)).then(() => sendResponse({ success: true }));
  return true; // Keep message channel open for async response
});

chrome.alarms.onAlarm.addListener((alarm) => {
  runExclusive(() => handleAlarm(alarm)).catch((error) =>
    console.error(`Handling alarm ${alarm.name} failed:`, error)
  );
});
