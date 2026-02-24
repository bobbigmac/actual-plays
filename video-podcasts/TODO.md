# Video Podcasts TODO

## UI goals (for confirmation)

- **Guide bar** — Fades out after a few seconds of inactivity; reappears on hover/interaction
- **History panel** — Auto-closes after ~10s with fade; timer resets on interaction
- **Themes** — Modern clean + classic cable TV/DOS (harsh blue, big letters, old-people TV)
- **Sleep button** — Countdown replaces button text, not a standalone label
- **Skinning** — Minimal HTML, flexible CSS; central panel elements movable via themes
- **Channel guide** — Full-width, opens upward (Sky TV/Pluto style); fixed channel column, episodes scroll horizontally (no scrollbar)
- **Vertical scrollbar** — Themed
- **Episode layout** — Channel names left; duration-based episode blocks right; history entries show as "NOW"; progress bar in background for episodes in history
- **Past episodes** — User can scroll back to episodes before "now" (feed order: newest left, oldest right)
- **Remote control** — Navigable by arrows (channel/episode), Enter (play), 0–9 (channel jump)

## Needs work / not done

- [ ] **State manager** — Ad-hoc state is a mess; needs a proper state manager
- [ ] **Episode click reliability** — Guide episode selection has been fragile; may need deeper fix
- [ ] **Feed cache** — Test performance with many channels; tune TTL; consider stale-while-revalidate
- [ ] **Mobile layout** — Narrow viewports need work
- [ ] **Sleep: fade volume** — Gradually lower volume before pause
- [ ] **Sleep: end-of-episode** — Option to stop at end of current episode instead of timer
- [ ] **Sleep: resume prompt** — After sleep, offer to resume from same point
- [ ] **Sleep: persist preference** — Remember last-used duration

## May need big changes

- **Guide + history + load flow** — Episode selection, loadSource/loadEpisode interaction, and history handlers are tangled; a state manager would help
- **Feed cache heuristic** — Rhythm/probability logic may need tuning for real-world feeds
