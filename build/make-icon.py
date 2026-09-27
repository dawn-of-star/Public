#!/usr/bin/env python3
"""
make-icon.py —— 生成 build/icon.ico（应用图标）

为什么自己画：
  项目里一张图片资源都没有，不指定图标的话 exe 会顶着 Electron 默认的
  原子图标。electron-builder 要求 .ico 至少包含 256x256 一张。

为什么不用 Pillow：
  这个项目的一贯原则是「零依赖」。PNG 和 ICO 都是很简单的容器格式，
  用标准库 zlib + struct 手写编码器就够了，不需要装任何东西。

依赖：Python 3.8+ 标准库（zlib, struct, math）

用法：
  python build/make-icon.py
"""

import math
import os
import struct
import zlib

# ═══════════════════════════════════════════════════════════
# 设计参数（配色跟 css/amoled.css 的绿/青主题走）
# ═══════════════════════════════════════════════════════════

BG_CENTER = (14, 22, 26)     # 圆角方块中心（近黑，带一点青）
BG_EDGE = (4, 6, 8)          # 圆角方块边缘（AMOLED 纯黑方向）
BG_RADIUS = 0.42             # 圆角半径（归一化：1.0 = 半宽）

CORE = (230, 255, 240)       # 核心高光
MID = (72, 226, 130)         # 中段绿
OUTER = (24, 176, 168)       # 外圈青绿

ORB_RADIUS = 0.80            # 光球半径（归一化到半宽 = 1.0）
ORB_SOFT = 0.30              # 边缘柔化宽度
CORE_RADIUS = 0.20           # 核心高光半径

RING_RADIUS = 0.87           # 光环中心半径
RING_HALF = 0.045            # 光环半宽
RING_COLOR = (96, 222, 255)  # 光环颜色（青）

SS = 3                       # 每个像素的超采样倍数（3x3 = 9 个样本，抗锯齿）

SIZES = [256, 128, 64, 48, 32, 16]


def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def lerp(a, b, t):
    return a + (b - a) * t


def mix_rgb(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


def over(src, dst):
    """标准 alpha 合成：src over dst。两者都是 (r,g,b,a)，a 在 0..1。"""
    sa = src[3]
    da = dst[3]
    out_a = sa + da * (1.0 - sa)
    if out_a <= 0.0:
        return (0.0, 0.0, 0.0, 0.0)
    out_rgb = tuple(
        (src[i] * sa + dst[i] * da * (1.0 - sa)) / out_a for i in range(3)
    )
    return (out_rgb[0], out_rgb[1], out_rgb[2], out_a)


def rounded_square_inside(px, py):
    """归一化坐标 px,py ∈ [-1,1]，判断是否落在圆角方块内。"""
    r = BG_RADIUS
    qx = abs(px) - (1.0 - r)
    qy = abs(py) - (1.0 - r)
    qx = max(qx, 0.0)
    qy = max(qy, 0.0)
    return math.hypot(qx, qy) <= r


def sample(px, py):
    """
    取归一化坐标上的颜色，返回 (r,g,b,a)，a ∈ 0..1。
    画顺序：圆角方块底 → 光球 → 光环。
    """
    out = (0.0, 0.0, 0.0, 0.0)

    # ── 1. 圆角方块底 ──
    if rounded_square_inside(px, py):
        d = clamp(math.hypot(px, py) / 1.25)
        rgb = mix_rgb(BG_CENTER, BG_EDGE, d)
        out = (rgb[0], rgb[1], rgb[2], 1.0)

    # ── 2. 光球 ──
    r = math.hypot(px, py)
    if r < ORB_RADIUS:
        # 颜色沿半径做三段渐变：核心 → 绿 → 青绿
        t = r / ORB_RADIUS
        if t < 0.45:
            rgb = mix_rgb(CORE, MID, t / 0.45)
        else:
            rgb = mix_rgb(MID, OUTER, (t - 0.45) / 0.55)

        # 核心高光：中心附近额外提亮
        if r < CORE_RADIUS:
            k = 1.0 - (r / CORE_RADIUS)
            rgb = mix_rgb(rgb, CORE, clamp(k * 1.25))

        # 透明度：中间实心，边缘柔化
        a = clamp((ORB_RADIUS - r) / ORB_SOFT) ** 0.85
        out = over((rgb[0], rgb[1], rgb[2], a), out)

    # ── 3. 光环 ──
    ring_d = abs(r - RING_RADIUS)
    if ring_d < RING_HALF:
        a = clamp(1.0 - ring_d / RING_HALF) ** 0.8 * 0.95
        out = over((RING_COLOR[0], RING_COLOR[1], RING_COLOR[2], a), out)

    return out


def render(size):
    """渲染一张 size x size 的 RGBA 像素数据（bytes）。"""
    half = size / 2.0
    step = 1.0 / SS
    offset0 = (1.0 - SS) / 2.0 * step  # 让采样点对称分布在像素内
    rows = bytearray()

    for y in range(size):
        rows.append(0)  # PNG 每行的 filter type = 0 (None)
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(SS):
                py = ((y + 0.5) + offset0 + sy * step - half) / half
                for sx in range(SS):
                    px = ((x + 0.5) + offset0 + sx * step - half) / half
                    s = sample(px, py)
                    # 预乘累加，避免边缘出现黑边
                    acc[0] += s[0] * s[3]
                    acc[1] += s[1] * s[3]
                    acc[2] += s[2] * s[3]
                    acc[3] += s[3]
            n = SS * SS
            a = acc[3] / n
            if a > 1e-6:
                rgb = (acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3])
            else:
                rgb = (0.0, 0.0, 0.0)
            rows.append(int(clamp(rgb[0] / 255.0) * 255.0 + 0.5))
            rows.append(int(clamp(rgb[1] / 255.0) * 255.0 + 0.5))
            rows.append(int(clamp(rgb[2] / 255.0) * 255.0 + 0.5))
            rows.append(int(clamp(a) * 255.0 + 0.5))

    return bytes(rows)


def png_encode(size, raw):
    """把原始扫描线数据编码成 PNG。"""
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8bit RGBA
    idat = zlib.compress(raw, 9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )


def ico_write(path, images):
    """
    images: [(size, png_bytes), ...]
    ICO 允许直接内嵌 PNG（Vista+ 都支持），所以不需要 BMP/DIB 那套。
    """
    n = len(images)
    header = struct.pack("<HHH", 0, 1, n)
    entries = b""
    offset = 6 + 16 * n
    body = b""

    for size, data in images:
        dim = 0 if size >= 256 else size  # 256 在 ICO 里用 0 表示
        entries += struct.pack(
            "<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset
        )
        offset += len(data)
        body += data

    with open(path, "wb") as f:
        f.write(header + entries + body)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "icon.ico")

    images = []
    for size in SIZES:
        raw = render(size)
        images.append((size, png_encode(size, raw)))
        print(f"  {size}x{size} ok")

    ico_write(out, images)
    print(f"\n写入 {out}（{os.path.getsize(out)} 字节，含 {len(images)} 种尺寸）")


if __name__ == "__main__":
    main()
