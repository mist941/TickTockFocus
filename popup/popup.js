document.addEventListener("DOMContentLoaded", () => {
  const minutesInput = document.getElementById("minutes");
  const startButton = document.getElementById("start");
  const stopButton = document.getElementById("stop");
  const countdownDisplay = document.getElementById("countdown");

  function updateCountdown() {
    chrome.storage.local.get(["endTime"], (result) => {
      if (!result.endTime) return;

      const remaining = result.endTime - Date.now();
      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        countdownDisplay.textContent = `${minutes}:${
          seconds < 10 ? "0" : ""
        }${seconds}`;
        setTimeout(updateCountdown, 1000);
      } else {
        countdownDisplay.textContent = "00:00";
      }
    });
  }

  startButton.addEventListener("click", () => {
    const minutes = parseInt(minutesInput.value);
    if (isNaN(minutes) || minutes <= 0) return;

    const endTime = Date.now() + minutes * 60000;
    chrome.storage.local.set({ endTime });
    chrome.alarms.create("countdown", { periodInMinutes: 1 });

    updateCountdown();
  });

  stopButton.addEventListener("click", () => {
    chrome.storage.local.remove("endTime");
    chrome.alarms.clear("countdown");
    countdownDisplay.textContent = "00:00";
  });

  updateCountdown();
});
