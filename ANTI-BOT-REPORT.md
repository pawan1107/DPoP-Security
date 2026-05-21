# Anti-Bot Detection Techniques Report

This report details the various client-side heuristic and environmental checks implemented in `anti-bot.ts` to detect automated browsers, headless environments, and bot frameworks like Playwright, Puppeteer, Selenium, and CloakBrowser.

The defenses are split into two categories: **Synchronous On-Load Checks** (which run immediately to block cryptographic key generation) and **Behavioral Monitoring** (which analyze user interaction continuously).

---

## 1. Synchronous On-Load Checks (Instant Detection)

These checks run the moment the JavaScript executes, verifying the integrity of the browser environment before the application finishes loading.

### 1.1. Native Function Fingerprinting (`MISSING_CHROME_RUNTIME`)
Automated frameworks often inject fake `window.chrome` objects using initialization scripts (like Playwright's `addInitScript`) to trick basic detectors.
*   **Technique:** We verify the `toString()` output of key Chrome runtime functions (e.g., `chrome.runtime.connect`). A genuine Chrome C++ binding returns `"function connect() { [native code] }"`. A JavaScript-injected fake returns `"function() {}"`.
*   **Context Trap:** We also verify that `chrome.runtime.id` is `undefined`. This property only exists inside actual Chrome Extension contexts, not on standard web pages. Attackers often mistakenly populate it when mocking the `chrome` object.

### 1.2. Deep Plugin Verification (`ZERO_PLUGINS`)
Real browsers always ship with at least a few default plugins (like the PDF Viewer). Fresh instances of headless Chromium often have zero plugins.
*   **Technique:** If `navigator.plugins.length` is `0`, it's highly suspicious.
*   **Prototype Verification:** If the attacker attempts to spoof the plugin array length, we verify that the objects inside the array are genuine instances of the native `Plugin` class by checking `Object.prototype.toString.call(plugin) === '[object Plugin]'`. Injected JavaScript fakes will return `'[object Object]'`.

### 1.3. Error Stack Trace Analysis (`CDP_LEAK_DETECTED`)
Automation frameworks inject their own code into the V8 engine to control the browser. Sometimes, this internal code leaks into error stack traces.
*   **Technique:** We generate a dummy `Error('probe')` and analyze its `stack` trace. If the trace contains keywords like `playwright`, `patchright`, or `puppeteer`, it indicates the browser is under programmatic control.

### 1.4. Global Variable Leak Detection (`CDP_LEAK_DETECTED`)
*   **Technique:** We scan the `window` and `document` objects for specific, known variables injected by automation tools. For example, ChromeDriver injects properties starting with `cdc_`, and Playwright injects variables containing `__playwright`.

### 1.5. WebDriver Flag (`WEBDRIVER_DETECTED`)
*   **Technique:** We check the standard W3C `navigator.webdriver` property. While advanced frameworks patch this, it still catches basic, unmodified automation scripts.

### 1.6. Permissions API Anomaly (`PERMISSIONS_ANOMALY`)
*   **Technique:** We look for inconsistent states in the Permissions API. For example, if `Notification.permission` is `"denied"` by default, but `navigator.permissions.query({ name: 'notifications' })` asynchronously returns `"prompt"`, it indicates a headless environment with mocked permission states.

---

## 2. Behavioral Monitoring (Runtime Detection)

These checks run continuously in the background, analyzing the physical interactions the user has with the webpage.

### 2.1. Mouse Teleportation Anomaly (`MOUSE_TELEPORTATION_ANOMALY`)
Automation scripts (like Playwright's default `page.click()`) do not physically move the mouse. They teleport the pointer directly to the target element.
*   **Technique (History):** We track the total number of `pointermove` events. If a `pointerdown` (click) occurs, but there have been fewer than 5 pointer movements in the entire session, it's a script. A human generates dozens of events just dragging the mouse to a button.
*   **Technique (Distance):** If the mouse *has* moved previously, we calculate the distance between the last recorded `pointermove` and the new `pointerdown`. If the distance is greater than 15 pixels, the mouse teleported instantly.

### 2.2. Click Timing Anomaly (`CLICK_TIMING_ANOMALY`)
*   **Technique:** We measure the exact millisecond gap between `pointerdown` and `pointerup`. Real humans physically cannot press and release a mouse button in less than 5 milliseconds. Automated scripts often fire these events simultaneously (0-2ms gap).
*   **Hardware Filter:** We use `PointerEvent.pointerType` to ignore this check if the input is `"touch"` or `"pen"`, as mobile devices generate synthetic mouse events with 0ms gaps.

### 2.3. Mouse Biometrics Anomaly (`MOUSE_BIOMETRICS_ANOMALY`)
When advanced attackers try to simulate mouse movement, they often use mathematical Bézier curves.
*   **Technique:** We monitor the derivative velocity of `pointermove` events. If we detect 20 consecutive frames of perfectly uniform, mathematically constant velocity, it flags the session. Humans possess micro-jitters that make constant velocity impossible over that many frames.

### 2.4. Coalesced Events Spoofing (`COALESCED_EVENTS_SPOOFED`)
*   **Technique:** We check if the `getCoalescedEvents` function on `PointerEvent` has been monkey-patched. We verify its integrity by ensuring its `toString()` output includes `[native code]`.

### 2.5. Execution Timing Anomaly (`EXECUTION_TIMING_ANOMALY`)
Bots often run in heavily throttled virtual machines or use mocked system clocks.
*   **Technique:** We run a tiny, synchronous math loop and measure the duration using `performance.now()`. If it executes in `0ms` (mocked clock) or takes an abnormally long time (e.g., `>200ms`, indicating a heavily throttled micro-VM), it flags the session.

### 2.6. Audio Fingerprint Noise Anomaly (`AUDIO_FINGERPRINT_ANOMALY`)
To prevent tracking, some privacy extensions and anti-detect browsers inject random noise into the `OfflineAudioContext` to constantly change the hardware audio hash.
*   **Technique:** We generate two audio hashes back-to-back. Real hardware is deterministic and will return the exact same hash both times. If the hashes differ, a spoofer is actively injecting random noise.

### 2.7. Window Geometry Anomaly (`WINDOW_GEOMETRY_ANOMALY`)
Headless browsers often struggle to correctly synchronize their internal viewport with the simulated outer browser window.
*   **Technique:** We verify that `window.innerWidth` is not physically larger than `window.outerWidth`. We also check if outer dimensions are exactly `0` while inner dimensions are populated, which is a common leak in headless configurations.

### 2.8. Keyboard Anomalies (`KEYBOARD_TIMING_ANOMALY` & `MISSING_KEYDOWN`)
*   **Technique:** We ensure all `KeyboardEvent` and `InputEvent` objects have `isTrusted === true`. Furthermore, if text is inserted (e.g., via a script calling `element.value = 'text'`), we verify that a corresponding `keydown` event occurred within a reasonable timeframe (e.g., < 500ms prior), preventing instant, keyless text injection.
