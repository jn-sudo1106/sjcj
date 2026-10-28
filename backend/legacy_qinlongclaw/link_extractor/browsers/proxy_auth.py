"""Native proxy authentication for DrissionPage tabs."""
import logging
from urllib.parse import unquote, urlsplit


def enable_drission_proxy_auth(tab, proxy_url):
    parsed = urlsplit(proxy_url)
    username = unquote(parsed.username or '')
    password = unquote(parsed.password or '')
    if not username:
        return False
    attempts = set()

    def on_auth(**event):
        request_id = event.get('requestId')
        if not request_id:
            return
        challenge = event.get('authChallenge') or {}
        if str(challenge.get('source') or '').lower() != 'proxy':
            response = {'response': 'Default'}
        elif request_id in attempts:
            response = {'response': 'CancelAuth'}
            logging.warning('[DrissionPage][Proxy] 代理拒绝认证，取消重复提交')
        else:
            attempts.add(request_id)
            response = {'response': 'ProvideCredentials', 'username': username, 'password': password}
            logging.info('[DrissionPage][Proxy] 已响应代理认证挑战（凭据不输出）')
        tab.run_cdp('Fetch.continueWithAuth', requestId=request_id, authChallengeResponse=response)

    def on_paused(**event):
        request_id = event.get('requestId')
        if request_id:
            tab.run_cdp('Fetch.continueRequest', requestId=request_id)

    tab.driver.set_callback('Fetch.authRequired', on_auth)
    tab.driver.set_callback('Fetch.requestPaused', on_paused)
    tab.run_cdp('Fetch.enable', handleAuthRequests=True,
                patterns=[{'urlPattern': '*', 'requestStage': 'Request'}])
    return True
