from pathlib import Path
from typing import Protocol


class Engine(Protocol):
    async def generate(self, spec: dict, seed: int, output: Path, log: Path) -> None: ...
