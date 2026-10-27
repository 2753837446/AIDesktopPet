from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="清理动漫化角色背景并生成透明桌宠资产。")
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    return parser.parse_args()


def is_checker_background(pixel: tuple[int, int, int]) -> bool:
    red, green, blue = pixel
    return max(pixel) - min(pixel) <= 10 and (red + green + blue) / 3 >= 180


def remove_checker_background(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index]:
            return
        visited[index] = 1
        if is_checker_background(pixels[x, y]):
            queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    alpha = Image.new("L", (width, height), 255)
    alpha_pixels = alpha.load()
    for y in range(height):
        for x in range(width):
            if visited[y * width + x]:
                alpha_pixels[x, y] = 0
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.45))
    result = rgb.convert("RGBA")
    result.putalpha(alpha)
    return result


def trim_and_pad(image: Image.Image, padding: int = 18) -> Image.Image:
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("背景清理后没有剩余角色像素")
    left, top, right, bottom = bounds
    return image.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(image.width, right + padding),
            min(image.height, bottom + padding),
        )
    )


def add_ai_mark(image: Image.Image) -> None:
    draw = ImageDraw.Draw(image, "RGBA")
    font_path = Path(r"C:\Windows\Fonts\msyh.ttc")
    font = (
        ImageFont.truetype(str(font_path), max(10, round(image.height * 0.009)))
        if font_path.exists()
        else ImageFont.load_default()
    )
    text = "AI生成"
    box = draw.textbbox((0, 0), text, font=font)
    text_width = box[2] - box[0]
    text_height = box[3] - box[1]
    margin = max(5, round(image.width * 0.012))
    x = image.width - text_width - margin
    y = image.height - text_height - margin
    draw.rounded_rectangle(
        (x - 4, y - 2, x + text_width + 4, y + text_height + 3),
        radius=4,
        fill=(255, 255, 255, 145),
    )
    draw.text((x, y), text, font=font, fill=(55, 64, 75, 190))


def main() -> None:
    args = parse_args()
    source = Image.open(args.source)
    transparent = trim_and_pad(remove_checker_background(source))
    if transparent.height > 1_200:
        ratio = 1_200 / transparent.height
        transparent = transparent.resize(
            (max(1, round(transparent.width * ratio)), 1_200),
            Image.Resampling.LANCZOS,
        )
    add_ai_mark(transparent)
    args.target.parent.mkdir(parents=True, exist_ok=True)
    transparent.save(args.target, optimize=True)
    alpha = transparent.getchannel("A")
    opaque = sum(1 for value in alpha.get_flattened_data() if value > 0)
    print(
        f"{args.target.name}: {transparent.width}x{transparent.height}, "
        f"opaque_pixels={opaque}, bytes={args.target.stat().st_size}"
    )


if __name__ == "__main__":
    main()
