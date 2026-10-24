# -*- coding: utf-8 -*-
"""生成发布链接二维码卡片（qrcode.png）。

用法：
    python tools/make-qrcode.py "https://xxx.app.workbuddy.host/?sharecode=XXXX"

会自动把 index.html 里的 APP_VERSION 追加成 `&v=<版本>` —— 平台边缘缓存按
「完整 URL」缓存，裸链接发布后长期返回旧版，带版本参数才能保证扫到的是当前版本。

产物：项目根目录 qrcode.png，492x630，白底，二维码 + 标题 + 链接文字。
"""
import re
import sys
import os

import qrcode
from qrcode.constants import ERROR_CORRECT_M
from PIL import Image, ImageDraw, ImageFont

W, H = 492, 630
BLACK = "#171a1f"
GRAY = "#5b6472"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_REG = "C:/Windows/Fonts/msyh.ttc"


def current_version(root: str) -> str:
    try:
        with open(os.path.join(root, "index.html"), encoding="utf-8") as f:
            m = re.search(r'const APP_VERSION = "(\d+\.\d+\.\d+)";', f.read())
            return m.group(1) if m else ""
    except OSError:
        return ""


def main(url: str) -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # 统一下发「带版本号」的链接，绕开边缘缓存的旧副本
    ver = current_version(root)
    if ver and "sharecode=" in url and "&v=" not in url:
        url = url + "&v=" + ver

    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, box_size=12, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color=BLACK, back_color="white").convert("RGB")
    qr_img = qr_img.resize((420, 420), Image.NEAREST)

    card = Image.new("RGB", (W, H), "white")
    card.paste(qr_img, ((W - 420) // 2, 34))

    d = ImageDraw.Draw(card)
    title = "FANUC 铣削编程助手"
    f_title = ImageFont.truetype(FONT_BOLD, 30)
    tw = d.textlength(title, font=f_title)
    d.text(((W - tw) / 2, 480), title, font=f_title, fill=BLACK)

    sub = "扫码即用 · 10 个模块"
    f_sub = ImageFont.truetype(FONT_REG, 18)
    sw = d.textlength(sub, font=f_sub)
    d.text(((W - sw) / 2, 522), sub, font=f_sub, fill=GRAY)

    # 网址折行：优先在 & / ? / / 处断开，避免把 sharecode 拦腰切断
    segs = re.split(r"(?<=[&?/])", url)
    for size in (17, 16, 15, 14, 13):
        f_url = ImageFont.truetype(FONT_REG, size)
        lines, cur = [], ""
        for seg in segs:
            if d.textlength(cur + seg, font=f_url) <= W - 48:
                cur += seg
            else:
                if cur:
                    lines.append(cur)
                cur = seg
        if cur:
            lines.append(cur)
        if len(lines) <= 3:
            break
    y = 556
    for ln in lines:
        lw = d.textlength(ln, font=f_url)
        d.text(((W - lw) / 2, y), ln, font=f_url, fill=GRAY)
        y += size + 6

    out = os.path.join(root, "qrcode.png")
    card.save(out)
    print("saved:", out, card.size, "url:", url)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
