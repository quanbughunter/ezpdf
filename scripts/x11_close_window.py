#!/usr/bin/env python3
"""Ask an X11 window to close the way a window manager's close button does
(WM_DELETE_WINDOW), so the app sees a normal close request.
Usage: python3 scripts/x11_close_window.py DISPLAY WINDOW_ID"""
import sys

from Xlib import X, display, protocol

d = display.Display(sys.argv[1])
w = d.create_resource_object('window', int(sys.argv[2]))
protocols = d.intern_atom('WM_PROTOCOLS')
delete = d.intern_atom('WM_DELETE_WINDOW')
w.send_event(protocol.event.ClientMessage(window=w, client_type=protocols, data=(32, [delete, X.CurrentTime, 0, 0, 0])), event_mask=X.NoEventMask)
d.flush()
