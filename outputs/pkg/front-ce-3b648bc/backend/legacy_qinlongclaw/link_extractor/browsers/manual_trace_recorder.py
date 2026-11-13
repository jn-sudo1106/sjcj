"""记录自有 UI 测试页面中的人工滑块轨迹，不执行轨迹回放。"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

try:
    from .cdp_client import CDPPage
    from .firefox_fallback import find_firefox
    from .slider_drag import _ensure_cdp_browser, _eval_js, _normalize_cli_url
except ImportError:
    # 兼容直接执行：python link_extractor/browsers/manual_trace_recorder.py
    link_extractor_dir = Path(__file__).resolve().parents[1]
    if str(link_extractor_dir) not in sys.path:
        sys.path.insert(0, str(link_extractor_dir))
    from browsers.cdp_client import CDPPage
    from browsers.firefox_fallback import find_firefox
    from browsers.slider_drag import (
        _ensure_cdp_browser,
        _eval_js,
        _normalize_cli_url,
    )


DEFAULT_SLIDER_SELECTOR = ", ".join((
    "#aliyunCaptcha-sliding-slider",
    ".nc_iconfont.btn_slide",
    "#nc_1_n1z",
    ".btn_slide",
))
DEFAULT_TRACK_SELECTOR = ", ".join((
    "#aliyunCaptcha-sliding-body",
    ".nc_scale",
    "#nc_1__scale_text",
))


def _build_recorder_script(slider_selector: str, track_selector: str) -> str:
    slider_json = json.dumps(slider_selector, ensure_ascii=False)
    track_json = json.dumps(track_selector, ensure_ascii=False)
    return f"""
        () => {{
            const sliderSelector = {slider_json};
            const trackSelector = {track_json};
            const stateKey = '__qinlongManualSliderTrace';
            const storageKey = '__qinlongManualSliderTraceSaved';

            if (window[stateKey] && window[stateKey].installed) {{
                return {{installed: true, reused: true}};
            }}

            const state = {{
                version: 1,
                installed: true,
                status: 'waiting',
                startedAtEpochMs: null,
                endedAtEpochMs: null,
                geometry: null,
                events: []
            }};
            window[stateKey] = state;
            try {{
                sessionStorage.removeItem(storageKey);
            }} catch (_) {{
            }}

            let activePointerId = null;
            let startPerf = 0;
            let startX = 0;
            let startY = 0;

            const persist = () => {{
                try {{
                    sessionStorage.setItem(storageKey, JSON.stringify(state));
                }} catch (_) {{
                }}
            }};

            const rectData = (rect) => rect ? ({{
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height
            }}) : null;

            const appendEvent = (event) => {{
                if (state.events.length >= 10000) return;
                state.events.push({{
                    seq: state.events.length,
                    type: event.type,
                    t: Number((performance.now() - startPerf).toFixed(3)),
                    eventTimeStamp: Number(event.timeStamp || 0),
                    clientX: Number(event.clientX),
                    clientY: Number(event.clientY),
                    pageX: Number(event.pageX),
                    pageY: Number(event.pageY),
                    screenX: Number(event.screenX),
                    screenY: Number(event.screenY),
                    dx: Number((event.clientX - startX).toFixed(3)),
                    dy: Number((event.clientY - startY).toFixed(3)),
                    movementX: Number(event.movementX || 0),
                    movementY: Number(event.movementY || 0),
                    button: Number(event.button),
                    buttons: Number(event.buttons),
                    pressure: Number(event.pressure || 0),
                    pointerId: Number(event.pointerId),
                    pointerType: String(event.pointerType || 'mouse'),
                    isPrimary: Boolean(event.isPrimary),
                    isTrusted: Boolean(event.isTrusted)
                }});
                if (state.events.length % 5 === 0) persist();
            }};

            document.addEventListener('pointerdown', (event) => {{
                const target = event.target && event.target.closest
                    ? event.target.closest(sliderSelector) : null;
                if (!target || state.status === 'recording') return;

                const track = document.querySelector(trackSelector)
                    || target.parentElement;
                const sliderRect = target.getBoundingClientRect();
                const trackRect = track ? track.getBoundingClientRect() : null;

                activePointerId = event.pointerId;
                startPerf = performance.now();
                startX = event.clientX;
                startY = event.clientY;
                state.status = 'recording';
                state.startedAtEpochMs = Date.now();
                state.endedAtEpochMs = null;
                state.events = [];
                state.geometry = {{
                    slider: rectData(sliderRect),
                    track: rectData(trackRect),
                    movableDistance: trackRect
                        ? Math.max(0, trackRect.width - sliderRect.width) : null,
                    devicePixelRatio: window.devicePixelRatio || 1,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight,
                    scrollX: window.scrollX,
                    scrollY: window.scrollY
                }};
                appendEvent(event);
                persist();
            }}, true);

            document.addEventListener('pointermove', (event) => {{
                if (state.status !== 'recording'
                    || event.pointerId !== activePointerId) return;
                appendEvent(event);
            }}, true);

            const finish = (event, status) => {{
                if (state.status !== 'recording'
                    || event.pointerId !== activePointerId) return;
                appendEvent(event);
                state.status = status;
                state.endedAtEpochMs = Date.now();
                activePointerId = null;
                persist();
            }};

            document.addEventListener(
                'pointerup', (event) => finish(event, 'completed'), true
            );
            document.addEventListener(
                'pointercancel', (event) => finish(event, 'cancelled'), true
            );

            return {{installed: true, reused: false}};
        }}
    """


def _wait_and_install(
    page: Any,
    slider_selector: str,
    track_selector: str,
    timeout_seconds: float = 20.0,
) -> None:
    """等待滑块出现在主文档中，再安装捕获阶段的 PointerEvent 监听器。"""
    selector_json = json.dumps(slider_selector, ensure_ascii=False)
    deadline = time.monotonic() + max(1.0, timeout_seconds)
    while time.monotonic() < deadline:
        exists = bool(_eval_js(
            page,
            f"() => Boolean(document.querySelector({selector_json}))",
        ))
        if exists:
            result = _eval_js(
                page,
                _build_recorder_script(slider_selector, track_selector),
            )
            if isinstance(result, dict) and result.get("installed"):
                return
        time.sleep(0.2)
    raise TimeoutError(
        "等待滑块元素超时；如果滑块位于 iframe，请在对应 frame 上安装记录器"
    )


def _read_trace(page: Any) -> Optional[dict]:
    result = _eval_js(
        page,
        """() => {
            if (window.__qinlongManualSliderTrace) {
                return window.__qinlongManualSliderTrace;
            }
            try {
                const saved = sessionStorage.getItem(
                    '__qinlongManualSliderTraceSaved'
                );
                return saved ? JSON.parse(saved) : null;
            } catch (_) {
                return null;
            }
        }""",
    )
    return result if isinstance(result, dict) else None


def _wait_for_manual_trace(page: Any, timeout_seconds: float) -> dict:
    deadline = time.monotonic() + max(1.0, timeout_seconds)
    last_status = ""
    while time.monotonic() < deadline:
        trace = _read_trace(page)
        status = str((trace or {}).get("status") or "waiting")
        if status != last_status:
            if status == "recording":
                logging.info("已检测到按下，正在记录人工轨迹……")
            last_status = status
        if trace and status in {"completed", "cancelled"}:
            return trace
        time.sleep(0.1)

    trace = _read_trace(page)
    if trace and trace.get("events"):
        trace["status"] = "timeout"
        return trace
    raise TimeoutError("等待人工拖动超时，未记录到轨迹")


def _default_output_path() -> Path:
    project_root = Path(__file__).resolve().parents[2]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return project_root / "logs" / f"manual_slider_trace_{timestamp}.json"


def _save_trace(trace: dict, output: str = "") -> Path:
    output_path = Path(output).expanduser() if output else _default_output_path()
    if not output_path.is_absolute():
        output_path = Path.cwd() / output_path
    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(trace, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return output_path


def _log_summary(trace: dict) -> None:
    events = trace.get("events") or []
    if not events:
        logging.warning("轨迹文件没有 PointerEvent 记录")
        return
    first = events[0]
    last = events[-1]
    logging.info(
        "轨迹记录完成：状态=%s，事件数=%d，时长=%.1fms，位移=(%.1f, %.1f)",
        trace.get("status"),
        len(events),
        float(last.get("t") or 0),
        float(last.get("clientX") or 0) - float(first.get("clientX") or 0),
        float(last.get("clientY") or 0) - float(first.get("clientY") or 0),
    )


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    parser = argparse.ArgumentParser(description="记录人工滑块 PointerEvent 轨迹")
    parser.add_argument("url", help="自有 UI 测试页面 URL")
    parser.add_argument(
        "--browser",
        choices=["chrome", "firefox"],
        default="firefox",
        help="使用的浏览器，默认 firefox",
    )
    parser.add_argument(
        "--selector",
        default=DEFAULT_SLIDER_SELECTOR,
        help="滑块 CSS 选择器",
    )
    parser.add_argument(
        "--track-selector",
        default=DEFAULT_TRACK_SELECTOR,
        help="轨道 CSS 选择器",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="等待人工操作的秒数，默认 120",
    )
    parser.add_argument("--output", default="", help="输出 JSON 文件路径")
    args = parser.parse_args()

    try:
        target_url = _normalize_cli_url(args.url)
    except ValueError as ex:
        parser.error(str(ex))
    if args.timeout <= 0:
        parser.error("--timeout 必须大于 0")

    page = None
    try:
        if args.browser == "firefox":
            from ruyipage import FirefoxOptions, FirefoxPage

            firefox_path = find_firefox()
            if not firefox_path:
                raise RuntimeError("未找到 Firefox 可执行文件")
            options = FirefoxOptions()
            options.set_browser_path(firefox_path)
            page = FirefoxPage(options)
            logging.info("[Firefox] 正在打开页面: %s", target_url)
            page.get(target_url, timeout=30)
        else:
            base_url = _ensure_cdp_browser()
            page = CDPPage.create_new_page(base_url)
            logging.info("[Chrome] 正在打开页面: %s", target_url)
            page.goto(target_url, wait_until="domcontentloaded")

        _wait_and_install(page, args.selector, args.track_selector)
        logging.info("记录器已安装，请在浏览器中人工按住并拖动滑块")
        trace = _wait_for_manual_trace(page, args.timeout)
        trace["url"] = target_url
        trace["browser"] = args.browser
        trace["recordedAt"] = datetime.now().isoformat(timespec="seconds")
        output_path = _save_trace(trace, args.output)
        _log_summary(trace)
        logging.info("轨迹已保存: %s", output_path)
    finally:
        if page is not None:
            if args.browser == "firefox":
                page.quit(timeout=3, force=True)
            else:
                page.ws.close()


if __name__ == "__main__":
    main()
