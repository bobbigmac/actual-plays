# Future ideas / roadmap (non-binding)

This project is intentionally lightweight today: a self-updating static podcast browser/listener.

## Sync (beyond import/export)

- Add proper syncing of subscriptions, queue, play history, and per-episode progress between devices.
- Likely requires an optional backend (or at least a sync provider) instead of the current import/export flow.

## UI/UX

- The UI needs significant polish and iteration.
- Expect layout, navigation, and player ergonomics to improve over time.

## Android app (maybe)

- Consider shipping an Android app.
- A React Native port is the likely path if we want “real app” integration.
- The app version may also add optional local-file playback/support (where appropriate).

## Auto-skip / “crowdskip” (maybe paid)

- Consider an “autoskip” utility to skip ads or known boring segments.
- Full per-episode backend analysis is currently too expensive to run for everyone.
- A more practical approach might be “crowdskip”:
  - Users opt in, and their skips feed anonymized segment data.
  - Clients can choose a sensitivity threshold to auto-skip when enough other listeners skipped the same segment.
- If there’s a clear market and someone is willing to pay for it, deeper backend processing becomes more feasible.

## Transcripts (later)

- Consider extracting transcripts via a high-quality speech-to-text library/service (name TBD).
- This is a later step due to cost and operational complexity.

