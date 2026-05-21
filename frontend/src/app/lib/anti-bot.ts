export type BotDetectionReason =
  | "CONSOLE_PATCHED"
  | "COALESCED_EVENTS_SPOOFED"
  | "KEYBOARD_TIMING_ANOMALY"
  | "MISSING_KEYDOWN"
  | "WEBGL_OS_MISMATCH"
  | "MOUSE_BIOMETRICS_ANOMALY"
  | "EXECUTION_TIMING_ANOMALY"
  | "AUDIO_FINGERPRINT_ANOMALY"
  | "WINDOW_GEOMETRY_ANOMALY"
  | "CLICK_TIMING_ANOMALY"
  | "MOUSE_TELEPORTATION_ANOMALY"
  | "CDP_LEAK_DETECTED"
  | "MISSING_CHROME_RUNTIME"
  | "ZERO_PLUGINS"
  | "PERMISSIONS_ANOMALY"
  | "WEBDRIVER_DETECTED";

/**
 * Runs instant, synchronous checks that detect automation frameworks
 * BEFORE any DPoP keys or device IDs are generated.
 * Returns an array of reasons if a bot is detected, or empty array if clean.
 */
export function instantBotCheck(): BotDetectionReason[] {
  const reasons: BotDetectionReason[] = [];

  // 1. navigator.webdriver — Patchright patches this, but check anyway
  if ((navigator as any).webdriver === true) {
    reasons.push("WEBDRIVER_DETECTED");
  }

  // 2. CDP (Chrome DevTools Protocol) leak detection
  try {
    // Check document for cdc_ keys (ChromeDriver) and playwright internals
    const docKeys = Object.keys(document);
    const cdcLeak = docKeys.some(k => k.startsWith('cdc_') || k.startsWith('__playwright'));
    if (cdcLeak) {
      reasons.push("CDP_LEAK_DETECTED");
    }
    // Check window for automation framework globals
    const winKeys = Object.getOwnPropertyNames(window);
    const automationGlobals = winKeys.some(k =>
      k.includes('__playwright') ||
      k.includes('__puppeteer') ||
      k.includes('__selenium') ||
      k.includes('__webdriver') ||
      k.includes('__nightmare') ||
      k.includes('_phantom') ||
      k.includes('callPhantom')
    );
    if (automationGlobals) {
      reasons.push("CDP_LEAK_DETECTED");
    }
  } catch (e) { /* ignore */ }

  // 3. DEEP Chrome Runtime Verification
  //    The attacker can inject a fake window.chrome via addInitScript,
  //    but those injected functions are plain JavaScript, NOT native C++ bindings.
  //    Real Chrome's runtime functions return "[native code]" when toString'd.
  //    Additionally, real web pages do NOT have chrome.runtime.id set — 
  //    that property only exists inside Chrome extension contexts.
  if (typeof (window as any).chrome !== 'undefined') {
    const chrome = (window as any).chrome;
    if (!chrome.runtime || Object.keys(chrome.runtime).length === 0) {
      reasons.push("MISSING_CHROME_RUNTIME");
    } else {
      // Deep check: Verify native function signatures
      // A real chrome.runtime.connect is a native C++ binding: "function connect() { [native code] }"
      // An attacker's fake is: "function() {}" or "function connect() {}"
      const functionsToVerify = ['connect', 'sendMessage', 'getURL', 'getManifest'];
      for (const fn of functionsToVerify) {
        if (typeof chrome.runtime[fn] === 'function') {
          const fnStr = chrome.runtime[fn].toString();
          if (!fnStr.includes('[native code]')) {
            reasons.push("MISSING_CHROME_RUNTIME");
            break;
          }
        }
      }

      // Deep check: chrome.runtime.id should NOT exist on a normal web page.
      // It only exists inside extension contexts. If an attacker set a dummy id,
      // that's a dead giveaway.
      if (chrome.runtime.id !== undefined) {
        reasons.push("MISSING_CHROME_RUNTIME");
      }
    }
  } else {
    if (navigator.userAgent.includes('Chrome')) {
      reasons.push("MISSING_CHROME_RUNTIME");
    }
  }

  // 4. Deep Plugin Verification
  //    Attacker can spoof navigator.plugins.length, but real PluginArray items
  //    are instances of the native Plugin class with proper prototypes.
  //    Spoofed plugins injected via addInitScript are plain JS objects.
  if (navigator.plugins) {
    if (navigator.plugins.length === 0) {
      reasons.push("ZERO_PLUGINS");
    } else {
      // Verify that at least one plugin has the native Plugin prototype
      try {
        const firstPlugin = navigator.plugins[0];
        if (firstPlugin) {
          // Real plugins have a native toString: "[object Plugin]"
          const pluginStr = Object.prototype.toString.call(firstPlugin);
          if (pluginStr !== '[object Plugin]') {
            reasons.push("ZERO_PLUGINS");
          }
        }
      } catch (e) { /* ignore */ }
    }
  }

  // 5. Error stack trace analysis
  //    Playwright/Patchright sometimes leaves traces in error stack origins.
  //    Generate an error and inspect where the stack originates.
  try {
    const err = new Error('probe');
    const stack = err.stack || '';
    // Playwright's internal evaluate calls sometimes leak patchright/playwright paths
    if (stack.includes('playwright') || stack.includes('patchright') || stack.includes('puppeteer')) {
      reasons.push("CDP_LEAK_DETECTED");
    }
  } catch (e) { /* ignore */ }

  // 6. Permissions API anomaly
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      navigator.permissions.query({ name: 'notifications' as PermissionName }).then(result => {
        if (result.state === 'prompt') {
          // Mismatch detected (async — won't block key gen, but will flag UI)
        }
      }).catch(() => {});
    }
  } catch (e) { /* ignore */ }

  return reasons;
}

