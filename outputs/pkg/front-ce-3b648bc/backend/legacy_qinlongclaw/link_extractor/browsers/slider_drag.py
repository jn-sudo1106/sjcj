"""通过 Chrome DevTools Protocol / Windows 窗口消息 / Firefox BiDi 自动识别与拟人化拖动滑块验证码。

主要特性：
- 多模式自适应兼容：
  1. Chrome CDP 原生模式 (Input.dispatchMouseEvent)
  2. Windows 原生窗口消息模式 (WM_LBUTTONDOWN / WM_MOUSEMOVE / WM_LBUTTONUP)
  3. Firefox BiDi 动作链模式 (ruyipage Actions 一体化拖拽)
- 封装 AliyunSliderSolver 类：统一管理阿里云/ESA等滑块的几何计算、渲染等待、拖拽与结果轮询、失败重试。
- 拟人化拖拽算法：集成缓动曲线（Ease-in-out）、非中心安全按压偏移、Y 轴微抖动、末端超滑冗余（Over-drag）与随机延时。
- 兼容命令行独立运行测试与在 BrowserManager / FirefoxFallback 流程中直接调用。
"""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import json
import logging
import math
import os
import random
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from .cdp_client import (
        CDP_PORT,
        CDPPage,
        find_chrome,
        get_cdp_base_url,
        launch_chrome,
    )
except ImportError:
    # 兼容直接执行：python link_extractor/browsers/slider_drag.py <url>
    link_extractor_dir = Path(__file__).resolve().parents[1]
    if str(link_extractor_dir) not in sys.path:
        sys.path.insert(0, str(link_extractor_dir))
    from browsers.cdp_client import (  # type: ignore[no-redef]
        CDP_PORT,
        CDPPage,
        find_chrome,
        get_cdp_base_url,
        launch_chrome,
    )

logger = logging.getLogger("slider_drag")

# Windows 鼠标消息常量
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
MK_LBUTTON = 0x0001


# ----------------------------------------------------------------------
# 统一页面 JS 执行抽象（兼容 CDPPage 与 FirefoxPage）
# ----------------------------------------------------------------------

def _eval_js(page: Any, script: str) -> Any:
    """统一执行 JS 脚本，自适应 CDPPage (evaluate)、FirefoxPage (run_js) 与 DrissionPage (run_js)。"""
    if hasattr(page, "evaluate"):
        return page.evaluate(script)
    elif hasattr(page, "run_js"):
        source = script.strip()
        function_prefix = source.split("{", 1)[0]
        if "=>" in function_prefix or source.startswith(("function", "async function")):
            try:
                return page.run_js(f"({source})()", as_expr=True)
            except TypeError:
                return page.run_js(f"return ({source})()")
        return page.run_js(source)
    raise AttributeError(f"不支持的页面对象类型: {type(page)}")


