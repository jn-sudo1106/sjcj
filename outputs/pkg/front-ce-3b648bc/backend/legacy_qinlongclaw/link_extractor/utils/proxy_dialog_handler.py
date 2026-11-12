# -*- coding: utf-8 -*-
"""Chrome 原生代理认证弹窗检测与模拟消息自动填写器。

支持针对 Windows 原生弹窗 (#32770) 以及 Chrome 对话框进行检测，
使用 Windows 消息 (WM_SETTEXT, BM_CLICK, WM_CHAR, WM_KEYDOWN) 自动填入代理用户名和密码。
"""

import ctypes
from ctypes import wintypes
import logging
import os
import sys
import time
import urllib.parse
from pathlib import Path

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

WM_SETTEXT = 0x000C
WM_GETTEXT = 0x000D
WM_GETTEXTLENGTH = 0x000E
BM_CLICK = 0x00F5
WM_COMMAND = 0x0111
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_CHAR = 0x0102
VK_RETURN = 0x0D
VK_TAB = 0x09
IDOK = 1

WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def _get_window_text(hwnd: int) -> str:
    length = user32.GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buff = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buff, length + 1)
    return buff.value


def _get_class_name(hwnd: int) -> str:
    buff = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buff, 256)
    return buff.value


def _get_child_windows(parent_hwnd: int) -> list[dict]:
    children = []

    def enum_child_cb(hwnd, lparam):
        children.append({
            "hwnd": hwnd,
            "class_name": _get_class_name(hwnd),
            "text": _get_window_text(hwnd),
        })
        return True

    cb = WNDENUMPROC(enum_child_cb)
    user32.EnumChildWindows(parent_hwnd, cb, 0)
    return children


