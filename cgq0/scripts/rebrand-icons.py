#!/usr/bin/env python3
"""fork 图标换底色：把官方黑底白 Z 图标的近黑背景换成深蓝渐变，白 Z 与抗锯齿保留。

用途：fork 构建产物（ZCode.fork）与官方 ZCode.app 在 Finder/Dock 一眼区分。
在 lin 机器运行（python3 + Pillow），产物直接覆盖 packages/desktop/build/ 下的图标资产。

用法：
    python3 cgq0/scripts/rebrand-icons.py           # 预览模式，输出到 cgq0/tmp/icon-preview/
    python3 cgq0/scripts/rebrand-icons.py --apply   # 覆盖 packages/desktop/build/ 正式资产

换色算法（逐像素，只动 RGB 不动 alpha）：
    - 背景：max(r,g,b) <= 0x40 且通道极差 <= 14（近黑低饱和）→ 映射为按 y 插值的蓝色，
      并按 原亮度/背景基准亮度 缩放，保留原图的纵向渐变、暗角与噪点质感；
    - 前景：min(r,g,b) >= 0xC0（白 Z）→ 原样保留；
    - 中间调（抗锯齿/阴影）：按亮度比例在 新蓝底 与 原色 之间线性混合。
上游若更换官方图标，重跑本脚本即可重新生成 fork 变体。
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
BUILD_DIR = REPO_ROOT / "packages" / "desktop" / "build"

# 蓝底渐变（顶部 → 底部），取 Tailwind blue-700 / blue-900 一带，保证白 Z 对比度。
BLUE_TOP = (29, 78, 216)  # #1D4ED8
BLUE_BOTTOM = (30, 58, 138)  # #1E3A8A

BG_LUM_MAX = 0x40  # 背景判定：亮度上限
BG_SAT_MAX = 14  # 背景判定：通道极差上限（低饱和）
BG_REF_LUM = 0x19  # 背景基准亮度（原图渐变中值），用于保留明暗层次
FG_LUM_MIN = 0xC0  # 前景判定：三通道下限（白 Z）

# (源文件, 用途说明)；icons/ 整目录单独处理。
SINGLE_PNGS = [
    ("icon.png", "mac 圆角主图标（icns 源）"),
    ("icon_windows.png", "Windows/Linux 方形主图标（与 icons/1024 同源）"),
    ("icon_installer.png", "安装器图标源图"),
]
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def recolor(image: Image.Image) -> Image.Image:
    """把近黑低饱和背景换成蓝色渐变，白前景与 alpha 原样保留。"""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    px = rgba.load()
    for y in range(height):
        t = y / max(height - 1, 1)
        blue_y = tuple(
            BLUE_TOP[c] + (BLUE_BOTTOM[c] - BLUE_TOP[c]) * t for c in range(3)
        )
        for x in range(width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hi, lo = max(r, g, b), min(r, g, b)
            if hi <= BG_LUM_MAX and hi - lo <= BG_SAT_MAX:
                scale = min(hi / BG_REF_LUM, 1.3)
                px[x, y] = (
                    round(blue_y[0] * scale),
                    round(blue_y[1] * scale),
                    round(blue_y[2] * scale),
                    a,
                )
            elif lo >= FG_LUM_MIN:
                continue
            else:
                # 抗锯齿/阴影：按前景占比混合，边缘自然过渡到新蓝底。
                f = min(max((hi - BG_LUM_MAX) / (FG_LUM_MIN - BG_LUM_MAX), 0.0), 1.0)
                px[x, y] = (
                    round(blue_y[0] * (1 - f) + r * f),
                    round(blue_y[1] * (1 - f) + g * f),
                    round(blue_y[2] * (1 - f) + b * f),
                    a,
                )
    return rgba


def save_png(image: Image.Image, out_dir: Path, rel: str) -> None:
    target = out_dir / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target)


def main() -> int:
    apply_mode = "--apply" in sys.argv[1:]
    out_dir = BUILD_DIR if apply_mode else REPO_ROOT / "cgq0" / "tmp" / "icon-preview"
    out_dir.mkdir(parents=True, exist_ok=True)

    recolored: dict[str, Image.Image] = {}
    sources = list(SINGLE_PNGS) + [
        (f"icons/{p.name}", "linux hicolor 尺寸集") for p in sorted((BUILD_DIR / "icons").glob("*.png"))
    ]
    for rel, note in sources:
        image = recolor(Image.open(BUILD_DIR / rel))
        recolored[rel] = image
        save_png(image, out_dir, rel)
        print(f"recolor {rel:24s} ({note})")

    # icns / ico 从换色后的 1024 源图重新生成（Pillow 内部完成多尺寸缩放）。
    icon = recolored["icon.png"]
    icon.save(out_dir / "icon.icns", format="ICNS")
    icon.resize((256, 256), Image.LANCZOS).save(out_dir / "icon.ico", format="ICO", sizes=ICO_SIZES)
    installer = recolored["icon_installer.png"]
    installer.save(out_dir / "icon_installer.icns", format="ICNS")
    installer.resize((256, 256), Image.LANCZOS).save(
        out_dir / "icon_installer.ico", format="ICO", sizes=ICO_SIZES
    )
    print(f"regen icon.icns / icon.ico / icon_installer.icns / icon_installer.ico")

    mode = "APPLY → packages/desktop/build" if apply_mode else "preview → cgq0/tmp/icon-preview"
    print(f"done ({mode})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
