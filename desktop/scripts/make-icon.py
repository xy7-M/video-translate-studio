# -*- coding: utf-8 -*-
"""生成奶油手账风应用图标 icon.ico（贴纸卡片 + 楷体「译」+ 暖橙红点睛）"""
import sys
from PIL import Image, ImageDraw, ImageFont

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 贴纸卡片：奶油纸底 + 墨黑描边
d.rounded_rectangle([8, 8, 248, 248], radius=46, fill=(250, 246, 239, 255),
                    outline=(28, 25, 17, 255), width=8)

# 楷体「译」，暖橙红
try:
    font = ImageFont.truetype(r"C:\Windows\Fonts\simkai.ttf", 150)
except OSError:
    font = ImageFont.load_default()
text = "译"
box = d.textbbox((0, 0), text, font=font)
w, h = box[2] - box[0], box[3] - box[1]
d.text(((S - w) / 2 - box[0], (S - h) / 2 - box[1] - 16), text,
       font=font, fill=(232, 99, 74, 255))

# 右下角小橙点
d.ellipse([194, 194, 222, 222], fill=(232, 99, 74, 255),
          outline=(28, 25, 17, 255), width=4)

out = sys.argv[1]
img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64),
                     (128, 128), (256, 256)])
print("icon saved:", out)
