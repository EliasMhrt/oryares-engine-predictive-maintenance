import { useState, useEffect, useRef } from "react";
import { predictRUL, downloadReportPDF, type PredictionResponse, type TelemetryInput } from "./api";
import { AlertTriangle, CheckCircle, Activity, SlidersHorizontal, LineChart as ChartIcon, FileText, Loader2, ChevronDown, ChevronRight, ChevronsRight, ChevronsLeft } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

import EngineTwinPanel from "./components/EngineTwinPanel"; 
import "./App.css";

const healthyPreset: TelemetryInput = {
  engine_id: "ENG-042", cycle: 1, setting_1: 0.0, setting_2: 0.0, setting_3: 100.0,
  sensor_1: 518.67, sensor_2: 642.38, sensor_3: 1586.84, sensor_4: 1402.76, sensor_5: 14.62,
  sensor_6: 21.61, sensor_7: 553.95, sensor_8: 2388.06, sensor_9: 9056.01, sensor_10: 1.30,
  sensor_11: 47.35, sensor_12: 521.91, sensor_13: 2388.06, sensor_14: 8137.37, sensor_15: 8.4183,
  sensor_16: 0.03, sensor_17: 392.0, sensor_18: 2388.0, sensor_19: 100.0, sensor_20: 38.93, sensor_21: 23.36,
};

type ChartDataPoint = { time: string; rul: number; };
type SensorKey = keyof Omit<TelemetryInput, "engine_id" | "cycle">;

const sensorCategories = [
  {
    title: "⚙️ Operational Settings",
    sensors: [
      { id: "setting_1", label: "Setting 1 (Alt/Mach)", min: -0.01, max: 0.01, step: 0.0001 },
      { id: "setting_2", label: "Setting 2 (Throttle)", min: -0.001, max: 0.001, step: 0.0001 },
      { id: "setting_3", label: "Setting 3 (TRA)", min: 90.0, max: 110.0, step: 0.5 },
    ]
  },
  {
    title: "🔥 Temperature Telemetry",
    sensors: [
      { id: "sensor_1", label: "S1: Fan Inlet Temp", min: 515.0, max: 522.0, step: 0.1 },
      { id: "sensor_2", label: "S2: LPC Outlet Temp", min: 640.0, max: 646.0, step: 0.05 },
      { id: "sensor_3", label: "S3: HPC Outlet Temp", min: 1570.0, max: 1620.0, step: 0.5 },
      { id: "sensor_4", label: "S4: LPT Outlet Temp", min: 1380.0, max: 1445.0, step: 0.5 },
    ]
  },
  {
    title: "💨 Pressure Telemetry",
    sensors: [
      { id: "sensor_5", label: "S5: Fan Inlet Press", min: 14.0, max: 15.5, step: 0.05 },
      { id: "sensor_6", label: "S6: Bypass Duct Press", min: 21.5, max: 21.7, step: 0.01 },
      { id: "sensor_7", label: "S7: HPC Outlet Press", min: 548.0, max: 558.0, step: 0.2 },
      { id: "sensor_10", label: "S10: Engine Press Ratio", min: 1.2, max: 1.4, step: 0.01 },
      { id: "sensor_11", label: "S11: HPC Static Press", min: 46.5, max: 48.8, step: 0.05 },
    ]
  },
  {
    title: "🌀 Speed & Flow Telemetry",
    sensors: [
      { id: "sensor_8", label: "S8: Phys Fan Speed", min: 2387.5, max: 2388.8, step: 0.02 },
      { id: "sensor_9", label: "S9: Phys Core Speed", min: 9020.0, max: 9220.0, step: 1.0 },
      { id: "sensor_12", label: "S12: Fuel Flow Ratio", min: 518.0, max: 524.0, step: 0.1 },
      { id: "sensor_13", label: "S13: Corr Fan Speed", min: 2387.5, max: 2388.8, step: 0.02 },
      { id: "sensor_14", label: "S14: Corr Core Speed", min: 8090.0, max: 8220.0, step: 1.0 },
      { id: "sensor_15", label: "S15: Bypass Ratio", min: 8.3, max: 8.6, step: 0.005 },
    ]
  },
  {
    title: "🩸 Bleed Air & System Ratios",
    sensors: [
      { id: "sensor_16", label: "S16: Fuel-Air Ratio", min: 0.02, max: 0.04, step: 0.005 },
      { id: "sensor_17", label: "S17: Bleed Enthalpy", min: 385.0, max: 402.0, step: 1.0 },
      { id: "sensor_18", label: "S18: Dem Fan Speed", min: 2380.0, max: 2390.0, step: 1.0 },
      { id: "sensor_19", label: "S19: Dem Corr Fan Speed", min: 95.0, max: 105.0, step: 0.5 },
      { id: "sensor_20", label: "S20: HPT Coolant Bleed", min: 38.0, max: 39.8, step: 0.02 },
      { id: "sensor_21", label: "S21: LPT Coolant Bleed", min: 22.8, max: 23.8, step: 0.02 },
    ]
  }
];

