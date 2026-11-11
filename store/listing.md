# Google Play listing

Everything Play Console asks for, ready to paste. Images are in this folder.

## App

- App name (30 max): `Sand: Realistic Sand Simulator`
- Package: `io.github.av.sand`
- Default language: English (United States)
- App or game: Game, category Simulation
- Free or paid: Free
- Tags: Relaxing, Simulation, Casual
- Website: `https://av.github.io/safe-sand/`
- Privacy policy: `https://av.github.io/safe-sand/privacy.html`

## Short description (80 max)

```
Real sand on your screen. Tilt it, shake it, draw in it. Calm, tactile, offline.
```

## Full description

```
Sand turns your phone into a tray of real sand.

Every grain is simulated: tens of thousands of them, each with its own size, colour and friction. Tilt the phone and the sand slides at the angle real sand would. Jerk it and the pile lags behind. Drag a finger and you plow a channel with berms on both sides. Shake it and the sand loosens and flows. Flip the phone face-down and it all pours off.

• Five sands: River, Beach, Desert, Volcanic and Coral
• Light follows the tilt of your phone, so shadows stretch and quartz grains glint
• Sound made from the sand itself: thousands of tiny clicks as it slides, silence when it rests
• A short buzz when flung sand slams into the edge of the screen
• Put it over your lock screen, a dark screen or a light tray
• Works offline, no account needed

Sand Pro is a one-time purchase that unlocks every sand and removes all ads. You can also try the extra sands for 24 hours by watching a short video.

Lay the phone flat, pour, and play.
```

## Graphics

| Asset | File |
| --- | --- |
| App icon 512×512 | `icon-512.png` |
| Feature graphic 1024×500 | `feature-graphic.png` |
| Phone screenshots 1080×1920 | `shot-1-beach.png` … `shot-5-desert-menu.png` |

## In-app product

- Type: one-time product, non-consumable
- Product ID: `sand_pro` (the app looks for exactly this ID)
- Name: `Sand Pro`
- Description: `Every sand, no ads. One-time purchase.`
- Price: USD 2.99, other countries converted by Play

## AdMob

- App: Android, `Sand: Realistic Sand Simulator`, linked to the Play listing
- Ad units: one Banner (`Sand banner`), one Rewarded (`Sand rewarded`, reward 1 `pass`)
- Privacy & messaging: create a GDPR (European regulations) message for the app; the app shows it through Google's consent SDK and offers "Privacy choices" in the menu
- Blocking controls: maximum ad content rating G
- Put the IDs in the app: AdMob app ID → `admobAppId` in `android/gradle.properties`; unit IDs → `UNITS` at the top of `src/app.js`. Release builds with Google's test IDs serve only test ads, and the production upload in CI refuses them
- `app-ads.txt`: AdMob shows the line to publish; it must be served from the root of the website in the listing

## App content answers

- Ads: yes, the app contains ads
- App access: all functionality available without special access
- Target audience: 13–15, 16–17, 18 and over. Not designed for children; store listing does not target children
- Content rating questionnaire (IARC): category "All other app types" / game, no violence, no fear, no sexuality, no gambling, no drugs, no profanity, no user interaction or chat, no sharing of location, digital purchases: yes. Expected rating: Everyone / PEGI 3
- Data safety:
  - Data collected and shared (by the Google Mobile Ads SDK, for advertising and fraud prevention, analytics): Device or other IDs (advertising ID); Location: approximate location; App activity: app interactions; App info and performance: diagnostics
  - Purchases are handled by Google Play; the app itself stores nothing off the device
  - Data is encrypted in transit: yes
  - Users can request deletion: no account exists; advertising ID reset is under Android settings
- Government app / financial features / health: no
