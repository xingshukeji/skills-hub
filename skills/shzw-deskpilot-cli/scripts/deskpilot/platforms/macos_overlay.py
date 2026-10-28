"""A tiny AppKit helper keeps macOS windows on their required main thread."""

from __future__ import annotations

import ctypes as C
import json
import os
from pathlib import Path
import queue
import select
import subprocess
import sys
import threading
import time

from .. import DeskPilotError


class MacOverlay:
    def __init__(self):
        environment = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
        package = str(Path(__file__).resolve().parents[2])
        entry = "import sys;sys.path.insert(0," + repr(package) + ");from deskpilot.platforms.macos_overlay import run;run()"
        self.process = subprocess.Popen([sys.executable, "-I", "-S", "-B", "-c", entry],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                        text=True, encoding="utf-8", env=environment)
        if not select.select([self.process.stdout], [], [], 3)[0]:
            self.close()
            raise DeskPilotError("OVERLAY_UNAVAILABLE", "The AppKit activity helper did not initialize.")
        try:
            ready = json.loads(self.process.stdout.readline(4096))
            if not ready.get("ready"):
                raise ValueError()
        except (ValueError, OSError):
            self.close()
            raise DeskPilotError("OVERLAY_UNAVAILABLE", "The AppKit activity helper could not create its windows.") from None

    def update(self, area, label, trace=None):
        if self.process.poll() is not None:
            raise DeskPilotError("OVERLAY_UNAVAILABLE", "The AppKit activity helper is no longer running.")
        try:
            self.process.stdin.write(json.dumps({"area": area, "label": label, "trace": trace}, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
        except OSError:
            raise DeskPilotError("OVERLAY_UNAVAILABLE", "The activity helper could not receive its update.") from None

    def close(self):
        if self.process.stdin:
            self.process.stdin.close()
        try:
            self.process.wait(2)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(2)
        if self.process.stdout:
            self.process.stdout.close()


def run():
    from .macos import MacDesktop, Point, Rect, Size
    desktop = MacDesktop()
    objc, cf, cg = desktop.objc, desktop.cf, desktop.cg
    cg.CGMainDisplayID.restype = C.c_uint32
    cg.CGDisplayBounds.argtypes = [C.c_uint32]
    cg.CGDisplayBounds.restype = Rect
    display = cg.CGDisplayBounds(cg.CGMainDisplayID())
    app = objc.send(objc.cls("NSApplication"), "sharedApplication")
    objc.send(app, "setActivationPolicy:", C.c_bool, (C.c_long,), (1,))
    objc.send(app, "finishLaunching", None)
    clear = objc.send(objc.cls("NSColor"), "clearColor")
    blue = objc.send(objc.cls("NSColor"), "systemBlueColor")
    border_color = objc.send(blue, "CGColor")
    windows = []

    def make_window(width, height, bordered=False):
        frame = Rect(Point(0, 0), Size(width, height))
        window = objc.send(objc.cls("NSPanel"), "alloc")
        window = objc.send(window, "initWithContentRect:styleMask:backing:defer:",
                           types=(Rect, C.c_ulong, C.c_ulong, C.c_bool), args=(frame, 128, 2, False))
        objc.send(window, "setLevel:", None, (C.c_long,), (25,))
        objc.send(window, "setOpaque:", None, (C.c_bool,), (False,))
        objc.send(window, "setHasShadow:", None, (C.c_bool,), (False,))
        objc.send(window, "setIgnoresMouseEvents:", None, (C.c_bool,), (True,))
        objc.send(window, "setBackgroundColor:", None, (C.c_void_p,), (clear,))
        objc.send(window, "setCollectionBehavior:", None, (C.c_ulong,), (1 | 16 | 64 | 256,))
        view = objc.send(objc.send(objc.cls("NSView"), "alloc"), "initWithFrame:", types=(Rect,), args=(frame,))
        objc.send(view, "setWantsLayer:", None, (C.c_bool,), (True,))
        layer = objc.send(view, "layer")
        if bordered:
            objc.send(layer, "setBorderWidth:", None, (C.c_double,), (3.0,))
            objc.send(layer, "setBorderColor:", None, (C.c_void_p,), (border_color,))
        objc.send(window, "setContentView:", None, (C.c_void_p,), (view,))
        objc.send(view, "release", None)
        windows.append(window)
        return window, view, layer

    frame, _, _ = make_window(1, 1, True)
    panel, panel_view, panel_layer = make_window(320, 38, True)
    background = objc.send(objc.send(objc.cls("NSColor"), "windowBackgroundColor"), "colorWithAlphaComponent:",
                            types=(C.c_double,), args=(0.94,))
    objc.send(panel, "setBackgroundColor:", None, (C.c_void_p,), (background,))
    label = objc.send(objc.send(objc.cls("NSTextField"), "alloc"), "initWithFrame:",
                      types=(Rect,), args=(Rect(Point(10, 8), Size(300, 23)),))
    for name, value in (("setEditable:", False), ("setSelectable:", False), ("setBordered:", False), ("setDrawsBackground:", False)):
        objc.send(label, name, None, (C.c_bool,), (value,))
    objc.send(label, "setTextColor:", None, (C.c_void_p,), (blue,))
    objc.send(panel_view, "addSubview:", None, (C.c_void_p,), (label,))
    trace_window, _, trace_layer = make_window(28, 28, True)
    objc.send(trace_layer, "setCornerRadius:", None, (C.c_double,), (14.0,))
    mode = desktop.string("kCFRunLoopDefaultMode")
    messages = queue.Queue()

    def read():
        try:
            for line in sys.stdin:
                value = json.loads(line)
                messages.put(value)
        except (ValueError, OSError):
            pass
        finally:
            messages.put(None)

    threading.Thread(target=read, daemon=True).start()
    print(json.dumps({"ready": True}), flush=True)
    deadline = 0
    border_visible = False

    def position(window, x, y, width, height):
        rectangle = Rect(Point(x, display.size.height - y - height), Size(width, height))
        objc.send(window, "setFrame:display:", None, (Rect, C.c_bool), (rectangle, True))
        objc.send(window, "orderFrontRegardless", None)

    running = True
    try:
        while running:
            pool = objc.send(objc.send(objc.cls("NSAutoreleasePool"), "alloc"), "init")
            try:
                while True:
                    try:
                        message = messages.get_nowait()
                    except queue.Empty:
                        break
                    if message is None:
                        running = False
                        break
                    text = desktop.string("DeskPilot · " + str(message.get("label", "Ready"))[:120])
                    objc.send(label, "setStringValue:", None, (C.c_void_p,), (text,))
                    cf.CFRelease(text)
                    position(panel, display.size.width - 335, 12, 320, 38)
                    area = message.get("area")
                    if area:
                        position(frame, area["x"], area["y"], area["width"], area["height"])
                        deadline, border_visible = time.monotonic() + 2, True
                        trace = message.get("trace")
                        if trace:
                            position(trace_window, area["x"] + trace[0] - 14, area["y"] + trace[1] - 14, 28, 28)
                        else:
                            objc.send(trace_window, "orderOut:", None, (C.c_void_p,), (None,))
                    else:
                        border_visible = False
                        objc.send(frame, "orderOut:", None, (C.c_void_p,), (None,))
                        objc.send(trace_window, "orderOut:", None, (C.c_void_p,), (None,))
                if border_visible and time.monotonic() >= deadline:
                    border_visible = False
                    objc.send(frame, "orderOut:", None, (C.c_void_p,), (None,))
                    objc.send(trace_window, "orderOut:", None, (C.c_void_p,), (None,))
                date = objc.send(objc.cls("NSDate"), "dateWithTimeIntervalSinceNow:", types=(C.c_double,), args=(0.05,))
                event = objc.send(app, "nextEventMatchingMask:untilDate:inMode:dequeue:",
                                  types=(C.c_ulong, C.c_void_p, C.c_void_p, C.c_bool), args=((1 << 64) - 1, date, mode, True))
                if event:
                    objc.send(app, "sendEvent:", None, (C.c_void_p,), (event,))
                objc.send(app, "updateWindows", None)
            finally:
                objc.send(pool, "drain", None)
    finally:
        for window in windows:
            objc.send(window, "orderOut:", None, (C.c_void_p,), (None,))
            objc.send(window, "release", None)
        objc.send(label, "release", None)
        cf.CFRelease(mode)
        desktop.close()
