# -*- coding: utf-8 -*-
"""隔离运行 ruyipage Firefox；由 firefox_fallback.py 启动。"""

import json
import sys
from pathlib import Path

from browsers.firefox_fallback import fetch_firefox_html_direct


def main() -> int:
    if len(sys.argv) != 8:
        return 2
    (
        url, output_file, timeout_text, decision_file,
        command_file, response_file, proxy_mode,
    ) = sys.argv[1:]
    payload = {"ok": False, "url": url, "html": ""}
    try:
        def report_ready(final_url: str, html: str, address: str = "") -> None:
            payload.update({
                "ok": True,
                "url": final_url,
                "html": html,
                "address": address,
            })
            Path(output_file).write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )

        fetch_firefox_html_direct(
            url,
            int(timeout_text),
            ready_callback=report_ready,
            decision_file=decision_file,
            command_file=command_file,
            response_file=response_file,
            use_proxy=proxy_mode == "proxy",
        )
    except Exception as ex:
        payload["error"] = f"{type(ex).__name__}: {ex}"
    if not payload["ok"]:
        Path(output_file).write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
