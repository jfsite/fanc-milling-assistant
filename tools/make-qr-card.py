# -*- coding: utf-8 -*-
"""生成公众号正文用的二维码卡片（1080 宽·高清）。

用法：
    python tools/make-qr-card.py "https://fanuc-milling-w.app.workbuddy.host/app.html?sharecode=OTD3JQJQPI"

与 make-qrcode.py 的区别：那张是 492x630 的「名片」，带完整 URL、适合打印；
这张是 1080 宽、去掉裸链接、只留「扫码直接用」的高清图，专供公众号正文插入
（公众号正文图片建议 1080 宽，小图在手机上会发虚）。

产物：tmp/wechat/qr-card.png
"""
import os
import re
import sys

import qrcode
from qrcode.constants import ERROR_CORRECT_M
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1180
BLACK = "#171a1f"
GRAY = "#5b6472"
LIGHT = "#8a93a0"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_REG = "C:/Windows/Fonts/msyh.ttc"


def app_meta(root):
    html = ""
    for name in ("app.html", "index.html"):
        try:
            with open(os.path.join(root, name), encoding="utf-8") as f:
                html = f.read()
                break
        except OSError:
            continue
    ver = re.search(r'const APP_VERSION = "(\d+\.\d+\.\d+)";', html)
    mods = len(re.findall(r'<button data-p="[a-z]+"', html))
    return (ver.group(1) if ver else ""), (mods or 11)


def center(d, text, font, y, fill):
    w = d.textlength(text, font=font)
    d.text(((W - w) / 2, y), text, font=font, fill=fill)


def main(url):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if "sharecode=" in url and "/app.html" not in url:
        url = url.replace("/?sharecode=", "/app.html?sharecode=")

    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, box_size=16, border=3)
    qr.add_data(url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color=BLACK, back_color="white").convert("RGB")
    qr_img = qr_img.resize((720, 720), Image.NEAREST)

    card = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(card)

    center(d, "数控铣削编程助手", ImageFont.truetype(FONT_BOLD, 56), 74, BLACK)
    center(d, "FANUC 系统 · 粘贴程序就能查错、看刀轨", ImageFont.truetype(FONT_REG, 30), 156, GRAY)

    # 二维码外框（细描边，避免白底上边界糊掉）
    bx, by, pad = (W - 720) // 2, 260, 26
    d.rectangle([bx - pad, by - pad, bx + 720 + pad, by + 720 + pad], outline="#e3e6ec", width=2)
    card.paste(qr_img, (bx, by))

    center(d, "微信扫一扫 / 长按识别，打开就能用", ImageFont.truetype(FONT_BOLD, 34), 1050, BLACK)

    ver, mods = app_meta(root)
    foot = "%d 个模块 · 不用安装 · 程序只存本地" % mods
    if ver:
        foot += " · v" + ver
    center(d, foot, ImageFont.truetype(FONT_REG, 24), 1104, LIGHT)

    out_dir = os.path.join(root, "tmp", "wechat")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "qr-card.png")
    card.save(out)
    print("saved:", out, card.size, "url:", url)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
