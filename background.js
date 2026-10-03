const COUNTDOWN_ALARM = "countdown";
const SEGMENT_ALARM_PREFIX = "clock_";
const COMPLETION_GRACE_MS = 60_000;
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
      iconUrl: "icons/icon512.png",
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

// For a run past its end time whose countdown alarm hasn't fired. Soon after
// the end the alarm is merely late; later than that it was lost (extension
// update, browser restart), and "Timer Complete" would be stale.
async function finishExpiredRun(run) {
  if (Date.now() - run.endTime < COMPLETION_GRACE_MS) {
    await completeTimer();
  } else {
    await stopTimer();
  }
}

// The last segment ends together with the countdown alarm, which announces it.
// Boundaries that already passed get no alarm, so a restored run doesn't
// announce the milestones it missed all at once.
async function scheduleRunAlarms(runStartTime, clocks, endTime) {
  const now = Date.now();
  await chrome.alarms.create(COUNTDOWN_ALARM, { when: endTime });

  let segmentEndTime = runStartTime;
  for (const [index, clock] of clocks.slice(0, -1).entries()) {
    segmentEndTime += getSegmentDurationMs(clock);
    if (segmentEndTime <= now) continue;
    await chrome.alarms.create(`${SEGMENT_ALARM_PREFIX}${index}`, {
      when: segmentEndTime,
    });
  }
}

async function startTimer({ duration, presetName, clocks }) {
  // Alarms can fire late, so the previous run may have ended without its
  // countdown alarm firing yet. Finish it first so restarting can't swallow
  // its "Timer Complete" notification.
  const previousRun = await chrome.storage.local.get(["isRunning", "endTime"]);
  if (previousRun.isRunning && previousRun.endTime <= Date.now()) {
    await finishExpiredRun(previousRun);
  }

  await clearTimerAlarms();

  const startTime = Date.now();
  const endTime = startTime + duration;
  await scheduleRunAlarms(startTime, clocks, endTime);

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

// Chrome clears alarms when the extension updates and may clear them when the
// browser restarts, so they are rebuilt from the stored run state.
async function reconcileRunState() {
  const run = await chrome.storage.local.get([
    "isRunning",
    "endTime",
    "totalDuration",
    "clocks",
  ]);

  if (!run.isRunning) {
    await clearTimerAlarms();
  } else if (run.endTime <= Date.now()) {
    await finishExpiredRun(run);
  } else {
    // Alarms that survived a restart are replaced too, so past-due ones can't
    // announce missed milestones late.
    const runStartTime = run.endTime - run.totalDuration;
    await clearTimerAlarms();
    await scheduleRunAlarms(runStartTime, run.clocks, run.endTime);
  }
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

  runExclusive(() => handler(request))
    .then(() => sendResponse({ success: true }))
    .catch((error) => {
      console.error(`${request.action} failed:`, error);
      sendResponse({ success: false, error: error.message });
    });
  return true; // Keep message channel open for async response
});

chrome.alarms.onAlarm.addListener((alarm) => {
  runExclusive(() => handleAlarm(alarm)).catch((error) =>
    console.error(`Handling alarm ${alarm.name} failed:`, error)
  );
});

function queueReconcileRunState() {
  runExclusive(() => reconcileRunState()).catch((error) =>
    console.error("Reconciling the run state failed:", error)
  );
}

chrome.runtime.onInstalled.addListener(queueReconcileRunState);
chrome.runtime.onStartup.addListener(queueReconcileRunState);
