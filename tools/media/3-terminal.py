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
 ('hl','8 条请求 → 5 个能力 / 2 个视图集合'),
 ('out',''),
 ('ok','adapter.yml        声明式适配器，不写代码'),
 ('ok','twin.json          回放孪生 = 白送的第二个实现'),
 ('ok','cases/recorded.json  案例草稿，只有观测算得出来的断言'),
 ('ok','unclassified.jsonl   认不出的形状，一条不藏'),
 ('warn','案例默认草稿：accept --by=名字 之后才出判决'),
]
O3=[
 ('hl','9 条案例 × 22 个变异体'),
 ('ok','抓到 17 / 适用 19    89.5%'),
 ('out',''),
 ('out','欠账 2 · 说不清 0 · 不适用 3'),
 ('hl','建议断言 3 条（每条都当场验过）'),
 ('out','  coffee/cancel-before-pickup  totalAmount = 56'),
 ('bad','  m-pickup-no-offset 仍然欠账：偏移是各实现自己的约定'),
]
CMD1='agent-web selftest'
CMD2='agent-web learn .tmp-tap/rec/traffic.jsonl --out=.tmp-tap/learned --name=tasks'
CMD3='agent-web certify cases/coffee --adapter=memory'
L1=[('cmd',CMD1)]+O1
L2=[('cmd',CMD1)]+O1+[('cmd','agent-web tap --target=http://127.0.0.1:8199 --port=8197 --out=.tmp-tap/rec'),
                      ('out','反向代理已起，脱敏后落盘 → .tmp-tap/rec/traffic.jsonl')]+[('cmd',CMD2)]
L3=L2+O2+[('cmd',CMD3)]

def build():
    if os.path.isdir(FR): shutil.rmtree(FR)
    os.makedirs(FR); n=0
    def snap(lines,typed=None,hold=1):
        nonlocal n
        for _ in range(hold):
            frame(lines,typed,os.path.join(FR,'f%04d.png'%n)); n+=1
    for i in range(1,len(CMD1)+1,5): snap([],CMD1[:i])
    snap([],CMD1,2)
    for i in range(1,len(O1)+1): snap(L1[:1]+O1[:i],None,1)
    snap(L1,None,3)
    for i in range(1,len(O2)+1): snap(L2+O2[:i],None,1)
    snap(L2+O2,None,4)
    for i in range(1,len(O3)+1,2): snap(L3+O3[:i],None,1)
    snap(L3+O3,None,6)
    print('frames',n)

def build_recall():
    R=[('cmd','agent-web recall'),
       ('hl','事故档案 agent-web/knowledge-1 · 14 条 · 命中 1 条'),
       ('out',''),
       ('hl','  k-unportable-assertion   第 2 次'),
       ('out','    当时怎么修的：NON_PORTABLE 字段一律不给建议'),
       ('out','    判据落在：certify 的 suggestionBlocked'),
       ('bad','    → 这条已经犯过，按规矩拦下来'),
       ('out',''),
       ('out','另有 5 条档案不靠这条命令守（由 CI / 单测兜底）')]
    frame(R,None,os.path.join(OUT,'recall.png'))
    print('recall.png')

if __name__=='__main__':
    build()
    frame(L2+O2,None,os.path.join(OUT,'terminal.png'))
    print('terminal.png')
    build_recall()
