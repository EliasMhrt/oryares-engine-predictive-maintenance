"""Generate a square, multi-size Windows .ico for the desktop app.

The source logo (assets/oryares.png) is a wide, fully opaque banner. To avoid a
visible colour seam, the square canvas is filled by *replicating the edge rows*
of the source rather than guessing a background colour. Only the shorter axis is
padded, so the full logo is preserved (no cropping).

Run with the backend venv (which already ships Pillow):
    backend\\.venv\\Scripts\\python desktop\\make_icon.py
"""

from pathlib import Path

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE = PROJECT_ROOT / "assets" / "oryares.png"
OUT_ICO = Path(__file__).resolve().parent / "build" / "icon.ico"
OUT_PNG = Path(__file__).resolve().parent / "build" / "icon.png"

ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def pad_to_square_with_edge_replication(image: Image.Image) -> Image.Image:
    width, height = image.size
    side = max(width, height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))

    offset_x = (side - width) // 2
    offset_y = (side - height) // 2
    canvas.paste(image, (offset_x, offset_y))

    # Extend the top/bottom bands by repeating the first/last image row so the
    # added area blends seamlessly into the logo's own background.
    if side > height:
        first_row = image.crop((0, 0, width, 1)).resize((width, offset_y))
        last_row = image.crop((0, height - 1, width, height)).resize(
            (width, side - height - offset_y)
        )
        canvas.paste(first_row, (offset_x, 0))
        canvas.paste(last_row, (offset_x, offset_y + height))

    # Same idea for the left/right bands (only relevant for portrait sources).
    if side > width:
        first_col = image.crop((0, 0, 1, height)).resize((offset_x, height))
        last_col = image.crop((width - 1, 0, width, height)).resize(
            (side - width - offset_x, height)
        )
        canvas.paste(first_col, (0, offset_y))
        canvas.paste(last_col, (offset_x + width, offset_y))

    return canvas


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Source icon not found: {SOURCE}")

    OUT_ICO.parent.mkdir(parents=True, exist_ok=True)

    logo = Image.open(SOURCE).convert("RGBA")
    square = pad_to_square_with_edge_replication(logo)

    master = square.resize((1024, 1024), Image.LANCZOS)
    master.save(OUT_PNG)
    master.save(OUT_ICO, format="ICO", sizes=ICO_SIZES)

    print(f"Wrote {OUT_ICO} ({', '.join(f'{w}x{h}' for w, h in ICO_SIZES)})")
    print(f"Wrote {OUT_PNG}")


if __name__ == "__main__":
    main()
