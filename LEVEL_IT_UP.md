Capacitor app, native playback, “brain-off” paid tier. No sliders, no “fix timings”, no crowd workflow in the paid path. The UI stays your current web UI, but it becomes a remote for a native player service that owns truth.

### Product behavior (updated)

Paid toggle: **Ad Assist ON/OFF**
That’s the whole paid UX surface.

When ON, the player does two things automatically:

* **Hard-skip** high-confidence junk ranges.
* **Adaptive speed** (your hook): in housekeeping/ad ranges it smoothly ramps up (pitch preserved), then smoothly returns to base speed. Dense bits never get slower than base; at most you can *avoid* speeding them up.

User controls that are allowed (because they’re not “work”):

* **Undo last assist** (single button, always present). If the last assist happened within 15 seconds, jump back to just before it and restore base speed.
* **Pause assists for this episode** (emergency).
* **Sleep timer** + **Start from last sleep start time** (so the next session resumes from where they consciously decided to stop).
* Optional **pre-assist cue**: two soft “brrp” tones N seconds before an assist. Default OFF.

Informational UI (no interaction):

* heat-line markers along the progress bar showing upcoming assist regions + count summary (“3 assists ahead; next at 12:40”).
* “timings pending” badge for new drops; assists start appearing as soon as first pass lands.

The golden rule: **never ask the user to label anything**. The only “feedback” you ingest is passive: undo, seek-back shortly after an assist, disabling assists for episode/show.

---

## Port architecture

### Keep: your web UI

Your current SPA runs inside Capacitor WebView, unchanged as much as possible.

### Move native: playback + long-running

Native owns:

* ExoPlayer instance
* foreground media service
* MediaSession + notification controls + headset/BT
* audio focus
* downloads (real filesystem, not SW cache)
* assist engine (skip + adaptive speed + beeps + undo)
* sleep timer and sleep-start bookmark

### Bridge seam: minimal surface area

You replace your HTML `<audio>` integration with a **PlayerBridge** wrapper. Everything else in the UI can keep its current shape: browse, queue view, episode view, show pages, search, settings UI.

---

## Components

### 1) Android: `PlayerService` (foreground)

* ExoPlayer + MediaSession
* Runs independent of UI process
* Emits state snapshots for UI hydration

Responsibilities:

* Queue management (canonical queue lives here)
* Progress tracking + persistence (so state survives UI death)
* Sleep timer:

  * start time marker stored at set-time
  * optional “resume from last sleep start time” action applies on next play
* Assist engine:

  * consumes intervals spec (skip ranges + “housekeeping” ranges)
  * enforces confidence gating
  * executes hard-skip or adaptive speed ramps
  * records last-assist stack for Undo
  * schedules pre-assist beeps (if enabled)

### 2) Android: `AssistEngine`

Inputs:

* baseSpeed (user’s usual speed)
* assistEnabled (paid toggle)
* intervals list: `[ {startMs,endMs, kind, confidence, suggestedAction, suggestedTargetSpeed} ]`

Internal policy (no user tuning):

* confidence >= 0.85 and duration >= ~8s → **hard-skip**
* confidence 0.60–0.85 → **adaptive speed**
* confidence < 0.60 → do nothing (but UI may still show markers lightly)

Adaptive speed defaults:

* target speed: clamp(baseSpeed + 1.2, 2.2, 3.2) (you can tune later)
* ramp up: 350ms; ramp down: 700ms
* if two assists are close, merge ramp envelopes so it doesn’t yo-yo

Undo logic:

* keep a ring buffer of last ~10 assists `{atPosMs, startMs, endMs, prevSpeed, type}`
* if user taps Undo and `now - atPosMs <= 15000ms`, seek to `max(0, startMs - 2000ms)` and restore prevSpeed

Pre-assist beeps:

* schedule two short tones at `startMs - warnSeconds` and `startMs - warnSeconds + 250ms`
* suppressed if paused/scrubbing or if the engine is already in a ramp

### 3) Android: `DownloadManager`

* downloads per episode to app storage
* keeps an index DB `episodeId -> localPath, sha, byteSize, duration`
* emits progress events