def find_proxy_auth_windows() -> list[dict]:
    """检测属于 Chrome/qinlong 进程且包含代理认证提示特征的弹窗。"""
    found = []

    def enum_windows_cb(hwnd, lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        title = _get_window_text(hwnd)
        class_name = _get_class_name(hwnd)
        lower_title = title.lower()

        keywords = [
            "代理", "身份验证", "sign in", "proxy", "authentication",
            "登录", "需要验证", "密码", "username", "password", "proxy authentication",
        ]
        is_dialog_class = class_name in ("#32770", "Chrome_WidgetWin_1", "Chrome_WidgetWin_0")
        if not is_dialog_class:
            return True

        is_matched_title = any(kw in lower_title for kw in keywords)
        # 如果窗口标题直接命中代理关键词
        if is_matched_title:
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            found.append({
                "hwnd": hwnd,
                "title": title,
                "class_name": class_name,
                "pid": pid.value,
            })
            return True

        # 若是 #32770，检查子控件中是否明确包含代理或认证相关提示文本
        children = _get_child_windows(hwnd)
        has_auth_kw = any(
            any(kw in str(c.get("text", "")).lower() for kw in keywords)
            for c in children
        )
        if has_auth_kw:
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            found.append({
                "hwnd": hwnd,
                "title": title,
                "class_name": class_name,
                "pid": pid.value,
            })
        return True

    cb = WNDENUMPROC(enum_windows_cb)
    user32.EnumWindows(cb, 0)
    return found


def handle_proxy_auth_dialog(
    username: str = "",
    password: str = "",
    timeout_seconds: float = 1.0,
) -> bool:
    """使用模拟 Windows 消息自动检测并填入代理用户名和密码。"""
    if os.name != "nt":
        return False

    if not username and not password:
        project_root = Path(__file__).resolve().parents[2]
        proxy_file = project_root / "txt" / "browser_proxy.txt"
        if proxy_file.exists():
            try:
                for line in proxy_file.read_text(encoding="utf-8-sig").splitlines():
                    val = line.strip()
                    if val and not val.startswith("#"):
                        parsed = urllib.parse.urlsplit(
                            val if "://" in val else f"http://{val}"
                        )
                        username = urllib.parse.unquote(parsed.username or "")
                        password = urllib.parse.unquote(parsed.password or "")
                        break
            except Exception:
                pass

    if not username:
        return False

    deadline = time.monotonic() + max(0.01, timeout_seconds)
    while time.monotonic() < deadline:
        windows = find_proxy_auth_windows()
        if not windows:
            break
        for win in windows:
            hwnd = win["hwnd"]
            children = _get_child_windows(hwnd)
            edits = [c for c in children if c["class_name"].lower() == "edit"]
            buttons = [
                c for c in children
                if c["class_name"].lower() in ("button", "syslink")
                or any(kw in c["text"].lower() for kw in ("登录", "确定", "ok", "sign in"))
            ]

            if len(edits) >= 2:
                # 原生 #32770 对话框：第一个 Edit 为用户名，第二个为密码
                user_edit = edits[0]["hwnd"]
                pass_edit = edits[1]["hwnd"]
                logging.info(
                    "[ProxyDialog] 检测到原生代理认证弹窗 HWND=%s，正在使用 WM_SETTEXT 发送凭据...",
                    hwnd
                )
                user32.SendMessageW(user_edit, WM_SETTEXT, 0, username)
                user32.SendMessageW(pass_edit, WM_SETTEXT, 0, password)
                time.sleep(0.1)

                if buttons:
                    user32.SendMessageW(buttons[0]["hwnd"], BM_CLICK, 0, 0)
                else:
                    user32.SendMessageW(hwnd, WM_COMMAND, IDOK, user_edit)
                logging.info("[ProxyDialog][OK] 代理认证凭据已成功通过 WM_SETTEXT/BM_CLICK 发送")
                return True
            elif edits:
                user_edit = edits[0]["hwnd"]
                logging.info(
                    "[ProxyDialog] 检测到单输入框代理弹窗 HWND=%s，正在发送消息...",
                    hwnd
                )
                user32.SendMessageW(user_edit, WM_SETTEXT, 0, username)
                user32.PostMessageW(user_edit, WM_KEYDOWN, VK_TAB, 0)
                user32.PostMessageW(user_edit, WM_KEYUP, VK_TAB, 0)
                time.sleep(0.1)
                focus_hwnd = user32.GetFocus() or user_edit
                user32.SendMessageW(focus_hwnd, WM_SETTEXT, 0, password)
                user32.PostMessageW(focus_hwnd, WM_KEYDOWN, VK_RETURN, 0)
                user32.PostMessageW(focus_hwnd, WM_KEYUP, VK_RETURN, 0)
                logging.info("[ProxyDialog][OK] 已成功填入凭据并发送模拟消息")
                return True
            else:
                logging.info(
                    "[ProxyDialog] 检测到 Chrome 界面代理弹窗 HWND=%s，正在发送按键消息...",
                    hwnd
                )
                user32.SetForegroundWindow(hwnd)
                time.sleep(0.1)
                focus_hwnd = user32.GetFocus() or hwnd
                for char in username:
                    user32.SendMessageW(focus_hwnd, WM_CHAR, ord(char), 0)
                user32.SendMessageW(focus_hwnd, WM_KEYDOWN, VK_TAB, 0)
                user32.SendMessageW(focus_hwnd, WM_KEYUP, VK_TAB, 0)
                time.sleep(0.1)
                focus_hwnd = user32.GetFocus() or hwnd
                for char in password:
                    user32.SendMessageW(focus_hwnd, WM_CHAR, ord(char), 0)
                user32.SendMessageW(focus_hwnd, WM_KEYDOWN, VK_RETURN, 0)
                user32.PostMessageW(focus_hwnd, WM_KEYUP, VK_RETURN, 0)
                logging.info("[ProxyDialog][OK] 已向对话框发送模拟字符与 Enter 消息")
                return True
        time.sleep(0.1)
    return False