def _normalize_cli_url(value: str) -> str:
    """校验 CLI URL，并兼容误粘贴的 Markdown 链接格式。"""
    raw_url = str(value or "").strip()
    if raw_url.startswith("[") and "](" in raw_url and raw_url.endswith(")"):
        label, target = raw_url[1:-1].split("](", 1)
        if label != target:
            raise ValueError("Markdown 链接的显示地址与目标地址不一致")
        logger.warning("检测到 Markdown 链接参数，已提取纯 URL: %s", target)
        raw_url = target

    parsed = urllib.parse.urlsplit(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("URL 必须是完整的 http:// 或 https:// 地址")
    return raw_url


# ----------------------------------------------------------------------
# 缓动函数与拟人轨迹生成
# ----------------------------------------------------------------------

def ease_in_out_sine(t: float) -> float:
    """正弦缓动：起步慢、中间快、结尾慢。"""
    return -(math.cos(math.pi * t) - 1) / 2.0


def ease_in_out_cubic(t: float) -> float:
    """三次方缓动：起步加速柔和，尾段减速明显。"""
    if t < 0.5:
        return 4.0 * t * t * t
    return 1.0 - math.pow(-2.0 * t + 2.0, 3) / 2.0


def generate_human_track(
    start_x: float,
    start_y: float,
    distance: float,
    steps: int = 15,
    extra_distance: float = 20.0,
    overshoot_px: float = 0.0,
) -> List[Tuple[float, float, float]]:
    """生成具备真实生物动力学（手腕弧度偏移、变速大步长、肌电微抖）的拟人化鼠标移动轨迹点。

    根据真实 Firefox 轨迹数据分析：
    1. 步数离散：人类在 250~450ms 内快速划过屏幕，浏览器通常仅捕获 10~18 个 pointermove 事件，中间伴随单步 50~100px 的大跨度加速。
    2. 手腕弧度偏转：右手向右拖拽时以腕肘为轴，Y 轴通常呈现自然的单向弧度偏转（如 -5px ~ -18px 向上微曲并在终段渐趋平稳），而非高频白噪微震。
    3. 超程拖动与速度节奏：中段快速扫掠（步延时 5~12ms），两头轻微减速。

    参数:
    - distance: 几何计算的理论滑动距离
    - steps: 移动采样步数（推荐 12~18 步，默认 15 步）
    - extra_distance: 超出理论距离的冗余增量（通常 15~25px），确保彻底拉满
    - overshoot_px: 拟人化过冲距离（拉满型滑块默认 0.0；特定拼图滑块可设少量）

    返回: List[(x, y, sleep_seconds)]
    """
    if steps < 5:
        steps = 5

    # 实际目标滑动距离 = 基础距离 + 随机冗余增量（彻底拉到右侧挡板）
    random_extra = random.uniform(extra_distance * 0.8, extra_distance * 1.3) if extra_distance > 0 else 0.0
    effective_distance = distance + random_extra

    track: List[Tuple[float, float, float]] = []
    has_overshoot = effective_distance > 50 and overshoot_px > 0
    actual_overshoot = random.uniform(2.0, overshoot_px) if has_overshoot else 0.0

    # 轨迹总移动阶段划分：前 88% 步数前进至 overshoot，后 12% 步数微调回拉到终点
    forward_steps = int(steps * 0.88) if has_overshoot else steps
    backward_steps = steps - forward_steps

    target_distance = effective_distance + actual_overshoot

    # 手腕向右扫动的弧度总偏转量（根据人手力学，右手向右拖拽通常向上偏 6~18px，偶尔向下微偏 2~5px）
    if random.random() < 0.85:
        max_y_arc = -random.uniform(6.0, 18.0)  # 向上偏（Y 减小）
    else:
        max_y_arc = random.uniform(2.0, 6.0)   # 向下偏（Y 增大）

    # 前进阶段
    for i in range(1, forward_steps + 1):
        t = i / float(forward_steps)
        progress = ease_in_out_cubic(t)
        curr_x = start_x + target_distance * progress

        # Y 轴：手腕弧度偏转模型（单向平滑弧线，在中后段达到峰值偏转并渐进保持）
        arc_factor = 1.0 - math.pow(1.0 - t, 2.2)
        micro_jitter = random.uniform(-0.4, 0.4) * math.sin(t * math.pi)
        curr_y = start_y + (max_y_arc * arc_factor) + micro_jitter

        # 随机步长延时：中间快速滑动（约 5~10ms），两头较慢（约 15~28ms）
        speed_factor = math.sin(t * math.pi)
        base_delay = 0.006 + (1.0 - speed_factor) * 0.015
        step_delay = max(0.004, base_delay + random.uniform(-0.002, 0.004))

        track.append((curr_x, curr_y, step_delay))

    # 回调阶段（如有过冲，回拉到 effective_distance）
    if backward_steps > 0:
        start_rebound_x = track[-1][0] if track else (start_x + target_distance)
        final_x = start_x + effective_distance
        rebound_base_y = track[-1][1] if track else (start_y + max_y_arc)
        for i in range(1, backward_steps + 1):
            t = i / float(backward_steps)
            progress = ease_in_out_sine(t)
            curr_x = start_rebound_x - (start_rebound_x - final_x) * progress
            curr_y = rebound_base_y + random.uniform(-0.3, 0.3)
            step_delay = 0.015 + random.uniform(0.005, 0.012)
            track.append((curr_x, curr_y, step_delay))

    return track


# ----------------------------------------------------------------------
# Windows 句柄探测（用于 Windows 窗口消息方式拖动）
# ----------------------------------------------------------------------

def find_chrome_render_hwnd(pid: Optional[int] = None) -> Optional[int]:
    """寻找 Chrome 渲染视口句柄 (Chrome_RenderWidgetHostHWND)。"""
    if os.name != "nt":
        return None
    user32 = ctypes.windll.user32
    target_hwnds = []

    def enum_windows_cb(hwnd, lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        buf = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, buf, 256)
        if buf.value == "Chrome_WidgetWin_1":
            if pid is not None:
                win_pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(win_pid))
                if win_pid.value == pid:
                    target_hwnds.append(hwnd)
            else:
                target_hwnds.append(hwnd)
        return True

    CB = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(CB(enum_windows_cb), 0)

    for top_hwnd in target_hwnds:
        # 寻找子窗口 Chrome_RenderWidgetHostHWND
        render_hwnd = user32.FindWindowExW(top_hwnd, 0, "Chrome_RenderWidgetHostHWND", None)
        if render_hwnd:
            return render_hwnd
        child_hwnds = []
        def enum_child_cb(hwnd, lparam):
            buf = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, buf, 256)
            if buf.value == "Chrome_RenderWidgetHostHWND":
                child_hwnds.append(hwnd)
            return True
        user32.EnumChildWindows(top_hwnd, CB(enum_child_cb), 0)
        if child_hwnds:
            return child_hwnds[0]
        return top_hwnd
    return None


# ----------------------------------------------------------------------
# 鼠标底层事件分发（CDP vs Windows 窗口消息 vs Firefox BiDi）
# ----------------------------------------------------------------------

def _dispatch_cdp_mouse_event(page: Any, event_type: str, **params: Any) -> None:
    """发送一个 CDP 鼠标事件，并在协议返回错误时抛出异常。支持 CDPPage 与 DrissionPage。"""
    if hasattr(page, "send_cmd"):
        response = page.send_cmd(
            "Input.dispatchMouseEvent",
            {"type": event_type, "pointerType": "mouse", **params},
        )
        if response.get("error"):
            error = response["error"]
            raise RuntimeError(
                f"CDP 鼠标事件发送失败: {error.get('message', error)}"
            )
    elif hasattr(page, "run_cdp"):
        page.run_cdp(
            "Input.dispatchMouseEvent",
            type=event_type,
            pointerType="mouse",
            **params,
        )
    else:
        raise AttributeError(f"不支持发送 CDP 鼠标事件的页面对象: {type(page)}")


