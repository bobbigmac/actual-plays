# Podcaster Ideas and Backlog

#### You:
Want to make notes on this for further features/tweaks... 

Segment shuffle (just shuffles all topics for any filter)
Topic Link (plays segments based on your seed/topic word/selections), additive or exclusive.
Speaker Link/Shuffle (likewise above)
More difficult: all segments that x, where x is any of 'joke', 'wisdom', etc. Needs better LLM tagging and some clever word association games.

No waffle, just relist these with a line of comment considering the rest of the project

#### Plugin (file_search):
Make sure to include fileciteturn0file0 in your response to cite this file, or to surface it as a link.
# Android app porting options

#### You:
I have this project, that I'm considering turning into an android app. I would run a server that transcribes and scene breaks every episode (slow addition of podcasts, but starting with the big like top 1000, so I know I have to take some time to do it) and determines autoskip times. My 'free tier' is crowd-skips, where you get free skipping for contributing your skips. They get logged per episode.

The first option is hard, but GOOD (and lets us decide what gets skipped, and is something we can charge for a subscription) but the crowd option is cheap/free, but I can't charge for it. I _could_ do free crowd, and use the crowd to inform my paid service, but that feels scummy to me, as they're not getting added value (and crowd is still going to be slow to get enough data that the average user just trying my app would pick an episode of the millions that has enough autoskip data when I have no customers)... 

