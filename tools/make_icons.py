"""XRadio simgelerini üretir (16, 32, 48, 128 px). Gereksinim: Pillow.

Marka işareti: sinyal turuncusu kare üzerinde koyu "yayın" sembolü (ortada nokta, iki yanda dalgalar).
Uygulama içindeki logo ile aynıdır; gradyan ya da gölge yoktur, küçük boyutta da okunur.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

ORANGE = (255, 90, 31, 255)
INK = (27, 13, 5, 255)
S = 1024  # yüksek çözünürlükte çizip küçült (kenar yumuşatma)


def draw(size):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = 0 if size >= 48 else 0
    d.rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad], radius=int(S * 0.22), fill=ORANGE)

    cx = cy = S // 2
    # Küçük boyutlarda daha kalın çizgi ve tek dalga: 16 px'te bile seçilsin
    if size <= 16:
        dot, waves, width = 120, [(300, 110)], 0
    elif size <= 32:
        dot, waves, width = 100, [(250, 92), (390, 92)], 0
    else:
        dot, waves, width = 88, [(230, 78), (370, 78)], 0
    d.ellipse([cx - dot, cy - dot, cx + dot, cy + dot], fill=INK)
    for r, w in waves:
        box = [cx - r, cy - r, cx + r, cy + r]
        d.arc(box, start=-48, end=48, fill=INK, width=w)
        d.arc(box, start=132, end=228, fill=INK, width=w)
    return img.resize((size, size), Image.LANCZOS)


def make():
    for size in (16, 32, 48, 128):
        draw(size).save(OUT / f"icon{size}.png")
    print("ikonlar:", OUT)


if __name__ == "__main__":
    make()