def _drag_with_firefox_actions(
    page: Any,
    start_x: float,
    start_y: float,
    distance: float,
    steps: int,
    extra_distance: float,
    humanize: bool,
    step_delay: float,
) -> None:
    """使用 Firefox (ruyipage BiDi Actions) 执行鼠标拖拽。
    关键：所有动作（移动、按住、连续轨迹、释放）必须合并为同一个 action 链一次性 perform()。
    """
    sx = int(round(start_x))
    sy = int(round(start_y))

    # 1. 移动鼠标到起点
    page.actions.move_to((sx, sy), duration=random.randint(35, 65) if humanize else 40)
    # 2. 按下左键 (0=左键)
    page.actions.hold(button=0)
    if humanize:
        # 按下后的起步反应生理延迟 (80~140ms)
        page.actions.wait(random.uniform(0.08, 0.14))

    # 3. 连续轨迹拖拽
    if humanize:
        trajectory = generate_human_track(
            start_x,
            start_y,
            distance,
            steps=steps,
            extra_distance=extra_distance,
        )
        for x, y, delay in trajectory:
            page.actions.move_to(
                (int(round(x)), int(round(y))),
                duration=max(1, int(round(delay * 1000))),
            )
        # 到达终点后的松手确认延迟 (220~350ms)
        page.actions.wait(random.uniform(0.22, 0.35))
    else:
        total_distance = distance + (extra_distance if extra_distance > 0 else 0.0)
        for step in range(1, steps + 1):
            next_x = int(round(start_x + total_distance * step / steps))
            page.actions.move_to(
                (next_x, sy),
                duration=max(1, int(step_delay * 1000)),
            )

    # 4. 释放左键
    page.actions.release(button=0)

    # 5. 一次性提交完整 BiDi 拖拽动作链
    page.actions.perform()


def _drag_with_win32_messages(
    hwnd: int,
    start_x: float,
    start_y: float,
    distance: float,
    steps: int,
    extra_distance: float,
    humanize: bool,
    step_delay: float,
) -> None:
    """使用 Windows 窗口消息 (PostMessage WM_LBUTTONDOWN/MOVE/UP) 直接驱动浏览器窗口拖拽。"""
    user32 = ctypes.windll.user32
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.05)

    sx, sy = int(round(start_x)), int(round(start_y))
    lparam_start = ((sy & 0xFFFF) << 16) | (sx & 0xFFFF)

    # 1. 移动鼠标至起点
    user32.PostMessageW(hwnd, WM_MOUSEMOVE, 0, lparam_start)
    time.sleep(random.uniform(0.05, 0.12) if humanize else 0.05)

    # 2. 按下左键
    user32.PostMessageW(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, lparam_start)
    time.sleep(random.uniform(0.08, 0.14) if humanize else 0.05)

    curr_x, curr_y = sx, sy
    try:
        if humanize:
            trajectory = generate_human_track(
                start_x,
                start_y,
                distance,
                steps=steps,
                extra_distance=extra_distance,
            )
            for x, y, delay in trajectory:
                ix, iy = int(round(x)), int(round(y))
                lparam = ((iy & 0xFFFF) << 16) | (ix & 0xFFFF)
                user32.PostMessageW(hwnd, WM_MOUSEMOVE, MK_LBUTTON, lparam)
                curr_x, curr_y = ix, iy
                if delay > 0:
                    time.sleep(delay)
        else:
            total_distance = distance + (extra_distance if extra_distance > 0 else 0.0)
            for step in range(1, steps + 1):
                next_x = int(round(start_x + total_distance * step / steps))
                lparam = ((sy & 0xFFFF) << 16) | (next_x & 0xFFFF)
                user32.PostMessageW(hwnd, WM_MOUSEMOVE, MK_LBUTTON, lparam)
                curr_x = next_x
                if step_delay:
                    time.sleep(step_delay)
        # 到达终点后的松手确认延迟 (220~350ms)
        time.sleep(random.uniform(0.22, 0.35) if humanize else 0.05)
    finally:
        # 3. 释放左键
        lparam_end = ((curr_y & 0xFFFF) << 16) | (curr_x & 0xFFFF)
        user32.PostMessageW(hwnd, WM_LBUTTONUP, 0, lparam_end)


def _drag_with_cdp(
    page: Any,
    start_x: float,
    start_y: float,
    distance: float,
    steps: int,
    extra_distance: float,
    humanize: bool,
    step_delay: float,
) -> None:
    """使用 Chrome (CDP) 执行鼠标拖拽。"""
    # 1. 移动鼠标至滑块中心
    _dispatch_cdp_mouse_event(
        page,
        "mouseMoved",
        x=start_x,
        y=start_y,
        button="none",
        buttons=0,
    )
    time.sleep(random.uniform(0.05, 0.12) if humanize else 0.05)

    # 2. 按下左键
    _dispatch_cdp_mouse_event(
        page,
        "mousePressed",
        x=start_x,
        y=start_y,
        button="left",
        buttons=1,
        clickCount=1,
    )
    time.sleep(random.uniform(0.08, 0.14) if humanize else 0.05)

    current_x = start_x
    current_y = start_y

    try:
        if humanize:
            trajectory = generate_human_track(
                start_x,
                start_y,
                distance,
                steps=steps,
                extra_distance=extra_distance,
            )
            for x, y, delay in trajectory:
                _dispatch_cdp_mouse_event(
                    page,
                    "mouseMoved",
                    x=x,
                    y=y,
                    button="none",
                    buttons=1,
                )
                current_x, current_y = x, y
                if delay > 0:
                    time.sleep(delay)
        else:
            total_distance = distance + (extra_distance if extra_distance > 0 else 0.0)
            for step in range(1, steps + 1):
                next_x = start_x + total_distance * step / steps
                _dispatch_cdp_mouse_event(
                    page,
                    "mouseMoved",
                    x=next_x,
                    y=start_y,
                    button="none",
                    buttons=1,
                )
                current_x = next_x
                if step_delay:
                    time.sleep(step_delay)

        # 拖拽到目标位置后短暂停顿，模拟人工松开前的确认
        time.sleep(random.uniform(0.22, 0.35) if humanize else 0.05)
    finally:
        # 3. 释放左键
        _dispatch_cdp_mouse_event(
            page,
            "mouseReleased",
            x=current_x,
            y=current_y,
            button="left",
            buttons=0,
            clickCount=1,
        )