### 4) Capacitor plugin layer

Two plugins, small surface:

`PlayerBridge` methods:

* `setQueue(queueItems, startIndex?)`
* `play() / pause() / toggle()`
* `seekTo(ms)`
* `setBaseSpeed(x)`
* `setAssistEnabled(bool)`
* `setAssistConfig({ warnSeconds?, warnEnabled?, mode? })` (mode is internal; UI doesn’t expose except maybe “Adaptive speed includes skips” later)
* `applyIntervals(episodeId, intervalsVersion, intervals[])`
* `setSleepTimer({ minutes? | untilEnd? | off })`
* `resumeFromLastSleepStart()` (or a setting toggle)
* `undoLastAssist()`
* `getSnapshot()` (for UI restore)
* `subscribeEvents()` (position/state/assist events)

Events:

* `snapshot` (initial + whenever big changes)
* `position` (throttled, e.g. 4–8Hz while playing)
* `state` (playing/buffering/ended/error)
* `assistPerformed` (for UI “undo” affordance and debug)
* `sleepStateChanged`
* `downloadProgress` (if you prefer a single bus)

`OfflineBridge` methods:

* `download(episodeId, url)`
* `delete(episodeId)`
* `getOfflineStatus(episodeId)`
* `listDownloads()`
* `getStorageUsage()`

### 5) UI state restore

On app launch / WebView reload:

* call `PlayerBridge.getSnapshot()`
* hydrate your existing JS store from snapshot (queue, current episode, position, base speed, assist enabled, sleep timer)
* render immediately; then subscribe to events

No “load UI when needed” gimmicks; just make it survivable if the OS kills the WebView.

---

## How your “minutes not hours” backend feeds this

Client contract for a played episode:

* it requests `spec.json` (or your compact intervals endpoint) as soon as the episode is in view / queued
* if absent: show “timings pending”, but playback still works normally
* poll aggressively for the first few minutes after episode publish / first play (5s → 10s → 20s → 60s)
* when intervals arrive:

  * if current position is before any upcoming interval, apply immediately
  * never trigger an assist for a region already passed (no retroactive surprise)

Server contract:

* publish first-pass intervals ASAP (conservative)
* later refinement can replace intervals with a version bump; client accepts only future regions

---

## What changes in your existing codebase

You keep almost everything, but you rip out the assumption that the DOM owns playback.

Replace:

* HTMLAudioElement creation / MediaSession wiring / timeupdate listeners
* SW-based audio caching calls

With:

* `player_api.ts` (or similar) that mirrors your existing internal player interface but delegates to `PlayerBridge`
* `offline_api.ts` that delegates to `OfflineBridge`

Your UI continues to call “play, pause, seek, setSpeed, setSleepTimer, queue ops”, but those calls go native.

The rest of the port is mechanical: route “player state” to whatever store you already use.

---

## MVP that’s shippable and feels premium

Must-have:

* foreground service playback + MediaSession + headset controls
* queue + progress persistence
* base speed control
* Ad Assist toggle (paid flag can be mocked initially)
* intervals fetch + apply + hard-skip + adaptive speed + undo
* sleep timer + resume-from-sleep-start
* “timings pending” + heat-line markers

Nice-but-not-blocking:

* EQ/gain native (do it only once playback is native; otherwise it’s a time sink)
* per-show presets (base speed per show)
* download library UX polish

---

## EQ/gain without turning into a science project

Do it native, but keep it brutally simple:

* a few presets (Voice, Flat, Bass cut, Treble cut) + gain
* no multi-band UI in the main settings
* gate it behind “Playback effects” like every other player, and it’s still “brain-off”

If you want higher-speed pitch preservation to sound decent at 3x+, plan for revisiting the time-stretch backend later. Ship first with ExoPlayer’s time-stretch and cap adaptive speed so it doesn’t sound like garbage.

---

If you paste the handful of modules where your web app currently owns playback (the file names around your `player.js` / media session / offline caching), I’ll map them to the exact bridge calls and give you the replacement surfaces so you can start swapping without a rewrite spiral.

