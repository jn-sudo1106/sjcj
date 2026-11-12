"""在项目内的本地普通滑块页面回放人工 PointerEvent 轨迹。"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from .firefox_fallback import find_firefox
except ImportError:
    link_extractor_dir = Path(__file__).resolve().parents[1]
    if str(link_extractor_dir) not in sys.path:
        sys.path.insert(0, str(link_extractor_dir))
    from browsers.firefox_fallback import find_firefox


PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOCAL_LAB_PATH = PROJECT_ROOT / "web" / "slider_trace_lab.html"
DEFAULT_TRACE_PATH = PROJECT_ROOT / "logs" / "my_trace.json"


def _load_trace(path: Path) -> dict:
    trace = json.loads(path.read_text(encoding="utf-8"))
    events = trace.get("events") or []
    if len(events) < 2:
        raise ValueError("轨迹至少需要 pointerdown 和 pointerup 两个事件")
    if events[0].get("type") != "pointerdown":
        raise ValueError("第一个事件必须是 pointerdown")
    if events[-1].get("type") not in {"pointerup", "pointercancel"}:
        raise ValueError("最后一个事件必须是 pointerup 或 pointercancel")
    return trace


def _wait_for_lab(page: Any, timeout_seconds: float = 10.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            if page.run_js("window.__traceLabReady === true", as_expr=True):
                return
        except Exception:
            pass
        time.sleep(0.1)
    raise TimeoutError("本地轨迹实验室加载超时")


def _get_replay_origin(page: Any, trace: dict) -> tuple[float, float]:
    source_slider = (trace.get("geometry") or {}).get("slider") or {}
    down = trace["events"][0]
    grip_x = float(down.get("clientX") or 0) - float(source_slider.get("left") or 0)
    grip_y = float(down.get("clientY") or 0) - float(source_slider.get("top") or 0)

    rect = page.run_js(
        """(() => {
            const rect = document.querySelector(
                '#trace-lab-slider'
            ).getBoundingClientRect();
            return {left: rect.left, top: rect.top};
        })()""",
        as_expr=True,
    )
    return float(rect["left"]) + grip_x, float(rect["top"]) + grip_y


def replay_trace(page: Any, trace: dict) -> dict:
    """使用 Firefox BiDi Actions 在本地夹具中回放相对轨迹。"""
    events = trace["events"]
    start_x, start_y = _get_replay_origin(page, trace)

    page.actions.move_to((int(round(start_x)), int(round(start_y))), duration=40)
    page.actions.hold(button=0)

    previous_t = float(events[0].get("t") or 0)
    for event in events[1:]:
        event_t = float(event.get("t") or previous_t)
        duration_ms = max(1, int(round(event_t - previous_t)))
        event_type = str(event.get("type") or "")
        if event_type == "pointermove":
            target_x = start_x + float(event.get("dx") or 0)
            target_y = start_y + float(event.get("dy") or 0)
            page.actions.move_to(
                (int(round(target_x)), int(round(target_y))),
                duration=duration_ms,
            )
        elif event_type in {"pointerup", "pointercancel"}:
            page.actions.wait(duration_ms / 1000.0)
            page.actions.release(button=0)
        previous_t = event_t

    page.actions.perform()
    time.sleep(0.3)
    result = page.run_js("window.__traceLabResult", as_expr=True)
    if not isinstance(result, dict):
        raise RuntimeError("本地滑块没有生成回放结果")
    return result


def _save_report(trace_path: Path, trace: dict, result: dict) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = PROJECT_ROOT / "logs" / f"trace_replay_report_{timestamp}.json"
    source_events = trace.get("events") or []
    report = {
        "tracePath": str(trace_path),
        "localLabPath": str(LOCAL_LAB_PATH),
        "source": {
            "eventCount": len(source_events),
            "durationMs": source_events[-1].get("t") if source_events else None,
            "dx": source_events[-1].get("dx") if source_events else None,
            "dy": source_events[-1].get("dy") if source_events else None,
        },
        "result": result,
        "createdAt": datetime.now().isoformat(timespec="seconds"),
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report_path


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    parser = argparse.ArgumentParser(
        description="仅在项目本地滑块夹具中回放人工轨迹"
    )
    parser.add_argument(
        "--trace",
        default=str(DEFAULT_TRACE_PATH),
        help="人工轨迹 JSON，默认 logs/my_trace.json",
    )
    args = parser.parse_args()

    trace_path = Path(args.trace).expanduser().resolve()
    if not trace_path.is_file():
        parser.error(f"轨迹文件不存在: {trace_path}")
    if not LOCAL_LAB_PATH.is_file():
        raise RuntimeError(f"本地测试页不存在: {LOCAL_LAB_PATH}")

    trace = _load_trace(trace_path)
    firefox_path = find_firefox()
    if not firefox_path:
        raise RuntimeError("未找到 Firefox 可执行文件")

    from ruyipage import FirefoxOptions, FirefoxPage

    options = FirefoxOptions()
    options.set_browser_path(firefox_path)
    options.set_window_size(1280, 900)
    page = FirefoxPage(options)
    try:
        logging.info("正在打开本地轨迹实验室: %s", LOCAL_LAB_PATH)
        page.get("https://www.gem.com.cn/CompanyNews/list.html", timeout=30)
        #page.get(LOCAL_LAB_PATH.as_uri(), timeout=15)
        time.sleep(5000)
        result = replay_trace(page, trace)
        report_path = _save_report(trace_path, trace, result)
        logging.info(
            "本地回放完成：passed=%s, finalLeft=%s/%s, receivedEvents=%s",
            result.get("passed"),
            result.get("finalLeft"),
            result.get("maxDistance"),
            len(result.get("receivedEvents") or []),
        )
        logging.info("回放报告已保存: %s", report_path)
        time.sleep(1.5)
    finally:
        page.quit(timeout=3, force=True)


if __name__ == "__main__":
    main()
