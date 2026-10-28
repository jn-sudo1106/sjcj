from DrissionPage._configs.chromium_options import ChromiumOptions
from DrissionPage import Chromium
import time
import random


def get_physics_trace(distance, overshoot=50):
    """
    - 物理积分：move = v0*t + 0.5*a*t^2，v = v0 + a*t
    - 前 70% 距离加速（a>0），后 30% 距离减速（a<0）
    - 目标距离 = distance + overshoot，先过冲再回正，模拟真人拖过头的回调

   原版缺陷：加速/减速判断写成 `start < the_distance`（恒真），
    导致全程只有加速；这里改为按剩余比例判断，并加入随机性。
    """
    trace = []
    target = distance + overshoot          # 过冲距离
    mid = target * 0.7                     # 减速切换点
    start, v0, dt = 0, 0, 0.2

    # ---- 加速 + 减速段（物理积分）----
    while start < target:
        if start < mid:
            a = random.uniform(28, 35)     # 加速段
        else:
            a = -random.uniform(30, 40)    # 减速段

        move = v0 * dt + 0.5 * a * dt * dt
        v0 = v0 + a * dt

        # 末段逼近目标时削掉越界部分
        if start + move > target:
            move = target - start

        # 保证不后退（减速过头时兜底）
        if move < 1 and start < target:
            move = 1

        start += move
        trace.append(round(move, 2))

        # 减速到接近静止且快到终点就停
        if v0 < 1 and start >= mid:
            break

    # ---- 过冲回调：从过冲点回到精确距离 ----
    back = start - distance
    while back > 0:
        m = min(random.uniform(2, 7), back)
        trace.append(-round(m, 2))
        back -= m

    return trace


co = ChromiumOptions()
co.set_argument("--disable-gpu")
co.set_argument("--window-size=1280,800")
co.set_argument("--window-position=100,100")
co.set_argument("--start-minimized")
co.set_local_port(5544)
co.ignore_certificate_errors(on_off=True)
browser = Chromium(co)
tab = browser.latest_tab
try:
    tab.set.window.mini()
except Exception:
    pass
tab.get("https://www.wuhan-guide.com/")

# 找到滑块并模拟真人轨迹滑动
slider = tab.ele('#aliyunCaptcha-sliding-slider', timeout=10)
if slider:
    print("找到滑块，模拟真人轨迹滑动")

    # 获取滑轨宽度计算拖拽距离
    track = tab.ele('.nc-lang-cmt-container', timeout=2) or tab.ele('.scale_text', timeout=1)
    drag_distance = 320  # 默认拖拽距离
    if track:
        try:
            track_w = track.rect.location.get('width', 320)
            if isinstance(track_w, dict):
                track_w = track_w.get('value', 320)
            drag_distance = int(track_w) - 45  # 减去滑块宽度
        except Exception:
            pass

    print(f"目标拖拽距离: {drag_distance}px")

    # ---- 模拟真人轨迹 ----
    # 1. 先把鼠标移到滑块上，停留一会（真人看到滑块后会停顿）
    tab.actions.move_to(slider)
    time.sleep(random.uniform(0.3, 0.6))

    # 2. 按下鼠标
    tab.actions.hold()
    time.sleep(random.uniform(0.15, 0.35))

    # 3. 参考 csdn.py 的物理加速度模型生成轨迹
    # s = v0*t + 0.5*a*t^2 ;  v = v0 + a*t
    # 前段加速、后段减速，先过冲再回正，符合真人拖拽特征
    import math
    trace = get_physics_trace(drag_distance)
    cumulative = 0
    for i, step_x in enumerate(trace, 1):
        cumulative += step_x
        t = i / max(len(trace), 1)

        # 上下偏移：用正弦波 + 随机噪声，模拟手抖
        # 前半段幅度大，后半段收敛（末段更稳）
        amplitude = 3 * (1 - t * 0.7)
        offset_y = math.sin(i * 0.6) * amplitude + random.uniform(-1, 1)

        tab.actions.move(step_x, int(offset_y), duration=random.uniform(0.015, 0.035))

        # 随机微停顿（真人有节奏变化）
        if random.random() < 0.1:
            time.sleep(random.uniform(0.04, 0.12))

    # 修正最终位置（确保精确到达）
    final_fix = drag_distance - cumulative
    if final_fix != 0:
        tab.actions.move(final_fix, 0, duration=0.03)

    # 4. 到达终点后不释放鼠标，前后微小移动
    time.sleep(random.uniform(0.3, 0.6))

    # 前后微调：左 -> 右 -> 左 -> 右，模拟真人在终点的犹豫抖动
    for _ in range(random.randint(3, 6)):
        # 向右微移
        tab.actions.move(random.randint(2, 6), random.randint(-1, 1), duration=random.uniform(0.03, 0.06))
        time.sleep(random.uniform(0.05, 0.15))
        # 向左回退
        tab.actions.move(-random.randint(1, 5), random.randint(-1, 1), duration=random.uniform(0.03, 0.06))
        time.sleep(random.uniform(0.05, 0.15))

    print("滑动完成，保持按住状态")
    time.sleep(3)
