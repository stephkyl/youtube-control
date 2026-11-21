# YouTube Session

Firefox extension that turns YouTube into short, intentional sessions.

- **Without a session, YouTube is closed.** To open one: pick a session type, a duration (preset or custom; not for one-video sessions), write down what you're here to do (at least 10 characters), then wait through 10 seconds of thinking time. Leaving the tab during that time restarts the countdown.
- **Session types**:
  - *Shorts & videos*: everything is allowed, following the rules below.
  - *Long videos only*: shorts disappear (home, search, menu, channel tabs). A short opened from a direct link opens in the classic player and counts as a video.
  - *One video*: no duration, but a single video (live streams included). You can search freely; the first video whose playback starts (ads excluded) becomes the session's video. Suggestions and autoplay disappear, any other YouTube page shows "You've already picked your video" with a button to go back to it, and the session ends when the video ends. Shorts are handled as in a long-videos session. If nothing plays for 30 minutes (no video chosen, video paused, tab closed), the session stops, at the time of the last playback.
- **Only videos that fit in the remaining time are shown** (home, search, sidebar, end screen). For a partly watched video, what counts is the time left to watch.
- **A video that is too long, opened from a direct link,** is paused and covered by an "out of session" screen.
- **Autoplay is turned off.**
- **Shorts**: a short is never cut off. Less than 2 minutes before the end, scrolling still works: the next short is the last one. While it plays, nothing appears below it and scrolling is blocked. It plays in full, even past the session, then the end screen shows. If time runs out before scrolling, the current short becomes the last one.
- **End of session**: a closing screen shows with an animation, the initial intention and stats: the session's actual duration, the total time since midnight (and the number of sessions), and the number of videos and/or shorts started. There is no "5 more minutes" button. The "Start a new session" link leads back to the full start form (intention + thinking time).
- **Languages**: English by default, French if Firefox is in French (`_locales/`).
- A pill at the bottom left shows the time left, in minutes (in a one-video session: "Pick your video", then "Your video"). On hover, an "End" button stops the session after a confirmation inside the pill. The extension popup can also end the session early, without confirmation.
- **History**: each finished session is stored locally (500 at most) with its intention, duration and number of videos and shorts. The history, grouped by day, opens from the end screen or from the popup ("History"), and can be cleared there. Today's total (end screen, popup) is computed from this history.

## Settings

In the extension popup, collapsible "Settings" section. Changes apply immediately.

- **Suggestions while watching a video**:
  - *Only those that fit in the session* (default): suggestions that are too long disappear as the session goes on, and YouTube doesn't load others to replace them.
  - *No suggestions*: nothing beside, below or at the end of the video.

## Installation (development)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**, then choose `manifest.json`.

The add-on stays loaded until Firefox restarts.

## Time rules (timed sessions)

- Time is wall-clock time: pausing a video doesn't stop it.
- When time runs out while a video is playing, it is allowed to finish, with at most 30 extra minutes. If it is paused during that time, the session ends.
- If a video ends with less than 3 minutes left, the session stops right away, without dead time.
- Live streams and videos without a readable duration stay visible.

## Files

- `src/shared.js`: constants, message types and helpers shared by all scripts (`YS` object).
- `src/theme.css`: shared color palette (`--ys-*` variables).
- `src/background.js`: session state, timer, closing and history.
- `src/content/`: scripts injected into YouTube, loaded in this order (`YSC` object):
  - `core.js`: delays and thresholds, shared state, player access;
  - `styles.js`: styles of the screens and the pill;
  - `filter.js`: suggestion filtering, hiding Shorts in long-videos and one-video sessions;
  - `shorts.js`: last short (hiding the rest of the feed, blocking scrolling);
  - `video.js`: tracking the displayed video (does it fit in the remaining time?);
  - `overlays.js`: start, end, "out of session" and "already picked" screens;
  - `pill.js`: time-left pill;
  - `main.js`: entry point, refresh loop.
- `src/content.css`: hiding rules, driven by classes and attributes set by the scripts.
- `src/popup.*`: time left, today's total, early stop button and settings.
- `src/stats.*`: session history page.
