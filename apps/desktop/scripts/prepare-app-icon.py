from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="从动漫角色生成 Windows 应用图标。")
    parser.add_argument("source", type=Path)
    parser.add_argument("png", type=Path)
    parser.add_argument("ico", type=Path)
    return parser.parse_args()


def main() -> None:
    options = args()
    source = Image.open(options.source).convert("RGBA")
    face = source.crop((30, 120, 275, 520))
    canvas = Image.new("RGBA", (512, 512), (238, 246, 252, 255))
    draw = ImageDraw.Draw(canvas)
    for y in range(512):
        ratio = y / 511
        color = (
            round(242 - ratio * 28),
            round(249 - ratio * 42),
            round(255 - ratio * 60),
            255,
        )
        draw.line((0, y, 511, y), fill=color)
    draw.ellipse((26, 26, 486, 486), fill=(225, 240, 250, 255))
    face.thumbnail((430, 430), Image.Resampling.LANCZOS)
    canvas.alpha_composite(
        face,
        ((512 - face.width) // 2, (512 - face.height) // 2),
    )
    options.png.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(options.png, optimize=True)
    canvas.save(
        options.ico,
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"icon: {options.png} / {options.ico}")


if __name__ == "__main__":
    main()
