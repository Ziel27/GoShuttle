#!/usr/bin/env python3
"""
Center-crop assets/images/logo.png to a perfect square.

This keeps Expo config paths unchanged by rewriting the same file.
By default, the original file is saved as logo.original.png once.
"""

from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
LOGO_PATH = ROOT / "assets" / "images" / "logo.png"
BACKUP_PATH = ROOT / "assets" / "images" / "logo.original.png"


def main() -> None:
  if not LOGO_PATH.exists():
    raise SystemExit(f"Logo not found: {LOGO_PATH}")

  with Image.open(LOGO_PATH) as img:
    width, height = img.size

    if width == height:
      print(f"Already square: {LOGO_PATH} ({width}x{height})")
      return

    square = min(width, height)
    left = (width - square) // 2
    top = (height - square) // 2
    right = left + square
    bottom = top + square

    if not BACKUP_PATH.exists():
      img.save(BACKUP_PATH)
      print(f"Backup created: {BACKUP_PATH}")

    cropped = img.crop((left, top, right, bottom))
    cropped.save(LOGO_PATH)
    print(f"Cropped to square: {LOGO_PATH} ({square}x{square})")


if __name__ == "__main__":
  main()
