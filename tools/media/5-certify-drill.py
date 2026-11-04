# -*- coding: utf-8 -*-
# 判据准入与出题批改。证书图放 README 的「变异体不再只靠人想」与「出题与批改」两节。
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join('docs', 'media')
BG, PANEL, BORDER = (11, 14, 20), (22, 27, 34), (48, 54, 61)
FG, MUTED = (230, 237, 243), (125, 133, 144)
GREEN, RED, AMBER, BLUE, PURPLE = (63, 185, 80), (248, 81, 73), (210, 153, 34), (88, 166, 255), (188, 140, 255)
F = 'C:/Windows/Fonts/'


def cn(s, b=True):
    return ImageFont.truetype(F + ('msyhbd.ttc' if b else 'msyh.ttc'), s, index=0)


def mono(s):
    return ImageFont.truetype(F + 'consola.ttf', s)


def canvas(w, h):
    im = Image.new('RGB', (w, h), BG)
    return im, ImageDraw.Draw(im)


def text(d, xy, s, f, fill=FG, a='la'):
    d.text(xy, s, font=f, fill=fill, anchor=a)


def box(d, bx, r=14, fill=PANEL, out=BORDER, w=2):
    d.rounded_rectangle(bx, radius=r, fill=fill, outline=out, width=w)


