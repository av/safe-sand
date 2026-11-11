# Sand

Real-feeling sand on your phone screen. Tilt the phone and it slides, jerk it and it lags behind, drag a finger and it plows a channel, flip the phone face-down and it falls off.

Open it on a phone: **https://av.github.io/safe-sand/**. For true fullscreen, use Share → Add to Home Screen (iOS) or Install app (Android). Before the first pour, pick the sand type and what lies under it on the start card. On iOS, tap "Pour" and allow motion access. Rotating the phone does not move the sand: the picture stays fixed to the glass, the way real sand would. The silent switch mutes the sound on iPhone, and the sound mixes with any music already playing.

## How it works

- About 100k–460k individual grains are simulated on the GPU (WebGL2) in real units (millimetres, 9.81 m/s²), so how fast sand moves and how much it lags matches the real thing.
- Each grain has its own size, mineral colour, and friction. Isolated grains roll and skitter, while bulk sand sticks until the tilt passes its angle of repose.
- A height field built from the grains every frame gives piles their slope forces, self-shadowing, and ambient occlusion.
- The light direction follows the phone's tilt, so shadows lengthen and quartz grains glint as you move it.
- Granular audio is synthesised from how much sand is actually moving: thousands of tiny resonant clicks per second (2–8 kHz) for sliding sand, sparse lower clicks for pebbles, brighter impacts for the pour. When nothing moves, the output is exactly silent.
- Quality adapts to the device. If frames run slow for 2 s, the app first renders a few idle frames to check whether the browser simply caps the frame rate (for example, iOS Low Power Mode at 30 fps). Only real overload lowers quality, in steps: device pixel ratio 3 → 2 → 1.5, then fewer grains. Quality never steps back up during a session, and the chosen level is remembered for the next visit, one step more optimistic. `window.sand.info().quality` shows the current state.
- On Android, a short vibration fires when sand you flung with a jerk slams into the edge of the screen. It can be turned off in the menu.

## Develop

No build step. Serve the folder over HTTP:

```sh
python3 -m http.server 8000
```

Desktop controls: drag with the mouse to push sand, use the arrow keys or WASD to tilt, and hold Space to shake.

Query parameters: `sand=river|beach|desert|volcanic|coral`, `screen=light|lock|dark`, `n=<grain cap>`, `density=<grains per mm²>`, `ppi=<css px per inch>`, `seed=<n>`, `flip` (invert the accelerometer sign if tilting moves sand the wrong way on some device), `test` (manual stepping via `window.sand`).