I suppose I'm asking a couple of things... How much work to port this to a 'real' android app? It builds to html and the js app is pretty sophisticated for the listener, but I know webview is considered slow, and I don't want it to look like shit. I could do a react native rebuild of the ui, and it wouldn't be very hard, but it would mean a new player from start (tho better/configurable mediacontrols would be better than relying on PWA+sw). Take a look at the code of this project and gimme a sense for what it'll take to port to android (not java, can't be bothered, just something pretty close, or something the build can just build to, tho I suspect that model isn't good for mobile because of the bundle sizes). I don't know what I'm asking, I just am trying to figure out if it's worth trying to do the same thing in mobile. I'd have to extend my server infrastructure a lot, but I _can_ make autoskip a reality (and I don't think anyone else does it, maybe you can check that too, because I know it's not illegal or against any rules (youtube do it on videos now, tho you have to double-tap forward on the remote) as long as all my sources come from their own rss and I'm not misrepresenting anything)

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
Your web app is already most of what an Android client needs, because it’s (a) static assets, (b) a bunch of DOM-driven UI code (\~5.2k LOC across 36 modules), and (c) a single `<audio>` player with Media Session + a service-worker cache layer. The hard part on mobile isn’t the UI, it’s “podcast app stuff”: background playback reliability, lockscreen/BT controls, download management, and storage that survives OS cleanup.

If you want “real Android app” without rewriting the UI, there are basically three sane paths.

1. **Trusted Web Activity (TWA) / PWA-in-a-box**

- Effort: low. You’re mostly doing packaging + manifest hygiene + play store listing + QA on a few devices.
- What you keep: your existing UI, routing, Media Session wiring, your service-worker caching model.
- The gotchas: it’s Chrome-under-the-hood. Usually fine, but you’re still living in browser constraints. Cross-origin audio caching is always a bit “depends” (you already fall back to `no-cors` opaque responses), and “downloads” are not the same as a real podcast download library. Background playback tends to be okay in Chrome/TWA, but you’ll still hit OEM weirdness sometimes.

2. **Capacitor wrapper (still your web app, but you can go native where it matters)**

- Effort: medium. You’ll touch code, but you won’t throw it away.
- What you keep: essentially all of `site/assets/app/*`. You can run it as the same SPA, same store/localStorage approach, same player logic (or keep most of it).
- What you gain: native file storage + download manager + notifications + more control over audio focus/foreground service if you decide you need it.
- The real work items *in your codebase*:
  - Replace/augment the service-worker “audio cache” with a proper native download store (your `offline_api.js` becomes a bridge: “cache/remove/has/stats” currently message-passing to the SW; that maps cleanly to a Capacitor plugin or an off-the-shelf one).
  - Decide what to do about your WebAudio EQ/gain. On Android you can either: keep it in-web (works when the audio is CORS-readable and WebAudio is allowed), or implement native audio effects and drop the web EQ UI when it’s not supported.
  - Background playback QA: your Media Session handlers are already there in `player.js`; you mainly verify they behave in a WebView context and don’t get suspended.

3. **React Native rebuild**

- Effort: highest, because you’re re-platforming everything your current code gets “for free” from the browser.
- You’ll be rewriting:
  - Navigation/routing (your SPA navigation)
  - All DOM UI (`episode_dom.js`, menus, lazy image loader, etc.)
  - Storage (localStorage → async storage/db)
  - Offline caching (service worker caches → filesystem + index + eviction)
  - The player: Media Session equivalents, audio focus, background service, headset controls, queue integration
- Your *player* is the stickiest bit: it does per-feed speed persistence, queue semantics, progress writing, Media Session action handlers, optional WebAudio EQ, and it threads through the whole UI model. Rebuilding that cleanly on RN usually means `react-native-track-player` (or similar) plus a bunch of glue.
- Net: if you go RN, budget most of the time on player+offline+library behaviour, not on “making screens”.

Given what’s actually in this repo (tiny dependency footprint, hand-rolled JS, already MediaSession-aware), **TWA or Capacitor are the “worth trying” options**. RN is “only if you’re committed to being a first-class podcast app with native downloads/library and you want the UI fully native”.

On the autoskip idea + whether anyone else does it: people absolutely are trying it, just not (yet) as a mainstream feature in the big players. You’ll see:

- Pocket Casts has per-show “Skip First/Skip Last” (intro/outro) but that’s not mid-roll ad detection. citeturn0search3turn0search14
- There are explicit “skip ads” apps/projects in the wild (examples: Adblock Podcast, STFUAI Podcasts, and smaller experiments). citeturn0search5turn0search8turn0search12
- Open-source podcast apps have had repeated feature requests and generally shy away from “needs a web service with timestamps / harms creators” territory. citeturn0search11turn0search16

On “crowd skips feels scummy” — it doesn’t have to be, but you need an exchange that isn’t pretend:

- Make crowd-skips *directly useful to the contributor immediately*: if I mark segments on an episode, I get those skips on that episode right away on my devices, even if nobody else ever does it.
- Make the free tier a *real* product: crowd mode gives manual tools + per-show skip presets (intro/outro, recurring segments) and decent UX; paid tier gives ML/scene breaks + auto-detected midrolls and better defaults.
- If you use crowd data to bootstrap paid ML, pay it back: contributors earn subscription time, or unlock premium for the shows they’ve contributed to, or you publish an open timestamp dataset and the paid value is “better detection + convenience + syncing”.

Legal-ish/product-risk reality check (not legal advice): “client-side skipping” is typically framed as user playback control; the bigger landmines show up when you **rehost/copy audio** (caching server-side, redistribution, messing with measurement for dynamically inserted ads). Notably, Adblock Podcast has publicly talked about sharing revenue with creators and caching audio to avoid harming impression-based ads, which tells you where the sensitivities are. citeturn0search12turn0search5

If you want the shortest path to “see if mobile is worth it”: ship **TWA first** (fastest learning), then if you hit the predictable walls (downloads/library/background edge-cases), move to **Capacitor** and start swapping the SW “offline” layer for a native download store while keeping your UI and most of `player.js` intact.


#### You:
skipping doesn't affect impressions, only conversion, and literally nobody buys from podcast ads anyway (maybe idiots). I'm not profit sharing, it's completely legal to support skipping, and since youtube think it's okay, I'm totally fine with it. I don't care about triggered whiners, can I technically do it? I'd be like £10 a month to (almost) never hear another podcast ad (95% is probably doable) would be reasonable to me, but I know some people would happily pay several times that. Any assesment on that, with receipts?

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
Yeah, you can technically do it, in the boring “seek past time ranges in the audio the user is already playing” sense. That’s just a player feature: you ship per-episode skip intervals (timestamps) and the client does `seekTo(end)` when playback hits `start`. No audio modification required.

What’s hard isn’t legality, it’s accuracy at scale:

- baked-in ad reads and sponsor segments: you can learn them from transcript + audio features pretty well, especially if you also detect “music sting / tone shift / loudness change / host cadence” around breaks.
- dynamically inserted ads: boundaries are *often* stable but not guaranteed, and some systems will vary segment duration (drift) per listener. IAB’s measurement docs talk about differences between download/progressive-download/streaming and client-confirmed delivery, which is basically a hint that the ecosystem is messy at the edges. citeturn0search1turn0search4turn0search10

If you’re aiming for “95% of ads skipped” as a product claim, it’s doable for a lot of shows *once you have per-show models + enough correction signals*, but it’s not “run Whisper and call it done”. You’ll need a confidence system and a fallback UI that makes fixing wrong skips painless, because wrong-skipping content is the thing people will uninstall over.

Receipts on “will people pay?”: pricing anchors + evidence of ad annoyance

Price anchors people already accept for podcast-ish subscriptions in the UK:

- Pocket Casts Plus: £3.99/mo; Pocket Casts Patron: £9.99/mo (UK App Store listing). citeturn0search12
- Luminary Premium UK: £3.99/mo. citeturn1search2turn1search14
- Wondery+ UK: £5.99/mo. citeturn1search3turn1search11turn1search7

How “ad-hate” actually looks in surveys:

- Sounds Profitable / “Ad Nauseam” reporting: 46% say they “always or often” skip podcast ads (self-report), and related writeups note the gap between what people *say* and what they do. citeturn0search15turn1search5turn0search11
- UK weekly listeners: 83% agree hearing ads is a fair price for free content. That’s a big neon sign that your paying market is a minority segment (even if it’s a lucrative one). citeturn0search3
- Ad load has gone up: one study cited by WSJ put ads at \~10.9% of runtime in Q2 2024 (up from \~7.9% in 2021). More ad minutes tends to create more “I’ll pay to stop this” people. citeturn0news39

So: **£10/mo is in-family** with “enthusiast tier” podcast subs (Pocket Casts Patron is basically the benchmark), and if you can really deliver “mostly ad-free across lots of shows” it’s a meaningfully stronger value prop than “one network ad-free”. citeturn0search12turn1search3turn1search2

But: don’t expect mass-market conversion. The Edison UK stat (83% say ads are fair) implies most people will stay free. citeturn0search3 Your business is “power listeners who hate ads enough to pay”, plus maybe “neurotic optimizers” who already buy Pocket Casts/Overcast/Patreon/etc.

If I had to sanity-range it from those receipts:

- £5.99/mo feels like “easy try” pricing (matches Wondery+). citeturn1search3
- £9.99/mo is “premium utility tier” (matches Pocket Casts Patron). citeturn0search12
- > £10/mo only works if you’re credibly better than everyone at *accuracy + coverage + low friction*, because you’re now competing with the stack of existing subs users already juggle.

If you want, I’ll run a quick pass over your zip’s player/offline bits and tell you exactly what you’d have to swap to make Android background playback + downloads solid (TWA vs Capacitor vs RN), but the core “autoskip intervals → seek” part is absolutely technically doable.


#### You:
TWA isn't good enough, I need long-running. Capacitor sounds about right (is that like phonegap? a wrapper, or more than that?)

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
Capacitor is “wrapper, but not shitty”. Same basic idea as PhoneGap/Cordova (WebView + JS↔native bridge), but the ergonomics and the modern Android/iOS plumbing are way better: it generates a real native project (Android Studio / Xcode), you ship a WebView app, and you can drop to native with plugins whenever the browser surface area stops being enough.

Key differences vs old PhoneGap vibes:

- Cordova/PhoneGap was “pile of plugins + magic”. Capacitor is “native project you own + a clean bridge + smaller core”.
- Capacitor plugins are typed, modern, and you can write your own without hating your life.
- You can keep your web build essentially unchanged and just adapt the few seams: storage, downloads, background audio, notifications.

For “I need long-running” on Android, the constraint is simple: if you want robust background playback (hours, screen off, app in background, headphone controls), you need a **foreground service** with a **media notification** and proper **audio focus** handling. A pure WebView/PWA can work until it doesn’t; OEM task killers, WebView suspension, and background limits will bite you.

With Capacitor you have two realistic patterns:

### A) Keep your UI + move playback native

Best for reliability.

- Web UI stays your UI.
- Native layer owns the player (ExoPlayer), background service, notification controls, media session, BT headset, Android Auto if you ever care.
- Web layer just sends commands + receives events (play/pause/seek/rate/position/track ended).
- Your autoskip becomes trivial: native player watches current position and seeks over intervals.

This is the “podcast app” architecture. It’s work, but it’s contained and worth it.

### B) Keep playback in WebView and “help” it

Sometimes ok, but it’s always a compromise.

- You still fight WebView throttling and weird background behavior.
- You can glue in partial native keep-alive stuff, but Android’s rules increasingly push you back toward A anyway.

Given your “long-running” requirement, A is the sane choice.

What this means for your current codebase:

- Your existing `player.js` logic is valuable as *state machine + UX*, but the actual media element becomes a remote-controlled native player.
- Your offline caching (currently SW cache) should become filesystem downloads managed by native, indexed by your app, with eviction rules.
- Media controls become native and reliable (notification, lockscreen, headset).

If you want the minimum viable port plan:

1. Wrap with Capacitor, ship the web UI as-is.
2. Add a custom plugin that exposes an ExoPlayer-backed player + foreground service.
3. Replace only the “audio element” boundary in your JS with calls into that plugin.
4. Replace SW offline audio caching with “download file / list / delete / storage stats” plugin calls.
5. Keep everything else (routing, lists, search, episode UI) in web.

So yes: it’s a wrapper, but the point is you can keep 90% of what you’ve built and swap the exact parts that matter for mobile quality.


#### You:
"~10.9% of runtime in Q2 2024 (up from ~7.9% in 2021)." is a great sales line. I absolutely skip EVERY ad except for custom-made ones, which are extremely rare (Second Wind did 1, I skipped halfway through, and Mom Can't Cook do every ad unique, and I occasionally tolerate one of those because it has jokes or references common to the episode). In some cases, detecting a change in tone or a repeating underlying tune (a lot of podcast ads play teh same sound underneath on a loop so you know when to stop skipping). A paid skipper is NOT going to hurt creators, fact. Besides, youtube already did it for videos. I only care if I _can_ do it, not if I may.

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
You can.

On-device skipping is just deterministic seeking. If the client has `[start,end]` intervals for an episode, it watches playback position and seeks past them. That’s it. Nothing about that requires touching the audio bytes, rehosting, or “adblocking” at the network layer.

What makes it solid (and not janky) is engineering around edge cases:

- clock drift / variable playback rates: always compare against the player’s “current position in media timeline”, not wall clock; normalize intervals to media time; apply a small hysteresis window so you don’t bounce around the boundary.
- near-boundary behavior: if the user manually scrubs into a skip range, decide whether to auto-jump immediately or only when entering during continuous playback (I’d do immediate jump unless they’re scrubbing with finger down).
- overlapping / adjacent intervals: merge them once per episode into canonical non-overlapping ranges.
- “don’t skip my actual content”: a global kill switch + per-show and per-episode “disable autoskip” toggle + “undo last skip” within \~10 seconds.
- making corrections fast: one-tap “start of ad / end of ad” buttons while listening, with a little timeline preview.

How you get intervals (your two approaches) is separate from whether skipping is technically possible.

Detection-wise you’ve already named the real signals that work in practice:

- transcript keywords / sponsor phrases: “this episode is brought to you by…”, “use code…”, “terms apply…”, “link in the show notes…”, “we’ll be right back…”, “and now back to…”
- acoustic segmentation: loudness/profile shift, different EQ/voiceprint, bed music onset/offset, pauses + stingers, compression differences, background “bed” loop repeating.
- repetition: same bed loop across ads on a show is gold; fingerprints + correlation gets you boundaries cheaply and robustly.
- structure priors: many shows have stable positions (pre-roll within first N minutes; mid-roll around 40–70%; post-roll final 2–6 min). Use it as a prior, not a rule.

For “long-running on Android”: do native playback (ExoPlayer) in a foreground service, and run the skip logic in the same service with a periodic position poll (eg 4–10 Hz while playing, lower when paused) or ExoPlayer’s position discontinuity callbacks + a timer. The web UI (Capacitor) just renders and sends control messages. Skips happen even if the UI process gets killed.

So yes: you can ship a paid skipper that works across lots of podcasts. The non-negotiables are (1) native player service, (2) a good correction UX, (3) confidence gating so low-confidence detections don’t nuke content. Everything else is iteration.


#### You:
I don't need mass market adoption, it's just me, I'll take £1000 a month to keep my head above the water ;)

#### ChatGPT:
£1k/mo is a small, very plausible niche.

At £10/mo you need \~100 subs. At £15/mo you need \~67. At £20/mo you need 50. That’s not “mass market”, that’s “a loud corner of power listeners” plus a few weirdos like you who genuinely hate ads.

The trick is not demand, it’s churn: people will pay for a month, then cancel if it ever skips real content or if coverage feels spotty. So you design the product around (a) immediate usefulness on day 1, and (b) trust.

What gets you there fastest:

- Don’t promise “95%” publicly; internally aim for it. Publicly say “skips most ads on supported shows” and show coverage in-app per show/episode.
- Make correction delightful: one button to mark “ad starts” and “ad ends”, and an “undo skip” toast. If somebody pays, they’ll forgive misses if fixing is frictionless.
- Start with a curated set: top 1k plus *your* listening graph. Coverage beats breadth for churn.
- Add a show-level model: “this show has a 45s sting + bed loop” and you’ll suddenly look magical on that show.
- Subscription pitch: “time saved” + “ad load is up”. That WSJ stat you liked is a good motivator line even if you don’t quote it verbatim everywhere. citeturn1search? (If you want, I can re-pull the exact source and wording again and make sure it’s clean for store listing copy.)

And yeah, £10/mo is already in the same psychological bucket as “Patron tier” podcast apps; £15–20/mo can still work if you’re demonstrably better at the one thing you sell.


#### You:
I currently have 3 podcast sites configured: my own faves (for my personal site), britcom and network (I like this stuff, but I thought I'd chuck it on a sub for some link love) and actual-plays (just a small project I might put at a cheap domain, cos I want more recommendations and like writing reviews of stuff)... none of these are particularly strong markets (not a lot of cash in comedy, tho actual plays have scope, it's a pretty deep niche, despite the boom of the last few years)... What are the primary markets for this, like people who listen to a LOT of podcasts, what do they listen to, and which groups/sectors have easy to access cash, like who are the key audiences for my autoskip feature who can and will actually pay for it if I have all their podcasts, and I keep up to date (the tricky bit) so I process new episodes in minutes, not hours (a flag for like 'no timings yet' is fine for a few mintues, but it really does have to be fast enough). 

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
If you want £1k/mo from a small crowd, you’re selling to “podcast is my daily routine” people who listen a lot, on schedule, and hate friction.

The best proxy segment is Edison’s “Super Listeners” (18+ averaging **11.2 hours/week**). citeturn0search0 Edison’s 2025 work also splits “casual” vs “fans” by time spent (fans around **9h+ per week** in their deck) and frames podcasts as routine for fans, which maps to “pays for utilities”. citeturn0search15turn0search8

Where the money is (and the listening behaviour you need)

- higher-income, 25–49, commute/workout listeners\
  In the UK, Ofcom notes weekly podcast listening indexes higher in **higher-income households** and peaks in **35–44**. citeturn0search16 YouGov similarly finds regular podcast listeners skew younger and more likely to be **higher income** than average. citeturn0search2\
  This is your “I’ll pay £10–£20/mo if it just works” pool.

The primary content markets for an autoskipper (high volume + high ad density + time-sensitive releases)

1. daily news + politics + current affairs\
   People who listen daily will notice every ad minute, and they pick episodes the day they drop, so “timings within minutes” matters most here. It’s also one of the consistently top genres in measurement/rankers. citeturn0search12turn0search8

2. finance/business/investing\
   These listeners skew toward disposable income and binge back-catalogues. Ads are frequent, often have obvious “use code” language in transcripts, and shows are high cadence. (Also: they’re already used to paying for information tools.)

3. sports talk (especially daily/near-daily)\
   High release frequency, lots of mid-rolls, and a big “listen while doing something else” audience that hates fiddling with the player.

4. true crime / long-form series / interview slogs\
   Not always “daily”, but heavy binge behaviour. Ad blocks tend to be chunky and repetitive, which makes your detection easier and the value obvious.

5. “wellness productivity” shows (fitness, self-improvement, entrepreneurship)\
   Audiences here are disproportionately subscription-normalized (apps, programs, memberships). Not all are rich, but willingness-to-pay is unusually high for utilities.

6. kids/family isn’t your market\
   They’ll pay for ad-free, but they buy *specific* networks/brands (or just use Spotify/YouTube). Also more likely to care about “creator support” arguments.

What to prioritize for your processing-speed constraint

- start with **high-cadence** shows where “today’s episode” matters: daily news, sports, finance. That’s where minutes-vs-hours is felt.
- maintain a per-show model so you can ship timings fast: recognize the show’s stinger/bed loop/host-read template; do a quick first pass immediately, then refine if/when corrections arrive.
- show an explicit “timings pending” badge for the first few minutes and keep manual marking one tap away; people tolerate “pending” if the fix button is instant.

UK-specific angle (since you’re in London): podcast listening reaches higher-income households more, and the weekly peak is 35–44. That’s basically “professionals with routines” rather than teens or retirees. citeturn0search16turn0search2

If you want, I’ll turn this into an initial “top 500 to process first” target list built around those markets (daily news, finance, sports, true crime), rather than britcom/actual-play clusters.


#### You:
what's stopping me just setting £29.99/mo and putting in my promo copy that it's intentionall expensive because I don't want it to harm creators, it's meant tobe exclusive. It's a shitty position, but it's fair in the modern day

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
You *can* set £29.99/mo. Nothing technical stops you. What stops it working (if it does) is: app-store friction, price anchoring, and the fact you’re selling a “utility” whose value only shows up after a few days of use.

A few practical constraints that actually matter:

- **Store cut**: on Google Play, auto-renewing subscriptions are **15%**. citeturn0search2  On Apple, if you’re under $1M/yr you can be on **15%** via the Small Business Program. citeturn0search3turn0search7\
  So £29.99/mo nets you roughly £25.49 before taxes/payment weirdness (and before your infra).

- **You can’t really claim “exclusive to protect creators” without it reading as cope**. People who’ll pay £30 for convenience don’t want moral framing; they want “this is extremely good, extremely reliable, and saves me hours”. Moral framing also invites exactly the discourse you say you don’t care about, and it won’t reduce it.

- **At £29.99/mo you’ve shifted the purchase to a “decision” not a “try”**. Unless your app is already obviously magical on day one, most people bounce. Your *best* customers (heavy listeners) still usually need a week of “holy shit I didn’t touch skip once” before they accept a high recurring bill.

If you want to charge that much and have it not kneecap growth, do it like a normal high-priced niche tool:

- **Two tiers**: £9.99–£14.99 “works great on lots of shows”, £29.99 “always-on fast lane” (minutes-level processing, priority shows, multi-device sync, downloads, maybe per-show custom rules). That lets you keep the premium price *and* still acquire customers who become believers.

- **Annual plan that makes the monthly look intentionally punitive**: e.g. £299/yr (effectively £24.92/mo). People with cash like committing annually if they trust it.

- **Position it as “time saved” not “exclusive”**: you’re selling back 3–10 hours a month of not hearing ads and not fiddling with the skip button. If it’s genuinely that reliable for their shows, £30 stops looking crazy.

Numbers-wise, you only need \~34 subs at £29.99 to hit £1k gross, but you’ll need enough volume to survive churn and refunds. That means your real job is “make it never screw up” and “make coverage obvious before they pay”.

If you want, tell me the 50 shows you personally listen to the most (or dump OPML), and I’ll outline the fastest way to hit “minutes not hours” processing for *those* (queue-based ingest, per-show priors, and a two-pass detection so you can publish a quick first cut then refine).


#### You:
rough out a port from my existing codebase to a Capacitor app I can ship. You A) options look most sensible, move playback native (and like sleep timers, eq/gain), load the ui when needed (restoring state, obviously). 

"Undo last skip" is good, instead of 15 seconds, if an autoskip was within 15 seconds, skip back to before it. I already plan to add like "Start from last sleep start time", so you start from where you actually set your sleep timer, and can skip forward from there manually, so you don't have to try and seek manually to get back to your 10 minutes in, cos you don't know when you stopped listening anyway. I would porbably also add like a 2-beeps (or 2-borrps, less severe) that warns an autoskip is coming up in n seconds, configurable, toggleable. Just for people who like to know what's coming, and can add a display on the UI so the user can preview at any time, how many skipsp there probably will be and when, from like a heatmap/heat-line along the waveform (not detailed, again, youtube already do this for video). You don't seem to understand my detection stack (new tech) it's partly whisper based but some heirstics, it's quick, but not instant, especially for long episodes, we really need to pick them up quick.

List out my features that I said already from all of this chat, like write up the design doc 1-2 pager, sell the sizzle a little first.

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
### Autoskip: the podcast player that treats ads like dead air

You already have a strong web listener with fast UX, queueing, per-episode state, and offline-ish behavior. The mobile product is the same vibe, but with the two things the web can’t do reliably: proper long-running playback and real downloads. The paid feature is simple to explain and visceral in use: episodes play like YouTube with sponsor segments already handled.

The core promise: **press play and don’t touch skip**. When the app isn’t confident, it stays out of the way. When it is, it quietly jumps past junk, with an instant “whoops” escape hatch.

---

## What the app does

### Playback that just keeps going

- Native background playback (screen off, Bluetooth, lockscreen, car) with a foreground media service.
- Rich media controls: seek, speed, chapter-ish jumps (scene breaks), and a proper queue.
- Per-show defaults: speed, trim silence (maybe later), skip settings, EQ preset, gain, warnings.
- Sleep timer with the thing you actually want:
  - normal “stop after X”
  - **“Start from last sleep start time”**: next session resumes from where you set the timer, not where you woke up half an hour later.

### Autoskip (paid) with trust features

- Server produces per-episode skip intervals (ads, promos, other skippables) plus scene/segment breaks.
- Client skips by seeking across intervals during playback.
- **Undo last skip**: if an autoskip occurred within the last 15 seconds, one tap jumps back to just before it (exact boundary, not “-15s”).
- Optional pre-skip warning:
  - **two soft beeps/brrps** N seconds before a skip, configurable + toggleable.
  - UI hint can show “skip in 4s” if enabled.
- Visual preview:
  - a lightweight **heat-line/heatmap** along the progress bar showing upcoming skips (not precise waveform editing; more like YouTube’s chapter/engagement markers).
  - quick summary: “3 skips ahead, next at 12:40”.

### Crowd mode (free) that’s still useful

- Free tier can contribute manual skip markers per episode.
- Those markers apply immediately for the contributor, sync across devices.
- Crowd data can exist on its own without feeling like bait: it’s a real feature even if ML exists.

### Detection stack (server-side)

- Fast-enough processing to feel “real time” for new drops:
  - ingest new episode quickly
  - publish a first-pass set of timings early (even if coarse)
  - refine as transcript/audio heuristics finish.
- Multi-signal detection:
  - Whisper-based transcript cues
  - heuristics for tone shift, stingers, repeated ad bed loops, structure priors
  - episode-specific corrections from user interactions.

### UX notes already implied by your approach

- “No timings yet” is fine as long as it’s minutes, not hours.
- When timings arrive mid-play, they should snap in safely (only apply future skips, never rewind the timeline underneath the user).

---

## Port plan: from current web app to a shippable Capacitor app

You keep your current UI as the shell and move the **player** (and later **downloads/EQ**) native. Capacitor is the bridge and packaging; the Android app is a real native project you can ship, with the WebView only responsible for UI.

### High-level architecture

**Web UI (Capacitor WebView)**

- Your existing SPA: browse, search, queue management, episode pages, show pages, settings.
- State store stays in JS (but migrate persistence from localStorage to a native-backed store for safety).
- Talks to native via a single “PlayerBridge” API and an “OfflineBridge” API.

**Native layer (Android)**

- ExoPlayer + MediaSession
- Foreground service with media notification
- Audio focus, noisy intents (headphones unplug), BT controls
- Download manager to local files
- Optional audio processing (EQ/gain) native

**Server**

- feed ingest + discovery
- transcribe + scene break
- skip timing generation + confidence
- push/poll updates per episode

### What gets rewritten vs reused

Reused almost entirely

- UI rendering, list views, your browsing model
- queue semantics and episode metadata model (with one important caveat: “now playing” is owned by native)
- settings UI
- the “skip visualization” UI you want (heat-line)

Rewritten / moved native

- audio playback implementation (HTMLAudioElement replaced)
- background behavior (service + MediaSession)
- downloads/offline audio storage (SW cache replaced)

Bridged seam (new)

- `PlayerBridge`: play/pause/seek/speed/position/events, queue, sleep timer, undo skip, beeps, autoskip intervals
- `OfflineBridge`: download/remove/list/space usage, plus “is available offline”

---

## Concrete module breakdown

### 1) PlayerBridge (Capacitor plugin + JS wrapper)

Native responsibilities

- Maintain the canonical queue + current item
- Report playback state + position + buffered position
- Handle actions: play/pause/seek, skip next/prev, jump to item, set speed
- Sleep timer:
  - timer countdown / end behavior
  - record “sleep start time” marker per session for the “start from last sleep start time” feature
- Autoskip engine:
  - store skip intervals for current episode
  - watch position and seek over intervals
  - emit events: `autoskip(start,end,reason,confidence)` when it happens (for UI + undo)
  - keep a small stack of recent autoskips for undo
  - implement “Undo last skip” rule: if last autoskip timestamp is within 15s, seek to `start - small_epsilon`
- Pre-skip warnings:
  - schedule two soft sounds N seconds before `start`
  - configurable, and suppressed if user is scrubbing / paused / already inside a skip

JS responsibilities

- Wrapper that looks like your current player API (so your UI code doesn’t explode)
- Subscribe to player events and update UI store
- Request “apply intervals” when server updates arrive

Events you’ll want

- `stateChanged(playing, buffering, ended, error)`
- `position(positionMs, bufferedMs, durationMs)`
- `trackChanged(trackId, episodeId, url, metadata)`
- `autoskipPerformed(startMs, endMs, atPositionMs, confidence, kind)`
- `sleep(startedAtMs, endsAtMs, fired)`
- `audioFocusLost/Regained` (optional, mostly for debugging)

### 2) OfflineBridge (downloads)

Native responsibilities

- Download episode audio to app storage
- Keep an index DB (episodeId → localPath, byte size, mime, duration)
- Provide eviction hooks (manual delete; later “keep last N”, “cap at X GB”)
- Surface download progress events

JS responsibilities

- Replace your SW cache calls with bridge calls
- Update UI badges (“downloaded”, “downloading”, “available offline”)

### 3) Persistence migration

On mobile you really don’t want “localStorage is my database” as the only source of truth.

Plan:

- Keep your JS store shape.
- Swap persistence to either:
  - Capacitor Preferences + SQLite plugin, or
  - a small custom native storage plugin.
- Store: queue, listening progress, per-show settings, last sleep start marker, last autoskip markers (for undo continuity), and cached episode metadata.

### 4) UI loading strategy (“load UI when needed”)

You can keep the WebView alive, but if you want to be aggressive:

- Native service runs always while playing.
- WebView can be killed and restored without losing playback.
- On app open, JS asks native for:
  - current playback snapshot (track, position, queue head/tail summary, settings)
  - any pending autoskip events (for undo button state)
  - sleep timer state
- UI store hydrates from snapshot, then starts normal polling/subscriptions.

### 5) Server integration: “minutes not hours”

Client behavior

- When a new episode is opened/played:
  - if timings exist: apply immediately
  - else show “timings pending” and start polling with short backoff (e.g., 5s → 10s → 20s → 60s)
  - if timings arrive mid-play: apply only for future positions; never retroactively jump
- If the user contributes manual markers:
  - upload immediately
  - apply locally immediately (even before server echo)

Server behavior (two-pass publish)

- Pass 1: quick heuristics (structure priors + lightweight transcript scan + known bed-loop fingerprints) → publish coarse intervals fast
- Pass 2: refine with heavier analysis → update intervals + confidence

---

## Feature list captured from this chat

Core

- Native long-running playback (Android foreground media service)
- Queue + sophisticated listener UI (existing)
- Per-episode skip intervals (server-generated)
- Scene breaks / segmenting (server-generated)
- Autoskip as a paid subscription feature

Free/crowd

- Crowd skips as free tier
- Logged per episode
- Used for immediate personal benefit + can inform improvements

Playback UX

- “Undo last skip”: if autoskip within 15 seconds, jump back to before it
- Sleep timer
- “Start from last sleep start time”
- Optional pre-skip warning sound (two soft beeps/brrps), configurable + toggleable
- UI preview of skips:
  - heat-line/heatmap along timeline
  - skip count and upcoming skip positions

Detection stack (high level)

- Whisper-based transcription as a component
- Heuristics: tone change, repeated underlying tune/bed loop detection, structural cues
- Fast first-pass timings; refined later
- “no timings yet” flag acceptable for a few minutes

---

## Shipping shape (MVP that’s actually good)

MVP to ship without embarrassment:

- Capacitor shell + your existing UI
- ExoPlayer service + MediaSession + notification controls
- PlayerBridge with: play/pause/seek/speed/queue/progress
- Autoskip intervals + undo last skip
- Sleep timer + “start from last sleep start time”
- Basic downloads (even if crude): download/delete, “available offline”
- Heat-line preview (even if it’s just markers, not a fancy gradient)

Nice next:

- Native EQ/gain (and a clean “only works on native playback” guarantee)
- Two-pass timings UX (“coarse now, refined soon”)
- Better per-show models (stingers/bed loops) to make “minutes” realistic at scale

If you want me to make this painfully concrete against your repo, paste the names of your current player modules (or a quick tree) and I’ll map “what becomes PlayerBridge calls” line-by-line and sketch the interfaces so you can start swapping without a big-bang rewrite.


#### You:
maybe an option isn't just to skip, but dynamic-speed (ads optionally go by at 2-5x, configurable, with pitch protection/correction) and the speed doesn't snap back, but slides, so it feels nice, and the occasional bit of bleed is less obvious. It also lets the user hear what they missed (and recognise our value to them as having handheld them through it quickly)

#### ChatGPT:
Yeah, do it. It’s a better default than hard-skip for a lot of people, and it solves a bunch of ugly edge cases (sloppy boundaries, host-read bleed, “wait what did they say?”) while still murdering the time cost.

How it fits cleanly:

- two modes per skip-range (and per show):
  - **skip**: jump `start→end`
  - **fast-pass**: ramp speed up inside the range, ramp down after
- a third “hybrid” is nice too:
  - fast-pass for short/low-confidence ranges, hard-skip for long/high-confidence blocks

Native feasibility on Android:

- ExoPlayer supports arbitrary playback speeds via `PlaybackParameters` (and Android has time-stretch/pitch-preserve under the hood). You won’t get truly perfect “5x with pristine pitch” on every device, but 2x–3x is generally fine; 4x–5x is usable for “I just want the gist” if you keep the pitch sane and accept some artifacts.
- If you want *really* good time-stretch at high rates, you can swap in a DSP time-stretch library later, but you don’t need that to ship.

Make it feel good (the “slides” bit):

- don’t snap from 1.2x to 3.5x; use a short ramp:
  - ramp up over \~250–600ms before `start`
  - hold inside range
  - ramp down over \~400–900ms after `end`
- keep a tiny guard window so you don’t flap if the user scrubs around the boundary.
- if another skip-range begins shortly after, merge the ramps so it doesn’t yo-yo.

UX that sells itself:

- label it as “Fast-forward ads” rather than “don’t pay creators” anything.
- show a subtle toast the first few times: “Fast-forwarded 1m12s (tap to undo)”.
- the “undo last skip” becomes “undo last assist”: jump back to `start - 2s` and restore previous speed.

Interaction with your detection stack:

- confidence becomes the knob:
  - high confidence → hard-skip
  - medium → fast-pass (with beeps optional)
  - low → just mark on heat-line, do nothing unless user taps “assist”
- bleed becomes less annoying because the user still hears the seam, just quickly, and the ramp hides the cut.

Design doc addendum bullets:

- New paid toggle: **Ad Assist: Skip / Fast-pass / Hybrid**
- Per-show defaults + per-episode override.
- Config: target ad speed (2x–5x), ramp in/out duration, max speed, pitch protection on/off (default on), beep warnings independent.

Port impact (Capacitor + native player):

- all of this lives in the native `PlayerService` as part of the autoskip engine:
  - it already watches position; instead of seek, it sets playback speed and schedules ramp events.
- web UI just displays mode and lets user tweak settings; heat-line is unchanged.

This also gives you a nice “premium” feel: it’s not just deleting ads, it’s shepherding you through them in a way that feels intentional.


#### You:
nobody will ever ever fix a timing. Nobody listens to episodes twice (at least not close together) and £20/mo is what you pay to never have to think about it... not to fiddle about with sliders. Never make the user work if we're going to charge them

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
Fair. If you’re charging “turn brain off” money, the product has to behave like a seatbelt: always on, rarely noticed, never asks you to participate.

So don’t build “crowd fixing” into the paid path at all. Treat corrections as something that happens automatically, or not at all.

What that implies in practice:

- one global switch: **Ad Assist: Off / On**
- one emergency switch: **Pause assists for this episode** (and maybe “for this show”)
- one recovery action: **Undo last assist** (always there, always instant)

Everything else is defaulted, hidden, learned.

How you still get better without asking users to do work:

- passive signals you already have:
  - **undo within 15s** is a strong “bad boundary” label
  - manual seek-back right after an assist is a weaker label
  - user pausing during a fast-pass/skip is a label
  - user disabling assists for the episode/show is a label
- push those events to the server as telemetry and use them to auto-adjust boundaries and confidence for future episodes of that show.
- show-level priors (stinger/bed loop fingerprints, typical placement) mean you’re not learning from scratch per episode anyway.

UI: keep it boring.

- no sliders in the main UI
- if you want advanced tuning, bury it behind “Advanced” and never mention it
- default mode can be hybrid internally (fast-pass for medium confidence, hard-skip for high), but to the user it’s just “On”.

And to make the “minutes not hours” requirement compatible with “no fiddling”:

- ship first-pass timings quickly, but gate them by confidence.
  - early timings start conservative (miss an ad is fine; skipping content is not)
  - as refinements land, confidence increases and the engine gets more aggressive automatically
- the heat-line can exist, but it’s informational, not interactive.

That’s the whole paid proposition: you pay so you never become a part-time editor. The only “work” the user ever does is hit Undo when you screw up, and even that doubles as training data so it happens less next time.


#### You:
the smart-speed thing is a good hook, and I've never heard of anyone else doing it. I think we need to make some suggestion to the user like "listen slow when the infomation is dense or worth thinking about, listen fast when it's housekeeping". 

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
Smart-speed exists, but it’s basically “trim silences so it feels faster” (Overcast’s Smart Speed is the famous one). citeturn0search1turn0search6 Pocket Casts has speed + trim silence + volume boost, but not “automatically ramp speed up for housekeeping and down for dense bits”. citeturn0search3turn0search7

Your hook is still legit if you frame it as **adaptive listening**, not “smart speed”.

Copy that sells it without asking the user to fiddle:

> **Adaptive Speed**\
> Keeps the good bits comfortable and the boring bits brief.\
> When the show is doing housekeeping (ads, promos, outro, “quick break”), it glides up to fast speed with pitch preserved. When the content gets dense again, it eases back down so you can actually think.

> **Feels natural, saves time**\
> No snapping. No chipmunks. Just a smooth slide faster and back.

And the nudge you want (light-touch, not preachy):

- “If you listen to learn, keep the dense parts slow and let the housekeeping fly past.”
- “Fast for housekeeping. Normal for the point.”
- “Speed up the bits you’d normally hammer ‘skip’ through.”

How to do “dense vs housekeeping” without user work:

- Don’t expose a slider. Expose **one toggle**: Adaptive Speed On/Off.
- Under the hood you classify segments and pick speeds.
  - **Housekeeping**: sponsor reads, promos, “we’ll be right back”, calls to action, credits, outro. (Transcript cues + your audio bed-loop/stinger signals.)
  - **Dense**: high concept density, numbers, lists, instructions, “here’s what happened”, “the reason is…”, Q\&A with lots of factual content. (Transcript features + pause patterns + “host in explanation mode”.)
- Defaults:
  - normal content: user’s chosen base speed (say 1.4x)
  - housekeeping: base + 1.0x to base + 2.5x (cap 3.0–3.5x unless they opt in higher)
  - dense: base or base - 0.15x (tiny nudge; most people hate slowdowns, so keep it subtle)
- Smooth ramps:
  - ramp up 300–600ms before housekeeping start
  - ramp down 500–900ms after it ends
  - if segments are close, merge so it doesn’t yo-yo

UI that makes the value obvious without asking anything from them:

- A single badge on the timeline: “Adaptive speed saved 2m 14s in this episode”
- Optional: tiny “fast zone” shading on the heat-line (same visual language as autoskip, just a different intensity)
- “Undo last assist” works the same whether you skipped or fast-passed: jump back to just before the segment and restore base speed

That gets you the suggestion you want to make: you’re not telling them to become an editor, you’re offering a default listening style that matches how people already behave (attention on the good bits, impatience for the rest), and you make it feel nice.


#### You:
write up a simple backend that uses python and whisper (I'm sure there was something better than that) to transcribe the last 10 episodes of a given url (it should cache sensibly, including downloading episodes that changed via etag or link parts or update dates for podcasts that support it) so reruns don't require redownloads unless they changed, we will add some limits later, just try to just get the key functionality right for a simple use case), look for common audio segments via the wave form, and whatever other useful python libs we can use, to do segmentation, scenes, chapters etc, just chuck some metnions of useful packages in there for extra steps with a simple usage. The transcript/subtitles (since it will need prettty good timings like autosubs) will be shortened, like a pre-edit of obvious cruft and known transitions, or like songs or long silences with no speech, then chunked and given to openai chatgpt 5.2 or or similar nano, for speed flagging and skips. We can then playback from that spec, show it on an image, and see if it makes sense.

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
```txt
# requirements.txt
feedparser==6.0.11
requests==2.31.0
python-dateutil==2.9.0.post0
pydantic==2.6.4
tqdm==4.66.4
faster-whisper==1.0.3
ctranslate2==4.4.0
numpy==1.26.4
scipy==1.12.0
soundfile==0.12.1
librosa==0.10.2.post1
webrtcvad==2.0.10
openai==1.63.0
```

```python
# podskip.py
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import feedparser
import librosa
import numpy as np
import requests
import soundfile as sf
import webrtcvad
from dateutil import parser as dateparser
from faster_whisper import WhisperModel
from openai import OpenAI
from pydantic import BaseModel, Field
from tqdm import tqdm


APP = "podskip"
USER_AGENT = "podskip/0.1 (+https://example.invalid)"
DEFAULT_DB = Path("./podskip.sqlite3")
DEFAULT_CACHE = Path("./cache")
DEFAULT_OUT = Path("./out")


# -----------------------------
# Models
# -----------------------------

class EpisodeRef(BaseModel):
    feed_url: str
    guid: str
    title: str
    pub_date: Optional[str] = None
    link: Optional[str] = None
    enclosure_url: str
    enclosure_type: Optional[str] = None
    enclosure_length: Optional[int] = None

class DownloadedEpisode(BaseModel):
    episode: EpisodeRef
    audio_path: str
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    fetched_at: str
    byte_size: int
    sha256: str

class WordTS(BaseModel):
    start: float
    end: float
    word: str
    probability: Optional[float] = None

class SegmentTS(BaseModel):
    start: float
    end: float
    text: str
    words: List[WordTS] = Field(default_factory=list)

class Transcription(BaseModel):
    model: str
    language: Optional[str]
    duration: float
    segments: List[SegmentTS]

class SkipInterval(BaseModel):
    start: float
    end: float
    kind: str  # "ad" | "promo" | "outro" | "housekeeping" | "music" | ...
    confidence: float
    action: str  # "skip" | "fastpass" | "none"
    target_speed: Optional[float] = None

class Chapter(BaseModel):
    start: float
    end: float
    title: str
    kind: str  # "content" | "ad" | "intro" | "outro" | "break" | ...
    confidence: float

class Spec(BaseModel):
    schema: str = "podskip/v1"
    created_at: str
    episode: EpisodeRef
    audio: Dict[str, Any]
    transcription: Transcription
    detected_repeats: List[Dict[str, Any]] = Field(default_factory=list)
    vad_speech: List[Tuple[float, float]] = Field(default_factory=list)
    silence: List[Tuple[float, float]] = Field(default_factory=list)
    chapters: List[Chapter] = Field(default_factory=list)
    skips: List[SkipInterval] = Field(default_factory=list)


# -----------------------------
# SQLite cache
# -----------------------------

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS feed_http (
  feed_url TEXT PRIMARY KEY,
  etag TEXT,
  last_modified TEXT,
  fetched_at TEXT NOT NULL,
  body_sha256 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  feed_url TEXT NOT NULL,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  pub_date TEXT,
  link TEXT,
  enclosure_url TEXT NOT NULL,
  enclosure_type TEXT,
  enclosure_length INTEGER,
  PRIMARY KEY (feed_url, guid)
);

CREATE TABLE IF NOT EXISTS audio_http (
  feed_url TEXT NOT NULL,
  guid TEXT NOT NULL,
  enclosure_url TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  fetched_at TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  local_path TEXT NOT NULL,
  PRIMARY KEY (feed_url, guid)
);

CREATE INDEX IF NOT EXISTS idx_audio_http_enclosure_url ON audio_http(enclosure_url);
"""

def db_connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.executescript(SCHEMA_SQL)
    return conn

def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def safe_filename(s: str, max_len: int = 140) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "_", s).strip("_")
    return s[:max_len] if len(s) > max_len else s

def cache_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


# -----------------------------
# Feed + episode selection
# -----------------------------

def parse_feed_with_http_cache(conn: sqlite3.Connection, feed_url: str, timeout: int = 30) -> feedparser.FeedParserDict:
    row = conn.execute(
        "SELECT etag, last_modified FROM feed_http WHERE feed_url=?",
        (feed_url,),
    ).fetchone()
    headers = {"User-Agent": USER_AGENT}
    if row:
        etag, last_modified = row
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified

    r = requests.get(feed_url, headers=headers, timeout=timeout)
    if r.status_code == 304:
        # need stored body; we only store hash, so refetch without conditions once.
        r = requests.get(feed_url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
    r.raise_for_status()

    etag = r.headers.get("ETag")
    last_modified = r.headers.get("Last-Modified")
    body = r.content
    body_hash = sha256_bytes(body)

    conn.execute(
        "INSERT INTO feed_http(feed_url, etag, last_modified, fetched_at, body_sha256) "
        "VALUES(?,?,?,?,?) "
        "ON CONFLICT(feed_url) DO UPDATE SET etag=excluded.etag, last_modified=excluded.last_modified, fetched_at=excluded.fetched_at, body_sha256=excluded.body_sha256",
        (feed_url, etag, last_modified, now_iso(), body_hash),
    )
    conn.commit()

    parsed = feedparser.parse(body)
    if parsed.bozo:
        # still return; feedparser sets .bozo_exception
        pass
    return parsed

def entry_to_episode(feed_url: str, e: Any) -> Optional[EpisodeRef]:
    guid = getattr(e, "id", None) or getattr(e, "guid", None) or getattr(e, "link", None)
    if not guid:
        return None

    title = getattr(e, "title", "") or ""
    link = getattr(e, "link", None)
    pub_date = None
    for k in ("published", "updated", "pubDate", "date"):
        v = getattr(e, k, None)
        if v:
            try:
                pub_date = dateparser.parse(v).astimezone(dt.timezone.utc).isoformat()
            except Exception:
                pub_date = str(v)
            break

    enclosure_url = None
    enclosure_type = None
    enclosure_length = None

    if getattr(e, "enclosures", None):
        enc = e.enclosures[0]
        enclosure_url = enc.get("href") or enc.get("url")
        enclosure_type = enc.get("type")
        try:
            enclosure_length = int(enc.get("length")) if enc.get("length") else None
        except Exception:
            enclosure_length = None

    if not enclosure_url:
        return None

    return EpisodeRef(
        feed_url=feed_url,
        guid=str(guid),
        title=str(title),
        pub_date=pub_date,
        link=link,
        enclosure_url=enclosure_url,
        enclosure_type=enclosure_type,
        enclosure_length=enclosure_length,
    )

def select_last_n_episodes(parsed: feedparser.FeedParserDict, feed_url: str, n: int) -> List[EpisodeRef]:
    episodes: List[EpisodeRef] = []
    for e in parsed.entries:
        ep = entry_to_episode(feed_url, e)
        if ep:
            episodes.append(ep)

    def sort_key(ep: EpisodeRef):
        if ep.pub_date:
            try:
                return dateparser.parse(ep.pub_date).timestamp()
            except Exception:
                pass
        return 0.0

    episodes.sort(key=sort_key, reverse=True)
    return episodes[:n]


# -----------------------------
# Conditional download of audio
# -----------------------------

@dataclass
class AudioFetchResult:
    local_path: Path
    fetched: bool
    etag: Optional[str]
    last_modified: Optional[str]
    byte_size: int
    sha256: str

def _download_stream(url: str, out_path: Path, headers: Dict[str, str], timeout: int = 60) -> requests.Response:
    with requests.get(url, headers=headers, stream=True, timeout=timeout) as r:
        if r.status_code == 304:
            return r
        r.raise_for_status()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = out_path.with_suffix(out_path.suffix + ".part")
        with tmp.open("wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
        tmp.replace(out_path)
        return r

def fetch_audio_with_cache(
    conn: sqlite3.Connection,
    cache_dir: Path,
    episode: EpisodeRef,
    timeout: int = 120,
) -> DownloadedEpisode:
    row = conn.execute(
        "SELECT enclosure_url, etag, last_modified, local_path, byte_size, sha256 FROM audio_http WHERE feed_url=? AND guid=?",
        (episode.feed_url, episode.guid),
    ).fetchone()

    headers = {"User-Agent": USER_AGENT}
    cached_path = None
    cached_etag = None
    cached_last_modified = None
    cached_sha = None
    cached_size = None
    cached_enclosure_url = None

    if row:
        cached_enclosure_url, cached_etag, cached_last_modified, local_path, cached_size, cached_sha = row
        cached_path = Path(local_path)
        # If feed updated enclosure URL for same GUID, treat as changed.
        if cached_enclosure_url != episode.enclosure_url:
            cached_etag = None
            cached_last_modified = None

    if cached_etag:
        headers["If-None-Match"] = cached_etag
    if cached_last_modified:
        headers["If-Modified-Since"] = cached_last_modified

    ext = Path(episode.enclosure_url.split("?")[0]).suffix or ".mp3"
    fname = safe_filename(f"{episode.guid}_{cache_key(episode.enclosure_url)}{ext}")
    out_path = cache_dir / "audio" / safe_filename(cache_key(episode.feed_url)) / fname

    # If we have a cached file and URL unchanged, try conditional GET; if 304, keep file.
    if cached_path and cached_path.exists() and cached_enclosure_url == episode.enclosure_url:
        r = _download_stream(episode.enclosure_url, out_path=cached_path, headers=headers, timeout=timeout)
        if r.status_code == 304:
            # Keep cached
            return DownloadedEpisode(
                episode=episode,
                audio_path=str(cached_path),
                etag=cached_etag,
                last_modified=cached_last_modified,
                fetched_at=now_iso(),
                byte_size=int(cached_size or cached_path.stat().st_size),
                sha256=str(cached_sha or sha256_file(cached_path)),
            )
        # updated
        new_etag = r.headers.get("ETag")
        new_lm = r.headers.get("Last-Modified")
        sha = sha256_file(cached_path)
        size = cached_path.stat().st_size
        conn.execute(
            "INSERT INTO audio_http(feed_url, guid, enclosure_url, etag, last_modified, fetched_at, byte_size, sha256, local_path) "
            "VALUES(?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(feed_url, guid) DO UPDATE SET enclosure_url=excluded.enclosure_url, etag=excluded.etag, last_modified=excluded.last_modified, fetched_at=excluded.fetched_at, byte_size=excluded.byte_size, sha256=excluded.sha256, local_path=excluded.local_path",
            (episode.feed_url, episode.guid, episode.enclosure_url, new_etag, new_lm, now_iso(), size, sha, str(cached_path)),
        )
        conn.commit()
        return DownloadedEpisode(
            episode=episode,
            audio_path=str(cached_path),
            etag=new_etag,
            last_modified=new_lm,
            fetched_at=now_iso(),
            byte_size=size,
            sha256=sha,
        )

    # No usable cache: download fresh (still with conditional headers; if server lies and returns 304, fallback to full).
    out_path.parent.mkdir(parents=True, exist_ok=True)
    r = _download_stream(episode.enclosure_url, out_path=out_path, headers=headers, timeout=timeout)
    if r.status_code == 304:
        r = _download_stream(episode.enclosure_url, out_path=out_path, headers={"User-Agent": USER_AGENT}, timeout=timeout)

    new_etag = r.headers.get("ETag")
    new_lm = r.headers.get("Last-Modified")
    sha = sha256_file(out_path)
    size = out_path.stat().st_size

    conn.execute(
        "INSERT OR REPLACE INTO episodes(feed_url, guid, title, pub_date, link, enclosure_url, enclosure_type, enclosure_length) "
        "VALUES(?,?,?,?,?,?,?,?)",
        (
            episode.feed_url, episode.guid, episode.title, episode.pub_date, episode.link,
            episode.enclosure_url, episode.enclosure_type, episode.enclosure_length
        ),
    )
    conn.execute(
        "INSERT INTO audio_http(feed_url, guid, enclosure_url, etag, last_modified, fetched_at, byte_size, sha256, local_path) "
        "VALUES(?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(feed_url, guid) DO UPDATE SET enclosure_url=excluded.enclosure_url, etag=excluded.etag, last_modified=excluded.last_modified, fetched_at=excluded.fetched_at, byte_size=excluded.byte_size, sha256=excluded.sha256, local_path=excluded.local_path",
        (episode.feed_url, episode.guid, episode.enclosure_url, new_etag, new_lm, now_iso(), size, sha, str(out_path)),
    )
    conn.commit()

    return DownloadedEpisode(
        episode=episode,
        audio_path=str(out_path),
        etag=new_etag,
        last_modified=new_lm,
        fetched_at=now_iso(),
        byte_size=size,
        sha256=sha,
    )


# -----------------------------
# Audio prep
# -----------------------------

def require_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg not found on PATH")

def to_wav_mono_16k(src: Path, dst: Path) -> None:
    require_ffmpeg()
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-vn",
        str(dst),
    ]
    subprocess.check_call(cmd)

def audio_duration_seconds(path: Path) -> float:
    with contextlib.closing(sf.SoundFile(str(path))) as f:
        return float(len(f) / f.samplerate)


# -----------------------------
# VAD + silence + repeats
# -----------------------------

def vad_segments(wav_path: Path, aggressiveness: int = 2, frame_ms: int = 30) -> List[Tuple[float, float]]:
    y, sr = librosa.load(str(wav_path), sr=16000, mono=True)
    pcm = (y * 32768.0).clip(-32768, 32767).astype(np.int16).tobytes()

    vad = webrtcvad.Vad(aggressiveness)
    frame_len = int(sr * (frame_ms / 1000.0))
    bytes_per_frame = frame_len * 2

    speech = []
    in_speech = False
    start = 0.0
    t = 0.0
    for i in range(0, len(pcm), bytes_per_frame):
        frame = pcm[i : i + bytes_per_frame]
        if len(frame) < bytes_per_frame:
            break
        is_speech = vad.is_speech(frame, sr)
        if is_speech and not in_speech:
            in_speech = True
            start = t
        elif (not is_speech) and in_speech:
            in_speech = False
            end = t
            if end - start >= 0.2:
                speech.append((start, end))
        t += frame_ms / 1000.0
    if in_speech:
        speech.append((start, t))
    return merge_intervals(speech, gap=0.25)

def silence_segments(wav_path: Path, top_db: int = 40) -> List[Tuple[float, float]]:
    y, sr = librosa.load(str(wav_path), sr=16000, mono=True)
    nonsilent = librosa.effects.split(y, top_db=top_db)
    nons = [(s / sr, e / sr) for s, e in nonsilent]
    if not nons:
        return [(0.0, float(len(y) / sr))]
    # silence = complement
    dur = float(len(y) / sr)
    sil = []
    prev = 0.0
    for s, e in nons:
        if s - prev > 0.3:
            sil.append((prev, s))
        prev = e
    if dur - prev > 0.3:
        sil.append((prev, dur))
    return sil

def merge_intervals(xs: List[Tuple[float, float]], gap: float = 0.0) -> List[Tuple[float, float]]:
    if not xs:
        return []
    xs = sorted(xs)
    out = [list(xs[0])]
    for s, e in xs[1:]:
        if s <= out[-1][1] + gap:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(float(a), float(b)) for a, b in out]

def detect_repeated_audio_segments(
    wav_path: Path,
    win_s: float = 2.0,
    hop_s: float = 0.5,
    min_repeat: int = 3,
    sim_thresh: float = 0.93,
) -> List[Dict[str, Any]]:
    """
    Crude repeated-segment finder: MFCC windows -> cosine similarity -> off-diagonal runs.
    Returns candidate repeated windows with occurrences (start,end).
    """
    y, sr = librosa.load(str(wav_path), sr=16000, mono=True)
    win = int(win_s * sr)
    hop = int(hop_s * sr)

    if len(y) < win * 3:
        return []

    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20, hop_length=hop, n_fft=2048)
    # window-average MFCC across frames inside each hop bucket (already hop-sized)
    feats = mfcc.T  # shape [T, 20]
    # normalize
    feats = feats - feats.mean(axis=0, keepdims=True)
    feats = feats / (np.linalg.norm(feats, axis=1, keepdims=True) + 1e-8)

    T = feats.shape[0]
    # similarity matrix is expensive; do approximate by comparing each t
The file is too long and its contents have been truncated.


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
- Segment shuffle\
  Global “surprise me” knob; trivial to ship, but it’ll clash with your “I want reliability, not fiddling” ethos unless it’s tucked away as a discovery-only mode. fileciteturn0file0

- Topic Link (seed/topic word/selections), additive or exclusive\
  This is basically “generate a dynamic playlist from your segmentation layer”; additive/exclusive maps cleanly onto your existing filter mental model, and it doubles as a shareable link format for web + app. fileciteturn0file0

- Speaker Link/Shuffle\
  Same mechanic as Topic Link but depends on speaker diarization quality; worth it if you’re already doing speaker IDs for detection, otherwise it’ll be the first place users notice mistakes. fileciteturn0file0

- “All segments that X” (joke/wisdom/etc) via LLM tagging + word association\
  High leverage, high risk: it’s only good if tags are stable across episodes and fast to compute; treat as a second-pass enrichment (post “minutes not hours” timings) and keep it opt-in until your taxonomy stops being mushy. fileciteturn0file0


#### You:
seamless pod stream, for any of these formats is pretty good, even if it's not particularly filterable (maybe user selected pods and/or speakers, but no guarantees), it's still a good little justifier for a subscription, cos I don't think anyone else does it. 

#### ChatGPT:
Yeah, that’s a nice “pay for it” feature even if the matching is fuzzy.

Make it a mode: pick pods (and optionally speakers), hit play, it continuously stitches segments into a radio-style stream. The value is the *seamlessness* (no dead air, consistent loudness, clean intros/outros) not the purity of filtering, so you can be honest: “best effort, may drift”.

Where it wins for subscription: it’s something people can’t easily reproduce with dumb playlists. If nobody else has a decent always-on segmented pod radio, that’s a clean differentiator.

Guardrails that keep it from feeling broken:

- show a lightweight “why this is playing” chip (pod, speaker guess, topic guess) but don’t promise accuracy
- quick “less like this / more like this” feedback that nudges the next picks without pretending it’s deterministic
- a “lock” toggle (stay within selected pods only) vs “roam” (use them as a seed, allow adjacent picks)
- cache a few next segments so the stream never stalls, even when tagging/search is slow


#### You:
ah, that's a good point. We might want to consider tracking volume/tone adjustments we can choose to normalise between feeds, not with blends or effects (hard) but just be storing the base volume/peaks offsets then using those during playback

#### ChatGPT:
Do it. Per-feed (and optionally per-episode) gain metadata: integrated loudness-ish + true peak-ish, store a target gain offset, apply at playback with a simple ramp.

- Measure once, use forever: analyze each downloaded file (or first N minutes) to get RMS/LUFS proxy + peak, stash `gain_db`, `true_peak_db`, `measured_at`, `window`.
- Two-stage gain: `feed_gain_db` (stable baseline) + `episode_delta_db` (small correction). Cap both so you don’t chase noise.
- Apply with smoothing: when a segment starts, ramp gain over \~150–300ms; also ramp when switching segments so you don’t hear a step.
- Safety: a peak guard that backs off if the predicted peak would clip after gain (hard limiter is “effects”; this is just avoiding obvious clipping).
- UI-wise: don’t expose it as “normalization”; just “even levels” toggle, default on for seamless stream mode.

Schema sketch:

- `feeds`: `gain_db`, `peak_db`, `loudness_db`, `samples`, `updated_at`
- `episodes`: `gain_db`, `peak_db`, `loudness_db`, `samples`, `updated_at`
- `segments`: pointer to episode + inherits gain unless overridden

Even without real LUFS, a decent proxy (EBU-ish gating later if you care) plus peak tracking gets you 80% of the “this feels premium” effect.


#### You:
I think our _core_ podcasts (a few dozen) can be free for skips/speeds for anyone (preview of some top podcasts, but maybe not any very long form or regularly updated ones), but you have to upgrade to add your own and access the extended coverage.

#### ChatGPT:
Makes sense if you treat it as “curated radio you can sample” vs “your library, your automation”.

Free tier

- a fixed catalogue of core pods (hand-picked, a few dozen)
- basic playback controls: skip, speed, maybe sleep timer
- limited freshness: lagged ingestion (eg 7–14 days), or only a rolling set of episodes
- capped features: no seamless stream, no deep linking, no advanced segment modes, no exports

Paid tier

- add any RSS / import from Apple/Spotify URLs / OPML
- extended catalogue + full back-catalog + fast updates
- seamless segmented stream mode
- topic/speaker links + segment shuffle + “all segments that X” once tagging is decent
- better audio leveling and “even levels” always-on for stream
- higher limits: offline, queues, device sync, maybe web player

The line you’re drawing is clean: free is a showcase of the experience on podcasts you can support operationally; paid is coverage + personalization + freshness. Avoid “randomly missing” by making the constraints obvious (catalogue boundary and freshness boundary), not a bunch of hidden per-feature nerfs.


#### You:
I suppose if any ONE account subscribes (justifying the cost to process it), and maybe as long as some paying listener is subscribed to it, we will consider it for pre-processing that becomes available to everyone. It's a little more for everyone, and our workload was always going to be that high anyway

#### ChatGPT:
That’s the right shape: “sponsor-to-unlock” preprocessing.

Rules that keep it sane and don’t piss off payers:

- Two pools: **public processed** (anyone can listen once processed) and **private processed** (only the subscriber who added it, until it’s promoted).
- Promotion trigger: a feed moves to public when it has (a) at least one active subscriber and (b) clears your quality/legality checks. Optional: require N active subs or X listens to avoid processing dead feeds.
- Retention: keep it public while there’s ≥1 active subscriber; if it drops to 0, keep already-processed backlog for a grace period, but stop new ingestion.
- Fairness: subscribers still get value: immediate processing, faster refresh, long-form coverage, higher limits, better modes, plus “request/boost this feed” priority.
- Abuse control: cap “new feed adds” per account per month, and require successful RSS validation + episode count sanity. Block obvious spam/duplicate mirrors.
- Cost controls: sample-first processing for new feeds (first episode + first N minutes), then full once engagement exists. Defer heavy LLM tagging until it’s promoted or hits a listen threshold.
- Transparency: show a badge like “community processed” vs “processing for you” so users understand why some feeds are available and others aren’t.

It also fits your earlier “core pods” idea: core is you-curated; community processed grows organically, paid users effectively fund expansion, everyone benefits without you pre-paying the compute for the whole internet.


#### You:
go do a bit of research on podcast app 'paid' features across many apps (I assume there are basically thousands of podcast apps), mainly android focus, I will never ship to apple devices ever, but if they have different features, I'm interested to know what they are. Essentially I know my process can have value, but I don't know what kind of value it's competing with from the big offerings that already have big subscriber bases

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
What “paid” usually buys in podcast land (Android-first reality, with iOS-only wrinkles where they matter):

Ads removed (app UI ads, not the ads *inside* audio)

- Castbox Premium: removes visual/video ads, lifts subscription limits, adds per-podcast playback effects (speed/volume boost/trim silence/skip-intro). citeturn0search0
- Podcast Addict: the paid bit is basically “support the dev + remove the small banner ad” (audio ads in episodes aren’t theirs to remove). citeturn3reddit46
- Overcast (iOS): free app with visual ads; subscription can hide them. citeturn0search8

Cloud / cross-device sync + web/desktop access

- Pocket Casts Plus: historically “pay for web/desktop + cloud locker”; in 2025 they list Plus perks like folders, smart shuffle, bookmarks/chapter preselection, Wear OS/Apple Watch, and 20GB cloud storage for personal media. citeturn4search6turn0search7
- Player FM: premium plans sync play state across devices; their Premium feature list leans on multi-device sync + extras (space saver compression, turbo fetch, theme/icon stuff). citeturn1search0turn1search4
- Podurama Premium (Android + web/desktop): sync across devices + organization features (folders/playlists, notes/bookmarks) and “no visual ads”. citeturn3search2
- Castro Plus (iOS): subscription unlocks “trim silence” + “enhance voices” and they’ve made sync a subscriber feature in practice. citeturn4search2turn4search1

Playback “power features”

- Silence trimming / smart speed, voice boost / loudness normalization, per-podcast presets, skip-intros/outros: these show up everywhere as the default “pro” upsell (Castbox explicitly gates per-podcast effects; Overcast markets Smart Speed + Voice Boost; Castro gates Trim Silence + Enhance Voices). citeturn0search0turn0search8turn4search2
- Chapter features + bookmarks: Pocket Casts calls these out as Plus perks (bookmarks + chapter preselection). citeturn4search6

Library organization + aesthetics

- Folders / smart playlists / tags / bookmarks / custom icons/themes: Pocket Casts has had subscriber-only folders; Player FM and Podurama lean on playlists/folders/themes; Pocket Casts also sells customization. citeturn0search1turn1search4turn3search2turn4search6

“Extra content” bundles

- Pocket Casts Plus has bundled premium sleep content (Slumber Studios) as a perk. citeturn4search6

iOS-only-ish perks that sometimes become paywalled

- Apple Watch / CarPlay polish, iCloud sideloading, iPad apps, etc. Castro has explicitly paywalled sideloading features at times and sells itself heavily on queue workflow. citeturn4search4turn4search2\
  (Android equivalents exist — Wear OS, Android Auto — but fewer apps monetize them as “exclusive” because the Android expectation is “most controls are just there”.)

The other subscription threat isn’t “podcast apps”, it’s “podcasts as memberships”

- Publishers increasingly sell ad-free feeds via private RSS that you add to any app, so the app isn’t the subscription at all (Vox is a clean example). citeturn1news53

And there’s a small but growing “AI ad skipping / cleaned feed” space

- PodBlock is literally selling “replace your feeds with private ad-free versions” as the product. citeturn3search0
- PurerPodcasts is selling automatic ad skipping as the upgrade, with a per-number-of-feeds pricing ladder. citeturn3search1

So what you’re actually competing with (where your segmented stream sits)

- Most paid tiers are shallow: remove UI ads + sync + folders + a couple playback DSP toggles. That’s it.
- The closest “new value” subscriptions are (a) private RSS ad-free memberships and (b) AI ad removal/skip services.
- Your “seamless segmented pod radio / topic + speaker linking / stream that never stalls + per-feed leveling” is orthogonal to all of that: it’s a *new listening mode*, not a nicer player skin. That’s good news for pricing, and also means you can be blunt about what you’re not: you’re not trying to win on “yet another queue manager”.

If you want, I can do a tighter Android-only competitor cut (top \~15 apps that actually matter in 2026, what they charge for, and the exact paywalled features) — but the pattern above basically doesn’t change.


#### You:
ah, I forgot I can put ads in the app for free, to cover the cost of indexing the ones they can access. What's the return like on that nowadays?

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
It’s very “depends”, but for a podcast app (utility/media, long sessions, not a game) the realistic returns from in-app ads in 2025–Q1 2026 are basically:

Banners / native (Android, UK-ish traffic)

- call it **$0.20–$1.50 eCPM** most of the time, with Tier-1 often in the upper half if your fill is good. citeturn0search1turn0search5turn0search11
- banners are low eCPM but you can rack impressions if you show one persistently (queue screen / browse / now playing). citeturn0search1

Interstitials (Android, UK)

- **\~$3–$8 eCPM** is a common “not insane” planning range; some datasets put UK Android interstitial around **\~$8.5** on average. citeturn0search0turn0search1turn0search10
- Q4 2025 saw interstitial eCPMs wobble (down in a bunch of European markets), so don’t bake in “Christmas forever”. citeturn0search2

Rewarded video

- this is where the numbers get sexy (**$8–$30+ eCPM**) but it’s hard to make it feel native in a podcast app unless you’re trading it for something users actually want (eg “unlock 24h of seamless stream / extra indexing quota / offline pack”). citeturn0search1turn0search5turn0search2

Translate that into “will this cover indexing?”

- If you’re thinking “AdMob banner to fund LLM + audio preprocessing”, it usually won’t unless you have **big DAU + long sessions + decent Tier-1 share**. The RPM for utility/media apps tends to be on the lower side versus games. citeturn0search11
- Where it *can* help a lot: **cover baseline infra** (RSS polling, storage, light indexing) and subsidise the free catalogue; then your heavier stuff (segmenting, tagging, diarization) is still a subscription justification.

If you want a quick back-of-napkin: take **sessions/day × banner impressions/session** and multiply by **(banner eCPM/1000)**. That’s the only part that’s usually predictable; interstitials in a podcast app are easy to overdo and tank retention.

Also: if you use Google’s formats, mind their interstitial policy expectations (natural breaks, frequency caps) or you’ll get hammered on serving. citeturn0search10


#### You:
okay so it's a lot of "google podcasts" features, some similar features to mine, but no full no-ads commitment. I don't want accounts so sync might be tricky, but via google SSO I can live with. Curious about Pocket Casts 'chapters', is that our segments thing, or just user-set chapters and bookmarks? No interest in cloud storage, but I do listen to folders of mp3s so a 'folder player' feature isn't hard to bolt-on to a podcast player, if we just make the folder a podcast. Trim silence automatically seems like an easy part of our early ingestion/processing stack, tho could be a lot of signals if not encoded sensibly (don't want to rely on user's phone cpu for scanning content). 
Per podcast settings is a good spot. The usual/defaults should be more controllable than most, but if we figure out the normalisation thing, maybe that solves this. What's a 'slumber pack'? I also have my own sites of ambience so could plug something from there in. I think the opportunity somewhere is finding a new WAY of listening to podcasts through better design, but that's probably hidden by my own understanding being driven by my precise use cases. Queue workflow is easy enough to improve, and it is always a pain. 

I have an idea of a single-column where you scroll up to history and down to queue, then below that is latest. Anything you play just pops to the front of the queue, and is easy to remove just next to the play button. So the queue is still a normal queue, but everything fits in the same view, but you only have to think in one direction, with maybe some quick-skip ui elements onthe side or bottom. 

PodBlock and PurerPodcasts are my main competition, that I need to outdo. How are they both doing? how's their userbase? and what do they do well and poorly? If I can compare okay on the key feature (with a little extra flavour from autospeed) but beat them on the UI/UX and our segmentation, I think it can still be viable for just _me_.

#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
\[Unsupported Content]


#### ChatGPT:
Pocket Casts “chapters” aren’t your segmentation thing. They’re whatever the publisher shipped as chapter markers (embedded MP3 chapters, or chapter data sourced from places like Podcast Index / Podlove). Pocket Casts lets you view them and jump, and the paid bit is “Preselect Chapters” (choose which chapters play, skip the rest) plus “Bookmarks”. citeturn0search1turn0search0turn0search5

“Slumber pack” is basically a bundled subscription: Pocket Casts Plus/Patron annual includes a year of Slumber Studios premium sleep content (meditations, sleep stories, etc). citeturn0search2turn0search3turn0search4

On PodBlock vs PurerPodcasts (as of Feb 2026), public traction signals are… small, but they’re pointed at the same pain:

PodBlock (podblock.fm)

- What they do: process episodes server-side and give you *private ad-free RSS feeds* you drop into whatever podcast app you already use. That “works with my current player” angle is the killer feature. citeturn1search0turn2search0
- Pricing/positioning: $7/mo listed, currently “free during beta”. citeturn1search0
- Signals on userbase: I can’t find any hard numbers (no public installs, no public stats). What’s visible is light: a couple of recent reddit mentions and “beta/free” positioning, which usually correlates with “early / small”. citeturn1reddit44turn2search0
- Likely strengths: zero-switch-cost (keep your app), clean mental model (swap feeds), server-side compute so phones stay dumb.
- Likely weaknesses: the hard bits are all product trust issues: missed ads, false cuts, latency, feed stability, and “does this break dynamic ad insertion / tracking / attribution” weirdness. Any outage or malformed feed hurts more than in an app-only approach.

PurerPodcasts

- What they do: their own podcast player; claims it *skips* ads (doesn’t “delete or alter files”) and sells per-number-of-feeds automation tiers. citeturn2search1turn1search1
- Pricing: $1.49/mo for 1 feed up to $15.49/mo for 20 feeds (their site and App Store list the ladder). citeturn1search1turn1search7
- Signals on userbase: Google Play shows **100+ downloads, 7 reviews, 2.8 rating** (that’s… rough). iOS shows only a handful of ratings. citeturn2search5turn2search13
- Likely strengths: simple pitch, “no in-app ads” positioning, per-feed pricing feels “fair” to some people.
- Likely weaknesses: adoption friction (you must switch players), and the low Play rating suggests UX/reliability issues right where it matters (skips, playback bugs, library/queue).

What you need to outdo (and where your segmentation is a real wedge)

- Against PodBlock: you’re not going to beat “works in any app” unless you also offer *linkable private feeds* as an export format. If you can, it becomes “PodBlock + a better listening mode”: ad handling + segment radio + topic/speaker links + leveling + autospeed. If you can’t, you win by making your player obviously nicer to live in (queue/flow) and by offering a mode they simply don’t have (seamless segmented stream).
- Against PurerPodcasts: you can beat them by not being janky. Their public Android signals imply they haven’t nailed that yet.

Your single-column history/queue/latest idea fits this perfectly: it makes the “player switch” less painful because the core interaction stops being a mess of screens. If “tap anything → it becomes next” is rock-solid, plus “remove next to play” is one-tap, you’re already ahead of most queue UIs.

One practical competitive move that matches your “no accounts” preference but still lets you compete with PodBlock’s “use your app” advantage:

- make your own app the best experience, but allow **exporting a private feed per selection** (pod list / speaker / topic seed) for people who insist on staying in AntennaPod etc. You don’t need sync for that. It’s just “generated feed URLs” with sane auth.

If you want, I’ll pull a tighter “feature delta” between you vs PodBlock vs PurerPodcasts just on the two money features: ad skipping/removal accuracy + latency + failure modes + UX recovery (what happens when it guesses wrong).


#### You:
"That “works with my current player” angle **IS** the killer feature". Hmm, that's a good solution for processing feeds before users try to play them, and for users who know what an RSS feed it, but if they're not a first-order podcast app, but something the user has to faff with, they're a tiny blip, at most. PurerPodcasts is much more up my street. "per number of feeds" is interesting, but again, it's faffy. I might be able to get a user to send me their opml from whatever app they already use, but it needs to be as easy as possible to smash. 100+ downloads is almost 0, with a 2.8 rating, that suggests the UI is crap. Between these and that other in our previous chat, we now know 3 systems that tried one of our key features and got near-zero interest, we need to keep that in mind... no big infra spend or time investment, we need it to be close enough, a great UI, fast and easy. No, fucking, about. I could offer private feeds from my engine, but I'm pretty sure that violates copyright serving somebody else's digital content with bits cut out. I think I'd rather make it purely a seek/speed tool, not an outright editor and file replacer.

#### ChatGPT:
Yeah. If PodBlock’s “killer feature” is “keep your player”, it’s also a killer constraint: you’re forced into being a backend utility with all the trust/ops/legal grief, and you still don’t get to own the listening experience. That’s a shit trade for a solo build.

The signal from PurerPodcasts (100+ installs, 2.8) is basically “people wanted the promise, bounced on execution”. That’s useful: demand exists, but it’s thin and unforgiving, and the UX/reliability bar is everything.

Private feeds: you’re right to be cautious. Serving modified audio (or even “ad-free” variants) is the part that drifts into “I’m redistributing someone else’s work in altered form”. Even if you could argue fair use in some places, it’s a constant headache. If you keep it strictly as “playback assistance” (seek/speed/skip based on timestamps, no rehosting), you’re in a much safer lane.

So the viable lane looks like:

- ingest RSS metadata only (title/desc/duration/chapters if present), maybe download audio *only for the user when they request it* (or only cache temporarily), process just enough to generate skip/seek regions
- don’t output new audio, don’t publish new feeds, don’t “replace” episodes; you’re a player that can jump and adapt speed
- keep compute bounded: cheap heuristics first, LLM tagging only on your “core” catalogue or when a user is clearly engaging

On OPML: do it, but make it a one-step hammer

- Android share sheet: “Export OPML” from existing app → share to yours → immediate import + start screen that’s already playable (no mapping screens, no categories, no choices)
- also accept “paste RSS URL / paste Apple/Spotify show URL” because normal people never find OPML

And the product principle you just said is the whole plan: close enough on the headline feature, but the experience is frictionless and fast.

If you want an even tighter spec for the “seek/speed tool, not editor” version of ad skipping that won’t feel janky:

- treat ad skip as **chapter-like markers** with confidence, not binary truth
- default to “tap to skip” with a *tiny* auto-skip window you can widen once confidence is high
- always provide a one-tap “rewind 15s and disable auto-skip for this episode” escape hatch right where the user’s thumb already is
- store per-feed offsets (your normalization idea) and per-feed default behavior (auto-skip on/off, speed, silence trim aggressiveness)

The “3 systems tried it and got near-zero interest” takeaway is mostly: don’t build the cathedral. Build the player people actually want to live in. Your segmented stream + single-column queue/history/latest is the differentiator that those utilities can’t do, and it’s also the part that makes “switching apps” worth it.
