# TickTockFocus

<img src="icons/icon128.png" alt="" width="64" align="right">

A multi-step focus timer for Chrome: Pomodoro, 52/17 or your own routine. A preset is a sequence of steps, such as 25 minutes of work and 5 of rest, that run back to back, with a notification at the end of every step. No site access, no account required.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/nealkefeifpkmkbfcfbkffdgnlohjbae)

## Features

- Presets of up to 50 steps of 30 seconds or more; reorder steps by dragging or with the ↑/↓ buttons
- A progress ring with labelled markers where steps end
- Keeps running with the popup closed. If the timer ended while Chrome was closed or the computer was asleep, one notification tells you when it finished
- Presets and settings sync across your computers when Chrome Sync is on
- 12- or 24-hour clock; usable with just the keyboard

## Usage

1. On the **Presets** tab, click **Create preset**, enter a name, add steps (hours, minutes, seconds, then **Add**) and click **Create**.
2. On the **Timer** tab, pick the preset and click **Start**. **Stop** ends the run early.
3. Click a saved preset to select it on the Timer tab; **×** deletes it.

## Development

There is no build step and there are no dependencies: the repository root is the unpacked extension. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the repository folder. Chrome 120 or later is required.

## Privacy

The extension uses only the `storage`, `alarms` and `notifications` permissions. Presets and settings live in Chrome's sync storage, so they follow your Google account when Chrome Sync is on; the running timer stays in your browser. There are no servers, tracking or analytics. See the [privacy policy](privacy-policy.md).

## License

[Apache 2.0](LICENSE). Report bugs and ideas in [GitHub issues](https://github.com/mist941/TickTockFocus/issues).
