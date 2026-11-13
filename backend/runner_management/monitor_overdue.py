"""「超期无新增」判定：把「窗口内 0 条」的假绿判成异常。

背景
----
``monitor_runner.apply_result`` 的既有语义是：脚本报告窗口内
``checkedCount == 0`` 时记 ``NORMAL``，理由「无待检记录，按无数据处理，不报警」。
这在数据源断流时是致命的：窗口里永远 0 条，结果永远「正常」，没人会发现
数据早就停了。

本模块给检查配一个「预期更新周期」，用上次真正有新增数据的时间做基准：
距上次有新增超过「周期 + 宽限」就判超期，由 ``monitor_runner`` 抬成异常。

设计取舍
--------
* **没有策略就不判定**。只有 ``check_conf`` 里显式配了 ``overduePolicy`` /
  ``overdue`` / ``expectEveryMinutes`` 才启用；老记录（没配）行为完全不变。
* **第一次 0 条不报警**。新监控刚上线、或策略刚加时还没有 ``lastDataAt``，
  此时先初始化成当前时间；否则一条新检查第一次跑就红，等于误报。
* **状态存 Runner 自己的 settings 表**（``monitor-overdue:`` 前缀）。业务库
  只读，这里只记判定所需的游标，不碰 ``ck_source`` / ``ck_job_log``。
* **干跑只算不写**。``persist=False`` 时只读状态、只返回判定结果，用于
  ``run_due(apply=False)`` 预览「会不会判超期」，不落任何状态。
* **只认 ``checkedCount > 0`` 为「有新增」**。条数是脚本给出的唯一口径；
  脚本没报告条数（``None``）时按「无法判定」处理，状态保持不动——宁可少判，
  不能把一次执行失败误当成「数据断流」或「数据恢复」。
* 时间统一 ``%Y-%m-%d %H:%M:%S``（与 ``ck_job_log`` 同口径），读不出来就当
  没有 ``lastDataAt``，走「首次初始化」分支。
"""
from __future__ import annotations

import threading
from datetime import datetime
from typing import Any, Dict, Optional

from . import monitor_batches as batches
from . import monitor_runner as runner

PREFIX = 'monitor-overdue:'
STAMP_FORMAT = '%Y-%m-%d %H:%M:%S'
# 策略字段的兼容写法，按优先级排列：前一个是推荐写法，后两个是历史/简写。
POLICY_KEYS = ('overduePolicy', 'overdue')

LOCK = threading.RLock()


def now(moment: Optional[Any] = None) -> datetime:
    """业务时区的当前时间；与执行器、``ck_job_log`` 的时间口径一致。"""
    return _moment(moment) or runner.business_now()


def stamp(moment: Optional[datetime] = None) -> str:
    return (moment or now()).strftime(STAMP_FORMAT)


def _moment(value: Any) -> Optional[datetime]:
    """容错解析时间；读不出来返回 None（调用方按「没有基准」处理）。"""
    if isinstance(value, datetime):
        return value
    text = str(value or '').strip()
    if not text:
        return None
    try:
        return datetime.strptime(text[:19], STAMP_FORMAT)
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(text).replace(tzinfo=None)
    except (TypeError, ValueError):
        return None


def _minutes(value: Any) -> Optional[float]:
    """把配置里的分钟数转成浮点数；非法/负数返回 None（配置写错就当没配）。"""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _number(value: float) -> Any:
    """整数值保持 int，避免 1440 变成 1440.0 让配置回看/断言不直观。"""
    return int(value) if float(value).is_integer() else round(value, 1)


