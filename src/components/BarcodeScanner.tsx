"use client";

import { useEffect, useRef, useState } from "react";

// BarcodeDetector is a WICG API not yet in the standard TypeScript DOM lib.
// Minimal declaration to satisfy tsc; checked at runtime via typeof guard.
declare global {
  class BarcodeDetector {
    static getSupportedFormats(): Promise<string[]>;
    constructor(options?: { formats?: string[] });
    detect(
      image: ImageData | HTMLVideoElement | HTMLCanvasElement | ImageBitmap
    ): Promise<Array<{ rawValue: string }>>;
  }
}

export type BarcodeScannerProps = {
  /** Called when two consecutive identical reads are confirmed. Parent moves to lookup phase. */
  onDetected: (barcode: string) => void;
  /** Whether the parent sheet is in the active scan phase (controls camera lifecycle). */
  active: boolean;
};

type ScannerState = "starting" | "scanning" | "denied" | "no-camera" | "error";

type Decoder = (imageData: ImageData) => Promise<string | null>;

// ──────────────────────────────────────────────────────────────────────────────
// SVG Icons — hand-rolled 20px stroke-1.5, house style (MoreSheet convention)
// ──────────────────────────────────────────────────────────────────────────────

function TorchIcon({ on }: { on: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      {on ? (
        /* Lightning bolt — filled when on */
        <path
          d="M11 2L4 11h6l-1 7 7-9h-6l1-7z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="currentColor"
          fillOpacity="0.3"
        />
      ) : (
        /* Lightning bolt — outline when off */
        <path
          d="M11 2L4 11h6l-1 7 7-9h-6l1-7z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/**
 * Corner-bracket reticle SVG — wide landscape shape for EAN-13.
 * Four 20px L-shaped brackets in var(--accent) at 2px stroke.
 */
function Reticle() {
  const B = 22; // bracket arm length in px
  const S = 2;  // stroke width
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 200 100"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden
      style={{ position: "absolute", inset: 0 }}
    >
      {/* Top-left */}
      <polyline
        points={`${S},${B + S} ${S},${S} ${B + S},${S}`}
        stroke="var(--accent)"
        strokeWidth={S * 4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Top-right */}
      <polyline
        points={`${200 - B - S},${S} ${200 - S},${S} ${200 - S},${B + S}`}
        stroke="var(--accent)"
        strokeWidth={S * 4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Bottom-left */}
      <polyline
        points={`${S},${100 - B - S} ${S},${100 - S} ${B + S},${100 - S}`}
        stroke="var(--accent)"
        strokeWidth={S * 4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Bottom-right */}
      <polyline
        points={`${200 - B - S},${100 - S} ${200 - S},${100 - S} ${200 - S},${100 - B - S}`}
        stroke="var(--accent)"
        strokeWidth={S * 4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// BarcodeScanner
// ──────────────────────────────────────────────────────────────────────────────

export function BarcodeScanner({ active, onDetected }: BarcodeScannerProps) {
  const [scannerState, setScannerState] = useState<ScannerState>("starting");
  const [torchOn, setTorchOn] = useState(false);
  const [torchCapable, setTorchCapable] = useState(false);

  // Lifecycle refs
  const startGenRef = useRef(0);     // H-1 cancellation counter
  const streamRef   = useRef<MediaStream | null>(null);
  const decoderRef  = useRef<Decoder | null>(null);
  const ctxRef      = useRef<CanvasRenderingContext2D | null>(null); // M-4: cached ctx

  // DOM refs
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // hidden; reused across frames

  // ── Decoder initialization (once per camera session) ──────────────────────

  async function initDecoder() {
    // Native BarcodeDetector path (Chrome Android, Chrome desktop)
    // Format names use underscores in the native API: "ean_13", NOT "EAN-13"
    if (typeof BarcodeDetector !== "undefined") {
      try {
        const supported = await BarcodeDetector.getSupportedFormats();
        if (supported.includes("ean_13")) {
          const detector = new BarcodeDetector({
            formats: ["ean_13", "upc_a", "upc_e", "ean_8"],
          });
          decoderRef.current = async (img) => {
            const results = await detector.detect(img);
            return results[0]?.rawValue ?? null;
          };
          return;
        }
      } catch {
        // getSupportedFormats failed — fall through to zxing-wasm
      }
    }

    // zxing-wasm path (iOS Safari, Firefox, everywhere native BarcodeDetector is absent)
    // Dynamic import ensures zxing is NOT in the shared/base chunk.
    const { prepareZXingModule, readBarcodes } = await import("zxing-wasm/reader");
    await prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => {
          if (path.endsWith(".wasm")) return `/zxing/${path}`;
          return prefix + path;
        },
      },
      fireImmediately: true,
    });

    decoderRef.current = async (img) => {
      const results = await readBarcodes(img, {
        // HRI label format strings — valid in zxing-wasm v3.1.0
        formats: ["EAN-13", "UPC-A", "UPC-E", "EAN-8"],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      });
      const valid = results.find((r) => r.isValid && r.text);
      return valid?.text ?? null;
    };
  }

  // ── Camera lifecycle — START (H-1 generation-counter pattern) ─────────────

  async function startCamera() {
    // Capture THIS call's generation BEFORE any await.
    // stopCamera() increments startGenRef.current to invalidate in-flight starts.
    const gen = ++startGenRef.current;
    setScannerState("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      // Guard: if stopCamera() ran (or another startCamera()) while we were awaiting
      if (gen !== startGenRef.current) {
        stream.getTracks().forEach((t) => t.stop()); // immediately release the fresh tracks
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Guard again after play() — play() can take non-trivial time on some devices
      if (gen !== startGenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return;
      }

      // Probe torch capability
      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchCapable(!!caps?.torch);
      setTorchOn(false);

      await initDecoder();

      if (gen !== startGenRef.current) return; // superseded during wasm warm-up

      setScannerState("scanning");
    } catch (err) {
      if (gen !== startGenRef.current) return; // already superseded — ignore error
      const name = (err as DOMException).name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setScannerState("denied");
      } else {
        setScannerState("no-camera");
      }
    }
  }

  // ── Camera lifecycle — STOP ───────────────────────────────────────────────
  //
  // stopTracks(): stops media tracks and clears refs ONLY. No setState.
  //   → Safe to call directly inside an effect body (no cascading renders).
  // stopCamera(): calls stopTracks() and resets torch state.
  //   → Call from cleanup functions or event callbacks — not effect body directly.

  function stopTracks() {
    // H-1: increment BEFORE track.stop() — invalidates any in-flight startCamera
    startGenRef.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    decoderRef.current = null;
    ctxRef.current = null; // clear cached canvas context for next session
  }

  function stopCamera() {
    stopTracks();
    setTorchOn(false);
    setTorchCapable(false);
  }

  // ── Torch toggle ──────────────────────────────────────────────────────────

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    await (
      track as MediaStreamTrack & { applyConstraints: (c: object) => Promise<void> }
    ).applyConstraints({ advanced: [{ torch: !torchOn }] });
    setTorchOn((t) => !t);
  }

  // ── Effect 1: camera start/stop on `active` change ───────────────────────
  //
  // Camera hardware IS the external system this effect syncs with.
  // startCamera() sets scannerState to track the hardware's readiness —
  // this is correct usage of setState inside an effect (external-system sync).
  // stopTracks() has no setState; stopCamera() (cleanup) resets torch state.

  useEffect(() => {
    if (!active) {
      stopTracks(); // no setState — safe in effect body
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startCamera();
    return () => stopCamera(); // cleanup: stops tracks + resets torch state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ── Effect 2: visibilitychange (iOS background/foreground) ───────────────

  // TEMP-DIAG: append visibility-state transitions to a rolling breadcrumb in
  // localStorage so we can see whether the camera causes a hidden→visible flip
  // that correlates with the Log-sheet-close bug. Remove after repro confirmed.
  function appendVisBreadcrumb(state: string) {
    try {
      const raw = localStorage.getItem("goaldmine.diag.vis");
      const crumbs: Array<{ state: string; at: string }> = raw ? JSON.parse(raw) : [];
      crumbs.push({ state, at: new Date().toISOString() });
      // Keep last 10 entries
      localStorage.setItem("goaldmine.diag.vis", JSON.stringify(crumbs.slice(-10)));
    } catch { /* noop */ }
  }
  // ────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return;
    const handler = () => {
      // TEMP-DIAG: record visibility transition
      appendVisBreadcrumb(document.hidden ? "hidden" : "visible");
      if (document.hidden) {
        stopCamera();
        setScannerState("starting"); // will restart when visible
      } else {
        startCamera();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ── Effect 3: decode loop (runs while scannerState === "scanning") ────────
  //
  // Canvas context is initialized once per session with { willReadFrequently: true }
  // (M-4 fix) — tells the browser to keep the canvas in CPU-readable memory,
  // avoiding a GPU→CPU readback on every getImageData(). Cached via ctxRef.
  // stopCamera() clears ctxRef so the next session gets a fresh context.

  useEffect(() => {
    if (scannerState !== "scanning" || !decoderRef.current) return;

    let cancelled = false;
    let inFlight = false;
    let lastCode: string | null = null;
    let matchCount = 0;

    const loop = async () => {
      while (!cancelled) {
        await new Promise<void>((r) => setTimeout(r, 200));
        if (cancelled || inFlight) continue;

        const video  = videoRef.current;
        const canvas = canvasRef.current; // S-3: null guard, no non-null assertion
        if (
          !video ||
          !canvas ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          continue;
        }

        inFlight = true;
        try {
          // M-4: initialize ctx once per session with willReadFrequently
          if (!ctxRef.current) {
            ctxRef.current = canvas.getContext("2d", { willReadFrequently: true });
          }
          const ctx = ctxRef.current;
          if (!ctx || !decoderRef.current) {
            inFlight = false;
            continue;
          }

          const W = Math.min(video.videoWidth, 1280);
          const H = Math.round(W * (video.videoHeight / video.videoWidth));
          canvas.width = W;
          canvas.height = H;
          ctx.drawImage(video, 0, 0, W, H);
          const imageData = ctx.getImageData(0, 0, W, H);

          const code = await decoderRef.current(imageData);
          if (!cancelled && code) {
            if (code === lastCode) {
              matchCount++;
              if (matchCount >= 2) {
                // Two consecutive identical reads — confirmed barcode
                navigator.vibrate?.(50);
                onDetected(code);
                return; // exit loop; parent will set active=false
              }
            } else {
              lastCode = code;
              matchCount = 1;
            }
          }
        } catch {
          // Decode errors are transient (motion blur, partial scan); continue loop
        } finally {
          inFlight = false;
        }
      }
    };

    loop();
    return () => {
      cancelled = true;
    };
  }, [scannerState, onDetected]);

  // ── Status text ───────────────────────────────────────────────────────────

  const statusText = (() => {
    switch (scannerState) {
      case "starting":  return "Starting camera…";
      case "scanning":  return "Point at the barcode";
      case "denied":    return "Camera access denied — enter the digits below";
      case "no-camera": return "No camera — enter the digits below";
      case "error":     return "Camera error — enter the digits below";
    }
  })();

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {/* Viewfinder card — ~4:3 aspect, black background, contains video + reticle */}
      <div
        className="relative rounded-xl border border-[var(--border)] overflow-hidden bg-black"
        style={{ aspectRatio: "4/3" }}
      >
        <video
          ref={videoRef}
          data-testid="scanner-video"
          playsInline
          muted
          autoPlay
          aria-hidden
          className="w-full h-full object-cover"
        />

        {/* Corner-bracket reticle — positioned in the center 70% of the viewfinder */}
        <div
          className="absolute pointer-events-none"
          style={{ inset: "10% 15%" }}
          aria-hidden
        >
          <Reticle />
        </div>

        {/* Torch toggle — only shown when the camera track supports torch */}
        {torchCapable && (
          <button
            type="button"
            data-testid="torch-btn"
            onClick={toggleTorch}
            aria-label={torchOn ? "Turn off torch" : "Turn on torch"}
            className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center text-white"
            style={{ background: "rgba(0,0,0,.35)" }}
          >
            <TorchIcon on={torchOn} />
          </button>
        )}
      </div>

      {/* Hidden canvas — reused per session; never rendered visually */}
      <canvas ref={canvasRef} className="hidden" aria-hidden />

      {/* Status text — aria-live for screen readers */}
      <p
        data-testid="scanner-status"
        aria-live="polite"
        className="text-sm text-center text-[var(--muted)]"
      >
        {statusText}
      </p>
    </div>
  );
}
