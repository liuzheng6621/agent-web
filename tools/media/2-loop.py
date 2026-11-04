# -*- coding: utf-8 -*-
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
def box(d,bx,r=16,fill=PANEL,out=BORDER,w=2): d.rounded_rectangle(bx,radius=r,fill=fill,outline=out,width=w)
def arrow(d,x1,y1,x2,y2,c=MUTED,w=3,h=12):
    d.line([(x1,y1),(x2,y2)],fill=c,width=w)
    s=1 if x2>x1 else -1
    d.polygon([(x2,y2),(x2-s*h,y2-h//2),(x2-s*h,y2+h//2)],fill=c)

def loop():
    W,H=1500,660
    im,d=canvas(W,H)
    text(d,(64,40),'一份案例，两个实现，一次对照',cn(38),FG)
    text(d,(64,100),'案例里不写实现细节，只写「做什么」和「结果该是什么」',cn(23,False),MUTED)

    box(d,(64,180,404,340))
    text(d,(92,206),'案例',cn(26),FG)
    text(d,(92,248),'happy-path.json',mono(20),BLUE)
    text(d,(92,286),'7 条咖啡店场景',cn(19,False),MUTED)

    box(d,(470,150,840,250))
    text(d,(496,172),'适配器 A',cn(24),FG)
    text(d,(496,210),'内置内存实现',cn(19,False),MUTED)
    box(d,(470,290,840,390))
    text(d,(496,312),'适配器 B',cn(24),FG)
    text(d,(496,350),'真实后端 HTTP',cn(19,False),MUTED)

    box(d,(906,150,1150,250))
    text(d,(932,172),'判决 A',cn(24),FG)
    text(d,(932,210),'pass / fail / unknown',mono(17),MUTED)
    box(d,(906,290,1150,390))
    text(d,(932,312),'判决 B',cn(24),FG)
    text(d,(932,350),'pass / fail / unknown',mono(17),MUTED)

    box(d,(1216,180,1440,360),fill=(16,32,20),out=GREEN)
    text(d,(1244,204),'一致率',cn(24,False),MUTED)
    text(d,(1244,246),'100%',mono(56),GREEN)
    text(d,(1244,318),'8/8',mono(22),MUTED)

    arrow(d,404,250,470,200)
    arrow(d,404,275,470,340)
    arrow(d,840,200,906,200)
    arrow(d,840,340,906,340)
    arrow(d,1150,200,1216,240,BLUE)
    arrow(d,1150,340,1216,300,BLUE)

    # 底部：档案回流
    box(d,(470,450,1440,590),fill=(18,22,30),out=PURPLE)
    text(d,(500,474),'不一致时：先查适配器是不是在撒谎，再查断言是不是在空转',cn(22),FG)
    text(d,(500,516),'agent-web recall   事故档案：这个仓库踩过的坑，第二次遇到直接拦下来',cn(20,False),PURPLE)
    arrow(d,1330,450,1330,394,PURPLE)
    im.save(os.path.join(OUT,'loop.png'),optimize=True)
    print('loop.png')

def term_base(lines, w=1240, h=760, title='agent-web — 演示'):
    im=Image.new('RGB',(w,h),BG); d=ImageDraw.Draw(im)
    box(d,(0,0,w-1,h-1),r=14,fill=(13,17,23),out=BORDER)
    d.rounded_rectangle((0,0,w-1,46),radius=14,fill=(22,27,34))
    d.rectangle((0,30,w-1,46),fill=(22,27,34))
    for i,c in enumerate([(255,95,86),(255,189,46),(39,201,63)]):
        d.ellipse((22+i*26,16,36+i*26,30),fill=c)
    text(d,(w//2,23),title,cn(18,False),MUTED,'mm')
    return im,d

def render(lines, path):
    im,d=term_base(lines)
    y=72
    for kind,s in lines:
        f = mono(21) if kind in ('cmd','out') else cn(21)
        color = {'cmd':FG,'out':MUTED,'ok':GREEN,'bad':RED,'warn':AMBER,'hl':PURPLE}[kind]
        if kind=='cmd':
            text(d,(34,y),'$',mono(21),GREEN); text(d,(58,y),s,mono(21),FG)
        else:
            text(d,(34,y),s,f,color)
        y+=31
    im.save(path,optimize=True)

if __name__=='__main__':
    loop()
    print('ok')