export default function App() {
  const [telemetry, setTelemetry] = useState<TelemetryInput>(healthyPreset);
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [history, setHistory] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState("");

  // Throttled RUL fed to the 3D twin. Rapid telemetry drags would otherwise
  // push a new prediction (and a full 3D scene re-render) every few hundred ms.
  // The twin catches up to the latest value at most ~1.3x/second instead.
  const [twinRul, setTwinRul] = useState(0);
  const pendingTwinRulRef = useRef(0);
  const twinSyncedRef = useRef(false);

  useEffect(() => {
    if (!prediction) return;
    pendingTwinRulRef.current = prediction.rul_cycles;
    if (!twinSyncedRef.current) {
      twinSyncedRef.current = true;
      setTwinRul(prediction.rul_cycles);
    }
  }, [prediction]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTwinRul((prev) => (prev === pendingTwinRulRef.current ? prev : pendingTwinRulRef.current));
    }, 750);
    return () => window.clearInterval(id);
  }, []);
  
  // Sidebar Toggle State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // All categories set to false by default
  const [openCategories, setOpenCategories] = useState<Record<number, boolean>>({
    0: false, 1: false, 2: false, 3: false, 4: false 
  });

  const toggleCategory = (idx: number) => {
    setOpenCategories(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleSliderChange = (id: string, value: number) => {
    setTelemetry(prev => ({ ...prev, [id]: value }));
  };

  // --- AUTOMATIC DEBOUNCED PREDICTION ---
  // Track the newest request so a slow/old response can never overwrite a
  // newer prediction (prevents RUL flicker and 3D re-render churn).
  const requestIdRef = useRef(0);

  useEffect(() => {
    const fetchPrediction = async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError("");
      try {
        const result = await predictRUL(telemetry);
        if (requestId === requestIdRef.current) {
          setPrediction(result);
        }
      } catch (err) {
        if (requestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    const debounceTimer = setTimeout(() => {
      fetchPrediction();
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [telemetry]);

  const handleConfirm = () => {
    if (!prediction) return;

    // Add the confirmed prediction to the chart
    const newPoint: ChartDataPoint = {
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      rul: Math.round(prediction.rul_cycles)
    };
    setHistory(prev => [...prev.slice(-14), newPoint]);
  };

  const handleSavePdf = async () => {
    if (!prediction || pdfLoading) return;

    // Download the PDF report with all 24 sensor values
    setPdfLoading(true);
    setError("");
    try {
      await downloadReportPDF(telemetry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPdfLoading(false);
    }
  };

  const getStatusClass = (risk: string) => {
    switch (risk) {
      case "CRITICAL": return "critical";
      case "WARNING": return "warning";
      default: return "normal";
    }
  };

  return (
    <div className="dashboard-container">
      {/* Clean Header with Ethiopian Airlines and Boeing Logos */}
      <header className="dashboard-header" style={{ paddingBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          
          {/* Left Side: Ethiopian Airlines Logo */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <img 
              src="/et-logo.png" 
              alt="Ethiopian Airlines Logo" 
              style={{ height: "70px", objectFit: "contain" }} 
              onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} 
            />
          </div>

          {/* Center: Title */}
          <h1 className="dashboard-title" style={{ textAlign: "center", margin: 0, fontSize: "1.5rem" }}>
            ET / BOEING FLEET ENGINE PREDICTIVE MAINTENANCE
          </h1>

          {/* Right Side: Boeing Logo */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <img 
              src="/boeing-logo.png" 
              alt="Boeing Logo" 
              style={{ height: "70px", objectFit: "contain" }} 
              onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} 
            />
          </div>

        </div>

        {/* Subtitle line just above the header divider */}
        <p className="dashboard-subtitle" style={{
          textAlign: "center",
          color: "#9CA3AF",
          fontSize: "0.8rem",
          letterSpacing: "0.08em",
          margin: "0.75rem 0 0 0",
        }}>
          Developed by Boeing &amp; Ethiopian Airlines Program Alumni | Powered by NASA C-MAPSS Telemetry &amp; XGBoost AI
        </p>
      </header>

      {/* Main Layout Wrapper: Relative positioning allows the button to float over it.
          CSS grid: row 1 holds the telemetry controls beside the results/chart, and
          row 2 lets the 3D twin span the full width so it covers the space under
          the controls instead of leaving an empty gap. */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gridTemplateRows: "auto auto", columnGap: isSidebarOpen ? "2rem" : "0", rowGap: "1rem", transition: "column-gap 0.3s ease-in-out", position: "relative", alignItems: "stretch" }}>
        
        {/* NEW: Floating Chevron Toggle */}
        <div style={{ 
          position: "absolute",
          left: isSidebarOpen ? "325px" : "-20px", 
          top: "0px", 
          zIndex: 50, 
          transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1)" 
        }}>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            style={{ 
              background: "#1F2937", 
              border: "1px solid #374151", 
              color: "#9CA3AF", 
              cursor: "pointer", 
              padding: "0.5rem 0.25rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderTopRightRadius: "0.5rem",
              borderBottomRightRadius: "0.5rem",
              borderLeft: "none",
              boxShadow: "4px 0 6px -1px rgba(0, 0, 0, 0.3)",
              transition: "color 0.2s ease, background-color 0.2s ease"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = "#60A5FA";
              e.currentTarget.style.backgroundColor = "#374151";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = "#9CA3AF";
              e.currentTarget.style.backgroundColor = "#1F2937";
            }}
            title={isSidebarOpen ? "Close Telemetry Panel" : "Open Telemetry Panel"}
          >
            {isSidebarOpen ? <ChevronsLeft size={24} /> : <ChevronsRight size={24} />}
          </button>
        </div>

        {/* Retractable Telemetry Controls Container */}
        <div style={{ 
          gridColumn: "1",
          gridRow: "1",
          width: isSidebarOpen ? "380px" : "0px",
          opacity: isSidebarOpen ? 1 : 0,
          visibility: isSidebarOpen ? "visible" : "hidden",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          overflow: "hidden" 
        }}>
          <div className="control-panel" style={{ width: "80%", height: "100%", minHeight: "calc(100vh - 150px)", overflowY: "auto", margin: 0 }}>
            <div className="panel-header" style={{ position: "sticky", top: 0, backgroundColor: "#1f2937", zIndex: 10, paddingBottom: "10px", borderBottom: "1px solid #374151", display: "flex", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <SlidersHorizontal size={20} className="panel-icon" />
                <h2 className="panel-title">Telemetry Array</h2>
              </div>
              {loading && <span style={{ color: "#60a5fa", fontSize: "0.75rem", animation: "pulse 1.5s infinite" }}>Analyzing...</span>}
            </div>

            {sensorCategories.map((category, idx) => (
              <div key={idx} style={{ marginTop: "1rem" }}>
                <div 
                  onClick={() => toggleCategory(idx)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", borderBottom: "1px solid #374151", paddingBottom: "0.5rem", marginBottom: openCategories[idx] ? "1rem" : "0" }}
                >
                  <h3 style={{ color: "#9ca3af", fontSize: "0.8rem", textTransform: "uppercase", margin: 0 }}>
                    {category.title}
                  </h3>
                  <span style={{ color: "#9ca3af" }}>
                    {openCategories[idx] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </span>
                </div>
                
                {openCategories[idx] && category.sensors.map((sensor) => (
                  <div key={sensor.id} className="control-group" style={{ marginBottom: "1rem" }}>
                    <div className="slider-label-container">
                      <label className="slider-label" style={{ fontSize: "0.8rem" }}>{sensor.label}</label>
                      <span className="slider-value" style={{ fontSize: "0.85rem" }}>
                        {Number(telemetry[sensor.id as SensorKey]).toFixed(sensor.step < 0.1 ? 4 : 2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={sensor.min}
                      max={sensor.max}
                      step={sensor.step}
                      value={Number(telemetry[sensor.id as SensorKey])}
                      onChange={(e) => handleSliderChange(sensor.id, Number(e.target.value))}
                      className="telemetry-slider"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Output Results & Chart */}
        <div style={{ gridColumn: "2", gridRow: "1", display: "flex", flexDirection: "column", gap: "1rem", minWidth: 10 }}>
          {error && <p className="error-message" style={{ margin: 0 }}>{error}</p>}
          {prediction ? (
            <>
              <div className="results-grid">
                <div className="card">
                  <h2 className="card-title">Remaining Useful Life (RUL)</h2>
                  <div className="rul-metric">{Math.round(prediction.rul_cycles)}</div>
                  <p className="card-subtext">Flight Cycles Remaining</p>
                </div>
                <div className="card">
                  <h2 className="card-title">System Status</h2>
                  <div className={`status-badge ${getStatusClass(prediction.risk_level)}`}>
                    {prediction.risk_level === "CRITICAL" && <AlertTriangle size={28} />}
                    {prediction.risk_level === "WARNING" && <Activity size={28} />}
                    {prediction.risk_level === "NORMAL" && <CheckCircle size={28} />}
                    <span>{prediction.risk_level}</span>
                  </div>
                  <p className="recommendation-text">{prediction.recommendation}</p>
                </div>
              </div>

              <div className="card" style={{ flexGrow: 1 }}>
                <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <ChartIcon size={20} className="panel-icon" />
                    <h2 className="panel-title">RUL Degradation Timeline</h2>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <button
                      onClick={handleConfirm}
                      className="btn-save-report"
                      style={{ backgroundColor: "#059669" }}
                    >
                      <CheckCircle size={16} />
                      <span>Confirm</span>
                    </button>
                    <button
                      onClick={handleSavePdf}
                      disabled={pdfLoading}
                      className="btn-save-report"
                    >
                      {pdfLoading ? <Loader2 size={16} className="icon-spin" /> : <FileText size={16} />}
                      <span>{pdfLoading ? "Generating PDF..." : "Save PDF"}</span>
                    </button>
                  </div>
                </div>
                <div style={{ width: "100%", height: "350px", marginTop: "1rem" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                      <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} tickMargin={10} />
                      <YAxis stroke="#9ca3af" fontSize={12} domain={[0, 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff' }} itemStyle={{ color: '#60a5fa', fontWeight: 'bold' }} />
                      <ReferenceLine y={60} stroke="#fbbf24" strokeDasharray="3 3" />
                      <ReferenceLine y={20} stroke="#f87171" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="rul" stroke="#60a5fa" strokeWidth={3} dot={{ r: 5, fill: '#1f2937', stroke: '#60a5fa', strokeWidth: 2 }} activeDot={{ r: 8, fill: '#60a5fa' }} animationDuration={300} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : (
            <div className="card" style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
              <h2>Awaiting initial telemetry analysis...</h2>
            </div>
          )}
        </div>

        {/* 3D Digital Twin: spans both grid columns beneath the controls and results */}
        {prediction && (
          <div style={{ gridColumn: "1 / -1", gridRow: "2", height: "520px" }}>
            <EngineTwinPanel rulCycles={twinRul} />
          </div>
        )}
      </div>
    </div>
  );
}