# README 用图的生成脚本

一次性生成脚本，不参与构建和测试。产物已经在 `docs/media/` 里，只在需要改文案或配色时重跑。

| 脚本 | 产物 |
| --- | --- |
| `1-hero-verdicts.py` | `hero.png`、`verdicts.png` |
| `2-loop.py` | `loop.png`（一份案例、两个实现的对照图） |
| `3-terminal.py` | `terminal.png`、`recall.png`、`.tmp-frames/` 的动画帧 |
| `4-discover.py` | `discover.png`（输入一个网址之后发生了什么） |
| `5-certify-drill.py` | `certify.png`、`certify.gif`、`drill.png`（判据准入与出题批改） |
| 真实截图（playwright + msedge，经本地 http-server） | `flow.png`（happy-pass 全页）、`flow.gif`（点开被拒步、筛偏差） |

```bash
python tools/media/1-hero-verdicts.py
python tools/media/2-loop.py
python tools/media/3-terminal.py
python tools/media/4-discover.py
python tools/media/5-certify-drill.py
ffmpeg -y -framerate 4 -i .tmp-frames/f%04d.png \
  -vf "split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 docs/media/demo.gif
```

依赖只有 Pillow 和 ffmpeg。字体用系统自带的微软雅黑与 Consolas，中文与代码分别渲染后按字宽拼接——单一等宽字体没有中文字形，混排会出现豆腐块。
