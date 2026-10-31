/**
 * npm run dev（默认）连的后端：本机业务后端，未配置 VITE_API_PROXY_TARGET 时的兜底。
 * 2026-10-28：原先默认打 186，现改成本机，186 移到 npm run test（见 TEST_API_PROXY_TARGET）。
 */
export const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:9999'

/** npm run test（VITE_BACKEND_ENV=test）连的 test 环境业务后端，即原 dev 默认。 */
export const TEST_API_PROXY_TARGET = 'http://124.223.180.186:9999'

/** dev：sync-platform 与本机业务后端同机。 */
export const DEFAULT_SYNC_PLATFORM_PROXY_TARGET = 'http://127.0.0.1:9999'

/** test：连 186 测试环境的 Nginx 9999 端口转发 /api/sync-platform。 */
export const TEST_SYNC_PLATFORM_PROXY_TARGET = 'http://124.223.180.186:9999'

/** 写保护 / 顶栏「生产环境」徽标按主机名判定；dev 与 test 默认目标都不在这台，不触发守卫。 */
export const PRODUCTION_BACKEND_HOSTS = ['115.227.21.133']

/**
 * 允许走真实「新建采集」（site/add → snatchSave → bindSite）的后端主机。
 * 生产 217（原「仅生产可新建」）＋ 本地开发环境 186（2026-10-12：开发环境完整后端，新建/改/删全放行）。
 * 186 不在 PRODUCTION_BACKEND_HOSTS 里，写保护本就不拦它；这里只解决 siteCreate 的独立闸门。
 * 133 测试环境（2807）2026-10-13 用户拍板放开：网站下添加源 / 批量导入要能真建源。
 */
export const CREATE_ALLOWED_BACKEND_HOSTS = ['118.25.96.217', '124.223.180.186', '115.227.21.133']

/**
 * 数据同步服务（sync-platform）所在环境的后端主机。同步服务按它自己连的库列源表，
 * 前端连的后端不是这台时（如 2806 连 217），数据中心的表和同步服务对不上。
 * 2026-10-31：npm run test 下同步服务切至 186 环境，同时保留 133 兼容。
 */
export const SYNC_PLATFORM_BACKEND_HOST = '124.223.180.186'
export const SYNC_PLATFORM_BACKEND_HOSTS = ['124.223.180.186', '115.227.21.133']
/**
 * 旧 ai-chat-view（大模型问答 POC）的模板配置服务前缀（1013 迁入 SQL 模板配置）。
 * 它**不在 9999 业务后端上**，是独立进程，真实路径形如 /api/poc/sql-temp/page，
 * 所以调用方传根相对 httpEndpoint（不拼 BASE_URL /api/v1/），dev 代理见 vite.config.ts 的 '/api/poc'。
 * 生产/测试环境要由 Nginx 反代同一个 /api/poc 前缀，否则整域 404。
 */
export const POC_API_PREFIX = '/api/poc'

/** /api/poc 默认目标：186 本地开发环境的 POC 服务（实测 2026-10-13 分页接口免鉴权可通）。 */
export const DEFAULT_POC_PROXY_TARGET = 'http://124.223.180.186:9093'
