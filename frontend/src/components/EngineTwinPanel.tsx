import { Component, Suspense, memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { WebGLRenderer } from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls } from "@react-three/drei";
import { RealEngine, type EngineMode } from "./RealEngine";

interface EngineTwinPanelProps {
  rulCycles: number;
}

const MODES: EngineMode[] = ["standard", "cutaway"];

type WebGLSupport = { supported: boolean; error: string | null };

// Probe result is cached for the whole session. Re-probing (and therefore
// allocating a throwaway WebGL context) on every render/Retry click is itself
// a known trigger for context loss: browsers cap the number of live contexts
// per process and force-lose the oldest when the cap is exceeded.
let webglProbe: WebGLSupport | null = null;
let webglProbeCanvas: HTMLCanvasElement | null = null;

// Try hard to obtain a WebGL2 context and capture the browser's real reason
// when it fails. We prefer "high-performance" so the twin runs on the dedicated
// GPU (e.g. an RTX 3050) rather than a weak integrated GPU, which resets the
// context under the load this scene generates. Every probed context is released
// immediately via WEBGL_lose_context so it cannot leak GPU memory.
function detectWebGL(force = false): WebGLSupport {
  if (webglProbe && !force) return webglProbe;

  // A canvas whose context we lost cannot be re-probed cleanly, so grab the
  // shared one if available and drop the reference (next probe allocates fresh).
  const canvas = webglProbeCanvas ?? (webglProbeCanvas = document.createElement("canvas"));
  webglProbeCanvas = null;

  const candidates: Array<WebGLContextAttributes | undefined> = [
    { failIfMajorPerformanceCaveat: false, powerPreference: "high-performance" },
    { failIfMajorPerformanceCaveat: false },
    undefined,
  ];

  for (const attrs of candidates) {
    try {
      let statusMessage: string | null = null;
      const handleError = (event: Event) => {
        statusMessage = (event as WebGLContextEvent).statusMessage || null;
      };
      canvas.addEventListener("webglcontextcreationerror", handleError);
      const context = canvas.getContext("webgl2", attrs);
      canvas.removeEventListener("webglcontextcreationerror", handleError);
      if (context) {
        context.getExtension("WEBGL_lose_context")?.loseContext();
        webglProbe = { supported: true, error: null };
        return webglProbe;
      }
      if (statusMessage) {
        webglProbe = { supported: false, error: statusMessage };
        return webglProbe;
      }
    } catch {
      // Try the next candidate.
    }
  }

  webglProbe = { supported: false, error: null };
  return webglProbe;
}

function SceneFallback({ title, detail }: { title: string; detail: string }) {
  return (
    <Html center>
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        color: "#9CA3AF",
        textAlign: "center",
        padding: "2rem",
        boxSizing: "border-box",
        maxWidth: "340px",
      }}>
        <span style={{ fontSize: "2rem" }}>⚙️</span>
        <strong style={{ color: "#F87171" }}>{title}</strong>
        <span style={{ fontSize: "0.85rem" }}>{detail}</span>
      </div>
    </Html>
  );
}

// IMPORTANT: this boundary must live INSIDE <Canvas>. R3F renders the 3D scene
// through its own reconciler root, so an error thrown by a 3D component is only
// caught by a boundary that is itself a child of <Canvas>. A boundary outside
// <Canvas> cannot see those errors and the whole app would white-screen.
class CanvasErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <SceneFallback
          title="3D view could not be initialized"
          detail="The WebGL renderer hit an error. Reload the page to try again."
        />
      );
    }
    return this.props.children;
  }
}

// Reads the actual GPU the browser assigned to this WebGL context. The
// `powerPreference` hint is not enough on Windows dual-GPU laptops — Chrome
// usually follows the OS/browser GPU assignment, so we surface the real
// renderer string instead of guessing.
function readGpuRenderer(gl: WebGLRenderer): string {
  try {
    const ctx = gl.getContext() as WebGL2RenderingContext | null;
    if (!ctx) return "unknown";
    const ext = ctx.getExtension("WEBGL_debug_renderer_info");
    if (ext) {
      return String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "unknown");
    }
    return String(ctx.getParameter(ctx.RENDERER) || "unknown");
  } catch {
    return "unknown";
  }
}

