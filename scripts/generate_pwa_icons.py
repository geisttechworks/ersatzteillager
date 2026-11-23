from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "icons"


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    scale = size / 512
    image = Image.new("RGB", (size, size), "#07111f")
    draw = ImageDraw.Draw(image)

    if not maskable:
        radius = round(112 * scale)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill="#07111f")

    def points(values: list[tuple[int, int]]) -> list[tuple[int, int]]:
        return [(round(x * scale), round(y * scale)) for x, y in values]

    warehouse = points([(94, 185), (256, 92), (418, 185), (418, 387), (384, 421), (128, 421), (94, 387)])
    draw.polygon(warehouse, fill="#0e7490")
    line = max(4, round(18 * scale))
    draw.line(points([(94, 185), (256, 92), (418, 185), (418, 387), (384, 421), (128, 421), (94, 387), (94, 185)]), fill="#67e8f9", width=line, joint="curve")
    grid_line = max(3, round(14 * scale))
    draw.line(points([(94, 185), (418, 185)]), fill="#a5f3fc", width=grid_line)
    draw.line(points([(256, 92), (256, 421)]), fill="#a5f3fc", width=grid_line)
    for left, top, right, bottom in [(145, 250, 219, 318), (293, 250, 367, 318), (145, 350, 219, 421), (293, 350, 367, 421)]:
        draw.rectangle((round(left * scale), round(top * scale), round(right * scale), round(bottom * scale)), fill="#07111f", outline="#a5f3fc", width=grid_line)
    return image


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    draw_icon(192).save(OUTPUT / "app-icon-192.png", optimize=True)
    draw_icon(512).save(OUTPUT / "app-icon-512.png", optimize=True)
    draw_icon(512, maskable=True).save(OUTPUT / "app-icon-maskable-512.png", optimize=True)
    draw_icon(180).save(OUTPUT / "apple-touch-icon.png", optimize=True)


if __name__ == "__main__":
    main()
