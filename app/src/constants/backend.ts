/** 本地未配置 VITE_API_PROXY_TARGET 时的默认后端。原 115.227.21.133 测试机已废弃。 */
export const DEFAULT_API_PROXY_TARGET = 'http://118.25.96.217:9999'

/** 写保护 / 顶栏「生产环境」徽标按主机名判定；当前默认代理就是这台。 */
export const PRODUCTION_BACKEND_HOSTS = ['118.25.96.217']

/**
 * 允许走真实「新建采集」（site/add → snatchSave → bindSite）的后端主机。
 * 生产 217（原「仅生产可新建」）＋ 本地开发环境 186（2026-10-12：开发环境完整后端，新建/改/删全放行）。
 * 186 不在 PRODUCTION_BACKEND_HOSTS 里，写保护本就不拦它；这里只解决 siteCreate 的独立闸门。
 */
export const CREATE_ALLOWED_BACKEND_HOSTS = ['118.25.96.217', '124.223.180.186']

/**
 * 数据同步服务（sync-platform）所在环境的后端主机。同步服务按它自己连的库列源表，
 * 前端连的后端不是这台时（如 2806 连 217），数据中心的表和同步服务对不上（2026-10-09 核对：217 的 88 张表有 34 张在 133 同步服务里没有）。
 */
export const SYNC_PLATFORM_BACKEND_HOST = '115.227.21.133'
