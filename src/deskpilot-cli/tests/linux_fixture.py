"""Owned GTK fixture using only the already installed system GTK libraries."""

import ctypes as C
import ctypes.util
import json
import sys

gtk = C.CDLL(C.util.find_library("gtk-3"))
glib = C.CDLL(C.util.find_library("glib-2.0"))
gobject = C.CDLL(C.util.find_library("gobject-2.0"))
atk = C.CDLL(C.util.find_library("atk-1.0"))
gdk = C.CDLL(C.util.find_library("gdk-3"))
pointer = C.c_void_p
for name, restype, args in [
    ("gtk_init_check", C.c_int, [pointer, pointer]),
    ("gtk_window_new", pointer, [C.c_int]),
    ("gtk_window_set_title", None, [pointer, C.c_char_p]),
    ("gtk_window_set_default_size", None, [pointer, C.c_int, C.c_int]),
    ("gtk_window_move", None, [pointer, C.c_int, C.c_int]),
    ("gtk_box_new", pointer, [C.c_int, C.c_int]),
    ("gtk_container_add", None, [pointer, pointer]),
    ("gtk_entry_new", pointer, []),
    ("gtk_entry_get_text", C.c_char_p, [pointer]),
    ("gtk_label_new", pointer, [C.c_char_p]),
    ("gtk_label_set_text", None, [pointer, C.c_char_p]),
    ("gtk_button_new_with_label", pointer, [C.c_char_p]),
    ("gtk_widget_get_accessible", pointer, [pointer]),
    ("gtk_widget_show_all", None, [pointer]),
    ("gtk_widget_get_window", pointer, [pointer]),
    ("gtk_main", None, []),
    ("gtk_main_quit", None, []),
]:
    function = getattr(gtk, name)
    function.restype, function.argtypes = restype, args
gobject.g_signal_connect_data.restype = C.c_ulong
gobject.g_signal_connect_data.argtypes = [pointer, C.c_char_p, pointer, pointer, pointer, C.c_int]
atk.atk_object_set_name.argtypes = [pointer, C.c_char_p]
glib.g_timeout_add.argtypes, glib.g_timeout_add.restype = [C.c_uint, pointer, pointer], C.c_uint
gdk.gdk_x11_window_get_xid.argtypes, gdk.gdk_x11_window_get_xid.restype = [pointer], C.c_ulong
if not gtk.gtk_init_check(None, None):
    raise SystemExit("GTK could not connect to the selected display.")
window = gtk.gtk_window_new(0)
gtk.gtk_window_set_title(window, sys.argv[1].encode("utf-8"))
gtk.gtk_window_set_default_size(window, 520, 200)
gtk.gtk_window_move(window, 80, 80)
box = gtk.gtk_box_new(1, 8)
gtk.gtk_container_add(window, box)
label = gtk.gtk_label_new(b"DeskPilot Linux Fixture")
edit = gtk.gtk_entry_new()
atk.atk_object_set_name(gtk.gtk_widget_get_accessible(edit), b"Input")
button = gtk.gtk_button_new_with_label(b"Apply")
result = gtk.gtk_label_new(b"waiting")
for child in (label, edit, button, result):
    gtk.gtk_container_add(box, child)


@C.CFUNCTYPE(None, pointer, pointer)
def clicked(*_):
    gtk.gtk_label_set_text(result, b"Result: " + gtk.gtk_entry_get_text(edit))


@C.CFUNCTYPE(None, pointer, pointer)
def closed(*_):
    gtk.gtk_main_quit()


@C.CFUNCTYPE(C.c_int, pointer)
def ready(_):
    print(json.dumps({"ready": True, "xid": gdk.gdk_x11_window_get_xid(gtk.gtk_widget_get_window(window))}), flush=True)
    return False


gobject.g_signal_connect_data(button, b"clicked", clicked, None, None, 0)
gobject.g_signal_connect_data(window, b"destroy", closed, None, None, 0)
gtk.gtk_widget_show_all(window)
glib.g_timeout_add(250, ready, None)
gtk.gtk_main()