def policy_of(conf: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """读超期策略，返回 ``{expectEveryMinutes, graceMinutes}``；没配返回 None。

    兼容三种写法（优先级从高到低）::

        {"overduePolicy": {"expectEveryMinutes": 1440, "graceMinutes": 120}}
        {"overdue":       {"expectEveryMinutes": 1440, "graceMinutes": 120}}
        {"expectEveryMinutes": 1440}

    宽限缺失按 0 分钟处理；``expectEveryMinutes`` 缺失或不是正数时视为没配，
    不做任何判定（老记录行为不变）。
    """
    conf = conf if isinstance(conf, dict) else {}
    expect: Optional[float] = None
    grace: Optional[float] = None
    for name in POLICY_KEYS:
        spec = conf.get(name)
        if not isinstance(spec, dict):
            continue
        expect = _minutes(spec.get('expectEveryMinutes'))
        if expect is not None:
            grace = _minutes(spec.get('graceMinutes'))
            break
    if expect is None:
        expect = _minutes(conf.get('expectEveryMinutes'))
    if expect is None or expect <= 0:
        return None
    return {'expectEveryMinutes': _number(expect), 'graceMinutes': _number(grace or 0.0)}


def state_key(monitor_id: Any) -> str:
    return PREFIX + str(monitor_id)


def _monitor_id(monitor: Optional[Dict[str, Any]]) -> Optional[int]:
    for name in ('monitorId', 'id'):
        value = (monitor or {}).get(name)
        if value not in (None, ''):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None
    return None


def _state(app, key: str) -> Dict[str, Any]:
    value = batches.read(app, key)
    return value if isinstance(value, dict) else {}


def _save(app, key: str, last_data: datetime, evaluated: datetime, status: str) -> None:
    """落游标：``lastDataAt`` 只在真正有新增/首次初始化时前进。"""
    batches.write(app, key, {
        'lastDataAt': stamp(last_data),
        'lastStatus': status,
        'evaluatedAt': stamp(evaluated),
    })


def evaluate(
    app,
    monitor: Optional[Dict[str, Any]],
    conf: Optional[Dict[str, Any]],
    outcome: Optional[Dict[str, Any]],
    moment: Optional[datetime] = None,
    persist: bool = True,
) -> Optional[Dict[str, Any]]:
    """判定本次结果是否「超期无新增」。

    返回 None 表示不需要判定（没配策略 / 本次有新增 / 首次初始化 / 无 app /
    脚本没报告条数）；返回 dict 时 ``overdue`` 是布尔值，超期时带 ``reason``。

    ``persist=False`` 只算不写：用于 ``run_due(apply=False)`` 的干跑预览，
    但首次 0 条时读不到基准，同样返回 None（不会凭空报警）。
    """
    policy = policy_of(conf)
    if policy is None:
        return None                     # 没配策略：旧记录行为完全不变
    if app is None:
        return None                     # CLI 干跑没有状态存储
    monitor_id = _monitor_id(monitor)
    if monitor_id is None:
        return None
    at = now(moment)
    report = (outcome or {}).get('report') or {}
    checked = runner._checked_count(report)
    if checked is None:
        # 脚本没报告条数：可能是执行失败，不能拿它当「0 条」判超期。
        return None
    key = state_key(monitor_id)
    with LOCK:
        state = _state(app, key)
        last = _moment(state.get('lastDataAt'))
        if checked > 0:
            # 本次窗口确实有新增：游标前进到今天，超期状态解除。
            if persist:
                _save(app, key, at, at, 'normal')
            return None
        if last is None:
            # 第一次遇到 0 条：先立基准，本次不报警（新监控不能一上线就红）。
            if persist:
                _save(app, key, at, at, 'normal')
            return None
        gap = (at - last).total_seconds() / 60.0
        threshold = policy['expectEveryMinutes'] + policy['graceMinutes']
        detail: Dict[str, Any] = {
            'overdue': gap > threshold,
            'expectEveryMinutes': policy['expectEveryMinutes'],
            'graceMinutes': policy['graceMinutes'],
            'lastDataAt': stamp(last),
            'gapMinutes': round(gap, 1),
        }
        if detail['overdue']:
            detail['reason'] = (
                '超期无新增：距上次有新增数据已 %s 分钟，超过预期更新周期 %s 分钟（宽限 %s 分钟）'
                % (_number(round(gap, 1)), policy['expectEveryMinutes'], policy['graceMinutes'])
            )
        if persist:
            _save(app, key, last, at, 'overdue' if detail['overdue'] else 'normal')
        return detail