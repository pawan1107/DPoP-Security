export type BotDetectionReason =
  | "CONSOLE_PATCHED"
  | "COALESCED_EVENTS_SPOOFED"
  | "KEYBOARD_TIMING_ANOMALY"
  | "MISSING_KEYDOWN"
  | "WEBGL_OS_MISMATCH"
  | "MOUSE_BIOMETRICS_ANOMALY"
  | "EXECUTION_TIMING_ANOMALY"
  | "AUDIO_FINGERPRINT_ANOMALY"
  | "WINDOW_GEOMETRY_ANOMALY";

export class BotDetector {
  private onDetect: (reason: BotDetectionReason) => void;
  private lastKeydownTime: number = 0;
  private cleanupFunctions: (() => void)[] = [];

  // For mouse biometrics
  private lastMouseX: number = -1;
  private lastMouseY: number = -1;
  private lastMouseTime: number = 0;
  private constantVelocityCount: number = 0;

  constructor(onDetect: (reason: BotDetectionReason) => void) {
    this.onDetect = onDetect;
  }

  public start() {
    this.checkConsolePatch(); // Disabled for Next.js dev mode (Next.js patches console internally)
    this.monitorPointerEvents();
    this.monitorKeyboardEvents();

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

