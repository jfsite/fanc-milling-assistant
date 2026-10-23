# -*- coding: utf-8 -*-
"""生成发布链接二维码卡片（qrcode.png）。

用法：
    python tools/make-qrcode.py "https://xxx.app.workbuddy.host/?sharecode=XXXX"

产物：项目根目录 qrcode.png，492x630，白底，二维码 + 标题 + 链接文字。
"""
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


def main(url: str) -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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

    # 网址按宽度折行，字号自适应
    for size in (17, 16, 15, 14, 13):
        f_url = ImageFont.truetype(FONT_REG, size)
        lines, cur = [], ""
        for ch in url:
            if d.textlength(cur + ch, font=f_url) <= W - 48:
                cur += ch
            else:
                lines.append(cur)
                cur = ch
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
