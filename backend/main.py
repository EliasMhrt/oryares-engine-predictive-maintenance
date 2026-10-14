import os
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Literal

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from fpdf import FPDF
from pydantic import BaseModel, Field


def resource_path(relative: str) -> Path:
    """Resolve a bundled resource in development and inside a PyInstaller
    bundle. PyInstaller unpacks data files under ``sys._MEIPASS`` (both
    ``--onedir`` and ``--onefile``), whereas in normal development the files
    sit next to this module."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative


BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = resource_path("xgboost_rul_model.pkl")
FRONTEND_DIST = resource_path("frontend_dist")

FEATURE_NAMES = [
    "setting_1", "setting_2", "setting_3",
    "sensor_1", "sensor_2", "sensor_3", "sensor_4", "sensor_5",
    "sensor_6", "sensor_7", "sensor_8", "sensor_9", "sensor_10",
    "sensor_11", "sensor_12", "sensor_13", "sensor_14", "sensor_15",
    "sensor_16", "sensor_17", "sensor_18", "sensor_19", "sensor_20",
    "sensor_21",
]

SENSOR_LABELS: dict[str, str] = {
    "setting_1": "Setting 1 (Altitude/Mach)",
    "setting_2": "Setting 2 (Throttle)",
    "setting_3": "Setting 3 (TRA)",
    "sensor_1": "Fan Inlet Temperature",
    "sensor_2": "LPC Outlet Temperature",
    "sensor_3": "HPC Outlet Temperature",
    "sensor_4": "LPT Outlet Temperature",
    "sensor_5": "Fan Inlet Pressure",
    "sensor_6": "Bypass Duct Pressure",
    "sensor_7": "HPC Outlet Pressure",
    "sensor_8": "Physical Fan Speed",
    "sensor_9": "Physical Core Speed",
    "sensor_10": "Engine Pressure Ratio",
    "sensor_11": "HPC Static Pressure",
    "sensor_12": "Fuel Flow Ratio",
    "sensor_13": "Corrected Fan Speed",
    "sensor_14": "Corrected Core Speed",
    "sensor_15": "Bypass Ratio",
    "sensor_16": "Fuel-Air Ratio",
    "sensor_17": "Bleed Enthalpy",
    "sensor_18": "Demanded Fan Speed",
    "sensor_19": "Demanded Corrected Fan Speed",
    "sensor_20": "HPT Coolant Bleed",
    "sensor_21": "LPT Coolant Bleed",
}

app = FastAPI(
    title="Oryares Aircraft Engine RUL API",
    version="1.0.0",
)

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
  )

try:
    model = joblib.load(MODEL_PATH)
except Exception as exc:
    model = None
    MODEL_LOAD_ERROR = str(exc)
else:
    MODEL_LOAD_ERROR = None


class TelemetryInput(BaseModel):
    setting_1: float = Field(..., description="Operational setting 1")
    setting_2: float = Field(..., description="Operational setting 2")
    setting_3: float = Field(..., description="Operational setting 3")
    sensor_1: float
    sensor_2: float
    sensor_3: float
    sensor_4: float
    sensor_5: float
    sensor_6: float
    sensor_7: float
    sensor_8: float
    sensor_9: float
    sensor_10: float
    sensor_11: float
    sensor_12: float
    sensor_13: float
    sensor_14: float
    sensor_15: float
    sensor_16: float
    sensor_17: float
    sensor_18: float
    sensor_19: float
    sensor_20: float
    sensor_21: float
    engine_id: str = "ENG-001"
    cycle: int = Field(default=1, ge=1)


class PredictionResponse(BaseModel):
    engine_id: str
    cycle: int
    rul_cycles: float
    health_percentage: float
    risk_level: Literal["NORMAL", "WARNING", "CRITICAL"]
    recommendation: str
    model_features: int
    generated_at: str


def classify_risk(rul: float) -> tuple[str, str]:
    if rul > 60:
        return (
            "NORMAL",
            "Engine healthy. Continue normal operations and monitor telemetry.",
        )
    if rul >= 20:
        return (
            "WARNING",
            "Schedule a thermal and pressure inspection at the next maintenance window.",
        )
    return (
        "CRITICAL",
        "High failure risk. Escalate to qualified maintenance personnel immediately.",
    )


def make_prediction(payload: TelemetryInput) -> PredictionResponse:
    if model is None:
        raise HTTPException(
            status_code=503,
            detail=f"Model could not be loaded: {MODEL_LOAD_ERROR}",
        )

    # model_dump excludes the metadata fields not used during training.
    values = payload.model_dump()
    feature_row = {name: values[name] for name in FEATURE_NAMES}
    input_df = pd.DataFrame([feature_row], columns=FEATURE_NAMES)

    try:
        predicted_rul = float(model.predict(input_df)[0])
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Prediction failed. Confirm the feature order and model version: {exc}",
        ) from exc

    predicted_rul = max(0.0, predicted_rul)
    health_percentage = float(np.clip((predicted_rul / 150.0) * 100.0, 0.0, 100.0))
    risk_level, recommendation = classify_risk(predicted_rul)

    return PredictionResponse(
        engine_id=payload.engine_id,
        cycle=payload.cycle,
        rul_cycles=round(predicted_rul, 2),
        health_percentage=round(health_percentage, 1),
        risk_level=risk_level,
        recommendation=recommendation,
        model_features=len(FEATURE_NAMES),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/api/health")
def health_check():
    return {
        "status": "online" if model is not None else "model_error",
        "model_loaded": model is not None,
        "model_path": str(MODEL_PATH),
        "error_details": MODEL_LOAD_ERROR, 
        "features_expected": len(FEATURE_NAMES),
    }


@app.post("/api/predict", response_model=PredictionResponse)
def predict(payload: TelemetryInput):
    return make_prediction(payload)


def build_pdf_report(payload: TelemetryInput, result: PredictionResponse) -> bytes:
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()
    pdf.set_margin(12)

    pdf.set_xy(12, 14)
    pdf.set_font("helvetica", "B", 15)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 8, "Oryares Engine RUL Report", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("helvetica", "", 9)
    pdf.cell(0, 5, "ET / Boeing Fleet Engine Predictive Maintenance", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("helvetica", "B", 9)
    pdf.cell(0, 6, f"Engine ID: {result.engine_id}   |   Cycle: {result.cycle}", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(2)
    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(0.6)
    pdf.line(12, pdf.get_y(), 198, pdf.get_y())
    pdf.ln(6)

    # Engine health summary
    pdf.set_font("helvetica", "B", 12)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 8, "1. Engine Health Summary", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    summary_rows = [
        ("Remaining Useful Life (RUL)", f"{result.rul_cycles:,.2f} cycles"),
        ("Health Percentage", f"{result.health_percentage} %"),
        ("Risk Level", result.risk_level),
        ("Recommendation", result.recommendation),
    ]
    with pdf.table(
        col_widths=(70, 116),
        borders_layout="SINGLE_TOP_LINE",
        line_height=7,
        text_align="LEFT",

    ) as table:
        for label, value in summary_rows:
            row = table.row()
            row.cell(label)
            row.cell(value)

    pdf.ln(8)

    # Telemetry snapshot: all 24 channels
    pdf.set_font("helvetica", "B", 12)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 8, "2. Telemetry Snapshot - All 24 Channels", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    values = payload.model_dump()
    rows = [
        (str(idx), SENSOR_LABELS.get(name, name), f"{values[name]:.6g}")
        for idx, name in enumerate(FEATURE_NAMES, start=1)
    ]
    with pdf.table(
        col_widths=(12, 110, 64),
        borders_layout="SINGLE_TOP_LINE",
        line_height=6.5,
        text_align="LEFT",

    ) as table:
        header = table.row()
        header.cell("#")
        header.cell("Channel")
        header.cell("Value")
        for index, channel, value in rows:
            row = table.row()
            row.cell(index)
            row.cell(channel)
            row.cell(value)

    pdf.ln(6)
    pdf.set_font("helvetica", "I", 8)
    pdf.set_text_color(0, 0, 0)
    pdf.multi_cell(
        0,
        5,
        text=f"Generated by the XGBoost RUL model ({result.model_features} features) "
        f"on {result.generated_at}.",
    )

    return bytes(pdf.output())


@app.post("/api/predict/pdf", response_class=Response)
def predict_report_pdf(payload: TelemetryInput):
    result = make_prediction(payload)
    pdf_bytes = build_pdf_report(payload, result)
    filename = f"engine_report_{payload.engine_id}_{payload.cycle}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# Serve the built React frontend (single-page app) from the same origin as the
# API. This mount MUST be registered after every /api route so those routes
# take precedence over the catch-all static handler. In desktop builds the
# bundle ships the compiled frontend under ``frontend_dist``; in development
# this directory is absent and the mount is skipped (Vite dev server + proxy
# is used instead).
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="spa")