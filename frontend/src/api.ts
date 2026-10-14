export type TelemetryInput = {
  engine_id: string;
  cycle: number;
  setting_1: number;
  setting_2: number;
  setting_3: number;
  sensor_1: number;
  sensor_2: number;
  sensor_3: number;
  sensor_4: number;
  sensor_5: number;
  sensor_6: number;
  sensor_7: number;
  sensor_8: number;
  sensor_9: number;
  sensor_10: number;
  sensor_11: number;
  sensor_12: number;
  sensor_13: number;
  sensor_14: number;
  sensor_15: number;
  sensor_16: number;
  sensor_17: number;
  sensor_18: number;
  sensor_19: number;
  sensor_20: number;
  sensor_21: number;
};

export type PredictionResponse = {
  engine_id: string;
  cycle: number;
  rul_cycles: number;
  health_percentage: number;
  risk_level: "NORMAL" | "WARNING" | "CRITICAL";
  recommendation: string;
  model_features: number;
  generated_at: string;
};

const API_URL = import.meta.env.VITE_API_URL || "";
const REQUEST_TIMEOUT_MS = 60000;

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail ?? `Request to ${path} failed (${response.status})`);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function predictRUL(input: TelemetryInput): Promise<PredictionResponse> {
  return post<PredictionResponse>("/api/predict", input);
}

export async function downloadReportPDF(input: TelemetryInput): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/predict/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail ?? "PDF report generation failed");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `engine_report_${input.engine_id}_${input.cycle}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
