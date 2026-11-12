"""Validate repository node types against the same catalog as the business UI."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def configured():
    return bool(os.getenv('RUNNER_NODE_TYPE_BACKEND', '').strip())


def type_name(code, headers):
    from .server import ApiError
    base = os.getenv('RUNNER_NODE_TYPE_BACKEND', '').strip()
    try:
        parsed = urlsplit(base)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/') or parsed.port == 0:
            raise ValueError()
    except (ValueError, TypeError):
        raise ApiError('节点类型业务后端地址配置无效', 503)
    forwarded = {}
    for key, limit in (('Cookie', 16384), ('Access-Token', 8192)):
        value = (headers or {}).get(key, '')
        if value:
            if len(value) > limit or '\r' in value or '\n' in value:
                raise ApiError('节点类型查询凭据无效', 401)
            forwarded[key] = value
    if not forwarded:
        raise ApiError('请通过已登录的平台页面保存节点类型目录', 401)
    request = Request(base.rstrip('/') + '/api/v1/config/sourceTypes', headers={**forwarded, 'Accept': 'application/json'})
    try:
        with build_opener(NoRedirect()).open(request, timeout=8) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError()
        payload = json.loads(raw)
        if isinstance(payload, dict):
            if payload.get('code') not in (None, '', 0, '0'):
                raise ApiError('业务后端拒绝节点类型查询，请刷新登录状态后重试', 502)
            rows = payload.get('data', payload)
        else:
            rows = payload
        if isinstance(rows, dict):
            rows = rows.get('list')
        if not isinstance(rows, list):
            raise ValueError()
        for row in rows:
            if isinstance(row, dict) and str(row.get('sourceType', '')).strip() == code:
                name = row.get('typeName')
                if not isinstance(name, str) or not name.strip():
                    raise ValueError()
                return name.strip()
        raise ApiError(f'当前业务后端不存在节点类型（ID={code}），请刷新节点类型列表后重试')
    except HTTPError as exc:
        if exc.code in (401, 403) or 300 <= exc.code < 400:
            raise ApiError('节点类型业务后端登录已失效，请重新登录', 401) from exc
        raise ApiError('业务后端节点类型查询失败，请稍后重试', 502) from exc
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        raise ApiError('业务后端节点类型查询失败，请稍后重试', 502) from exc
