"""Per-machine-binding retry policy shared by the server and Runner."""
from __future__ import annotations

DEFAULT_RETRY_POLICY = {'enabled': True, 'maxAttempts': 5, 'windowSeconds': 300, 'delaysSeconds': [5, 15, 30, 60]}


def retry_policy(value=None):
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ValueError('重试策略必须是一个配置对象')
    result = {**DEFAULT_RETRY_POLICY, **value}
    if type(result['enabled']) is not bool:
        raise ValueError('自动重试开关无效')
    if type(result['maxAttempts']) is not int or not 1 <= result['maxAttempts'] <= 100:
        raise ValueError('尝试上限须为 1 至 100 次，包含首次启动')
    if type(result['windowSeconds']) is not int or not 60 <= result['windowSeconds'] <= 86400:
        raise ValueError('失败统计窗口须为 1 分钟至 24 小时')
    delays = result['delaysSeconds']
    if not isinstance(delays, list) or not 1 <= len(delays) <= 10 or any(type(v) is not int or not 1 <= v <= 3600 for v in delays):
        raise ValueError('重试间隔须为 1 至 10 个整数，每个为 1 至 3600 秒')
    return {key: list(result[key]) if key == 'delaysSeconds' else result[key] for key in DEFAULT_RETRY_POLICY}
