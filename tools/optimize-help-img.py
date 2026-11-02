# -*- coding: utf-8 -*-
"""压缩内嵌帮助截图，给 app.html 瘦身。

背景：`<script type="application/json" id="help-img">` 里 13 张 PNG 解码后 868 KB，
base64 后 1158 KB，占全文 80%。这些图只有点开「帮助」才用得上，却必须跟着首屏下载。

做法：解码 → 超宽图缩到 1600 → 转 WebP(q88) → 重新 base64 写回。
结构完全不变（仍是 id="help-img" 的 JSON，值仍是 data URI），前端代码零改动。

用法：
    python tools/optimize-help-img.py                 # 只分析，不写文件
    python tools/optimize-help-img.py --write app-lite.html   # 产出瘦身副本

**当前状态：验证过、未采用（2026-11-02）**。实测 13 张图 868 KB→496 KB、整文件
1,535,594→1,033,864 字节（−32.7%），无头浏览器里 13 张全部正常渲染。没落地的原因：
① 瓶颈是 GitHub Pages 的 15 KB/s 网络，不是体积，压到 1 MB 仍要 60 秒以上；
② 真要落地必须先改 `sync-doc.js` 的 embed（它直接读 png 转 base64），否则下次同步文档体积反弹。
详见 HANDOVER §8 / §9.5。
"""
import base64
import io
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "app.html")
PAT = re.compile(r'(<script type="application/json" id="help-img">)(.*?)(</script>)', re.S)
MAXW = 1600
QUALITY = 88


def kb(n):
    return round(n / 1024)


def main():
    html = open(SRC, encoding="utf-8").read()
    m = PAT.search(html)
    if not m:
        print("没找到 help-img 块")
        sys.exit(1)
    data = json.loads(m.group(2))
    print("条目数 %d，原块 %d KB" % (len(data), kb(len(m.group(2)))))

    out, rows = {}, []
    for k, uri in data.items():
        if not uri.startswith("data:image/"):
            out[k] = uri
            continue
        b64 = uri.split(",", 1)[1]
        raw = base64.b64decode(b64)
        im = Image.open(io.BytesIO(raw))
        omode, osize = im.mode, im.size
        im = im.convert("RGB")
        w, h = im.size
        if w > MAXW:
            im = im.resize((MAXW, round(h * MAXW / w)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=QUALITY, method=6)
        nb = buf.getvalue()
        out[k] = "data:image/webp;base64," + base64.b64encode(nb).decode()
        rows.append((k, osize, omode, len(raw), im.size, len(nb)))

    rows.sort(key=lambda r: -r[3])
    print("%-14s %-13s %-5s %8s %-13s %8s %6s" % ("图", "原始尺寸", "模式", "原KB", "新尺寸", "新KB", "降幅"))
    for k, osz, omode, olen, nsz, nlen in rows:
        print("%-14s %-13s %-5s %8d %-13s %8d %5.0f%%"
              % (k[:14], "%dx%d" % osz, omode, kb(olen), "%dx%d" % nsz, kb(nlen), (1 - nlen / olen) * 100))

    new_json = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    old_len, new_len = len(html), len(html) - len(m.group(2)) + len(new_json)
    print("\n原图合计 %d KB → %d KB" % (kb(sum(r[3] for r in rows)), kb(sum(r[5] for r in rows))))
    print("原块 %d KB → 新块 %d KB" % (kb(len(m.group(2))), kb(len(new_json))))
    print("app.html %d KB → %d KB（降 %.0f%%）"
          % (kb(old_len * 1), kb(new_len), (1 - new_len / old_len) * 100))

    if "--write" in sys.argv:
        dst = sys.argv[sys.argv.index("--write") + 1]
        dst = dst if os.path.isabs(dst) else os.path.join(ROOT, dst)
        new_html = html[:m.start(2)] + new_json + html[m.end(2):]
        open(dst, "w", encoding="utf-8").write(new_html)
        print("已写出:", dst, "（%.0f KB）" % (os.path.getsize(dst) / 1024))


if __name__ == "__main__":
    main()
