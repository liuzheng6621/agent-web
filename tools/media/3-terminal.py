# -*- coding: utf-8 -*-
import os, shutil
from PIL import Image, ImageDraw, ImageFont
OUT=os.path.join('docs','media'); FR='.tmp-frames'
BG,BORDER=(11,14,20),(48,54,61)
FG,MUTED=(230,237,243),(125,133,144)
GREEN,RED,AMBER,PURPLE=(63,185,80),(248,81,73),(210,153,34),(188,140,255)
F='C:/Windows/Fonts/'
_cache={}
def cn(s,b=True):
    k=('cn',s,b)
    if k not in _cache: _cache[k]=ImageFont.truetype(F+('msyhbd.ttc' if b else 'msyh.ttc'),s,index=0)
    return _cache[k]
def mono(s):
    k=('mo',s)
    if k not in _cache: _cache[k]=ImageFont.truetype(F+'consola.ttf',s)
    return _cache[k]
W,H=1120,660

def runs(s):
    out=[]; cur=''; flag=None
    for ch in s:
        a = ord(ch) < 0x2000
        if flag is None or a==flag: cur+=ch; flag=a
        else: out.append((cur,flag)); cur=ch; flag=a
    if cur: out.append((cur,flag))
    return out

def draw_mixed(d,x,ytop,s,size,color):
    fm,fc=mono(size),cn(size,False)
    yb=ytop+int(size*0.80)
    for run,is_ascii in runs(s):
        f=fm if is_ascii else fc
        d.text((x,yb),run,font=f,fill=color,anchor='ls')
        x+=d.textlength(run,font=f)
    return x

def frame(lines,typed=None,path=None):
    im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
    d.rounded_rectangle((0,0,W-1,H-1),radius=14,fill=(13,17,23),outline=BORDER,width=2)
    d.rounded_rectangle((0,0,W-1,44),radius=14,fill=(22,27,34))
    d.rectangle((0,28,W-1,44),fill=(22,27,34))
    for i,c in enumerate([(255,95,86),(255,189,46),(39,201,63)]):
        d.ellipse((22+i*26,15,36+i*26,29),fill=c)
    d.text((W//2,22),'agent-web',font=cn(17,False),fill=MUTED,anchor='mm')
    y=64
    for kind,s in lines:
        color={'cmd':FG,'out':MUTED,'ok':GREEN,'bad':RED,'warn':AMBER,'hl':PURPLE}[kind]
        if kind=='cmd':
            d.text((26,y+2),'$',font=mono(19),fill=GREEN)
            draw_mixed(d,48,y,s,19,FG)
        else:
            draw_mixed(d,26,y,s,19,color)
        y+=27
    if typed is not None:
        d.text((26,y+2),'$',font=mono(19),fill=GREEN)
        draw_mixed(d,48,y,typed+'▌',19,FG)
    if path: im.save(path,optimize=True)
    return im

O1=[
 ('ok','PASS  coffee/cancel-before-pickup   ok'),
 ('bad','FAIL  coffee/skip-ready-stage      unexpected_rejection'),
 ('out','      订单 1001 当前 MAKING，不允许直接变成 PICKED'),
 ('ok','PASS  coffee/happy-path             ok'),
 ('ok','PASS  coffee/two-items              ok'),
 ('warn','UNKN  coffee/unknown-capability     coverage_gap'),
 ('out',''),
 ('out','样本 N=8    pass=4   fail=3   unknown=1'),
 ('out','可判定率 87.5% (7/8)    CI95[53%, 98%]'),
]
O2=[
 ('hl','事故档案 agent-web/knowledge-1 · 命中 1 条'),
 ('out',''),
 ('hl','  k-unportable-assertion   第 2 次'),
 ('out','    当时怎么修的：NON_PORTABLE 字段一律不给建议'),
 ('out','    判据落在：certify 的 suggestionBlocked'),
 ('bad','    → 这条已经犯过，按规矩拦下来'),
]
CMD1='agent-web selftest'; CMD2='agent-web recall'
L1=[('cmd',CMD1)]+O1; L2=L1+[('cmd',CMD2)]

def build():
    if os.path.isdir(FR): shutil.rmtree(FR)
    os.makedirs(FR); n=0
    def snap(lines,typed=None,hold=1):
        nonlocal n
        for _ in range(hold):
            frame(lines,typed,os.path.join(FR,'f%04d.png'%n)); n+=1
    for i in range(1,len(CMD1)+1,6): snap([],CMD1[:i])
    snap([],CMD1,2)
    for i in range(1,len(O1)+1): snap(L1[:1]+O1[:i],None,1)
    snap(L1,None,4)
    for i in range(1,len(CMD2)+1,6): snap(L1,CMD2[:i])
    snap(L1,CMD2,2)
    for i in range(1,len(O2)+1): snap(L2+O2[:i],None,1)
    snap(L2+O2,None,8)
    print('frames',n)

if __name__=='__main__':
    build()
    frame(L1,None,os.path.join(OUT,'terminal.png'))
    print('terminal.png')
