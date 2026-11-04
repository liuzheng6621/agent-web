# -*- coding: utf-8 -*-
"""生成本仓库 README 用的图片与动图。零网络依赖，只用 Pillow + ffmpeg。"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join('docs', 'media')
os.makedirs(OUT, exist_ok=True)

BG      = (11, 14, 20)
PANEL   = (22, 27, 34)
BORDER  = (48, 54, 61)
FG      = (230, 237, 243)
MUTED   = (125, 133, 144)
GREEN   = (63, 185, 80)
RED     = (248, 81, 73)
AMBER   = (210, 153, 34)
BLUE    = (88, 166, 255)
PURPLE  = (188, 140, 255)

F = 'C:/Windows/Fonts/'
def cn(size, bold=True):
    return ImageFont.truetype(F + ('msyhbd.ttc' if bold else 'msyh.ttc'), size, index=0)
def mono(size):
    return ImageFont.truetype(F + 'consola.ttf', size)

def canvas(w, h, bg=BG):
    im = Image.new('RGB', (w, h), bg)
    return im, ImageDraw.Draw(im)

def text(d, xy, s, font, fill=FG, anchor='la'):
    d.text(xy, s, font=font, fill=fill, anchor=anchor)

def round_box(d, box, radius=14, fill=PANEL, outline=BORDER, width=2):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def arrow(d, x1, y1, x2, y2, color=MUTED, width=3, head=12):
    d.line([(x1, y1), (x2, y2)], fill=color, width=width)
    if abs(x2 - x1) >= abs(y2 - y1):
        s = 1 if x2 > x1 else -1
        d.polygon([(x2, y2), (x2 - s * head, y2 - head // 2), (x2 - s * head, y2 + head // 2)], fill=color)
    else:
        s = 1 if y2 > y1 else -1
        d.polygon([(x2, y2), (x2 - head // 2, y2 - s * head), (x2 + head // 2, y2 - s * head)], fill=color)

def badge(d, x, y, label, color):
    f = mono(20)
    w = d.textlength(label, font=f)
    d.rounded_rectangle((x, y, x + w + 24, y + 34), radius=17, outline=color, width=2)
    text(d, (x + 12, y + 6), label, f, color)

# ---------------------------------------------------------------- hero
def hero():
    W, H = 1600, 620
    im, d = canvas(W, H)
    # 背景网格
    for gx in range(0, W, 40):
        d.line([(gx, 0), (gx, H)], fill=(16, 20, 27), width=1)
    for gy in range(0, H, 40):
        d.line([(0, gy), (W, gy)], fill=(16, 20, 27), width=1)

    text(d, (84, 74), 'agent-web', cn(74), FG)
    text(d, (86, 168), '给 Agent 写机器可判的集成测试', cn(32, False), MUTED)

    # 一行卖点
    y = 236
    d.rounded_rectangle((84, y, 84 + 8, y + 92), radius=4, fill=BLUE)
    text(d, (112, y + 2), '同一份案例，跑两个实现，判决必须一致。', cn(30), FG)
    text(d, (112, y + 48), '不一致的地方，要么实现有洞，要么断言在空转。', cn(30), MUTED)

    # 三态
    xs = 84
    for label, color, note in [
        ('pass', GREEN, '断言全成立'),
        ('fail', RED, '有断言不成立'),
        ('unknown', AMBER, '缺观测，不算通过'),
    ]:
        round_box(d, (xs, 400, xs + 300, 520), 16)
        d.rounded_rectangle((xs, 400, xs + 300, 406), radius=3, fill=color)
        text(d, (xs + 24, 424), label, mono(34), color)
        text(d, (xs + 24, 474), note, cn(21, False), MUTED)
        xs += 320

    text(d, (1196, 404), '可判定率', cn(22, False), MUTED)
    text(d, (1196, 436), '(pass+fail) / N', mono(30), FG)
    text(d, (1196, 480), 'unknown 不进回收', cn(19, False), MUTED)

    im.save(os.path.join(OUT, 'hero.png'), optimize=True)
    print('hero.png')

# ---------------------------------------------------------------- 三值判决
def verdicts():
    W, H = 1500, 500
    im, d = canvas(W, H)
    text(d, (70, 44), '判决只有三种，没有第四种', cn(40), FG)
    text(d, (70, 108), 'unknown 留在分母里，所以「测了多少」和「判了多少」是两件事', cn(24, False), MUTED)

    cols = [
        ('pass',  GREEN, '所有断言为真', '没有发现反例', '可以发布'),
        ('fail',  RED,   '至少一条为假', '找到反例', '报告首条失败原因'),
        ('unknown', AMBER, '缺观测、缺能力', '说不清', '不折算成 pass'),
    ]
    x = 70
    for name, color, a, b, c in cols:
        round_box(d, (x, 190, x + 440, 430), 18)
        d.rounded_rectangle((x, 190, x + 440, 198), radius=4, fill=color)
        text(d, (x + 30, 224), name, mono(40), color)
        text(d, (x + 30, 300), a, cn(23), FG)
        text(d, (x + 30, 344), b, cn(23, False), MUTED)
        text(d, (x + 30, 386), c, cn(23, False), MUTED)
        x += 470
    im.save(os.path.join(OUT, 'verdicts.png'), optimize=True)
    print('verdicts.png')

if __name__ == '__main__':
    hero(); verdicts()
