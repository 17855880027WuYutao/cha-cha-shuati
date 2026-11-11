#!/usr/bin/env python3
# 生成刷题 App 图标：深青底 + 米色答题卡 + 橙色对勾
import os, math
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'res')

TEAL = (44, 90, 95, 255)
TEAL_DARK = (34, 70, 74, 255)
CREAM = (251, 246, 234, 255)
CREAM_SOFT = (240, 231, 211, 255)
LINE = (92, 132, 134, 255)
ORANGE = (224, 163, 92, 255)
ORANGE_DEEP = (198, 134, 66, 255)

S = 1024


def rounded(draw, box, r, fill, outline=None, width=0):
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def make_card_layer(size=S):
    """答题卡本体（透明底），居中、略倾斜"""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    card_w, card_h = 450, 552
    cx, cy = size // 2, size // 2
    box = (cx - card_w // 2, cy - card_h // 2, cx + card_w // 2, cy + card_h // 2)
    rounded(d, box, 54, CREAM)
    # 卡片上的三条「题干」线
    x0 = box[0] + 52
    for i, w in enumerate([272, 300, 210]):
        y = box[1] + 96 + i * 62
        rounded(d, (x0, y, x0 + w, y + 22), 11, LINE)
    # 底部一块浅色「答案区」
    rounded(d, (x0, box[3] - 132, box[2] - 52, box[3] - 62), 22, CREAM_SOFT)
    # 选项小圆点 A/B/C/D
    for i in range(3):
        cx2 = x0 + 26 + i * 74
        cy2 = box[3] - 97
        d.ellipse((cx2 - 20, cy2 - 20, cx2 + 20, cy2 + 20), fill=(255, 255, 255, 255), outline=LINE, width=7)
    # 对勾圆：压在卡片右下角
    ccx, ccy, cr = box[2] - 40, box[3] - 40, 104
    d.ellipse((ccx - cr - 10, ccy - cr - 10, ccx + cr + 10, ccy + cr + 10), fill=CREAM)
    d.ellipse((ccx - cr, ccy - cr, ccx + cr, ccy + cr), fill=ORANGE_DEEP)
    d.ellipse((ccx - cr + 8, ccy - cr + 8, ccx + cr - 8, ccy + cr - 8), fill=ORANGE)
    # 对勾
    pts = [(ccx - 44, ccy + 2), (ccx - 12, ccy + 34), (ccx + 46, ccy - 34)]
    d.line(pts, fill=CREAM, width=30, joint='curve')
    for p in (pts[0], pts[-1]):
        d.ellipse((p[0] - 15, p[1] - 15, p[0] + 15, p[1] + 15), fill=CREAM)
    return layer.rotate(-8, resample=Image.BICUBIC, center=(size // 2, size // 2))


def make_background(size=S):
    bg = Image.new('RGBA', (size, size), TEAL)
    d = ImageDraw.Draw(bg)
    # 柔和的顶部高光
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-size * 0.25, -size * 0.55, size * 0.9, size * 0.45), fill=(255, 255, 255, 26))
    bg = Image.alpha_composite(bg, glow)
    return bg


def legacy_icon(size, round_icon=False):
    bg = make_background(S)
    if round_icon:
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, S, S), fill=255)
        bg.putalpha(mask)
    else:
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, S, S), radius=230, fill=255)
        bg.putalpha(mask)
    card = make_card_layer(S)
    card = card.resize((int(S * 0.98), int(S * 0.98)), Image.LANCZOS)
    bg.alpha_composite(card, (int(S * 0.01), int(S * 0.01)))
    return bg.resize((size, size), Image.LANCZOS)


def adaptive_foreground():
    """108dp 画布，内容压在中心 66% 安全区内"""
    fg = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
    card = make_card_layer(S).resize((int(432 * 0.66), int(432 * 0.66)), Image.LANCZOS)
    off = (432 - card.width) // 2
    fg.alpha_composite(card, (off, off))
    return fg


def main():
    sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for dpi, px in sizes.items():
        legacy_icon(px).save(os.path.join(RES, f'mipmap-{dpi}', 'ic_launcher.png'))
        legacy_icon(px, round_icon=True).save(os.path.join(RES, f'mipmap-{dpi}', 'ic_launcher_round.png'))
    adaptive_foreground().save(os.path.join(RES, 'drawable-xxxhdpi', 'ic_launcher_foreground.png'))
    # 预览
    prev = Image.new('RGBA', (900, 460), (247, 245, 240, 255))
    prev.alpha_composite(legacy_icon(320), (40, 70))
    rnd = legacy_icon(320, round_icon=True)
    prev.alpha_composite(rnd, (400, 70))
    small = legacy_icon(96)
    prev.alpha_composite(small, (790, 90))
    prev.save(os.path.join(os.path.dirname(__file__), 'preview.png'))
    print('icons written')


if __name__ == '__main__':
    main()