// Listens for WebGL context loss/restore. On loss we preventDefault so the
// browser is allowed to restore the SAME context (Three.js then re-initialises
// it automatically) instead of us tearing down and rebuilding the renderer.
function WebGLGuard({
  onLost,
  onRestored,
  onRenderer,
}: {
  onLost: () => void;
  onRestored: () => void;
  onRenderer: (renderer: string) => void;
}) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    onRenderer(readGpuRenderer(gl));
  }, [gl, onRenderer]);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    const handleRestored = () => onRestored();
    canvas.addEventListener("webglcontextlost", handleLost);
    canvas.addEventListener("webglcontextrestored", handleRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);
    };
  }, [gl, onLost, onRestored]);

  return null;
}

function EngineScene({ rulCycles, mode }: { rulCycles: number; mode: EngineMode }) {
  return (
    <>
      {/* Cinematic Lighting Setup */}
      <ambientLight intensity={0.6} />
      <hemisphereLight args={["#9bb8ff", "#1a1f2b", 0.9]} />
      <spotLight position={[10, 10, 10]} angle={0.2} penumbra={1} intensity={1.5} castShadow />
      <spotLight position={[-10, -10, -10]} angle={0.2} penumbra={1} intensity={0.5} color="#60a5fa" />

      {/* Local-only environment (Lightformers, no CDN fetch): reflections work
          offline and can never crash the scene because of a network failure. */}
      <Environment resolution={128}>
        <Lightformer intensity={0.8} rotation-x={Math.PI / 2} position={[0, 5, -9]} scale={[10, 10, 1]} />
        <Lightformer intensity={1} rotation-y={Math.PI / 2} position={[-5, 1, -1]} scale={[20, 0.1, 1]} />
        <Lightformer intensity={1} rotation-y={-Math.PI / 2} position={[10, 1, 0]} scale={[20, 1, 1]} />
        <Lightformer intensity={0.5} rotation-x={Math.PI / 2} position={[0, -5, 9]} scale={[10, 10, 1]} />
      </Environment>

      {/* The Actual Engine Model */}
      <RealEngine rul={rulCycles} mode={mode} position={[0, -0.5, 0]} scale={0.6} />

      {/* Ground Shadow for Realism — render the depth pass once; it is static
          and re-rendering it every frame just adds GPU pressure on weak iGPUs. */}
      <ContactShadows position={[0, -1.5, 0]} opacity={0.6} scale={10} blur={2.5} far={4} color="#000000" frames={1} />

      {/* User Controls: Allow zooming and panning */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        maxPolarAngle={Math.PI / 1.5}
        minDistance={3}
        maxDistance={12}
      />
    </>
  );
}

// memo: the parent re-renders on every slider tick, but the 3D scene only needs
// to update when the predicted RUL actually changes.
function EngineTwinPanel({ rulCycles }: EngineTwinPanelProps) {
  const [mode, setMode] = useState<EngineMode>("standard");
  const [webgl, setWebgl] = useState<WebGLSupport>(() => detectWebGL());
  const [contextLost, setContextLost] = useState(false);
  // Bumping this key remounts <Canvas> with a freshly created context, but ONLY
  // on an explicit, debounced Retry click — never automatically.
  const [renderKey, setRenderKey] = useState(0);
  const [retryDisabled, setRetryDisabled] = useState(false);
  const [gpu, setGpu] = useState<string>("");
  const retryTimer = useRef<number | null>(null);

  const webglSupported = webgl.supported;
  const handleContextLost = useCallback(() => setContextLost(true), []);
  const handleContextRestored = useCallback(() => setContextLost(false), []);
  const handleRenderer = useCallback((renderer: string) => setGpu(renderer), []);

  useEffect(() => () => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
  }, []);

  // Shared cooldown so rapid clicks cannot spam new WebGL contexts.
  const startRetryCooldown = useCallback(() => {
    setRetryDisabled(true);
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => setRetryDisabled(false), 1000);
  }, []);

  const retryRender = useCallback(() => {
    startRetryCooldown();
    setContextLost(false);
    setRenderKey((k) => k + 1);
  }, [startRetryCooldown]);

  const retryWebGL = useCallback(() => {
    startRetryCooldown();
    setWebgl(detectWebGL(true));
  }, [startRetryCooldown]);

  // Determine text color based on RUL (matches backend risk thresholds)
  const getRulColor = (rul: number) => {
    if (rul > 60) return "#4ade80"; // Healthy Green
    if (rul >= 20) return "#fbbf24"; // Warning Yellow
    return "#ef4444"; // Critical Red
  };

  // Heuristic: an NVIDIA renderer string means the dedicated RTX 3050 is in
  // use. Intel/AMD here almost always means the integrated GPU was selected.
  const usingDiscreteGpu = /nvidia|rtx|geforce/i.test(gpu);

  return (
    <div className="card" style={{ flexGrow: 1, minHeight: "500px", display: "flex", flexDirection: "column", padding: "1.5rem" }}>

      {/* Panel Header */}
      <div className="panel-header" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 className="panel-title">3D Digital Twin Engine</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {MODES.map((option) => (
            <button
              key={option}
              onClick={() => setMode(option)}
              style={{
                padding: "5px 10px",
                textTransform: "uppercase",
                fontSize: "0.7rem",
                letterSpacing: "0.05em",
                borderRadius: "6px",
                cursor: "pointer",
                border: "1px solid #4B5563",
                color: mode === option ? "#081019" : "#9CA3AF",
                background: mode === option ? "#60A5FA" : "transparent",
              }}
            >
              {option}
            </button>
          ))}
          <span style={{ fontSize: "0.75rem", color: "#60A5FA", backgroundColor: "rgba(96, 165, 250, 0.1)", padding: "0.25rem 0.75rem", borderRadius: "9999px", border: "1px solid rgba(96,165,250,0.2)" }}>
            Live Rendering Active
          </span>
          {gpu && (
            <span
              title={gpu}
              style={{
                maxWidth: "240px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "0.7rem",
                color: usingDiscreteGpu ? "#4ade80" : "#fbbf24",
                backgroundColor: usingDiscreteGpu ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)",
                padding: "0.25rem 0.75rem",
                borderRadius: "9999px",
                border: `1px solid ${usingDiscreteGpu ? "rgba(74,222,128,0.25)" : "rgba(251,191,36,0.25)"}`,
              }}
            >
              GPU: {gpu}
            </span>
          )}
        </div>
      </div>

      {/* 3D Canvas Container */}
      <div style={{
        flexGrow: 1,
        width: "100%",
        borderRadius: "0.5rem",
        overflow: "hidden",
        backgroundColor: "#111827",
        position: "relative",
        border: "1px solid #374151",
        boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)"
      }}>
        {webglSupported ? (
          <>
            <Canvas
              key={renderKey}
              camera={{ position: [0, 2, 7], fov: 45 }}
              // Cap the render scale: the panel spans most of the viewport and
              // at full DPR the framebuffer + MSAA can reach several hundred MB.
              // 1.25 keeps it crisp without spiking VRAM.
              dpr={[1, 1.25]}
              gl={{
                antialias: true,
                alpha: true,
                failIfMajorPerformanceCaveat: false,
                // Route the renderer to the dedicated GPU. The twin is heavy
                // (7 MB model, cubemap env, contact shadows); running it on a
                // weak integrated GPU is what let the context reset under
                // slider/dropdown interaction.
                powerPreference: "high-performance",
              }}
            >
              <CanvasErrorBoundary>
                <Suspense fallback={<SceneFallback title="Loading 3D engine..." detail="Preparing the digital twin." />}>
                  <EngineScene rulCycles={rulCycles} mode={mode} />
                  <WebGLGuard onLost={handleContextLost} onRestored={handleContextRestored} onRenderer={handleRenderer} />
                </Suspense>
              </CanvasErrorBoundary>
            </Canvas>

            {/* Kept as an overlay (not a replacement) so the SAME context can be
                restored by the browser instead of being torn down and rebuilt. */}
            {contextLost && (
              <div style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                color: "#9CA3AF",
                textAlign: "center",
                padding: "2rem",
                boxSizing: "border-box",
                backgroundColor: "rgba(17, 24, 39, 0.92)",
                zIndex: 5,
              }}>
                <span style={{ fontSize: "2rem" }}>⚙️</span>
                <strong style={{ color: "#F87171" }}>
                  3D view interrupted
                </strong>
                <span style={{ fontSize: "0.85rem", maxWidth: "420px" }}>
                  The GPU lost the rendering context. It usually restores on its own;
                  if it doesn't, restart the 3D view.
                </span>
                <button
                  onClick={retryRender}
                  disabled={retryDisabled}
                  style={{
                    marginTop: "0.5rem",
                    padding: "6px 14px",
                    borderRadius: "6px",
                    cursor: retryDisabled ? "not-allowed" : "pointer",
                    opacity: retryDisabled ? 0.6 : 1,
                    border: "1px solid #4B5563",
                    color: "#081019",
                    background: "#60A5FA",
                  }}
                >
                  Retry
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            backgroundColor: "#111827",
            padding: "2rem",
            boxSizing: "border-box",
            textAlign: "center",
            color: "#9CA3AF",
            fontFamily: "sans-serif",
          }}>
            <span style={{ fontSize: "2rem" }}>⚙️</span>
            <strong style={{ color: "#F87171" }}>3D engine view unavailable</strong>
            <span style={{ fontSize: "0.8rem", maxWidth: "460px", lineHeight: 1.5 }}>
              Your browser could not start the WebGL 2 renderer that powers the 3D digital twin.
              Enable hardware acceleration in your browser settings, then retry.
              {webgl.error && (
                <>
                  <br />
                  Browser reported: <code style={{ color: "#FBBF24", fontSize: "0.72rem" }}>{webgl.error}</code>
                </>
              )}
            </span>
            <button
              onClick={retryWebGL}
              disabled={retryDisabled}
              style={{
                marginTop: "0.5rem",
                padding: "6px 14px",
                borderRadius: "6px",
                cursor: retryDisabled ? "not-allowed" : "pointer",
                opacity: retryDisabled ? 0.6 : 1,
                border: "1px solid #4B5563",
                color: "#081019",
                background: "#60A5FA",
                fontSize: "0.75rem",
              }}
            >
              Retry 3D
            </button>
          </div>
        )}

        {/* HUD Overlay inside the 3D viewport */}
        <div style={{
          position: "absolute",
          top: "1.5rem",
          right: "1.5rem",
          backgroundColor: "rgba(31, 41, 55, 0.75)",
          padding: "1rem 1.5rem",
          borderRadius: "0.5rem",
          backdropFilter: "blur(12px)",
          border: "1px solid #4B5563",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          pointerEvents: "none",
          fontFamily: "sans-serif"
        }}>
          {/* Glowing Indicator Dot */}
          <div style={{
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            backgroundColor: getRulColor(rulCycles),
            boxShadow: `0 0 12px ${getRulColor(rulCycles)}`
          }} />

          <div>
            <div style={{ color: "#9CA3AF", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>
              Engine Health (RUL)
            </div>
            <strong style={{ color: getRulColor(rulCycles), fontSize: "1.5rem", lineHeight: "1" }}>
              {Math.round(rulCycles)} Cycles
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(EngineTwinPanel);