else:
    print("未找到滑块")


def slide_captcha_to_bottom(tab):
    """滑动验证码到底部

    通用思路：
    1. 找到滑块元素（常见 class/role 关键词）
    2. 用 tab.actions 模拟真实拖拽：按下 -> 逐步移动 -> 松开
    3. 拖拽距离 = 轨道容器宽度 - 滑块宽度
    """
    # ---- 常见滑块选择器，按优先级尝试 ----
    slider_selectors = [
        '#aliyunCaptcha-sliding-slider',   # 阿里云验证码滑块（你的目标）
        '.slider-btn',                    # 通用滑块按钮
        '.slider_button',
        '.sliderMask .sliderBtn',
        '[class*="slider"][class*="btn"]',
        '[class*="slide"][class*="button"]',
        '[data-role="slider"]',
        '.nc_iconfont',                   # 阿里滑块
        '.JDJRV-bigimgslider-btn',        # 京东滑块
        '.geetest_slider_button',         # 极验滑块
        '.tc-slider-normal',             # 腾讯滑块
        'div[class*="slider"]',           # 兜底：class 含 slider 的元素
    ]

    slider = None
    used_selector = None
    for sel in slider_selectors:
        slider = tab.ele(sel, timeout=2)
        if slider:
            used_selector = sel
            break

    if not slider:
        print("未找到滑块元素，可能没有验证码或需要手动指定选择器")
        return False

    print(f"找到滑块: {used_selector} -> {slider}")

    # ---- 找到滑轨容器（用于计算拖拽距离）----
    track_selectors = [
        '.slider-container',
        '.sliderBg',
        '.slider_mask',
        '[class*="slider-track"]',
        '[class*="slider-bg"]',
        '[class*="slide"][class*="container"]',
        slider.parent(),  # 兜底用滑块的父元素
    ]

    track = None
    for sel in track_selectors:
        if callable(sel):
            track = sel()
        else:
            track = tab.ele(sel, timeout=2)
        if track:
            break

    # 计算拖拽距离
    slider_rect = slider.rect.location  # {'x':.., 'y':.., 'width':.., 'height':..}
    try:
        slider_x = slider_rect.get('x', slider_rect.get('left', 0))
        if isinstance(slider_x, dict):
            slider_x = slider_x.get('value', 0)
    except Exception:
        slider_x = 0

    if track:
        try:
            track_width = track.rect.location.get('width', track.rect.location.get('right', 300))
            if isinstance(track_width, dict):
                track_width = track_width.get('value', 300)
        except Exception:
            track_width = 300
    else:
        track_width = 300

    # 默认拖到底：轨道宽度 - 滑块宽度（留 2px 余量防止越界）
    try:
        slider_w = slider_rect.get('width', slider_rect.get('right', 40))
        if isinstance(slider_w, dict):
            slider_w = slider_w.get('value', 40)
    except Exception:
        slider_w = 40

    drag_distance = int(track_width) - int(slider_w) - 2
    if drag_distance <= 0:
        drag_distance = 260  # 兜底默认值

    print(f"滑块位置 x={slider_x}, 拖拽距离={drag_distance}px")

    # ---- 模拟真实人类拖拽 ----
    # 先把鼠标移到滑块中心
    tab.actions.move_to(slider)
    time.sleep(0.3)

    # 按下鼠标
    tab.actions.hold()
    time.sleep(0.2)

    # 分段移动，带加速度变化，模拟人类轨迹
    steps = 30
    moved = 0
    for i in range(1, steps + 1):
        # 缓动函数：先快后慢，最后再微调
        if i < steps * 0.6:
            step_dist = int(drag_distance * 0.6 / (steps * 0.6))
        elif i < steps * 0.9:
            step_dist = int(drag_distance * 0.3 / (steps * 0.3))
        else:
            step_dist = int(drag_distance * 0.1 / (steps * 0.1)) + 1
        step_dist = max(1, step_dist)
        moved += step_dist
        if moved >= drag_distance:
            step_dist -= (moved - drag_distance)
            moved = drag_distance
        tab.actions.move(step_dist, 0, duration=0.02)
        time.sleep(0.01 + (0.03 if i > steps * 0.8 else 0))

    # 到达终点后停留一下再松开（模拟人类确认动作）
    time.sleep(0.3)
    tab.actions.move(drag_distance - moved, 0)  # 修正到精确位置
    time.sleep(0.2)
    tab.actions.up()  # 松开鼠标

    print("滑动完成，等待验证结果...")
    time.sleep(2)

    # 检测是否验证成功（页面变化/提示文字）
    # 这里用通用的成功标志检测，可根据目标网站调整
    success_hints = ['验证成功', '验证通过', 'success', '已通过', '安全验证']
    for hint in success_hints:
        el = tab.ele(f'xpath://*[contains(text(), "{hint}")]', timeout=1)
        if el:
            print(f"验证成功: {hint}")
            return True

    print("验证可能未通过，如需请调整选择器或拖拽距离")
    return False


if __name__ == '__main__':
    slide_captcha_to_bottom(tab)