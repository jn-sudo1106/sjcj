import os
import sys
import time
import urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright
from browsers.cdp_client import CDPPage, get_cdp_base_url, find_chrome, launch_chrome
from utils.runtime_files import ensure_runtime_txt_files
from models.xpath_data import XpathData
from actions.extract_link_list import ExtractLinkListAction
from actions.extract_link_list_auto import ExtractLinkListAutoAction

# 将当前项目根目录加入 Python 模块搜索路径
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def print_formatted_result(df):
    if df is None or df.empty:
        print("无提取结果")
        return
    print("-" * 80)
    for _, row in df.iterrows():
        text = " ".join(str(row["Text"]).split())
        url = str(row["Url"])
        xpath = str(row["Xpath"])
        idx = str(row["Index"])
        print(f"[{idx}] {text}")
        print(f"    链接: {url}")
        if "Date" in row and row["Date"] is not None and str(row["Date"]).strip() and str(row["Date"]).lower() != "nan":
            print(f"    日期: {str(row['Date']).strip()}")
        print(f"    路径: {xpath}")
        print("-" * 80)


def get_recent_url() -> str:
    """优先读取项目 txt 目录中最近一次运行的 URL。"""
    recent_file = ensure_runtime_txt_files()["recent"]
    try:
        for line in recent_file.read_text(encoding="utf-8-sig").splitlines():
            if line.startswith("URL:"):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return ""


def get_html_snapshot_path(url: str) -> Path:
    """在 web 目录中按网站域名生成浏览器 DOM 快照文件名。"""
    hostname = urllib.parse.urlsplit(url).hostname or "unknown-site"
    safe_hostname = "".join(
        char if char.isalnum() or char in ".-_" else "_" for char in hostname
    )
    return Path(__file__).resolve().parent.parent / "web" / f"{safe_hostname}.html"


def main():
    target_url = get_recent_url() or "https://tongbicapital.com/news?feClassCode=gmg"
    print(f"[Recent] 本次运行 URL: {target_url}")
    snapshot_path = get_html_snapshot_path(target_url)
    sample_xpath = ""

    stealth_js = """
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.navigator.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    """

    # =========================================================================
    # 【第一阶段】优先尝试使用无头模式抓取 (Playwright Headless)
    # =========================================================================
    print("--------------------------------------------------")
    print("【第一阶段】尝试使用无头浏览器（Playwright Headless）抓取...")
    print("--------------------------------------------------")
    success_headless = False
    df_result = None
    last_error = ""

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            context.add_init_script(stealth_js)
            page = context.new_page()

            if snapshot_path.exists():
                print(f"[Snapshot] 优先读取本地 HTML: {snapshot_path}")
                snapshot_html = snapshot_path.read_text(encoding="utf-8")
                from utils.http_page_validator import ensure_successful_html
                ensure_successful_html(snapshot_html, target_url)
                page.set_content(snapshot_html, wait_until="domcontentloaded")
            else:
                print(f"正在无头浏览器中访问目标网页：{target_url}")
                response = page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
                if response and response.status >= 400:
                    raise RuntimeError(
                        f"目标网页返回 HTTP {response.status}，不进入列表识别: {response.url}"
                    )
                from utils.http_page_validator import ensure_successful_html
                ensure_successful_html(page.content(), page.url)

            if sample_xpath:
                action = ExtractLinkListAction()
                xpath_config = XpathData(absolute_path=sample_xpath)
                action.bind_operating_object(xpath_config)
                print("正在无头浏览器中运行 ExtractLinkListAction...")
            else:
                action = ExtractLinkListAutoAction()
                action.source_url = target_url
                print("正在无头浏览器中运行 ExtractLinkListAutoAction (全自动识别)...")

            if action.run(page):
                df_result = action.run_result
                if df_result is not None and not df_result.empty:
                    success_headless = True
            else:
                last_error = action.last_error_msg
            browser.close()
    except Exception as e:
        print(f"❌ 无头模式访问页面超时/失败 ({e})，不再尝试数据提取，准备进入第二阶段...")
        last_error = f"页面访问超时/失败: {e}"

    if success_headless and df_result is not None:
        print(f"\n✅ 无头模式抓取成功！共抓取 {len(df_result)} 条列表数据：")
        print_formatted_result(df_result)
        return

    # =========================================================================
    # 【第二阶段】无头模式未成功，降级尝试原生 CDP 有头浏览器抓取
    # =========================================================================
    print("\n--------------------------------------------------")
    print(f"⚠️ 无头模式抓取未成功（原因：{last_error}）")
    print("【第二阶段】启动有头 Chrome 浏览器并通过原生 CDP 模式重试...")
    print("--------------------------------------------------")

    base_url = get_cdp_base_url()
    if not base_url:
        chrome_path = find_chrome()
        if not chrome_path:
            print("❌ 未在系统中查找到 Google Chrome，请确认已安装浏览器！")
            sys.exit(1)
        launch_chrome(chrome_path)
        for i in range(10):
            time.sleep(1)
            base_url = get_cdp_base_url()
            if base_url:
                print("✅ Chrome 调试服务已启动就绪！")
                break
            print(f"   等待 Chrome 就绪... ({i + 1}/10)")

    if not base_url:
        print("❌ 启动 Chrome 调试服务超时，请手动打开浏览器并附加调试参数。")
        sys.exit(1)

    print(f"正在通过原生 CDP 连接浏览器 ({base_url})...")
    page = CDPPage.create_new_page(base_url)
    page.add_init_script(stealth_js)

    print(f"正在浏览器中访问目标网页：{target_url}")
    try:
        page.goto(target_url, wait_until="domcontentloaded", timeout=60000)

        if sample_xpath:
            action = ExtractLinkListAction()
            xpath_config = XpathData(absolute_path=sample_xpath)
            action.bind_operating_object(xpath_config)
            print("正在原生 CDP 中运行 ExtractLinkListAction (基于样本 XPath)...")
        else:
            action = ExtractLinkListAutoAction()
            action.source_url = target_url
            print("正在原生 CDP 中运行 ExtractLinkListAutoAction (全自动识别)...")

        success = action.run(page)

        if success:
            df_result = action.run_result
            print(f"\n✅ 原生 CDP 有头模式重试成功！共抓取 {len(df_result)} 条列表数据：")
            print_formatted_result(df_result)
        else:
            if isinstance(action, ExtractLinkListAutoAction):
                action.show_debug_panel_on_failure(page)
            print(f"\n❌ 原生 CDP 有头模式执行失败！原因：{action.last_error_msg}")
            print("\n📌 【提示】抓取失败后已注入调试面板与 XPath 高亮（标签页保持开启）。")
    except Exception as e:
        print(f"\n❌ 原生 CDP 模式页面访问超时/失败 ({e})，停止抓取。")
    # 不自动关闭 page，保留浏览器标签页供直观查看与调试



if __name__ == "__main__":
    main()
