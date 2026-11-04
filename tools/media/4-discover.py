# -*- coding: utf-8 -*-
# 输入一个网址之后发生了什么。这张图放 docs/GUIDE.md 的 discover 一节。
from PIL import Image, ImageDraw, ImageFont
import os
OUT = os.path.join('docs', 'media')
BG, PANEL, BORDER = (11,14,20), (22,27,34), (48,54,61)
FG, MUTED = (230,237,243), (125,133,144)
GREEN, RED, AMBER, BLUE, PURPLE = (63,185,80),(248,81,73),(210,153,34),(88,166,255),(188,140,255)
F = 'C:/Windows/Fonts/'
def cn(s,b=True): return ImageFont.truetype(F+('msyhbd.ttc' if b else 'msyh.ttc'), s, index=0)
def mono(s): return ImageFont.truetype(F+'consola.ttf', s)
def canvas(w,h):
    im=Image.new('RGB',(w,h),BG); return im, ImageDraw.Draw(im)
def text(d,xy,s,f,fill=FG,a='la'): d.text(xy,s,font=f,fill=fill,anchor=a)
def box(d,bx,r=14,fill=PANEL,out=BORDER,w=2): d.rounded_rectangle(bx,radius=r,fill=fill,outline=out,width=w)
def arrow(d,x1,y1,x2,y2,c=MUTED,w=3,h=12):
    d.line([(x1,y1),(x2,y2)],fill=c,width=w)
    if y1==y2:
        s=1 if x2>x1 else -1
        d.polygon([(x2,y2),(x2-s*h,y2-h//2),(x2-s*h,y2+h//2)],fill=c)
    else:
        s=1 if y2>y1 else -1
        d.polygon([(x2,y2),(x2-h//2,y2-s*h),(x2+h//2,y2-s*h)],fill=c)

def discover():
    W,H=1500,740
    im,d=canvas(W,H)
    text(d,(64,36),'输入一个网址，先看清它有什么',cn(38),FG)
    text(d,(64,96),'最便宜的起步：不用先写适配器，先让工具告诉你这台站点长什么样',cn(23,False),MUTED)

    # 第一行：网址 → 探测 → 能力清单
    box(d,(64,160,424,300))
    text(d,(88,180),'① 网址',cn(22),MUTED)
    text(d,(88,218),'http://127.0.0.1:8080',mono(19),BLUE)
    text(d,(88,258),'./quickstart.sh 后面那个参数',cn(17,False),MUTED)

    box(d,(470,160,930,300))
    text(d,(494,180),'② 探测',cn(22),MUTED)
    text(d,(494,218),'根路径通不通、返回什么',cn(18,False),FG)
    text(d,(494,248),'再试 8 个常见的 OpenAPI 位置',cn(18,False),FG)
    text(d,(494,278),'找不到就停手，不猜路径',cn(17,False),AMBER)

    box(d,(976,160,1436,300))
    text(d,(1000,180),'③ 能力清单',cn(22),MUTED)
    text(d,(1000,218),'orders.list   GET /api/orders',mono(16),FG)
    text(d,(1000,244),'orders.create POST /api/orders',mono(16),FG)
    text(d,(1000,274),'只读 3  写 3',cn(17,False),MUTED)

    arrow(d,424,230,470,230)
    arrow(d,930,230,976,230)

    # 第二行：生成两样东西
    box(d,(64,350,1436,502))
    text(d,(88,368),'④ 生成两份东西（都标 inferred，不是事实）',cn(21),MUTED)

    box(d,(96,398,700,486),fill=(16,28,40),out=BLUE)
    text(d,(116,410),'只读适配器  adapter.mjs',cn(19),BLUE)
    text(d,(116,446),'写能力一律 unsupported —— 业务该保证什么，机器猜不出来',cn(16,False),MUTED)

    box(d,(736,398,1404,486),fill=(38,28,16),out=AMBER)
    text(d,(756,410),'案例草稿  cases/*.json',cn(19),AMBER)
    text(d,(756,446),'每个资源一条，断言只有 unchanged：读不该改变任何东西',cn(16,False),MUTED)

    arrow(d,1200,300,1200,350)

    # 第三行：确认 → 判决
    box(d,(64,540,340,670),fill=(30,22,40),out=PURPLE)
    text(d,(88,558),'⑤ accept',cn(21),PURPLE)
    text(d,(88,592),'--by=<你的名字>',cn(17),FG)
    text(d,(88,626),'不确认不出判决',cn(16,False),MUTED)

    box(d,(374,540,900,670))
    text(d,(398,558),'⑥ verify',cn(21),FG)
    text(d,(398,592),'pass / fail / unknown',mono(17),FG)
    text(d,(398,626),'unknown 留在分母里，不算通过',cn(16,False),MUTED)

    box(d,(934,540,1436,670),fill=(16,32,20),out=GREEN)
    text(d,(958,558),'你拿到什么',cn(21),GREEN)
    text(d,(958,592),'一台跑着的站点 → 可复用的案例',cn(17,False),FG)
    text(d,(958,626),'下次改代码，同一批案例重跑一遍',cn(17,False),MUTED)

    arrow(d,340,600,374,600)
    arrow(d,900,600,934,600)

    path=os.path.join(OUT,'discover.png')
    im.save(path, optimize=True)
    print(path, os.path.getsize(path), 'bytes', im.size)

if __name__=='__main__':
    discover()
