"""Read an explicitly selected local JSON secret without putting it in a request."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import string

from . import DeskPilotError, require


def read_local_secret(reference):
    require(isinstance(reference, dict) and set(reference) == {"path", "json_path"},
            "INVALID_SECRET_REFERENCE", "Provide a local JSON path and a list of JSON keys.")
    path, keys = reference["path"], reference["json_path"]
    require(isinstance(path, str) and bool(path) and "\x00" not in path,
            "INVALID_SECRET_REFERENCE", "The secret source must be an absolute local file.")
    require(isinstance(keys, list) and 1 <= len(keys) <= 16
            and all(isinstance(key, str) and 0 < len(key) <= 128 for key in keys),
            "INVALID_SECRET_REFERENCE", "The JSON key path must contain 1 to 16 short keys.")
    def check_local(candidate):
        if os.name == "nt":
            require(bool(re.fullmatch(r"[A-Za-z]:", candidate.drive)), "INVALID_SECRET_REFERENCE",
                    "The secret source must be a local drive, not a network path.")
            import ctypes
            get_drive_type = ctypes.WinDLL("kernel32").GetDriveTypeW
            get_drive_type.argtypes = [ctypes.c_wchar_p]
            get_drive_type.restype = ctypes.c_uint
            require(get_drive_type(candidate.anchor) in (2, 3, 6), "INVALID_SECRET_REFERENCE",
                    "The secret source must be on a local drive.")

    try:
        candidate = Path(path)
        require(candidate.is_absolute(), "INVALID_SECRET_REFERENCE", "The secret source must be an absolute local file.")
        check_local(candidate)
        candidate = candidate.resolve(strict=True)
        check_local(candidate)
        with candidate.open("rb") as source:
            raw = source.read(1_048_577)
        require(len(raw) <= 1_048_576, "SECRET_SOURCE_UNAVAILABLE", "The selected secret source is unavailable or too large.")
        value = json.loads(raw.decode("utf-8-sig"))
        for key in keys:
            if not isinstance(value, dict) or key not in value:
                raise ValueError("missing key")
            value = value[key]
        require(isinstance(value, str) and 0 < len(value) <= 4096
                and not any(ord(char) < 32 or ord(char) == 127 for char in value),
                "SECRET_SOURCE_UNAVAILABLE", "The selected secret is missing or cannot be entered safely.")
        value.encode("utf-16-le")
        return value
    except DeskPilotError:
        raise
    except (OSError, ValueError, UnicodeError, RecursionError):
        raise DeskPilotError("SECRET_SOURCE_UNAVAILABLE", "The selected secret source could not be read.") from None


def keyboard_sequence(layout, secret, *, width, height, offset_x, offset_y):
    """Validate a complete public layout before resolving any secret characters."""
    require(isinstance(layout, dict) and set(layout) == {"character_set", "keys"},
            "INVALID_SECRET_LAYOUT", "Provide a complete public on-screen keyboard layout.")
    repertoires = {"ascii_alphanumeric": string.ascii_letters + string.digits,
                   "ascii_printable": "".join(chr(code) for code in range(32, 127))}
    name = layout.get("character_set")
    repertoire = repertoires.get(name) if isinstance(name, str) else None
    keys = layout.get("keys")
    require(repertoire is not None and isinstance(keys, dict) and set(keys) == set(repertoire),
            "INVALID_SECRET_LAYOUT", "The keyboard map must cover the complete declared character set.")
    converted = {}
    for character, points in keys.items():
        require(isinstance(points, list) and 1 <= len(points) <= 6, "INVALID_SECRET_LAYOUT",
                "Each character must have a bounded on-screen key sequence.")
        converted[character] = []
        for point in points:
            require(isinstance(point, list) and len(point) == 2 and all(type(value) is int for value in point)
                    and 0 <= point[0] < width and 0 <= point[1] < height,
                    "INVALID_SECRET_LAYOUT", "A keyboard point lies outside the screenshot.")
            converted[character].append((point[0] + offset_x, point[1] + offset_y))
    require(len(secret) <= 128 and all(character in converted for character in secret),
            "SECRET_LAYOUT_UNSUPPORTED", "The selected secret cannot be entered with this complete keyboard layout.")
    sequence = [point for character in secret for point in converted[character]]
    require(len(sequence) <= 512, "SECRET_LAYOUT_UNSUPPORTED", "The selected secret needs too many keyboard actions.")
    return sequence
