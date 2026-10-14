import { Component, Suspense, memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls } from "@react-three/drei";
import { RealEngine, type EngineMode } from "./RealEngine";

interface EngineTwinPanelProps {
  rulCycles: number;
}

const MODES: EngineMode[] = ["standard", "cutaway"];

type WebGLSupport = { supported: boolean; error: string | null };

// Try hard to obtain a WebGL2 context and capture the browser's real reason
// when it fails (Chrome no longer falls back to software rendering, and on
// dual-GPU laptops requesting "high-performance" can make creation fail).
// IMPORTANT: every probed context is released immediately via
// WEBGL_lose_context. A live probe context that is never released eats GPU
// memory and, on dual-GPU systems, forces Chrome to juggle two contexts which
// is a known trigger for GPU process crashes.
function detectWebGL(): WebGLSupport {
  // CRITICAL for dual-GPU laptops: request "low-power" FIRST so the probe
  // lands on the integrated GPU and never wakes the discrete GPU. If the probe
  // used the default power preference, Chrome may create the context on the
  // discrete GPU, lose it, then let the real <Canvas> context switch back —
  // that GPU hand-off is the #1 cause of the GPU process crash ("Aw, snap").
  const candidates: Array<{ type: "webgl2"; attrs?: WebGLContextAttributes }> = [
    { type: "webgl2", attrs: { failIfMajorPerformanceCaveat: false, powerPreference: "low-power" } },
    { type: "webgl2", attrs: { failIfMajorPerformanceCaveat: false } },
    { type: "webgl2", attrs: undefined },
  ];

  for (const { type, attrs } of candidates) {
    try {
      const canvas = document.createElement("canvas");
      let statusMessage: string | null = null;
      const handleError = (event: Event) => {
        statusMessage = (event as WebGLContextEvent).statusMessage || null;
      };
      canvas.addEventListener("webglcontextcreationerror", handleError);
      const context = canvas.getContext(type, attrs);
      canvas.removeEventListener("webglcontextcreationerror", handleError);
      if (context) {
        context.getExtension("WEBGL_lose_context")?.loseContext();
        return { supported: true, error: null };
      }
      if (statusMessage) return { supported: false, error: statusMessage };
    } catch {
      // Try the next candidate.
    }
  }

  return { supported: false, error: null };
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

// Listens for WebGL context loss and reports it up to the panel so we can show
// a graceful fallback instead of a frozen / white screen.
function WebGLGuard({ onLost }: { onLost: () => void }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    canvas.addEventListener("webglcontextlost", handleLost);
    return () => canvas.removeEventListener("webglcontextlost", handleLost);
  }, [gl, onLost]);

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
      <Environment resolution={256}>
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

  const webglSupported = webgl.supported;
  const handleContextLost = useCallback(() => setContextLost(true), []);
  const retryWebGL = () => setWebgl(detectWebGL());

  // Determine text color based on RUL (matches backend risk thresholds)
  const getRulColor = (rul: number) => {
    if (rul > 60) return "#4ade80"; // Healthy Green
    if (rul >= 20) return "#fbbf24"; // Warning Yellow
    return "#ef4444"; // Critical Red
  };

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
        {webglSupported && !contextLost ? (
            <Canvas
              camera={{ position: [0, 2, 7], fov: 45 }}
              // Cap the render scale: the panel spans most of the viewport and
              // at full DPR the framebuffer + MSAA can reach several hundred MB,
              // which is the usual reason the GPU process is killed on laptops
              // with an integrated GPU.
              dpr={[1, 1.5]}
              gl={{
                antialias: true,
                alpha: true,
                failIfMajorPerformanceCaveat: false,
                // Pin the context to the integrated GPU. On dual-GPU laptops
                // (Intel + NVIDIA/AMD) the default power preference lets Chrome
                // switch GPUs once the scene gets busy (slider drags, orbiting),
                // and that switch drops the context mid-frame and kills the GPU
                // process -> "Aw, snap". Low-power prevents the hand-off.
                powerPreference: "low-power",
              }}
            >
              <CanvasErrorBoundary>
                <Suspense fallback={<SceneFallback title="Loading 3D engine..." detail="Preparing the digital twin." />}>
                  <EngineScene rulCycles={rulCycles} mode={mode} />
                  <WebGLGuard onLost={handleContextLost} />
                </Suspense>
              </CanvasErrorBoundary>
            </Canvas>
        ) : contextLost ? (
          <div style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            color: "#9CA3AF",
            textAlign: "center",
            padding: "2rem",
            boxSizing: "border-box",
          }}>
            <span style={{ fontSize: "2rem" }}>⚙️</span>
            <strong style={{ color: "#F87171" }}>
              3D view interrupted
            </strong>
            <span style={{ fontSize: "0.85rem", maxWidth: "420px" }}>
              The GPU lost the rendering context. Click retry to restart the 3D view.
            </span>
            <button
              onClick={() => setContextLost(false)}
              style={{
                marginTop: "0.5rem",
                padding: "6px 14px",
                borderRadius: "6px",
                cursor: "pointer",
                border: "1px solid #4B5563",
                color: "#081019",
                background: "#60A5FA",
              }}
            >
              Retry
            </button>
          </div>
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
              style={{
                marginTop: "0.5rem",
                padding: "6px 14px",
                borderRadius: "6px",
                cursor: "pointer",
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
