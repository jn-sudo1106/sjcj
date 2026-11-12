# -*- coding: utf-8 -*-
import os
import time
import requests
from DrissionPage._configs.chromium_options import ChromiumOptions
from DrissionPage._functions.keys import Keys
from DrissionPage._pages.chromium_page import ChromiumPage
from dateutil import parser
from ruyipage import FirefoxOptions, FirefoxPage
from browsers.firefox_fallback import configure_firefox_proxy
from loguru import logger
import re
from datetime import datetime, timedelta
import json
import sys
from lxml import html as lhtml
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup, NavigableString


def find_firefox() -> str:
    """自动查找系统中 Firefox 浏览器的安装路径"""
    candidates = [
        r"D:\firefox\firefox.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Mozilla Firefox\firefox.exe"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return r"D:\firefox\firefox.exe"


def pass_this_check(page):
    """
    检测并尝试通过安全验证
    :param page: 页面操作对象
    :return: bool - 验证是否通过（True=通过，False=未通过）
    """
    # check_list
    check_list = ['正在进行安全验证', '执行安全验证', '验证您是真人', 'check…']
    if not check_list:
        logger.warning("check_list为空，跳过验证检测")
        return True

    # 初始化flag
    flag = 0
    # 遍历检测关键词
    for check_str in check_list:
        check_str_stripped = check_str.strip()
        # 跳过空字符串
        if not check_str_stripped:
            continue
        # 检测页面是否包含验证关键词
        if check_str_stripped in page.html:
            logger.warning(f"触发验证（检测到关键词：{check_str_stripped}）")
            # 保存页面源码用于排查
            # with open('cf_check.html', 'w', encoding='utf-8') as f:
            #     f.write(page.html)
            flag = 1  # 标记需要验证
            break  # 检测到一个关键词即触发验证，无需继续遍历

    # 未触发验证，直接返回通过
    if flag == 0:
        logger.info("未触发验证")
        return True

    # 开始尝试验证（最多18次）
    for attempt in range(18):
        try:
            if page.ele('.main-wrapper') or page.ele('.main-wrapper lang-zh-cn'):
                # 执行按键操作
                logger.info("开始执行按键操作")
                time.sleep(2)
                logger.info("按下space键")
                page.actions.key_down(Keys.SPACE)
                page.actions.key_up(Keys.SPACE)
                time.sleep(1)
                logger.info("按下tab键")
                page.actions.key_down(Keys.TAB)
                page.actions.key_up(Keys.TAB)
                time.sleep(2)
                logger.info("按下enter键")
                page.actions.key_down(Keys.SPACE)
                page.actions.key_up(Keys.SPACE)
                logger.info("结束执行按键操作")
            time.sleep(15)
            if check_str_stripped in page.html:
                logger.warning('验证未通过')
                continue
            else:
                logger.success('验证通过')
                flag = 0
                break
        except Exception as e:
            logger.error(f'第{attempt + 1}次验证出错：{e}')
            page.wait(10)  # 出错后等待10秒再重试
        # 每6次尝试刷新页面（修复finally逻辑，避免循环结束后无效刷新）
        finally:
            if flag == 1 and (attempt + 1) % 6 == 0:
                logger.info(f'第{attempt + 1}次尝试失败，刷新页面')
                page.refresh()
                page.wait.load_start()  # 等载页面加载完成
    # 最终结果判断
    if flag == 1:
        logger.error('18次验证尝试均未通过，任务失败')
        return False
    return True

class DhCrawler(object):
    def __init__(self, task_url, task, thread_id, all_contentRule, send_result):
        self.task_url = task_url
        self.task = task
        self.thread_id = thread_id
        self.all_contentRule = all_contentRule
        self.send_result = send_result


    def get_chrome_html(self,browser,firefox=False):
        try:
            # 设置 timeout 为 120 秒
            if firefox:
                browser.get(self.task_url.replace("amp;", ""))
            else:
                browser.get(self.task_url.replace("amp;", ""),retry=0,timeout=60)
        except Exception as e:
            logger.warning('页面加载超时（60s），执行强制停止: %s', e)
            # 【关键步骤】强制停止页面加载
            browser.stop_loading()
        time.sleep(3)
        flag_ = pass_this_check(browser)
        if not flag_:
            return False,False,500
        # 这种方式是瞬间到底，但如果你想模拟过程，可以分段滚动
        for _ in range(20):
            if _==10:
                time.sleep(5)
            browser.scroll.down(200)  # 每次向下滚 500 像素
            browser.wait(1)  # 停顿 0.5 秒
        # time.sleep(10)
        browser.scroll.to_bottom()
        html = browser.html
        real_url = browser.url
        time.sleep(1)
        # with open(r'D:\Code\AI\all_model\新闻解析\test.html','w') as f:
        #     f.write(html)
        return html, real_url,200

    def get_page(self):
        try:
            headers = {
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090b11)XWEB/14185 Edg/138.0.0.0"
            }
            proxies= None
            res = requests.get(self.task_url.replace("amp;", ""), headers=headers, proxies=proxies,verify=False, timeout=20)
            # with open("test.html",'w',encoding='utf-8') as f:
            #     f.write(res.text)
            html = res.content.decode('utf-8')
            real_url = res.url
        except Exception as e:
            return None, None, None
        return html, real_url,res.status_code

    def get_config(self,SourceId):
        url = f"http://118.25.96.217:9999/rest/api/v1/data/qs?appId=dev&appKey=dev1&type=6200021&sourceId=430001407&more=K1={SourceId}"
        headers = {
            'User_Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
        }
        resp = requests.get(url, headers=headers, timeout=5)
        logger.info(resp)
        return resp.json().get('data').get('list')



    def get_params(self):
        end_list = []

        co = ChromiumOptions()
        co.set_local_port("9998")
        co.no_imgs()
        browser = ChromiumPage(co)
        html, base_url,status_code = self.get_chrome_html(browser)


        try:
            opts = configure_firefox_proxy(FirefoxOptions())
            # opts.set_browser_path(r"C:\qh\zx\firefox\firefox.exe")
            opts.set_browser_path(r"d:\firefox\firefox.exe")
            browser = FirefoxPage(opts)
            html, base_url, status_code = self.get_chrome_html(browser, True)
        except Exception as e:
            print(e.args)
            return None
        #pass
        # 使用火狐浏览器

        co = ChromiumOptions()
        co.set_local_port("9999")
        co.no_imgs()
        browser = ChromiumPage(co)
        html, base_url,status_code = self.get_chrome_html(browser)

        if status_code != 200:
            print(status_code)
            return None


if __name__ == '__main__':
    # url = "https://www.bain.cn/news.php?pid=62"
    # url = "https://www.urban.org/events"
    # crawler = DhCrawler(task_url=url,task={"ConfigId":None},thread_id=0,all_contentRule={},send_result=None)
    # crawler.get_params()
    opts = configure_firefox_proxy(FirefoxOptions())
    opts.set_browser_path(r"D:\firefox\firefox.exe")
    browser = FirefoxPage(opts)
    browser.get("https://www.united-imaging.com/zh-cn/news-center/uih-news-list")
    html = browser.html
    real_url = browser.url
    print("\n========== Firefox 返回的 HTML ==========", flush=True)
    print(html, flush=True)
    print("========== HTML 输出结束 ==========\n", flush=True)
    logger.info("Firefox 已打开目标网站，将保持浏览器不关闭；按 Ctrl+C 结束守护进程。")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("收到 Ctrl+C，结束守护进程。")
