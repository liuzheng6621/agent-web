# -*- coding: utf-8 -*-
"""Promo video frames: 7 static scenes, stitched by ffmpeg.

Style matches 1..7 (dark #0B0E14, mono for ASCII, 雅黑 for CJK).
Run: python tools/media/8-promo.py && ffmpeg ... (see bottom of file)
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join('docs', 'media')
FR = '.tmp-promo'
W, H = 1280, 720
BG, PANEL, BORDER = (11, 14, 20), (22, 27, 34), (48, 54, 61)
FG, MUTED = (230, 237, 243), (125, 133, 144)
GREEN, RED, AMBER, BLUE, PURPLE = (63, 185, 80), (248, 81, 73), (210, 153, 34), (88, 166, 255), (188, 140, 255)
F = 'C:/Windows/Fonts/'
_c = {}


def cn(s, b=True):
    k = ('cn', s, b)
    if k not in _c:
        _c[k] = ImageFont.truetype(F + ('msyhbd.ttc' if b else 'msyh.ttc'), s, index=0)
    return _c[k]


def mono(s):
    k = ('mo', s)
    if k not in _c:
        _c[k] = ImageFont.truetype(F + 'consola.ttf', s)
    return _c[k]


def canvas():
    im = Image.new('RGB', (W, H), BG)
    return im, ImageDraw.Draw(im)


def runs(s):
    out, cur, flag = [], '', None
    for ch in s:
        a = ord(ch) < 0x2000
        if flag is None or a == flag:
            cur += ch
            flag = a
        else:
            out.append((cur, flag))
            cur = ch
            flag = a
    if cur:
        out.append((cur, flag))
    return out


def mixed(d, x, ytop, s, size, color):
    fbm = mono(size)
    fbc = cn(size, False)
    yb = ytop + int(size * 0.78)
    for run, is_ascii in runs(s):
        f = fbm if is_ascii else fbc
        d.text((x, yb), run, font=f, fill=color, anchor='ls')
        x += d.textlength(run, font=f)
    return x


def box(d, rect, fill=PANEL, out=BORDER, w=2):
    d.rounded_rectangle(rect, radius=10, fill=fill, outline=out, width=w)


def arrow(d, x1, y, x2):
    d.line((x1, y, x2 - 8, y), fill=BORDER, width=2)
    d.polygon([(x2, y), (x2 - 9, y - 5), (x2 - 9, y + 5)], fill=BORDER)


def scene(fn):
    im, d = canvas()
    fn(im, d)
    return im


def s1_title(im, d):
    d.text((80, 250), '给 Agent 写的集成测试', font=cn(58), fill=FG)
    d.rectangle((80, 330, 300, 336), fill=PURPLE)
    d.text((80, 362), '一份案例 · 两个实现 · 判决必须一致', font=cn(30), fill=MUTED)
    d.text((80, 410), '不一致的地方，要么实现有洞，要么断言在空转', font=cn(26), fill=MUTED)
    chips = ['26 条命令', '12 种断言', '22 个变异体', '零依赖']
    x = 80
    for t in chips:
        w = d.textlength(t, font=cn(20, False)) + 34
        box(d, (x, 500, x + w, 546), fill=PANEL)
        d.text((x + 17, 512), t, font=cn(20, False), fill=FG)
        x += w + 14
    mixed(d, 80, 596, 'node >= 20   ·   MIT   ·   gitee.com/liu-everything_impossble/agent-web', 18, MUTED)


def s2_verdicts(im, d):
    d.text((80, 62), '判决只有三种', font=cn(40), fill=FG)
    d.text((80, 118), '第三种最要紧：它留在分母里，不会变成通过', font=cn(24, False), fill=MUTED)
    cards = [('PASS', GREEN, '每条断言都成立', 'coffee/happy-path  ok'),
             ('FAIL', RED, '指出哪一条、期望什么、实际什么', '订单 1001 当前 MAKING，不允许直接变成 PICKED'),
             ('UNKN', AMBER, '缺观测 / 环境故障 / 草稿未确认', '留在分母里，不算通过')]
    y = 176
    for tag, color, desc, sample in cards:
        box(d, (80, y, 1200, y + 148), out=color)
        d.text((108, y + 26), tag, font=mono(30), fill=color)
        d.text((250, y + 22), desc, font=cn(24), fill=FG)
        mixed(d, 250, y + 72, sample, 19, MUTED)
        y += 164
    d.text((80, 672), '可判定率 = (pass + fail) / N   ——   只会因为观测被修好而上升', font=cn(21, False), fill=MUTED)


def s3_discover(im, d):
    d.text((80, 62), '输入一个网址，先看清它有什么', font=cn(40), fill=FG)
    d.text((80, 118), '最便宜的起步：不用先写适配器', font=cn(24, False), fill=MUTED)
    box(d, (80, 190, 330, 330))
    d.text((104, 208), '① 网址', font=cn(21), fill=BLUE)
    mixed(d, 104, 246, 'http://127.0.0.1:8199', 19, FG)
    d.text((104, 292), './quickstart.sh 后面那个参数', font=cn(17, False), fill=MUTED)
    box(d, (370, 190, 730, 330))
    d.text((394, 208), '② 探测', font=cn(21), fill=BLUE)
    d.text((394, 246), '根路径通不通、返回什么', font=cn(19, False), fill=FG)
    d.text((394, 280), '再试 8 个常见 OpenAPI 位置', font=cn(19, False), fill=FG)
    d.text((394, 312), '找不到就停手，不猜路径', font=cn(19, False), fill=AMBER)
    box(d, (770, 190, 1200, 330))
    d.text((794, 208), '③ 能力清单', font=cn(21), fill=BLUE)
    mixed(d, 794, 246, 'menu.list    GET  /api/menu', 19, FG)
    mixed(d, 794, 282, 'orders.create POST /api/orders', 19, FG)
    d.text((794, 312), '只读 3 · 写 3', font=cn(19, False), fill=MUTED)
    arrow(d, 330, 260, 370)
    arrow(d, 730, 260, 770)
    box(d, (80, 380, 1200, 520), fill=(16, 28, 40), out=BLUE)
    d.text((104, 398), '④ 生成两份东西（都标 inferred，不是事实）', font=cn(22), fill=FG)
    mixed(d, 104, 444, 'adapter.mjs   只读适配器，写能力一律 unsupported', 19, FG)
    mixed(d, 104, 480, 'cases/*.json  案例草稿，断言只有 unchanged：读不该改变任何东西', 19, FG)
    d.text((80, 560), '它不猜三件事：写操作该保证什么、带参数接口的路径、没有 OpenAPI 时的路由', font=cn(21, False), fill=MUTED)
    d.text((80, 600), '猜出来的 404 会变成假失败，而假失败会让工具失去信任', font=cn(21, False), fill=AMBER)


def s4_tap(im, d):
    d.text((80, 62), '录五分钟流量，长出一个适配器', font=cn(40), fill=FG)
    d.text((80, 118), '写适配器是最贵的一步。这一节把它压到十分钟', font=cn(24, False), fill=MUTED)
    box(d, (80, 180, 560, 300))
    d.text((104, 198), '① 正常点几下', font=cn(21), fill=PURPLE)
    d.text((104, 236), '登录 · 建三条任务 · 完成一条 · 看列表', font=cn(19, False), fill=FG)
    mixed(d, 104, 272, 'tap --port=8197 --out=.tmp-tap/rec', 18, MUTED)
    box(d, (600, 180, 1200, 300))
    d.text((624, 198), '② learn 一次，四样东西一起掉出来', font=cn(21), fill=PURPLE)
    mixed(d, 624, 236, 'adapter.yml    声明式，不写代码', 18, FG)
    mixed(d, 624, 268, 'twin.json      回放孪生 = 白送的第二个实现', 18, FG)
    box(d, (80, 320, 1200, 420), fill=(16, 30, 22), out=GREEN)
    mixed(d, 104, 336, 'cases/*.json   案例草稿，只有观测算得出来的断言', 18, FG)
    mixed(d, 104, 370, 'unclassified.jsonl  认不出的形状，一条不藏', 18, FG)
    d.text((80, 448), '孪生让 compare 免费：同一批案例，打真实系统也打孪生', font=cn(21, False), fill=MUTED)
    box(d, (80, 500, 1200, 620), fill=(38, 24, 24), out=RED)
    d.text((104, 518), '③ 把应用改坏，不重录', font=cn(21), fill=RED)
    mixed(d, 104, 558, 'FAIL  todo/recorded   assertion_false', 21, RED)
    d.text((104, 590), '目标未达成：tasks 变化 2（期望 3）  ← 抓的是行为，不是录制的文本', font=cn(19, False), fill=FG)
    d.text((80, 652), '三条硬规矩：录状态不录动作 · 口令不落盘 · 产物一律 inferred、案例默认草稿', font=cn(20, False), fill=MUTED)


def s5_certify(im, d):
    d.text((80, 62), '断言不是描述，是武器', font=cn(40), fill=FG)
    d.text((80, 118), '杀不掉任何变异体的断言，不许入库', font=cn(24, False), fill=MUTED)
    d.text((80, 190), '9 条案例 × 22 个变异体', font=cn(24, False), fill=MUTED)
    d.text((80, 236), '17 / 19', font=cn(76), fill=GREEN)
    d.text((430, 268), '89.5%', font=mono(34), fill=GREEN)
    d.text((430, 316), '抓到 / 适用', font=cn(19, False), fill=MUTED)
    chips = [('欠账 2', AMBER), ('说不清 0', MUTED), ('不适用 3', MUTED)]
    x = 660
    for t, c in chips:
        w = d.textlength(t, font=cn(20, False)) + 34
        box(d, (x, 250, x + w, 298), out=c)
        d.text((x + 17, 262), t, font=cn(20, False), fill=c)
        x += w + 14
    box(d, (80, 380, 1200, 516), fill=(16, 30, 22), out=GREEN)
    d.text((104, 398), '它不只说哪有洞，还说补哪条', font=cn(22), fill=GREEN)
    mixed(d, 104, 440, 'field_equals   totalAmount = 56', 20, FG)
    d.text((104, 476), '每条建议都当场验过：正确实现 true，坏实现 false', font=cn(19, False), fill=FG)
    d.text((80, 532), '分三档，不许混算：欠账（看得见差异，只差断言）· 说不清（连差异都造不出）· 不适用', font=cn(20, False), fill=MUTED)
    d.text((80, 580), '等价变异体问题四十年没解决——这里只要求投稿人给出可区分性证明', font=cn(20, False), fill=MUTED)
    d.text((80, 640), '真实后端实测：state 层变异体免重放，3 条案例 44.5s → 15.1s（2.95×）', font=cn(20, False), fill=BLUE)


def s6_drill(im, d):
    d.text((80, 62), '出题与批改：标签由机制产出', font=cn(40), fill=FG)
    d.text((80, 118), '一个变异体 + 一条案例 = 一道题；题面不给 catch_hint，不给变异体 id', font=cn(24, False), fill=MUTED)
    box(d, (80, 190, 620, 380), fill=(16, 30, 22), out=GREEN)
    d.text((104, 208), '认真写的那份', font=cn(22), fill=GREEN)
    d.text((104, 250), '11 / 11 题解出', font=cn(40), fill=FG)
    d.text((104, 316), 'exit 0', font=mono(20), fill=GREEN)
    d.text((104, 348), '每条断言都只在坏实现上为假', font=cn(18, False), fill=MUTED)
    box(d, (660, 190, 1200, 380), fill=(38, 24, 24), out=RED)
    d.text((684, 208), '把案例原有断言抄一遍的那份', font=cn(22), fill=RED)
    d.text((684, 250), '0 / 11 题解出', font=cn(40), fill=FG)
    d.text((684, 316), 'exit 1', font=mono(20), fill=RED)
    d.text((684, 348), '它交的全是真断言，读代码看不出区别', font=cn(18, False), fill=MUTED)
    d.text((80, 420), '同一批 22 道题。默认「必须答满」，--allow-missed 是「答了就必须对」', font=cn(21, False), fill=MUTED)
    d.text((80, 462), '防偷懒和防瞎写是两件事，合成一条就会互相放水', font=cn(21, False), fill=AMBER)
    d.text((80, 530), '这就是「标签不需要人来标」的意思：', font=cn(24), fill=FG)
    d.text((80, 572), '标签由「这条断言杀不杀得掉那个故障」直接算出来', font=cn(24), fill=GREEN)


def s7_end(im, d):
    d.text((80, 200), 'agent-web', font=mono(58), fill=FG)
    d.rectangle((80, 286, 300, 292), fill=PURPLE)
    d.text((80, 318), '一份案例，跑两个实现，判决必须一致', font=cn(30), fill=MUTED)
    lines = ['26 条命令 · 12 种断言 · 22 个变异体 · 14 条事故档案',
             '在咖啡点单、动物救助、复式记账三个域上验过',
             '没有 LLM judge：判不了就记 unknown，留在分母里']
    y = 396
    for t in lines:
        d.text((80, y), t, font=cn(23, False), fill=FG)
        y += 44
    mixed(d, 80, 556, 'gitee.com/liu-everything_impossble/agent-web', 22, BLUE)
    mixed(d, 80, 596, 'github.com/liuzheng6621/agent-web', 22, BLUE)
    d.text((80, 648), 'MIT · 零依赖 · node >= 20', font=cn(19, False), fill=MUTED)


SCENES = [
    ('s1', s1_title, 5),
    ('s2', s2_verdicts, 7),
    ('s3', s3_discover, 8),
    ('s4', s4_tap, 10),
    ('s5', s5_certify, 8),
    ('s6', s6_drill, 8),
    ('s7', s7_end, 6),
]


def build():
    os.makedirs(FR, exist_ok=True)
    lines = []
    for name, fn, sec in SCENES:
        path = os.path.join(FR, name + '.png')
        scene(fn).save(path, optimize=True)
        lines.append("file '%s.png'" % name)
        lines.append('duration %d' % sec)
        print(path, sec, 's')
    lines.append("file '%s.png'" % SCENES[-1][0])   # concat needs the last file twice
    open(os.path.join(FR, 'list.txt'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('total', sum(s for _, _, s in SCENES), 's')


if __name__ == '__main__':
    build()
