"""XRadio simgelerini üretir (16, 32, 48, 128 px). Gereksinim: Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
S = 512  # yüksek çözünürlükte çizip küçült


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    grad = Image.new("RGBA", (S, S))
    gp = grad.load()
    c1, c2 = (139, 92, 246), (236, 72, 153)
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            gp[x, y] = lerp(c1, c2, t) + (255,)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=118, fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    # Radyo dalgaları (sağ üst)
    cx, cy = 360, 150
    for i, r in enumerate((54, 98, 142)):
        d.arc([cx - r, cy - r, cx + r, cy + r], start=-80, end=10, fill=(255, 255, 255, 235 - i * 55), width=26)
    d.ellipse([cx - 22, cy - 22, cx + 22, cy + 22], fill=(255, 255, 255, 255))
    # Kalın "X"
    w = 74
    pts = [(120, 170), (330, 400)]
    d.line(pts, fill=(255, 255, 255, 255), width=w)
    d.line([(330, 170), (120, 400)], fill=(255, 255, 255, 255), width=w)
    # Hafif gölge parlaklığı
    glow = img.filter(ImageFilter.GaussianBlur(2))
    img = Image.alpha_composite(glow, img)
    for size in (16, 32, 48, 128):
        im = img.resize((size, size), Image.LANCZOS)
        im.save(OUT / f"icon{size}.png")
    print("ikonlar:", OUT)


if __name__ == "__main__":
    make()