export class BotDetector {
  private onDetect: (reason: BotDetectionReason) => void;
  private lastKeydownTime: number = 0;
  private lastMousedownTime: number = 0;
  private cleanupFunctions: (() => void)[] = [];

  // For mouse biometrics
  private lastMouseX: number = -1;
  private lastMouseY: number = -1;
  private lastMouseTime: number = 0;
  private constantVelocityCount: number = 0;
  private pointerMoveCount: number = 0;

  constructor(onDetect: (reason: BotDetectionReason) => void) {
    this.onDetect = onDetect;
  }

  public start() {
    // Run instant checks first
    const instantReasons = instantBotCheck();
    for (const reason of instantReasons) {
      this.triggerDetection(reason);
    }

    // Then set up ongoing monitors
    this.monitorPointerEvents();
    this.monitorKeyboardEvents();
    this.monitorClickEvents();

    // Advanced Heuristics
    this.checkWebGLMismatch();
    this.checkExecutionTiming();
    this.checkAudioFingerprint();
    this.checkWindowGeometry();
  }

  public stop() {
    this.cleanupFunctions.forEach((cleanup) => cleanup());
    this.cleanupFunctions = [];
  }

  private triggerDetection(reason: BotDetectionReason) {
    this.onDetect(reason);
  }

  // --- 1. Console API Patching ---
  private checkConsolePatch() {
    const methods = ["log", "debug", "info", "warn", "error"];
    for (const method of methods) {
      // @ts-ignore
      const originalMethod = console[method];
      if (typeof originalMethod === "function") {
        const methodStr = originalMethod.toString();
        if (!methodStr.includes("[native code]")) {
          this.triggerDetection("CONSOLE_PATCHED");
          break;
        }
      }
    }
  }

