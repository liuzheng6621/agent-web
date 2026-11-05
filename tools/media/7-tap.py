# 生成 docs/media/tap.png：录一段真流量，长出适配器、孪生与案例。
# 配色与 1-hero-verdicts.py 一致。中文行用雅黑，纯 ASCII 行用 Consolas。
from PIL import Image, ImageDraw, ImageFont

BG = (11, 14, 20)
PANEL = (22, 27, 34)
BORDER = (48, 54, 61)
TEXT = (230, 237, 243)
DIM = (125, 133, 144)
GREEN = (63, 185, 80)
RED = (248, 81, 73)
AMBER = (210, 153, 34)
BLUE = (88, 166, 255)
PURPLE = (188, 140, 255)

CN = "C:/Windows/Fonts/msyh.ttc"
CNB = "C:/Windows/Fonts/msyhbd.ttc"
MONO = "C:/Windows/Fonts/consola.ttf"


def cn(size, bold=False):
    return ImageFont.truetype(CNB if bold else CN, size)


def mono(size):
    return ImageFont.truetype(MONO, size)


W, H = 1500, 700
im = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(im)

d.text((60, 34), "录一段真流量，长出适配器、孪生与案例", font=cn(40, True), fill=TEXT)
d.text((60, 92), "不猜业务规则，只问「应用刚才答应过什么」。—— tap 是反向代理，录的是状态不是动作。",
       font=cn(22), fill=DIM)


def panel(x, y, w, h, title, color, fill=PANEL):
    d.rounded_rectangle([x, y, x + w, y + h], 10, fill=fill, outline=BORDER, width=2)
    d.rounded_rectangle([x, y, x + w, y + 44], 8, fill=(28, 34, 42))
    d.text((x + 16, y + 9), title, font=cn(21, True), fill=color)


Y = 148
panel(60, Y, 400, 180, "① 你的操作", BLUE)
d.text((80, Y + 60), "登录 · 建三条任务", font=cn(19), fill=TEXT)
d.text((80, Y + 92), "完成一条 · 看列表", font=cn(19), fill=TEXT)
d.text((80, Y + 132), "走 ", font=cn(17), fill=DIM)
d.text((112, Y + 132), "127.0.0.1:8197", font=mono(17), fill=DIM)

d.line([(468, Y + 90), (508, Y + 90)], fill=BORDER, width=3)
d.polygon([(508, Y + 84), (520, Y + 90), (508, Y + 96)], fill=BORDER)

panel(520, Y, 400, 180, "② tap 反向代理", PURPLE)
d.text((540, Y + 60), "traffic.jsonl", font=mono(19), fill=TEXT)
d.text((540, Y + 92), "口令 → password#1", font=cn(17), fill=GREEN)
d.text((540, Y + 122), "token → bearer#2", font=cn(17), fill=GREEN)
d.text((540, Y + 150), "真打目标，脱敏后落盘", font=cn(16), fill=DIM)

d.line([(928, Y + 90), (968, Y + 90)], fill=BORDER, width=3)
d.polygon([(968, Y + 84), (980, Y + 90), (968, Y + 96)], fill=BORDER)

panel(980, Y, 460, 180, "③ learn 长出四样", BLUE)
d.text((1000, Y + 56), "adapter.yml", font=mono(18), fill=TEXT)
d.text((1240, Y + 60), "声明式，不写代码", font=cn(16), fill=DIM)
d.text((1000, Y + 86), "twin.json", font=mono(18), fill=TEXT)
d.text((1240, Y + 90), "回放孪生 = 白送的第二个实现", font=cn(16), fill=DIM)
d.text((1000, Y + 116), "cases/*.json", font=mono(18), fill=TEXT)
d.text((1240, Y + 120), "案例草稿，默认待确认", font=cn(16), fill=DIM)
d.text((1000, Y + 146), "unclassified.jsonl", font=mono(18), fill=AMBER)
d.text((1240, Y + 150), "认不出的形状，一条不藏", font=cn(16), fill=DIM)

Y2 = 368
panel(60, Y2, 460, 150, "④ 同一批案例打两个实现", GREEN)
d.text((80, Y2 + 60), "跨适配器判决一致率 100.0%", font=cn(19), fill=TEXT)
d.text((80, Y2 + 92), "视图契约：2 个集合逐字相同", font=cn(18), fill=DIM)
d.text((80, Y2 + 120), "真实系统  vs  孪生", font=cn(17), fill=BLUE)

panel(560, Y2, 420, 150, "⑤ 把应用改坏，不重录", RED)
d.text((580, Y2 + 58), "assertion_false", font=mono(18), fill=RED)
d.text((580, Y2 + 90), "tasks 变化 2（期望 3）", font=cn(18), fill=TEXT)
d.text((580, Y2 + 120), "红在行为上，不是红在文本上", font=cn(16), fill=DIM)

panel(1020, Y2, 420, 150, "⑥ 十分钟，零代码", AMBER)
d.text((1040, Y2 + 58), "陌生 CRUD 应用", font=cn(19), fill=TEXT)
d.text((1040, Y2 + 90), "→ 第一条 pass", font=cn(19), fill=GREEN)
d.text((1040, Y2 + 120), "剩下的只有业务规则要人给", font=cn(16), fill=DIM)

d.text((60, 560), "三条硬规矩", font=cn(24, True), fill=TEXT)
d.text((60, 604), "录状态不录动作 · 口令与 token 不落盘（换稳定伪名）· 产物一律 inferred、案例默认草稿", font=cn(19), fill=DIM)
d.text((60, 640), "三件不做：不猜业务规则 · 不重放没录到的路径（unknown，不是 pass）· 只支持单角色链路", font=cn(19), fill=DIM)

im.save("docs/media/tap.png")
print("docs/media/tap.png", im.size)
