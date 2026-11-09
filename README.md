# Liveness Checker

A privacy-focused tool for checking that a user is real using their webcam and local facial recognition. All processing happens on the user's device - no data is ever sent to any servers.

> This is a fork of [universal-verify/liveness-checker](https://github.com/universal-verify/liveness-checker). See [Changes from the original](#changes-from-the-original) for what is different.

## Changes from the original

### Blink detection

- New **blink step** after the head-turn steps (look left → look right → look straight → blink).
- Eye openness is measured from the **pixels of the eye region** (`scripts/eyes.js`) instead of only the landmark Eye Aspect Ratio. The 68-point landmarks barely follow the eyelid (~12% EAR drop with the eye fully closed), while the pixel signal drops ~40% on a real blink. The signal is normalized by a skin patch below the eye, so it works across lighting conditions and skin tones.
- Robust blink detector (`scripts/blink.js`, `scripts/blinkSensor.js`):
  - baseline is the 75th percentile of recent frames, noise is estimated with MAD;
  - **both** eyes must close (a reflection in one eye does not count);
  - hysteresis so one oscillation is not counted as two blinks;
  - frames with too much face/camera motion are ignored (motion blur looks like a closed eye);
  - eyes "closed" for too long (smiling, tilted head) do not count as a blink.
- Configurable number of required blinks and a blink timeout.

### Configuration and debugging

- All detection parameters live in `scripts/config.js` (blink sensitivity, head-turn tolerances, detector score/input size, frame interval).
- New **settings page** (`/settings.html`) to tune those parameters. Values are saved in the browser's `localStorage` and merged over the defaults.
- Optional **debug panel** (`scripts/debugPanel.js`) that shows the live eye signal, baseline, threshold, motion and FPS to help calibration.

### UI

- Step list showing progress through each stage (face detected, left, right, straight, blink).
- Head-turn and "look straight" checks use the configurable tolerances instead of hard-coded values.

### Code structure

- Detection logic split into modules: `face.js`, `eyes.js`, `blink.js`, `blinkSensor.js`, `config.js`, `debugPanel.js`, `settings.js`.

### Build and tooling

- Rollup was replaced by a custom esbuild-based build (`tools/build.mjs`):
  - bundles and tree-shakes the JS, with `face-api.js` imported from npm;
  - inlines per-page Tailwind CSS (the prebuilt `styles/main.css` was removed);
  - minifies HTML, converts images to AVIF, preloads the models;
  - writes pre-compressed `.br` / `.gz` files;
  - `npm start` serves `dist/` with rebuild on save.
- `tailwind.config.js` renamed to `tailwind.config.cjs` (the package is ESM).
- Build tools moved to `devDependencies`; the published package only ships `build/`.
- Unit tests for blink detection (`tests/blink.test.js`) run with `npm test` (Node's built-in test runner).

## Installation

Install this fork directly from GitHub:

```bash
npm install github:b-c-a-s/liveness-checker
```

## Usage

```javascript
import livenessChecker from 'liveness-checker';

// Basic usage with async/await
try {
    await livenessChecker.checkLiveness();
    console.log('Liveness check passed');
} catch (error) {
    console.error('Liveness check failed:', error);
}

// Or with .then/.catch
livenessChecker.checkLiveness()
    .then(() => {
        console.log('Liveness check passed');
    })
    .catch((error) => {
        console.error('Liveness check failed:', error);
    });
```

### API Reference

#### `checkLiveness()`

Opens the liveness checker in a new tab and returns a Promise that resolves on success or rejects on error (or if the tab is closed or popup is blocked).

##### Returns

- `Promise<void>`: Resolves if the liveness check is successful, rejects with an error code if it fails, the tab is closed, or the popup is blocked.

##### Possible Rejection Error Codes

- `CANCELLED`: The user closed the liveness check tab before completing the process.
- `POPUP_BLOCKED`: The browser blocked the popup window from opening.
- `WEBCAM_ERROR`: There was an issue accessing the user's webcam (e.g., permission denied or device not found).
- `INTERNAL_ERROR`: An unexpected error occurred during the liveness check process.

## Development

```bash
npm install
npm start        # builds dist/ and serves it at http://localhost:8001, rebuilding on save
npm run build    # production build only (dist/ + build/ library)
npm test         # runs the blink detection tests
```

The source pages import `face-api.js` from npm, so they must be served from `dist/` (not opened directly).
Integration examples are at `/examples.html` and blink and head-turn parameters can be tuned at `/settings.html`.

## Privacy

The liveness checker processes all data locally on the user's device:

- Video from the user's camera is processed in real-time
- No video or biometric data is ever sent to any servers
- If directed from another website, only the liveness result is shared
- All processing happens in the user's browser

## License

MPL-2.0

## Credits

Based on [liveness-checker](https://github.com/universal-verify/liveness-checker) by Universal Verify.

This project uses [face-api.js](https://github.com/justadudewhohacks/face-api.js) for facial detection and liveness checking. All processing is done locally on the user's device.
