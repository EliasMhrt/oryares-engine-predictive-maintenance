"""Desktop entrypoint for the bundled backend.

The Electron shell launches this executable with ``--port <n>`` and then polls
``GET /api/health`` until the server is ready. The app object is imported
directly (rather than by string) so PyInstaller bundles everything statically
and uvicorn never needs its import-string machinery.
"""

import argparse
import multiprocessing

import uvicorn

from main import app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Oryares Engine backend")
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Interface to bind (loopback only by default).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="TCP port to listen on.",
    )
    parser.add_argument(
        "--log-level",
        default="info",
        help="uvicorn log level.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        reload=False,
        workers=1,
    )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