def drag_slider(
    page: Any,
    *,
    start_x: float,
    start_y: float,
    distance: float,
    steps: int = 15,
    extra_distance: float = 20.0,
    step_delay: float = 0.01,
    humanize: bool = True,
    method: str = "auto",
) -> None:
    """通用滑块拖动函数：自适应 Chrome (CDP / Win32 窗口消息) 与 Firefox (ruyipage BiDi)。"""
    if distance < 0:
        raise ValueError("distance 不能小于 0")
    if steps < 1:
        raise ValueError("steps 必须大于或等于 1")

    # 1. Firefox 内核
    if hasattr(page, "actions") and hasattr(page.actions, "perform"):
        _drag_with_firefox_actions(
            page,
            start_x=start_x,
            start_y=start_y,
            distance=distance,
            steps=steps,
            extra_distance=extra_distance,
            humanize=humanize,
            step_delay=step_delay,
        )
        return

    # 2. Windows 窗口消息模式
    if method == "win32_msg" or os.getenv("SLIDER_DRAG_METHOD", "").lower() in ("win32", "msg", "windows"):
        hwnd = find_chrome_render_hwnd()
        if hwnd:
            logger.info("[Drag] 正在使用 Windows 窗口消息 (PostMessage HWND=%s) 执行拖动", hwnd)
            _drag_with_win32_messages(
                hwnd,
                start_x=start_x,
                start_y=start_y,
                distance=distance,
                steps=steps,
                extra_distance=extra_distance,
                humanize=humanize,
                step_delay=step_delay,
            )
            return
        else:
            logger.warning("[Drag] 未找到 Chrome 渲染窗口句柄，自动回退到 CDP 模式")

    # 3. 默认 Chrome CDP 模式
    _drag_with_cdp(
        page,
        start_x=start_x,
        start_y=start_y,
        distance=distance,
        steps=steps,
        extra_distance=extra_distance,
        humanize=humanize,
        step_delay=step_delay,
    )