  // --- 2 & 7. Coalesced Events & Mouse Biometrics ---
  private monitorPointerEvents() {
    const handlePointerMove = (e: PointerEvent) => {
      this.pointerMoveCount++;

      // Coalesced Check
      if (e.getCoalescedEvents && typeof e.getCoalescedEvents === 'function') {
        const funcStr = e.getCoalescedEvents.toString();
        if (!funcStr.includes("[native code]")) {
          this.triggerDetection("COALESCED_EVENTS_SPOOFED");
        }
      }

      // Biometrics Check (Simplified velocity consistency check)
      const currentTime = performance.now();
      if (this.lastMouseX !== -1 && this.lastMouseTime !== 0) {
        const dx = Math.abs(e.clientX - this.lastMouseX);
        const dy = Math.abs(e.clientY - this.lastMouseY);
        const dt = currentTime - this.lastMouseTime;

        if (dt > 0) {
          const velocity = Math.sqrt(dx * dx + dy * dy) / dt;

          // If velocity is exactly the same repeatedly (very unnatural for humans)
          // Mathematical bezier curves often exhibit extremely constant velocities in certain segments
          if (velocity > 0 && Number.isInteger(velocity * 100)) {
            this.constantVelocityCount++;
            if (this.constantVelocityCount > 20) {
              this.triggerDetection("MOUSE_BIOMETRICS_ANOMALY");
            }
          } else {
            this.constantVelocityCount = 0;
          }
        }
      }
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.lastMouseTime = currentTime;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    this.cleanupFunctions.push(() => window.removeEventListener('pointermove', handlePointerMove));
  }

  // --- 3. Keyboard Anomalies ---
  private monitorKeyboardEvents() {
    const handleKeydown = (e: KeyboardEvent) => {
      if (!e.isTrusted) {
        this.triggerDetection("KEYBOARD_TIMING_ANOMALY");
      }
      this.lastKeydownTime = performance.now();
    };

    const handleInput = (e: Event) => {
      if (!e.isTrusted) {
        this.triggerDetection("KEYBOARD_TIMING_ANOMALY");
        return;
      }
      const inputEvent = e as InputEvent;
      if (inputEvent.inputType === "insertText" && inputEvent.data) {
        const timeSinceKeydown = performance.now() - this.lastKeydownTime;
        if (inputEvent.data.length === 1 && timeSinceKeydown > 500) {
          this.triggerDetection("MISSING_KEYDOWN");
        }
      }
    };

    window.addEventListener('keydown', handleKeydown, { passive: true });
    window.addEventListener('input', handleInput, { passive: true, capture: true });

    this.cleanupFunctions.push(() => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('input', handleInput, { capture: true });
    });
  }

  // --- 3.5. Click Timing & Teleportation Anomalies ---
  private monitorClickEvents() {
    const handlePointerdown = (e: PointerEvent) => {
      // Ignore touch screens and pens
      if (e.pointerType !== "mouse") return;
      
      this.lastMousedownTime = performance.now();

      // Teleportation Check 1: No previous pointer moves
      if (this.lastMouseX === -1) {
         this.triggerDetection("MOUSE_TELEPORTATION_ANOMALY");
      } else {
         const distance = Math.sqrt(
           Math.pow(e.clientX - this.lastMouseX, 2) + 
           Math.pow(e.clientY - this.lastMouseY, 2)
         );
         // Teleportation Check 2: Jumped > 15 pixels instantly
         if (distance > 15) {
            this.triggerDetection("MOUSE_TELEPORTATION_ANOMALY");
         }
      }

      // Teleportation Check 3: Playwright bypasses Checks 1 & 2 by firing exactly ONE 
      // pointermove event directly on the target coordinate right before clicking.
      // A human generates dozens of pointermove events just dragging the mouse.
      if (this.pointerMoveCount < 5) {
         this.triggerDetection("MOUSE_TELEPORTATION_ANOMALY");
      }
    };

    const handlePointerup = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const timeSinceDown = performance.now() - this.lastMousedownTime;
      // Real humans physically cannot click and release a physical mouse button in less than 5ms.
      // Automation tools (like Playwright's default click) often dispatch these instantly (0-2ms).
      if (this.lastMousedownTime > 0 && timeSinceDown < 5) {
        this.triggerDetection("CLICK_TIMING_ANOMALY");
      }
    };

