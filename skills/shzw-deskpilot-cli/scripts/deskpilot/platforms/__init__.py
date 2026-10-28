"""System backends are loaded only on their own operating system."""

from __future__ import annotations

import sys

from .. import DeskPilotError


def create():
    if sys.platform == "win32":
        from .windows import WindowsDesktop
        return WindowsDesktop()
    if sys.platform == "darwin":
        from .macos import MacDesktop
        return MacDesktop()
    if sys.platform.startswith("linux"):
        from .linux import LinuxDesktop
        return LinuxDesktop()
    raise DeskPilotError("PLATFORM_UNSUPPORTED", "This operating system has no DeskPilot backend.")
