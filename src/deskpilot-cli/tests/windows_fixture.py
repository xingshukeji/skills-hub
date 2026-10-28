"""A disposable native window for DeskPilot Development checks."""

import ctypes as C
from ctypes import wintypes as W
import json
import os
import sys
from pathlib import Path

user, kernel, gdi = C.WinDLL("user32"), C.WinDLL("kernel32"), C.WinDLL("gdi32")
callback_type = C.WINFUNCTYPE(C.c_ssize_t, W.HWND, W.UINT, W.WPARAM, W.LPARAM)


class WNDCLASS(C.Structure):
    _fields_ = [("style", W.UINT), ("procedure", callback_type), ("class_extra", C.c_int), ("window_extra", C.c_int),
                ("instance", W.HINSTANCE), ("icon", W.HICON), ("cursor", W.HANDLE), ("background", W.HBRUSH),
                ("menu", W.LPCWSTR), ("name", W.LPCWSTR)]


user.CreateWindowExW.restype = W.HWND
user.CreateWindowExW.argtypes = [W.DWORD, W.LPCWSTR, W.LPCWSTR, W.DWORD, C.c_int, C.c_int, C.c_int, C.c_int,
                               W.HWND, W.HMENU, W.HINSTANCE, C.c_void_p]
user.DefWindowProcW.restype = C.c_ssize_t
user.DefWindowProcW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
user.SetWindowTextW.argtypes = [W.HWND, W.LPCWSTR]
user.GetWindowTextW.argtypes = [W.HWND, W.LPWSTR, C.c_int]
user.DestroyWindow.argtypes = [W.HWND]
user.SendMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
kernel.GetModuleHandleW.restype = W.HMODULE
gdi.CreateFontW.restype = W.HFONT
gdi.CreateFontW.argtypes = [C.c_int] * 5 + [W.DWORD] * 8 + [W.LPCWSTR]
instance = kernel.GetModuleHandleW(None)
edit = status = None


def procedure(handle, message, wparam, lparam):
    if message == 0x0111 and wparam & 0xFFFF == 102:
        value = C.create_unicode_buffer(4096)
        user.GetWindowTextW(edit, value, 4096)
        user.SetWindowTextW(status, "Result: " + value.value)
        return 0
    if message == 0x0010:
        user.DestroyWindow(handle)
        return 0
    if message == 0x0002:
        user.PostQuitMessage(0)
        return 0
    return user.DefWindowProcW(handle, message, wparam, lparam)


callback = callback_type(procedure)
name = "DeskPilotNativeFixture"
window_class = WNDCLASS(0, callback, 0, 0, instance, None, None, W.HBRUSH(6), None, name)
user.RegisterClassW.argtypes = [C.POINTER(WNDCLASS)]
user.RegisterClassW(C.byref(window_class))
title = sys.argv[1]
window = user.CreateWindowExW(0, name, title, 0x10CF0000, 340, 220, 900, 430, None, None, instance, None)
children = []


def child(class_name, text, x, y, width, height, identifier, style=0):
    handle = user.CreateWindowExW(0, class_name, text, 0x50010000 | style, x, y, width, height,
                                window, W.HMENU(identifier), instance, None)
    children.append(handle)
    return handle


child("STATIC", "DeskPilot Fixture - native controls", 24, 20, 800, 38, 100)
edit = child("EDIT", "Initial", 24, 80, 570, 38, 101, 0x00800080)
child("BUTTON", "Apply", 620, 80, 180, 40, 102)
status = child("STATIC", "Result: waiting", 24, 150, 810, 45, 103)
child("EDIT", "", 24, 230, 570, 38, 104, 0x008000A0)  # ES_PASSWORD
child("STATIC", "User-only password field", 24, 280, 700, 38, 105)
font = gdi.CreateFontW(-24, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 0, 0, "Microsoft YaHei")
for handle in children:
    user.SendMessageW(handle, 0x0030, font, 1)
user.SetForegroundWindow.argtypes = [W.HWND]
user.GetForegroundWindow.restype = W.HWND
if "--claim-input" in sys.argv:
    user.SetForegroundWindow(window)
    if user.GetForegroundWindow() != window:
        raise RuntimeError("The disposable focus fixture did not acquire foreground.")
    # Test setup: emulate the user clicking this fixture's static heading.
    # This is never a DeskPilot activation workaround or an input to another app.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from deskpilot.platforms.windows import WindowsDesktop
    fixture_desktop = WindowsDesktop()
    fixture_desktop.click(fixture_desktop.window(window), 100, 60)
    fixture_desktop.close()
print(json.dumps({"ready": True, "handle": window, "title": title, "pid": os.getpid()}), flush=True)
message = W.MSG()
while user.GetMessageW(C.byref(message), None, 0, 0) > 0:
    user.TranslateMessage(C.byref(message))
    user.DispatchMessageW(C.byref(message))
gdi.DeleteObject.argtypes = [W.HGDIOBJ]
gdi.DeleteObject(font)
