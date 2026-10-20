"""Encode actual native AvatarPortrait verification frames (requires Pillow)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / ".tools"))
from PIL import Image

directory = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "parity-results")
frames = []
for path in sorted((directory / "avatar-animation-frames").glob("*.png")):
    source = Image.open(path).convert("RGBA")
    background = Image.new("RGBA", source.size, "#f7efd9")
    background.alpha_composite(source)
    frames.append(background.convert("RGB"))
if not frames:
    raise SystemExit("No native portrait frames found")
destination = directory / "avatar-idle-speaking.gif"
frames[0].save(destination, save_all=True, append_images=frames[1:], duration=240, loop=0, optimize=True)
print(f"{destination}: {len(frames)} actual native rendered frames")
