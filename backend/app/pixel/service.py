from pathlib import Path

from PIL import Image


def process_image(source: Path, target: Path, options: dict):
    with Image.open(source) as opened:
        image = opened.convert("RGBA")

    if options["remove_solid_background"]:
        corners = [
            image.getpixel(point)
            for point in (
                (0, 0),
                (image.width - 1, 0),
                (0, image.height - 1),
                (image.width - 1, image.height - 1),
            )
        ]
        background = max(set(corners), key=corners.count)
        pixels = image.load()
        for y in range(image.height):
            for x in range(image.width):
                red, green, blue, alpha = pixels[x, y]
                if (
                    alpha
                    and max(
                        abs(red - background[0]),
                        abs(green - background[1]),
                        abs(blue - background[2]),
                    )
                    <= 12
                ):
                    pixels[x, y] = (red, green, blue, 0)

    if options["trim"]:
        box = image.getbbox()
        if box:
            image = image.crop(box)

    max_size = (options["width"], options["height"])
    image.thumbnail(max_size, Image.Resampling.NEAREST)
    alpha = image.getchannel("A")
    palette = image.convert("RGB").quantize(
        colors=options["palette_colors"], method=Image.Quantize.MEDIANCUT
    )
    image = palette.convert("RGBA")
    image.putalpha(alpha)

    if options["center"]:
        canvas = Image.new("RGBA", max_size)
        position = ((max_size[0] - image.width) // 2, (max_size[1] - image.height) // 2)
        canvas.alpha_composite(image, position)
        image = canvas

    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    image.save(target, "PNG")
