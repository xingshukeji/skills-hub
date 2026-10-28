"""DeskPilot: local GUI operations, without application or business policy."""

from __future__ import annotations

import platform
import sys
from pathlib import Path

VERSION = "0.1.0"
PROTOCOL_VERSION = 1


class DeskPilotError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False,
                 details: dict | None = None, outcome: str = "not_dispatched"):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.details = details or {}
        self.outcome = outcome

    def body(self) -> dict:
        result = {"code": self.code, "message": str(self), "retryable": self.retryable,
                  "outcome": self.outcome}
        if self.details:
            result["details"] = self.details
        return result


def require(condition: bool, code: str, message: str, **kwargs) -> None:
    if not condition:
        raise DeskPilotError(code, message, **kwargs)


def platform_key() -> str:
    system = {"win32": "windows", "darwin": "macos", "linux": "linux"}.get(sys.platform, sys.platform)
    machine = platform.machine().lower()
    architecture = {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(machine, machine)
    return f"{system}-{architecture}"


def resource_root() -> Path:
    """Installed archives use their build's resources, never a source checkout."""
    import os
    configured = os.environ.get("DESKPILOT_RESOURCES")
    if configured:
        return Path(configured).resolve()
    location = Path(__file__).resolve()
    # The generated package lives at <skill>/scripts/deskpilot/.
    return location.parent.parent.parent


def vendor_paths() -> None:
    root = resource_root() / "vendor"
    for path in (root / "python", root / platform_key() / "python"):
        if path.is_dir() and str(path) not in sys.path:
            sys.path.insert(0, str(path))


def number(value, name: str, *, minimum: float | None = None, maximum: float | None = None) -> float:
    import math
    require(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value),
            "INVALID_ARGUMENT", f"{name} must be a finite number.")
    require(minimum is None or value >= minimum, "INVALID_ARGUMENT", f"{name} is below its supported range.")
    require(maximum is None or value <= maximum, "INVALID_ARGUMENT", f"{name} exceeds its supported range.")
    return value


def bounds(value: dict) -> dict:
    require(isinstance(value, dict), "INVALID_ARGUMENT", "A rectangle must be an object.")
    result = {key: int(number(value.get(key), key)) for key in ("x", "y", "width", "height")}
    require(result["width"] > 0 and result["height"] > 0, "INVALID_ARGUMENT", "Rectangle dimensions must be positive.")
    return result
