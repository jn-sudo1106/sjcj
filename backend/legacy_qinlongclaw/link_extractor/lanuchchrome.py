# -*- coding: utf-8 -*-
"""启动并守护独立 CDP Chrome。"""

import sys
from pathlib import Path

link_extractor_dir = Path(__file__).resolve().parent
if str(link_extractor_dir) not in sys.path:
    sys.path.insert(0, str(link_extractor_dir))

from browser_process import main


if __name__ == "__main__":
    raise SystemExit(main())
