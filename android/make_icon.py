#!/usr/bin/env python3
"""ランチャーアイコン（マークシート風）を res/mipmap-*/ic_launcher.png に書き出す。"""
import pathlib
from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).parent
BLUE = (36, 67, 160)
INK = (24, 36, 47)
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
S = 768  # 大きく描いてから縮小する


def draw():
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([24, 24, S - 24, S - 24], radius=170, fill=BLUE)
    # 答案用紙
    d.rounded_rectangle([150, 130, S - 150, S - 130], radius=40, fill=(255, 255, 255))
    # 3行×4列のマーク欄。各行1つだけ塗りつぶす
    filled = [1, 3, 0]
    w, h = 72, 46
    xs = [205 + i * 100 for i in range(4)]
    for r, y in enumerate([230, 370, 510]):
        for c, x in enumerate(xs):
            box = [x, y, x + w, y + h]
            if c == filled[r]:
                d.ellipse(box, fill=INK)
            else:
                d.ellipse(box, outline=BLUE, width=12)
    return im


def main():
    im = draw()
    for name, px in SIZES.items():
        out = HERE / "res" / f"mipmap-{name}" / "ic_launcher.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        im.resize((px, px), Image.LANCZOS).save(out)
    im.resize((512, 512), Image.LANCZOS).save(HERE / "icon-512.png")


if __name__ == "__main__":
    main()
