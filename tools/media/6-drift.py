# 生成 docs/media/drift.png：跑两遍，不一样的地方不算故障。
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

CN = "C:/Windows/Fonts/msyh.ttc"
CNB = "C:/Windows/Fonts/msyhbd.ttc"
MONO = "C:/Windows/Fonts/consola.ttf"

def cn(size, bold=False):
    return ImageFont.truetype(CNB if bold else CN, size)

def mono(size):
    return ImageFont.truetype(MONO, size)

W, H = 1500, 660
im = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(im)

d.text((60, 36), "跑两遍，不一样的地方不算故障", font=cn(40, True), fill=TEXT)
d.text((60, 92), "同一条案例跑两遍，自增 id、时间、取餐号本来就会变。这些差异叫漂移，不叫见证。",
       font=cn(22), fill=DIM)

def panel(x, y, w, h, title, color):
    d.rounded_rectangle([x, y, x + w, y + h], 10, fill=PANEL, outline=BORDER, width=2)
    d.rounded_rectangle([x, y, x + w, y + 44], 8, fill=(28, 34, 42))
    d.text((x + 16, y + 9), title, font=cn(21, True), fill=color)

def row(x, y, text, color=TEXT, font=None, fill=None):
    d.text((x, y), text, font=font or mono(19), fill=fill or color)

Y = 150
PH = 210
panel(60, Y, 420, PH, "① 第一遍", BLUE)
row(80, Y + 62, "orders[0].id         = 196")
row(80, Y + 94, "orders[0].pickupNo   = 1196")
row(80, Y + 126, "orders[0].totalAmount = 56", GREEN)
row(80, Y + 166, "（identity 复位：新账号）", font=cn(17), fill=DIM)

panel(540, Y, 420, PH, "② 第二遍", BLUE)
row(560, Y + 62, "orders[0].id         = 210", RED)
row(560, Y + 94, "orders[0].pickupNo   = 1210", RED)
row(560, Y + 126, "orders[0].totalAmount = 56", GREEN)
row(560, Y + 166, "（同一个案例，再跑一次）", font=cn(17), fill=DIM)

panel(1020, Y, 420, PH, "③ 漂移集", AMBER)
d.text((1040, Y + 60), "id / pickupNo / 时间", font=cn(20, True), fill=RED)
d.text((1040, Y + 92), "→ 两次都变，剔除", font=cn(19), fill=DIM)
d.text((1040, Y + 132), "totalAmount", font=cn(20, True), fill=GREEN)
d.text((1040, Y + 164), "→ 两次相同，留着当见证", font=cn(19), fill=DIM)

for x0, x1 in ((480, 540), (960, 1020)):
    ym = Y + PH // 2
    d.line([(x0, ym), (x1 - 8, ym)], fill=DIM, width=3)
    d.polygon([(x1 - 2, ym), (x1 - 12, ym - 6), (x1 - 12, ym + 6)], fill=DIM)

Y2 = 400
d.rounded_rectangle([60, Y2, 730, Y2 + 200], 10, fill=(38, 22, 24), outline=RED, width=2)
d.text((80, Y2 + 16), "修之前", font=cn(24, True), fill=RED)
d.text((80, Y2 + 58), "m-duplicate-row 被判「欠账：可杀，缺断言」", font=cn(20), fill=TEXT)
d.text((80, Y2 + 94), "见证是 orders.0.id：196 → 210", font=cn(19), fill=RED)
d.text((80, Y2 + 128), "它「看见」的是编号在长，不是那个变异体在复制行。", font=cn(18), fill=DIM)
d.text((80, Y2 + 160), "还会据此建议写 orders.0.id == 196 —— 换个实现必红。", font=cn(18), fill=DIM)

d.rounded_rectangle([770, Y2, 1440, Y2 + 200], 10, fill=(18, 34, 22), outline=GREEN, width=2)
d.text((790, Y2 + 16), "修之后", font=cn(24, True), fill=GREEN)
d.text((790, Y2 + 58), "每案例先跑两遍正确实现，求出漂移集再比见证", font=cn(20), fill=TEXT)
d.text((790, Y2 + 94), "m-duplicate-row → 说不清（连真差异都造不出来）", font=cn(19), fill=AMBER)
d.text((790, Y2 + 128), "快路径与重放在真实后端上判定 0 处差异。", font=cn(18), fill=DIM)
d.text((790, Y2 + 160), "memory 域不受影响：确定性实现的漂移集为空。", font=cn(18), fill=DIM)

im.save("docs/media/drift.png")
print("saved docs/media/drift.png", im.size)