    // Use pointerdown/up instead of mousedown/up to properly detect the hardware type (touch vs mouse)
    window.addEventListener('pointerdown', handlePointerdown, { passive: true });
    window.addEventListener('pointerup', handlePointerup, { passive: true });

    this.cleanupFunctions.push(() => {
      window.removeEventListener('pointerdown', handlePointerdown);
      window.removeEventListener('pointerup', handlePointerup);
    });
  }

  // --- 4. WebGL OS Mismatch ---
  private checkWebGLMismatch() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        // @ts-ignore
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          // @ts-ignore
          const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
          const userAgent = navigator.userAgent.toLowerCase();

          // Apple devices shouldn't report NVIDIA/AMD discrete cards in typical WebGL profiles natively without eGPUs, 
          // but more reliably, they shouldn't report SwiftShader (Google's software rasterizer often used in headless Chrome)
          if (userAgent.includes('mac os') && (renderer.includes('swiftshader') || renderer.includes('llvmpipe'))) {
            this.triggerDetection("WEBGL_OS_MISMATCH");
          }
        }
      }
    } catch (e) {
      // Ignore errors if WebGL is disabled
    }
  }

  // --- 5. Execution Timing Anomaly ---
  private checkExecutionTiming() {
    const start = performance.now();
    // Run a small matrix calculation that takes a predictable amount of time
    let sum = 0;
    for (let i = 0; i < 100000; i++) {
      sum += Math.sqrt(i) * Math.sin(i);
    }
    const end = performance.now();
    const duration = end - start;

    // If it executes in 0ms, performance.now() is likely spoofed/mocked
    // If it takes > 200ms for this tiny loop, it's heavily throttled (VM/Headless)
    if (duration === 0 || duration > 200) {
      this.triggerDetection("EXECUTION_TIMING_ANOMALY");
    }
  }

  // --- 6. Audio Fingerprint Noise Anomaly ---
  private checkAudioFingerprint() {
    try {
      // Generate two fingerprints. Real hardware is deterministic. 
      // Bad spoofers add random noise every time AudioContext is called.
      const getAudioHash = async (): Promise<number> => {
        const context = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, 44100, 44100);
        const oscillator = context.createOscillator();
        oscillator.type = "triangle";
        oscillator.frequency.value = 10000;

        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -50;
        compressor.knee.value = 40;
        compressor.ratio.value = 12;
        compressor.attack.value = 0;
        compressor.release.value = 0.25;

        oscillator.connect(compressor);
        compressor.connect(context.destination);
        oscillator.start(0);

        const buffer = await context.startRendering();
        const data = buffer.getChannelData(0);

        let hash = 0;
        for (let i = 0; i < data.length; i++) {
          hash += Math.abs(data[i]);
        }
        return hash;
      };

      Promise.all([getAudioHash(), getAudioHash()]).then(([hash1, hash2]) => {
        if (hash1 !== hash2) {
          this.triggerDetection("AUDIO_FINGERPRINT_ANOMALY");
        }
      }).catch(() => { });
    } catch (e) {
      // Audio context might be disabled
    }
  }

  // --- 7. Window Geometry Anomaly ---
  private checkWindowGeometry() {
    // Some headless browsers fail to set proper outer window dimensions
    if (window.outerWidth === 0 && window.outerHeight === 0 && window.innerWidth > 0) {
      this.triggerDetection("WINDOW_GEOMETRY_ANOMALY");
    }

    // Inner viewport cannot be larger than the outer browser window
    if (window.innerWidth > window.outerWidth || window.innerHeight > window.outerHeight) {
      // Allow a small margin of error for mobile zoom, but generally this catches bad spoofs
      if (window.innerWidth - window.outerWidth > 50) {
        this.triggerDetection("WINDOW_GEOMETRY_ANOMALY");
      }
    }
  }
}

