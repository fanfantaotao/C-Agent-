from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont


def label_font(size: int):
    candidates = [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/segoeui.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


reference_path, implementation_path, output_path = map(Path, sys.argv[1:4])
reference = Image.open(reference_path).convert("RGB")
implementation = Image.open(implementation_path).convert("RGB")
column_width = max(reference.width, implementation.width)

if reference.width != column_width:
    reference = reference.resize((column_width, round(reference.height * column_width / reference.width)))
if implementation.width != column_width:
    implementation = implementation.resize((column_width, round(implementation.height * column_width / implementation.width)))

header_height = 56
gutter = 24
canvas = Image.new(
    "RGB",
    (column_width * 2 + gutter, max(reference.height, implementation.height) + header_height),
    "#eef0f3",
)
canvas.paste(reference, (0, header_height))
canvas.paste(implementation, (column_width + gutter, header_height))

draw = ImageDraw.Draw(canvas)
font = label_font(20)
draw.text((16, 14), "参考：Codex 执行流", fill="#20242d", font=font)
draw.text((column_width + gutter + 16, 14), "实现：MushSCI 浅色主题映射", fill="#20242d", font=font)
canvas.save(output_path)