def _load_recorded_trace(trace_file: str) -> tuple[Path, dict]:
    """读取并校验人工 PointerEvent 轨迹文件的基本结构。"""
    trace_path = Path(trace_file).expanduser().resolve()
    if not trace_path.is_file():
        raise ValueError(f"轨迹文件不存在: {trace_path}")
    try:
        trace = json.loads(trace_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as ex:
        raise ValueError(f"无法读取轨迹文件: {ex}") from ex

    events = trace.get("events") or []
    if len(events) < 2:
        raise ValueError("轨迹至少需要 pointerdown 和 pointerup 两个事件")
    if events[0].get("type") != "pointerdown":
        raise ValueError("轨迹第一个事件必须是 pointerdown")
    if events[-1].get("type") not in {"pointerup", "pointercancel"}:
        raise ValueError("轨迹最后一个事件必须是 pointerup 或 pointercancel")
    return trace_path, trace


def _url_scope_key(url: str) -> tuple[str, str, str]:
    parsed = urllib.parse.urlsplit(url)
    path = parsed.path.rstrip("/") or "/"
    return parsed.scheme.lower(), (parsed.hostname or "").lower(), path


def _validate_recorded_trace_scope(
    trace: dict,
    target_url: str,
    browser_name: str,
) -> None:
    """限制轨迹只能回放到其记录时的同一地址和同一浏览器。"""
    recorded_url = _normalize_cli_url(str(trace.get("url") or ""))
    if _url_scope_key(recorded_url) != _url_scope_key(target_url):
        raise ValueError(
            "轨迹回放范围不匹配：只允许记录时的同一协议、域名和路径"
        )

    recorded_browser = str(trace.get("browser") or "").lower()
    allowed_browsers = {browser_name.lower()}
    if browser_name.lower() in ("test", "drission"):
        allowed_browsers.update(["chrome", "test", "drission"])
    if recorded_browser and recorded_browser not in allowed_browsers:
        raise ValueError(
            f"轨迹由 {recorded_browser} 记录，请使用 --browser {recorded_browser}"
        )


def _wait_for_recorded_trace_geometry(
    page: Any,
    timeout_seconds: float = 20.0,
) -> dict:
    deadline = time.monotonic() + max(1.0, timeout_seconds)
    while time.monotonic() < deadline:
        geometry = AliyunSliderSolver.get_geometry(page)
        if geometry and geometry.get("visible"):
            return geometry
        time.sleep(0.2)
    raise TimeoutError("等待当前页面滑块几何信息超时")


def _recorded_event_point(
    event: dict,
    start_x: float,
    start_y: float,
) -> tuple[float, float]:
    return (
        start_x + float(event.get("dx") or 0),
        start_y + float(event.get("dy") or 0),
    )


def _replay_recorded_trace_firefox(
    page: Any,
    events: List[dict],
    start_x: float,
    start_y: float,
) -> None:
    """通过单次 Firefox BiDi Actions 链回放已记录的关键帧。"""
    page.actions.move_to(
        (int(round(start_x)), int(round(start_y))),
        duration=40,
    )
    page.actions.hold(button=0)

    previous_t = float(events[0].get("t") or 0)
    released = False
    for event in events[1:]:
        event_t = float(event.get("t") or previous_t)
        duration_ms = max(1, int(round(event_t - previous_t)))
        event_type = str(event.get("type") or "")
        if event_type == "pointermove":
            x, y = _recorded_event_point(event, start_x, start_y)
            page.actions.move_to(
                (int(round(x)), int(round(y))),
                duration=duration_ms,
            )
        elif event_type in {"pointerup", "pointercancel"}:
            page.actions.wait(duration_ms / 1000.0)
            page.actions.release(button=0)
            released = True
        previous_t = event_t

    if not released:
        page.actions.release(button=0)
    page.actions.perform()


def _replay_recorded_trace_cdp(
    page: Any,
    events: List[dict],
    start_x: float,
    start_y: float,
) -> None:
    """通过 Chrome CDP 按记录时间发送轨迹关键帧。"""
    _dispatch_cdp_mouse_event(
        page, "mouseMoved", x=start_x, y=start_y,
        button="none", buttons=0,
    )
    _dispatch_cdp_mouse_event(
        page, "mousePressed", x=start_x, y=start_y,
        button="left", buttons=1, clickCount=1,
    )

    previous_t = float(events[0].get("t") or 0)
    current_x, current_y = start_x, start_y
    released = False
    try:
        for event in events[1:]:
            event_t = float(event.get("t") or previous_t)
            delay = max(0.0, event_t - previous_t) / 1000.0
            if delay:
                time.sleep(delay)
            event_type = str(event.get("type") or "")
            if event_type == "pointermove":
                current_x, current_y = _recorded_event_point(
                    event, start_x, start_y
                )
                _dispatch_cdp_mouse_event(
                    page, "mouseMoved", x=current_x, y=current_y,
                    button="none", buttons=1,
                )
            elif event_type in {"pointerup", "pointercancel"}:
                _dispatch_cdp_mouse_event(
                    page, "mouseReleased", x=current_x, y=current_y,
                    button="left", buttons=0, clickCount=1,
                )
                released = True
            previous_t = event_t
    finally:
        if not released:
            _dispatch_cdp_mouse_event(
                page, "mouseReleased", x=current_x, y=current_y,
                button="left", buttons=0, clickCount=1,
            )


def replay_recorded_trace(page: Any, trace: dict, geometry: dict) -> None:
    """把同一页面记录的相对轨迹映射到当前滑块位置并回放一次。"""
    source_geometry = trace.get("geometry") or {}
    source_slider = source_geometry.get("slider") or {}
    current_slider = geometry.get("slider") or {}
    source_distance = float(source_geometry.get("movableDistance") or 0)
    current_distance = float(geometry.get("movableDistance") or 0)
    tolerance = max(2.0, source_distance * 0.02)
    if source_distance <= 0 or abs(source_distance - current_distance) > tolerance:
        raise ValueError(
            "当前滑块尺寸与记录时不一致，拒绝回放未缩放的轨迹"
        )

    down = trace["events"][0]
    grip_x = float(down.get("clientX") or 0) - float(source_slider.get("left") or 0)
    grip_y = float(down.get("clientY") or 0) - float(source_slider.get("top") or 0)
    start_x = float(current_slider.get("left") or 0) + grip_x
    start_y = float(current_slider.get("top") or 0) + grip_y
    events = list(trace.get("events") or [])

    logger.info(
        "[TraceReplay] 事件数=%d, 起点=(%.1f, %.1f), 记录距离=%.1f, 当前距离=%.1f",
        len(events), start_x, start_y, source_distance, current_distance,
    )
    if hasattr(page, "actions") and hasattr(page.actions, "perform"):
        _replay_recorded_trace_firefox(page, events, start_x, start_y)
    else:
        _replay_recorded_trace_cdp(page, events, start_x, start_y)


# ----------------------------------------------------------------------
# 阿里云 / ESA 滑块验证码求解器（通用跨浏览器）
# ----------------------------------------------------------------------

class AliyunSliderSolver:
    """阿里云 / ESA 滑块验证码自动识别与求解器（兼容 Chrome 与 Firefox，支持多模式拖拽与重试）。"""

    SLIDER_SELECTORS = [
        "#aliyunCaptcha-sliding-slider",
        ".nc_iconfont.btn_slide",
        "#nc_1_n1z",
        ".btn_slide",
    ]

    TRACK_SELECTORS = [
        "#aliyunCaptcha-sliding-body",
        ".nc_scale",
        "#nc_1__scale_text",
    ]

    @classmethod
    def get_geometry(cls, page: Any) -> Optional[Dict[str, Any]]:
        """获取页面滑块与轨道的几何信息（坐标、宽高、可滑动距离）。"""
        try:
            geometry = _eval_js(page, """
                () => {
                    const sliderSelectors = [
                        '#aliyunCaptcha-sliding-slider',
                        '.nc_iconfont.btn_slide',
                        '#nc_1_n1z',
                        '.btn_slide'
                    ];
                    let slider = null;
                    for (const sel of sliderSelectors) {
                        slider = document.querySelector(sel);
                        if (slider) break;
                    }
                    if (!slider) return null;

                    const trackSelectors = [
                        '#aliyunCaptcha-sliding-body',
                        '.nc_scale',
                        '#nc_1__scale_text'
                    ];
                    let track = null;
                    for (const sel of trackSelectors) {
                        track = document.querySelector(sel);
                        if (track) break;
                    }
                    if (!track) {
                        track = slider.parentElement;
                    }
                    if (!track) return null;

                    const style = getComputedStyle(slider);
                    const sliderRect = slider.getBoundingClientRect();
                    const trackRect = track.getBoundingClientRect();
                    const visible = style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        sliderRect.width > 0 && sliderRect.height > 0;

                    return {
                        visible,
                        slider: {
                            left: sliderRect.left,
                            top: sliderRect.top,
                            width: sliderRect.width,
                            height: sliderRect.height,
                            centerX: sliderRect.left + sliderRect.width / 2,
                            centerY: sliderRect.top + sliderRect.height / 2,
                            pageCenterX: sliderRect.left + sliderRect.width / 2 + window.scrollX,
                            pageCenterY: sliderRect.top + sliderRect.height / 2 + window.scrollY
                        },
                        track: {
                            left: trackRect.left,
                            top: trackRect.top,
                            width: trackRect.width,
                            height: trackRect.height,
                            centerX: trackRect.left + trackRect.width / 2,
                            centerY: trackRect.top + trackRect.height / 2
                        },
                        movableDistance: Math.max(
                            0, trackRect.width - sliderRect.width
                        ),
                        devicePixelRatio: window.devicePixelRatio || 1
                    };
                }
            """)
            return geometry if isinstance(geometry, dict) else None
        except Exception as ex:
            logger.debug("[Captcha] 获取滑块几何信息失败: %s", ex)
            return None

    @classmethod
    def is_challenge_page(cls, page: Any) -> bool:
        """快速判定当前页面是否处于滑动验证码挑战页面。"""
        try:
            return bool(_eval_js(page, """
                () => {
                    const title = String(document.title || '');
                    const text = String(document.body && document.body.innerText || '');
                    return title.includes('滑动验证') ||
                        /请完成以下操作，验证您是真人|请按住滑块|向右滑动验证/.test(text) ||
                        Boolean(document.querySelector(
                            '#captcha-element, #aliyunCaptcha-window-embed, #aliyunCaptcha-sliding-slider, .nc_scale'
                        ));
                }
            """))
        except Exception:
            return False

    @classmethod
    def solve(
        cls,
        page: Any,
        timeout_seconds: int = 15,
        extra_distance: float = 20.0,
        humanize: bool = True,
        max_retries: int = 3,
        method: str = "auto",
    ) -> bool:
        """检测并尝试自动完成滑动验证（自动适配 Chrome 与 Firefox，支持失败自动重试）。

        流程：
        1. 检查是否存在滑块几何元素或验证外壳；
        2. 异步轮询等待滑块 DOM 渲染就绪；
        3. 计算滑块起点与滑动距离，执行拟人化拖拽（带非中心安全偏移与冗余超滑距离）；
        4. 轮询检测状态：若成功跳回业务页则返回 True；若检测到“验证失败/刷新重试”则点击刷新重试最多 max_retries 次。
        """
        if hasattr(page, "actions") and hasattr(page.actions, "perform"):
            browser_type = "Firefox"
        elif hasattr(page, "run_cdp"):
            browser_type = "DrissionPage/Test"
        else:
            browser_type = "Chrome/CDP"

        for attempt in range(1, max_retries + 1):
            geometry = cls.get_geometry(page)
            if not geometry or not geometry.get("visible"):
                if not cls.is_challenge_page(page):
                    return False

                logger.info(
                    "[%s][Captcha] 已识别滑动验证页 (尝试 %d/%d)，等待滑块组件渲染...",
                    browser_type,
                    attempt,
                    max_retries,
                )
                render_deadline = time.monotonic() + 15
                while time.monotonic() < render_deadline:
                    time.sleep(0.25)
                    geometry = cls.get_geometry(page)
                    if geometry and geometry.get("visible"):
                        break

                if not geometry or not geometry.get("visible"):
                    logger.warning("[%s][Captcha] 识别到验证页，但 15 秒内未找到可见滑块组件", browser_type)
                    return False

            slider = geometry.get("slider") or {}
            track = geometry.get("track") or {}
            center_x = float(slider.get("centerX") or 0)
            center_y = float(slider.get("centerY") or 0)
            slider_width = float(slider.get("width") or 40.0)
            slider_height = float(slider.get("height") or 40.0)
            movable_distance = float(geometry.get("movableDistance") or 0)

            # 拟人化非中心点击偏移：在滑块按钮安全区域内（±18%）随机偏移，避免每次点击正中心
            if humanize:
                max_offset_x = min(6.0, max(2.0, slider_width * 0.18))
                max_offset_y = min(6.0, max(2.0, slider_height * 0.18))
                offset_x = random.uniform(-max_offset_x, max_offset_x)
                offset_y = random.uniform(-max_offset_y, max_offset_y)
            else:
                offset_x, offset_y = 0.0, 0.0

            start_x = center_x + offset_x
            start_y = center_y + offset_y

            logger.info(
                "[%s][CaptchaGeometry] 尝试 %d/%d: 滑块中心=(%.1f, %.1f), 按下起点=(%.1f, %.1f)[dx=%.1f, dy=%.1f], "
                "尺寸=%.1fx%.1f, 轨道尺寸=%.1fx%.1f, 理论可移动距离=%.1f, 冗余增量=%.1f, DPR=%s",
                browser_type,
                attempt,
                max_retries,
                center_x,
                center_y,
                start_x,
                start_y,
                offset_x,
                offset_y,
                slider_width,
                slider_height,
                float(track.get("width") or 0),
                float(track.get("height") or 0),
                movable_distance,
                extra_distance,
                geometry.get("devicePixelRatio") or 1,
            )

            if movable_distance <= 0:
                logger.warning("[%s][Captcha] 可移动距离异常 (<=0)，取消自动拖动", browser_type)
                return False

            logger.info("[%s][Captcha] 正在执行第 %d/%d 次拟人化超滑拖拽...", browser_type, attempt, max_retries)
            try:
                drag_slider(
                    page,
                    start_x=start_x,
                    start_y=start_y,
                    distance=movable_distance,
                    steps=random.randint(12, 18) if humanize else 15,
                    extra_distance=extra_distance,
                    humanize=humanize,
                    method=method,
                )
            except Exception as e:
                logger.warning("[%s][Captcha] 自动拖动滑块执行异常: %s", browser_type, e)

            # 轮询验证是否通过或出现错误
            wait_seconds = max(3, int(os.getenv("MANUAL_CAPTCHA_WAIT_SECONDS", str(timeout_seconds))))
            deadline = time.monotonic() + wait_seconds
            need_retry = False
            while time.monotonic() < deadline:
                try:
                    state = _eval_js(page, """
                        () => {
                            const errorNode = document.querySelector(
                                '.nc_scale .errloading, .btn_refresh, #aliyunCaptcha-sliding-btn-refresh, .nc-lang-cnt, [class*="err"], [class*="refresh"], [class*="reload"]'
                            );
                            const bodyText = (document.body ? document.body.innerText : '') || '';
                            const isErrorText = /验证失败|请刷新重试|网络不给力|哎呀，出错了|重新滑动|拖动滑块|验证不通过/.test(bodyText);
                            const refreshBtn = document.querySelector(
                                '.btn_refresh, #aliyunCaptcha-sliding-btn-refresh, a[class*="refresh"], .nc_iconfont.btn_refresh'
                            );
                            return {
                                hasError: Boolean(errorNode) || isErrorText,
                                refreshBtnExists: Boolean(refreshBtn),
                                sliderExists: Boolean(document.querySelector(
                                    '#aliyunCaptcha-sliding-slider, .btn_slide, #nc_1_n1z'
                                )),
                                title: document.title || '',
                                validLinks: [...document.querySelectorAll('a[href]')].filter(a => {
                                    const href = String(a.getAttribute('href') || '').trim();
                                    return href && href !== '#' && !/^javascript:/i.test(href);
                                }).length,
                                bodyLength: document.body ? (document.body.innerText || '').trim().length : 0
                            };
                        }
                    """) or {}

                    if (
                        not state.get("sliderExists")
                        and state.get("title") != "滑动验证页面"
                        and int(state.get("validLinks") or 0) >= 3
                        and int(state.get("bodyLength") or 0) >= 100
                    ):
                        logger.info("[%s][Captcha][OK] 滑动验证已通过，进入业务页面", browser_type)
                        return True

                    if state.get("hasError") or state.get("refreshBtnExists"):
                        logger.warning("[%s][Captcha] 检测到验证失败或刷新提示，准备第 %d 次重试...", browser_type, attempt + 1)
                        # 尝试点击刷新按钮
                        try:
                            _eval_js(page, """
                                () => {
                                    const btn = document.querySelector('.btn_refresh, #aliyunCaptcha-sliding-btn-refresh, a[class*="refresh"], .nc_iconfont.btn_refresh');
                                    if (btn) btn.click();
                                }
                            """)
                        except Exception:
                            pass
                        time.sleep(random.uniform(1.0, 1.8))
                        need_retry = True
                        break
                except Exception as ex:
                    logger.warning("[%s][Captcha] 等待验证结果时页面连接异常: %s", browser_type, ex)
                    return False
                time.sleep(0.5)

            if not need_retry:
                # 既没通过也没提示重试，说明超时
                break

        logger.warning("[%s][Captcha] 等待滑动验证通过超时（已重试 %d 次）", browser_type, max_retries)
        return False


# ----------------------------------------------------------------------
# CLI 独立启动与测试入口
# ----------------------------------------------------------------------

def _ensure_cdp_browser(timeout: float = 10.0) -> str:
    """获取现有 CDP 地址；未启动时自动启动项目配置的 Chrome。"""
    base_url = get_cdp_base_url()
    if base_url:
        return base_url

    chrome_path = find_chrome()
    if not chrome_path:
        raise RuntimeError("未找到 Chrome，无法启动 CDP 浏览器")

    launch_chrome(chrome_path, port=CDP_PORT)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        base_url = get_cdp_base_url()
        if base_url:
            return base_url
        time.sleep(0.2)

    raise TimeoutError(f"等待 CDP 浏览器启动超时: 127.0.0.1:{CDP_PORT}")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    parser = argparse.ArgumentParser(description="通过原生 CDP / Windows窗口消息 / Firefox / DrissionPage 自动识别并拖动滑块验证码")
    parser.add_argument("url", help="需要打开并测试的页面 URL")
    parser.add_argument(
        "--browser",
        choices=["chrome", "firefox", "test", "drission"],
        default="chrome",
        help="选择测试浏览器内核 (chrome, firefox, 或 test/drission)，默认 chrome",
    )
    parser.add_argument(
        "-test", "--test",
        action="store_true",
        help="使用 test.py 方式启动浏览器 (DrissionPage 模式, 端口 5544, --disable-gpu)",
    )
    parser.add_argument(
        "--method",
        choices=["auto", "cdp", "win32_msg"],
        default="auto",
        help="拖拽驱动模式 (auto=自动, cdp=CDP协议, win32_msg=Windows窗口消息)，默认 auto",
    )
    parser.add_argument(
        "--wait-ms",
        type=int,
        default=1500,
        help="页面打开后、执行检测前的等待时间，默认 1500 毫秒",
    )
    parser.add_argument(
        "--disable-humanize",
        action="store_true",
        help="禁用拟人化轨迹，使用纯直线拖拽",
    )
    parser.add_argument(
        "--trace-file",
        nargs="?",
        const=str(
            Path(__file__).resolve().parents[2] / "logs" / "my_trace.json"
        ),
        default="",
        help=(
            "显式回放人工轨迹；不提供路径时读取 logs/my_trace.json。"
            "仅允许记录时的同一浏览器、域名和路径"
        ),
    )
    args = parser.parse_args()

    if args.test:
        args.browser = "test"

    if args.wait_ms < 0:
        parser.error("--wait-ms 不能小于 0")
    try:
        target_url = _normalize_cli_url(args.url)
    except ValueError as ex:
        parser.error(str(ex))

    trace_path = None
    recorded_trace = None
    if args.trace_file:
        try:
            trace_path, recorded_trace = _load_recorded_trace(args.trace_file)
            _validate_recorded_trace_scope(
                recorded_trace,
                target_url,
                args.browser,
            )
        except ValueError as ex:
            parser.error(str(ex))
        logging.info("[TraceReplay] 已读取人工轨迹: %s", trace_path)

    if args.browser == "firefox":
        from firefox_fallback import find_firefox
        from ruyipage import FirefoxOptions, FirefoxPage
        firefox_path = find_firefox()
        if not firefox_path:
            raise RuntimeError("未找到 Firefox 可执行文件")
        options = FirefoxOptions()
        options.set_browser_path(firefox_path)
        page = FirefoxPage(options)
        try:
            logging.info("[Firefox] 正在打开页面: %s", target_url)
            page.get(target_url, timeout=30)
            time.sleep(args.wait_ms / 1000.0)
            if recorded_trace is not None:
                geometry = _wait_for_recorded_trace_geometry(page)
                replay_recorded_trace(page, recorded_trace, geometry)
                logging.info("[Firefox][TraceReplay] 人工轨迹已回放一次")
            else:
                success = AliyunSliderSolver.solve(
                    page,
                    humanize=not args.disable_humanize,
                )
                if success:
                    logging.info("[Firefox] 滑块验证处理成功！")
                else:
                    logging.warning("[Firefox] 未能自动完成滑块验证或无需验证。")
            time.sleep(3.0)
        finally:
            page.quit(timeout=3, force=True)
    elif args.browser in ("test", "drission"):
        try:
            from DrissionPage import Chromium
            from DrissionPage._configs.chromium_options import ChromiumOptions
        except ImportError:
            raise ImportError("未安装 DrissionPage，请先运行: pip install DrissionPage")

        logging.info("[Test/DrissionPage] 正在以 test.py 模式启动 Chromium 浏览器 (端口 5544)...")
        co = ChromiumOptions()
        chrome_path = find_chrome()
        if chrome_path:
            co.set_browser_path(chrome_path)
            logging.info("[Test/DrissionPage] 已指定浏览器内核: %s", chrome_path)
        co.set_argument("--disable-gpu")
        co.set_argument("--no-proxy-server")
        co.set_argument("--window-size=1280,800")
        co.set_argument("--window-position=100,100")
        co.set_argument("--start-minimized")
        co.set_local_port(5544)
        co.ignore_certificate_errors(on_off=True)
        browser = Chromium(co)
        page = browser.latest_tab
        try:
            page.set.window.mini()
        except Exception:
            pass
        try:
            logging.info("[Test/DrissionPage] 正在打开页面: %s", target_url)
            page.get(target_url)
            time.sleep(args.wait_ms / 1000.0)
            if recorded_trace is not None:
                geometry = _wait_for_recorded_trace_geometry(page)
                replay_recorded_trace(page, recorded_trace, geometry)
                logging.info("[Test/DrissionPage][TraceReplay] 人工轨迹已回放一次")
            else:
                success = AliyunSliderSolver.solve(
                    page,
                    humanize=not args.disable_humanize,
                    method=args.method,
                )
                if success:
                    logging.info("[Test/DrissionPage] 滑块验证处理成功！")
                else:
                    logging.warning("[Test/DrissionPage] 未能自动完成滑块验证或无需验证。")
            time.sleep(2.0)
        finally:
            pass
    else:
        base_url = _ensure_cdp_browser()
        page = CDPPage.create_new_page(base_url)
        try:
            logging.info("[Chrome] 正在打开页面: %s", target_url)
            page.goto(target_url, wait_until="domcontentloaded")
            time.sleep(args.wait_ms / 1000.0)
            if recorded_trace is not None:
                geometry = _wait_for_recorded_trace_geometry(page)
                replay_recorded_trace(page, recorded_trace, geometry)
                logging.info("[Chrome][TraceReplay] 人工轨迹已回放一次")
            else:
                success = AliyunSliderSolver.solve(
                    page,
                    humanize=not args.disable_humanize,
                    method=args.method,
                )
                if success:
                    logging.info("[Chrome] 滑块验证处理成功！")
                else:
                    logging.warning("[Chrome] 未能自动完成滑块验证或无需验证。")
            time.sleep(2.0)
        finally:
            page.ws.close()


if __name__ == "__main__":
    main()
