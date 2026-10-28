import asyncio
import random

from PIL import Image, ImageDraw


class FakeEngine:
    def __init__(self, delay=0.02):
        self.delay = delay

    async def generate(self, spec, seed, output, log):
        await asyncio.sleep(self.delay)
        rng = random.Random(seed)
        canvas = Image.new(
            "RGB", (spec["width"], spec["height"]), tuple(rng.randrange(40, 180) for _ in range(3))
        )
        ImageDraw.Draw(canvas).text((16, 16), f"FAKE ENGINE / seed {seed}", fill="white")
        canvas.save(output, format="PNG")
        log.write_text("Simulated CPU image; no GPU or LLM service was used.\n")