def arrow(d, x1, y1, x2, y2, c=MUTED, w=3, h=12):
    d.line([(x1, y1), (x2, y2)], fill=c, width=w)
    if y1 == y2:
        s = 1 if x2 > x1 else -1
        d.polygon([(x2, y2), (x2 - s * h, y2 - h // 2), (x2 - s * h, y2 + h // 2)], fill=c)
    else:
        s = 1 if y2 > y1 else -1
        d.polygon([(x2, y2), (x2 - h // 2, y2 - s * h), (x2 + h // 2, y2 - s * h)], fill=c)


def chip(d, x, y, w, label, color, size=17):
    """"抓到了"这种小标签，用色块代替符号——雅黑和 Consolas 都没有对勾字形。"""
    d.rounded_rectangle((x, y, x + w, y + 30), radius=6, fill=color)
    text(d, (x + w // 2, y + 15), label, cn(size), BG, 'mm')


# ---------------------------------------------------------------------------
# 图一：判据准入
# ---------------------------------------------------------------------------

def certify_stages(d, rows_shown=3, cards_lit=4):
    """把「形状 → 变异体 → 三档 → 建议」画出来。marks 控制前几个变异体是否已判完。"""
    # 第一行
    box(d, (56, 156, 420, 292))
    text(d, (78, 174), '① 观测到的形状', cn(21), MUTED)
    text(d, (78, 210), 'orders[0].totalAmount = 56', mono(16), BLUE)
    text(d, (78, 238), 'orders[0].items[0].count = 2', mono(16), BLUE)
    text(d, (78, 266), '不是猜的，是跑出来的', cn(15, False), MUTED)

    box(d, (462, 156, 878, 292))
    text(d, (484, 174), '② 每个位置造一个故障', cn(21), MUTED)
    text(d, (484, 210), '金额少一分 / 数量全变 1', cn(17, False), FG)
    text(d, (484, 238), '取餐号不加偏移 / 流水被吞', cn(17, False), FG)
    text(d, (484, 266), '28 个（另有 4 个恒等算子跳过）', cn(15, False), MUTED)

    box(d, (920, 156, 1444, 292))
    text(d, (942, 174), '③ 每个变异体各跑一遍全部断言', cn(21), MUTED)
    text(d, (942, 208), '在正确实现上成立，在坏实现上不成立', cn(16, False), FG)
    text(d, (942, 234), '→ 这条断言抓得住它', cn(16, False), GREEN)
    text(d, (942, 262), '两边都成立 → 这条断言是摆设', cn(16, False), RED)

    arrow(d, 420, 224, 462, 224)
    arrow(d, 878, 224, 920, 224)

    # 第二行：三档
    box(d, (56, 330, 900, 506))
    text(d, (78, 346), '④ 抓不住的分三档，不许混在一起算', cn(21), MUTED)
    rows = [
        ('m-money-off-by-cent', '抓到', GREEN, 'goal[4] 一条就够'),
        ('m-pickup-no-offset', '欠账', AMBER, '看得见，但偏移是各实现自己的约定'),
        ('m-breed-reverse-menu', '说不清', MUTED, '菜单没有约定顺序，没有模板该表达'),
    ]
    y = 388
    for i, (name, tag, color, why) in enumerate(rows):
        if i >= rows_shown:
            break
        text(d, (78, y + 6), name, mono(16), FG)
        chip(d, 368, y - 2, 74, tag, color, 15)
        text(d, (458, y + 6), why, cn(15, False), MUTED)
        y += 38

    box(d, (930, 330, 1444, 506), fill=(16, 30, 22), out=GREEN)
    text(d, (952, 346), '⑤ 它不只说哪有洞，还说补哪条', cn(20), GREEN)
    text(d, (952, 382), 'field_equals  totalAmount = 56', mono(16), FG)
    text(d, (952, 410), '已在这两个实现上当场验过：', cn(15, False), MUTED)
    text(d, (952, 436), '正确实现 true，坏实现 false', cn(15), GREEN)
    text(d, (952, 468), '这四行不是我想出来的，是跑出来的', cn(15, False), AMBER)

    # 第三行：数字演进
    stages = [('12 个变异体', '8 / 12', '66.7%', MUTED), ('+ 关系式', '11 / 12', '91.7%', BLUE),
              ('+ 形状断言', '14 / 16', '87.5%', PURPLE), ('+ breed 生成', '38 / 40', '95.0%', GREEN)]
    x = 56
    for i, (label, got, pct, color) in enumerate(stages):
        lit = i < cards_lit
        edge = color if lit else BORDER
        box(d, (x, 546, x + 320, 660), out=edge)
        text(d, (x + 20, 562), label, cn(17, False), MUTED)
        text(d, (x + 20, 596), got, cn(30) if lit else cn(30, False), color if lit else BORDER)
        text(d, (x + 200, 604), pct, mono(20), color if lit else BORDER)
        if x + 320 <= 1092:
            arrow(d, x + 320, 603, x + 352, 603)
        x += 352


def make_certify():
    W, H = 1500, 716
    im, d = canvas(W, H)
    text(d, (56, 30), '变异体是机器造的，判据也是机器判的', cn(38), FG)
    text(d, (56, 88), '一条断言如果连一个故障都抓不住，它就是摆设——这句话现在可以自动检查', cn(22, False), MUTED)
    certify_stages(d)
    im.save(os.path.join(OUT, 'certify.png'))
    print('certify.png')


# ---------------------------------------------------------------------------
# 图二：出题与批改
# ---------------------------------------------------------------------------

def make_drill():
    W, H = 1500, 640
    im, d = canvas(W, H)
    text(d, (56, 30), '出题与批改：标签由机制产出，不由模型', cn(38), FG)
    text(d, (56, 88), '不看提交说了什么，只把它的断言放到两个实现上各跑一遍', cn(22, False), MUTED)

    # 第一行：出题
    box(d, (56, 148, 460, 286))
    text(d, (78, 166), '① 出题', cn(21), MUTED)
    text(d, (78, 202), '一个变异体 + 一条案例', cn(17, False), FG)
    text(d, (78, 230), '滤掉三类：正确实现上也红的、', cn(16, False), MUTED)
    text(d, (78, 256), '已经抓住的、观测里看不见的', cn(16, False), MUTED)

    box(d, (500, 148, 940, 286), fill=(16, 28, 40), out=BLUE)
    text(d, (522, 166), '② 题面（交给 Agent）', cn(21), BLUE)
    text(d, (522, 200), 'symptom: 总额少一分', cn(16, False), FG)
    text(d, (522, 226), '现有断言：status = CANCELED', cn(15, False), FG)
    text(d, (522, 252), '不给 catch_hint，不给变异体 id', cn(16, False), AMBER)

    box(d, (980, 148, 1444, 286))
    text(d, (1002, 166), '③ 批改', cn(21), MUTED)
    text(d, (1002, 200), '正确实现上成立？坏实现上不成立？', cn(16, False), FG)
    text(d, (1002, 226), '两个都真 → 这条断言看不见这个故障', cn(15, False), RED)
    text(d, (1002, 258), '一题至少杀一个，才算解出', cn(16, False), GREEN)

    arrow(d, 460, 217, 500, 217)
    arrow(d, 940, 217, 980, 217)

    # 第二行：成绩
    text(d, (56, 330), '两份提交，同一批题', cn(21), MUTED)

    box(d, (56, 372, 726, 552), fill=(16, 30, 22), out=GREEN)
    text(d, (78, 390), '认真写的那份', cn(20), GREEN)
    text(d, (78, 428), '3 / 3 题解出', cn(28), FG)
    text(d, (78, 476), 'exit 0', mono(17), GREEN)
    text(d, (78, 508), '每条断言都只在坏实现上为假', cn(15, False), MUTED)

    box(d, (774, 372, 1444, 552), fill=(38, 24, 24), out=RED)
    text(d, (796, 390), '把案例原有断言抄一遍的那份', cn(20), RED)
    text(d, (796, 428), '0 / 3 题解出', cn(28), FG)
    text(d, (796, 476), 'exit 1', mono(17), RED)
    text(d, (796, 508), '它交的全是真断言，读代码看不出区别，只能跑', cn(15, False), MUTED)

    text(d, (56, 580), '所以标签不需要人来标：它由「这条断言杀不杀得掉那个故障」直接算出来', cn(18, False), AMBER)
    im.save(os.path.join(OUT, 'drill.png'))
    print('drill.png')


def make_certify_gif():
    """三档一行行填、底部数字一格格亮。动图比静图更容易看懂「它是逐个判的」。"""
    frames_dir = os.path.join('.tmp-certify-frames')
    os.makedirs(frames_dir, exist_ok=True)
    W, H = 1500, 716
    steps = []
    for r in range(0, 4):
        steps += [(r, 0)] * 3
    for c in range(1, 5):
        steps += [(3, c)] * 3
    idx = 0
    for rows_shown, cards_lit in steps:
        im, d = canvas(W, H)
        text(d, (56, 30), '变异体是机器造的，判据也是机器判的', cn(38), FG)
        text(d, (56, 88), '一条断言如果连一个故障都抓不住，它就是摆设——这句话现在可以自动检查', cn(22, False), MUTED)
        certify_stages(d, rows_shown=rows_shown, cards_lit=cards_lit)
        im.save(os.path.join(frames_dir, 'f%04d.png' % idx))
        idx += 1
    print('frames', idx)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    make_certify()
    make_drill()
    make_certify_gif()
