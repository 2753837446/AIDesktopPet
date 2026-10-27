from __future__ import annotations

import argparse
import shutil
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat


VIEWS = {
    "front": {
        "box": (810, 28, 1025, 932),
        "cleanup": (
            (0, 0, 52, 20),
            (0, 0, 20, 932),
            (0, 390, 46, 535),
            (0, 625, 30, 715),
        ),
    },
    "side": {
        "box": (1038, 28, 1192, 932),
        "cleanup": ((0, 0, 40, 24),),
    },
    "back": {
        "box": (1202, 28, 1394, 932),
        "cleanup": ((0, 0, 40, 24),),
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="将角色设定图裁切为透明桌宠多视图资产。"
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--tolerance", type=int, default=22)
    return parser.parse_args()


def background_rgb(image: Image.Image) -> tuple[int, int, int]:
    width, height = image.size
    samples: list[tuple[int, int, int]] = []
    border = 4
    for x in range(0, width, 2):
        samples.append(image.getpixel((x, 0)))
        samples.append(image.getpixel((x, height - 1)))
    for y in range(0, height, 2):
        samples.append(image.getpixel((0, y)))
        samples.append(image.getpixel((width - 1, y)))
    red = sorted(pixel[0] for pixel in samples)[len(samples) // 2]
    green = sorted(pixel[1] for pixel in samples)[len(samples) // 2]
    blue = sorted(pixel[2] for pixel in samples)[len(samples) // 2]
    return red, green, blue


def is_background(
    pixel: tuple[int, int, int],
    background: tuple[int, int, int],
    tolerance: int,
) -> bool:
    red, green, blue = pixel
    background_red, background_green, background_blue = background
    return (
        max(
            abs(red - background_red),
            abs(green - background_green),
            abs(blue - background_blue),
        )
        <= tolerance
        and min(pixel) >= 205
    )


def remove_connected_background(
    image: Image.Image,
    tolerance: int,
) -> Image.Image:
    rgb = image.convert("RGB")
    width, height = rgb.size
    background = background_rgb(rgb)
    pixels = rgb.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index]:
            return
        visited[index] = 1
        if is_background(pixels[x, y], background, tolerance):
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

    alpha = alpha.filter(ImageFilter.GaussianBlur(0.55))
    result = rgb.convert("RGBA")
    result.putalpha(alpha)
    return result


def trim_and_pad(image: Image.Image, padding: int = 18) -> Image.Image:
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError("背景移除后没有剩余角色像素")
    left, top, right, bottom = bounds
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(image.width, right + padding)
    bottom = min(image.height, bottom + padding)
    return image.crop((left, top, right, bottom))


def clear_regions(
    image: Image.Image,
    regions: tuple[tuple[int, int, int, int], ...],
) -> None:
    alpha = image.getchannel("A")
    pixels = alpha.load()
    for left, top, right, bottom in regions:
        for y in range(max(0, top), min(image.height, bottom)):
            for x in range(max(0, left), min(image.width, right)):
                pixels[x, y] = 0
    image.putalpha(alpha)


def main() -> None:
    args = parse_args()
    source = Image.open(args.source).convert("RGB")
    args.output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.source, args.output / "source-profile.jpg")

    for name, config in VIEWS.items():
        cropped = source.crop(config["box"])
        transparent = remove_connected_background(cropped, args.tolerance)
        clear_regions(transparent, config["cleanup"])
        result = trim_and_pad(transparent)
        if result.height > 1_200:
            ratio = 1_200 / result.height
            result = result.resize(
                (max(1, round(result.width * ratio)), 1_200),
                Image.Resampling.LANCZOS,
            )
        target = args.output / f"{name}.png"
        result.save(target, optimize=True)
        alpha = result.getchannel("A")
        stat = ImageStat.Stat(alpha)
        opaque = sum(1 for value in alpha.get_flattened_data() if value > 0)
        print(
            f"{name}: {result.width}x{result.height}, "
            f"alpha_mean={stat.mean[0]:.2f}, opaque_pixels={opaque}, "
            f"bytes={target.stat().st_size}"
        )


if __name__ == "__main__":
    main()
