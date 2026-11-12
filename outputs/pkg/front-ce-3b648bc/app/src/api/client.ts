import { mockRegistry } from './mock'
import { ENDPOINT_PATHS, DANGER_ENDPOINTS, LIVE_ENDPOINTS } from './endpoints'
import { flowRequestPath, type BackendScope } from './flowBackend'
import { ACCESS_TOKEN_HEADER, isSessionExpiredRedirect, readStoredToken, triggerSessionExpired } from './auth'
import {
  PRODUCTION_BACKEND_HOSTS,
  CREATE_ALLOWED_BACKEND_HOSTS,
  SOURCE_ISSUE_WRITE_BLOCKED_HOSTS,
  SOURCE_ISSUE_WRITE_BLOCKED_GATEWAYS,
  POC_API_PREFIX,
  DEFAULT_POC_PROXY_TARGET,
} from '@/constants/backend'

// 数据适配层：默认 mock。两种切真实后端的方式：
// ①按端点：endpoints.ts 把某端点标 live:true 后自动切真实，其余仍走 mock —— 功能一个个上线用这个。
// ②全局：VITE_API_MODE=http 强制全部端点走真实（仍受 options.mode==='mock' 的按调用强制项优先），
//   仅用于本地联调验证一整批接口，不用于生产（生产靠①逐项上线，见 endpoints.ts 的 live 标记）。
type AdapterMode = 'mock' | 'http'
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface RequestOptions {
  /** Shared step/config reads retain the backend of the requesting workflow. */
  backendScope?: BackendScope
  mode?: AdapterMode
  method?: HttpMethod
  /**
   * 参数编码方式。默认 GET → query、其余 → body（JSON）。
   * `form` = application/x-www-form-urlencoded，给**没有 @RequestBody 的 Spring 对象绑定**
   * 端点用（如 config/add）：那类接口收 JSON 会**静默丢弃全部字段**——返回 success、记录也建了，
   * 但每个字段都是 null。2026-09-02 在 config/add 上实测撞到，表单与 query 才能绑上。
   */
  paramsIn?: 'query' | 'body' | 'form'
  timeoutMs?: number
  httpParams?: Record<string, unknown>
  httpEndpoint?: string
  /** 响应编码。json-or-text 用于后端成功时可能返回纯文本路径的文件接口。 */
  responseType?: 'json' | 'json-or-text'
  signal?: AbortSignal
  /** 额外的 URL query 参数；用于 POST 也需要 query 的场景（如旧 /v1 端点把 ids/all/skip/include/queue 放 query、body 仅放 param）。 */
  query?: Record<string, unknown>
  /**
   * query 里值为空串也照样带上的键。旧 axios 会保留空串参数，有的后端 `@RequestParam` 必须"在场"
   * 但可以为空（如 source/createJobs 的 `configId=`，不带直接报 not present）。默认空串一律跳过。
   */
  keepEmptyParams?: string[]
}

const MODE: AdapterMode = (import.meta.env.VITE_API_MODE as AdapterMode) || 'mock'
export const BASE_URL: string = import.meta.env.VITE_API_BASE || '/api/v1/'
const FAIL_RATE = Number(import.meta.env.VITE_API_FAIL_RATE) || 0
// 测试环境固定关闭（vitest.config.ts 的 test.env），避免既有测试意外撞上真实发起的 fetch
const DISABLE_LIVE_ENDPOINTS = import.meta.env.VITE_API_DISABLE_LIVE_ENDPOINTS === '1'

/** 当前构建是否以 Mock 为默认数据源；用于真实端点失败时仅在演示模式做本地回退。 */
export function isMockMode(): boolean {
  return MODE === 'mock'
}

/**
 * 网关类错误：nginx 在、后端服务没起来（停机 / 重启 / 发版中）。2026-09-24 实测生产整体 502 时，
 * 页面提示是「请求异常 [sourceType/update]: 请求失败 502」，用户看不出是后端没起来还是自己操作错了。
 * 这几种统一说人话；状态码和端点留在括号里方便排查。
 */
const GATEWAY_STATUSES = new Set([502, 503, 504])

function gatewayStatusOf(cause: unknown): number | undefined {
  const status = (cause as { status?: unknown } | null)?.status
  const detail = (cause as { gatewayDetail?: unknown } | null)?.gatewayDetail
  // 后端自己带了业务 msg 的 5xx 不算——那是后端给出的真实原因，照原文展示
  return typeof status === 'number' && GATEWAY_STATUSES.has(status) && !detail ? status : undefined
}

export class ApiError extends Error {
  endpoint: string
  override readonly cause?: unknown

  constructor(endpoint: string, cause?: unknown) {
    const gateway = gatewayStatusOf(cause)
    super(gateway
      ? `后端服务暂时不可用，请稍后重试（${gateway} ${endpoint}）`
      : `请求异常 [${endpoint}]: ${(cause as Error)?.message ?? String(cause)}`)
    this.endpoint = endpoint
    this.name = 'ApiError'
    this.cause = cause
  }
}

// 危险端点集合从契约清单 endpoints.ts 派生（单一事实源）；UI 统一灰显或二次确认。
export { DANGER_ENDPOINTS }
export function isDanger(endpoint: string): boolean {
  return DANGER_ENDPOINTS.has(endpoint)
}

// 生产写守卫（0812 计划 M0-4，2026-08-25 放宽为「可新建、禁改删」）：
// 本地默认代理就是生产（118.25.96.217）；133 测试机已废弃。
// 允许：新建网站、新建源（含随源新建配置）、把新建源关联网站、创建编排元数据。
// 禁止：改、删、启停、发抓取、换绑已有源、覆盖流程等。
// 判定读当前实际连接的后端主机：VITE_API_PROXY_TARGET 与 vite.config.ts 的 proxy target 同源。

function currentBackendTarget(): string {
  const env = import.meta.env as Record<string, string | undefined>
  return env.VITE_API_PROXY_TARGET || env.VITE_AUTH_PROXY_TARGET || ''
}

/** 当前连接的后端主机（去掉协议和端口），顶栏用来区分 118 生产 / 133 等环境；取不到返回空串 */
export function currentBackendHost(): string {
  return currentBackendTarget().replace(/^\w+:\/\//, '').replace(/[:/].*$/, '')
}

export function isProductionBackend(): boolean {
  const target = currentBackendTarget()
  return PRODUCTION_BACKEND_HOSTS.some((host) => target.includes(host))
}

/**
 * 真实新建采集通道：代理已指向「可新建后端」（生产 217 或本地开发环境 186），且显式允许新建。
 * 日常联调保持 VITE_API_MODE=mock（已迁移 live 端点走正式接口，未迁移继续 mock），
 * 不要用 VITE_API_MODE=http 一刀切打生产。
 * 2026-10-12：186 是开发环境（新建/改/删全放行，写保护不拦），加入可新建清单后 siteCreate
 * 不再回 mock 假 ID（src-xxx），改走真实 site/add → snatchSave → bindSite。
 */
export function isProductionCreateEnabled(): boolean {
  const target = currentBackendTarget()
  return CREATE_ALLOWED_BACKEND_HOSTS.some((host) => target.includes(host))
    && import.meta.env.VITE_SITE_CREATE_TARGET === 'production'
}

// 按真实请求目的地（httpEndpoint）判断，与 usesMockAdapter 的 liveCheckKey 口径一致。
const PRODUCTION_CREATE_ENDPOINTS = new Set([
  'site/add',
  'site/createSite',
  // 画布流程标签栏：给源关联 / 设默认 / 解除流程，都是这一条（整体替换绑定列表）
  'source-group/bindSourceFlows',
  // 2026-10-10 用户拍板放开（1008-03/04）：来源组增删改、按源 ID 调整成员、组绑定流程、绑定启停。
  // 都是 admin 才能调、带 revision 并发校验；UI 侧删组 / 移出 / 换组 / 退组都有二次确认。
  // **不放 changeMembersByRange**：一次能改上万个源，生产上「按筛选范围调整」入口置灰。
  'source-group/add',
  'source-group/update',
  'source-group/delete',
  // 2026-10-12 我的视图：只读写当前登录人自己的视图（后端按会话取用户），不碰源 / 流程 / 配置，不是共享数据，放开
  'source-view/add',
  'source-view/update',
  'source-view/delete',
  'source-view/sort',
  // 2026-10-15 我的视图目录里的源 / 来源组（V3 增量）：只改自己视图目录的绑定关系，不碰源本身
  'category/addSources',
  'category/delSources',
  'source-group/changeMembers',
  'source-group/bindFlows',
  'source-group/updateBindingState',
  'snatch/snatchSave',
  'source/bindSite',
  '/vrule/api/custom-compose/save',
  // 2026-08-26 拍板放开：配置的参数绑定/解绑。这两个是本清单里**第一次**出现的真删改
  // （configParamDel 直接删掉配置与参数的绑定记录，不可撤销），放开原因是画布上的「解绑」
  // 此前只改内存、刷新就回来，等于界面骗人；旧平台同一个按钮本来就是即时写库的。
  'config/configParamAdd',
  'config/configParamDel',
  'source/sendSnatchWithParam',
  // 2026-08-31 放开：数据视图「发后续任务」。旧平台 EntryList2 的 nextStep / nextStep2
  // 即时下发后续处理；这边 UI 已有二次确认。不放开则按钮能点、确认后被写保护拦下，后端收不到。
  // nextStep = 勾选/本页；nextStep2 = 发全部后续 / 发大量后续。与 sendSnatchWithParam 同性质（下发任务，不是改删配置）。
  'source/nextStep',
  'source/nextStep2',
  // 2026-08-27 拍板放开：源换网站 / 删除源 / 网站重命名（侧栏右键菜单）。
  // source/delete 是**永久删除源**，本清单里破坏性最强的一条，UI 侧必须保留二次确认。
  // 2026-09-01 补漏：当时注释写了「源换网站」但白名单只放了 delete，changeSite 打生产仍被拦。
  'source/delete',
  'source/changeSite',
  // 2026-09-01：源启停。日常已 live（httpEndpoint=source/changeEnable），漏加白名单则
  // 生产顶栏「禁止改删」会拦，源视图批量启停点了后端收不到。
  'source/changeEnable',
  // 2026-10-12 放开：源监控（数据源告警 / sourceCheck 页）的全部写操作。旧平台 MonitorList.vue
  // 的同一个页面本来就是行开关 / 批量启停 / 立即运行 / 删除 / 新增 / 编辑保存全部直连后端，
  // 迁到新平台后这些端点已在 endpoints.ts 标 live；若不加进本清单，日常代理默认指向生产
  // （118.25.96.217）时会被写保护在发请求前拦下——用户点了「删除」只看到一条写保护报错，
  // 后端一条都没收到，跟"没执行真实接口调用"是同一个观感。
  // ⚠️ 破坏性：delete 是**永久删监控配置**，update 会改监控规则与收件人（改完直接影响告警行为），
  // add 会让该源多出一条定时校验。UI 侧 delete / 立即运行 / 批量操作都有二次确认。
  // 与 source/delete 同理：这只是"允许发出去"，不代表已在生产验证过这套契约。
  'source/check/add',
  'source/check/update',
  'source/check/delete',
  'source/check/changeEnable',
  'source/check/runNow',
  'source/check/check-one',
  // 1013：队列告警（旧 page/config/QueueCheck.vue）的四个写端点。与 source/check 同性质——
  // 旧页面本来就是直连后端在改真实队列校验配置，迁到新平台若只在 mock 里"成功"，
  // 页面就是在骗人。delete 同样是**永久删配置**，UI 侧已加二次确认（confirmDanger）。
  // 与 source/check 同理：这只是"允许发出去"，不代表已在生产验证过这套契约。
  'mq/check/add',
  'mq/check/update',
  'mq/check/delete',
  'mq/check/changeEnable',
  // 1013：自定义告警（旧 page/config/CommJobList.vue，通用定时任务）的六个写端点。与 mq/check 同性质——
  // 旧页面本来就是直连后端在改真实定时任务配置，且行内「运行」会真的把任务推给后端执行；
  // 迁到新平台若只在 mock 里"成功"，页面就是在骗人。
  // ⚠️ 破坏性：delete 是**永久删任务配置**（UI 侧已加 confirmDanger）；copy 会多出一条同配置的任务；
  // run 是**真的触发执行**（旧版没有任何二次确认，这里保持 1:1 不确认——需要的话可以补）。
  // 与 source/check 同理：这只是"允许发出去"，不代表已在生产验证过这套契约。
  'comm-job/add',
  'comm-job/update',
  'comm-job/delete',
  'comm-job/changeEnable',
  'comm-job/copy',
  'comm-job/run',
  // 1013：指标数据集（旧 page/config/DatasetList.vue）的六个写端点。与 mq/check / comm-job 同性质——
  // 旧页面本来就是直连后端在改真实数据集：编辑保存、批量启停、由源快速生成、制作副本、立即执行指标。
  // 迁到新平台后这些端点已在 endpoints.ts 标 live；若不加进本清单，日常代理默认指向生产（118.25.96.217）
  // 时会被写保护在发请求前拦下——用户点了「删除」只看到一条写保护报错，后端一条都没收到。
  // ⚠️ 破坏性：delete 是**永久删数据集**（UI 侧已加 confirmDanger）；copy / genFromSource 会多出一条数据集；
  // runNow 会**真的把指标推给后端执行**（旧版没有任何二次确认，这里保持 1:1 不确认——需要的话可以补）。
  // 与 source/check 同理：这只是"允许发出去"，不代表已在生产验证过这套契约。
  'dataset/updateDataSet',
  'dataset/delete',
  'dataset/changeEnable',
  'dataset/copy',
  'dataset/genFromSource',
  'dataset/runNow',
  // 1014：指标定义（旧 page/config/MeasureList.vue）的七个写端点，与 dataset 那六个同一性质——
  // 旧页面本来就直连后端在改真实指标：新增、修改、复制、批量启停、批量删除、物理删除、由源生成。
  // 已在 endpoints.ts 标 live；不加进本清单则日常代理指向生产时会被写保护拦下（按钮点了后端收不到）。
  // ⚠️ 破坏性：deleteMeasurePhy 是**从物理表删除该指标记录**（无法恢复，旧页文案「警告，是否从表中删除该记录」，
  // 只对 isDelete === -1 的历史删除记录开放入口）；delete 是批量删除；copy / add / genMeasureFromSource 会多出记录。
  // 与 source/check、dataset 同理：这只是"允许发出去"，不代表已在生产验证过这套契约。
  'measure/add',
  'measure/update',
  'measure/copy',
  'measure/delete',
  'measure/changeEnable',
  'measure/deleteMeasurePhy',
  'measure/genMeasureFromSource',
  // 2026-09-18：定时任务启停（节点配置「定时策略」右上角那个开关）。与源启停同性质：
  // 可逆、不删数据，停用只是把 isDelete 置 1，随时能再打开。
  'job/enableJob',
  'job/disableJob',
  // 2026-09-18：保存源的定时（节点配置「定时策略」→ 保存）。纯新增，不删不覆盖别的东西；
  // 与上面两条启停是同一条线。
  //
  // ⚠️ createJobs **只会新建**，名字没骗人——实测连存两次会得到两条同时启用的定时，
  // 源就被抓两遍。所以源上已经有定时时必须走 updateJob 原地改（旧平台
  // SourceCronList.vue:303 的 updateCallback 就是这么干的）。
  'source/createJobs',
  'job/updateJob',
  // 2026-09-01：复制源。侧栏「按模板源添加」原先打自造 BFF site/cloneSource（永远 mock）。
  // 纯新增，与 snatchSave / copyAll 同性质；flag=1 会多出一套配置，不改原源。
  'source/copySource',
  'site/update',
  // 0918-01：清空网站标签只能走这条（site/update 传空串清不掉）。覆盖式写标签，
  // 不删网站、不动别的字段，与 site/update 同性质。
  'site/batchChangeTags',
  // 2026-08-28 拍板放开：源重命名（source/updateSource，team_six bfbbcf7 已切真实请求，
  // 但漏加本白名单，导致打生产时被写保护拦下）。
  'source/updateSource',
  // 2026-08-28 拍板放开：节点配置的新建与保存（config/modify/updateConfig）。
  // 这个端点**新增和修改是同一个**（不带 configId = 新增，带 = 更新，见 config_api.md §二），
  // 放开它等于同时放开"改已有配置"，而配置可被多个节点/流程/源复用，一次保存会影响到所有引用方。
  // ⚠️ 2026-08-28 更新：保存前的影响范围**确认弹窗已按会议要求删除**（0828 §6.2，原话
  // 「正常保存就保存了，不要有提示」）。现在 UI 上只在保存按钮旁挂一行灰字「N 个源在用」，
  // 数据仍来自 source/sourcePaged 的 configId 反查（穿透流程，首节点配置与子步骤引用都命中），
  // 但**不拦截**。共享配置没有回滚，改错了的退路是「复制节点」（0828 D02）。
  'config/modify/updateConfig',
  // 2026-08-28 放开：复制配置。它现在是**「复制节点 = 新增一套配置」**（0828 D02）的实现，
  // 原「另存为新配置」入口已删除。
  // 纯新增——复制出一条新配置，不改不删任何已有数据，与 site/add、snatch/snatchSave 同性质。
  // 之所以必须走它：updateConfig 不带 configId 并不会创建配置（实测），旧平台建配置也只有
  // 新建源向导 / source/genConfig / config/copyAll 三条路，前两条都会顺带动源。
  'config/copyAll',
  // 2026-09-02 放开：新增配置（config_api.md §十六）。纯新增，不改不删任何已有数据，
  // 与 site/add、config/copyAll 同性质。画布新拉的节点第一次「保存」靠它拿 configId。
  'config/add',
  // 2026-08-31 放开：源标签 / 颜色标识。旧平台 markBatch / markSourceFlag 即时写库
  // （tags、usedFlag）；不放开则新平台只改 session overlay，旧平台刷新后看不到。
  // 2026-09-01 改：白名单键跟 source/tagSource 一起放开时没意识到那个端点名是臆造的，
  // 真实生产请求打的是 source/markBatch（见 endpoints.ts 同一条注释），键改成真实路径。
  'source/markBatch',
  'source/setColor',
  // 2026-08-31 放开：流程画布步骤写入（节点名 / 进入条件 / 增删节点）。
  // 这几项在步骤上，不走配置。不放开则 UI 能点、确认后被写保护拦下，后端收不到。
  // saveItemConfig 是新增；stepModify / enable 是改；delete 是真删（UI 二次确认）。
  'item/next/saveItemConfig',
  'item/next/stepModify',
  'item/next/enable',
  'item/next/delete',
  // 2026-09-02 放开：流程（cs_flow）的写端点，为流程中心联调做准备。
  //
  // ⚠️ 2026-09-03 后端答复推翻了本段原先的免责理由。原文写的是「执行链路根本没接……
  // changeFlowBatch 只是把 cs_source.FLOW_ID 置上而已，执行器不读它，写坏了不会影响任何
  // 在跑的采集任务」——**这是错的**。后端原话「执行就按 flowID 去反选，去执行」：
  // 绑定即生效，关联到哪个流程，这个源就按那个流程的配置跑。所以 changeFlowBatch 是
  // 实打实会改变生产采集行为的写操作，下面那条单独的警告仍然成立且更重要。
  // saveFlow / deleteFlow 只动 cs_flow 自身，破坏面确实较小。
  // saveFlow 新增与修改是同一个端点（不带 flowId = 新增）；deleteFlow 是逻辑删除（is_delete=-1 + state=D）。
  //
  // updateFlowConf / changeFlowEnable 两条 2026-09-02 联调后确认代码里没有调用方（见 endpoints.ts
  // 同名端点的注释），连带从这份白名单删掉——留着一条没人调的写端点在生产白名单里，
  // 是比端点表本身更容易被忽略的隐患：万一以后哪天真的接了、却没顺手核对这里，
  // 反而是"看起来已经放行"，实际请求发出去才会被 ProductionWriteBlockedError 拦下。
  'flow/saveFlow',
  'flow/assignTemplate',
  'flow/deleteFlow',
  // ⚠️ 唯一一条写**存量生产表**的：changeFlowBatch 改的是 cs_source.FLOW_ID，不是 cs_flow，
  // 且单次上限 5000 条。**这个字段有消费方**——执行器按 FLOW_ID 反查配置后执行（2026-09-03
  // 后端答复），改它等于改这批源实际跑的那套配置。UI 侧必须保留二次确认 + 明确展示影响条数，
  // 不要做成"勾一片直接绑"。
  'flow/changeFlowBatch',
  // 2026-09-04 放开（0903 Y8）：两条复制端点，都是**纯新增**。
  // copyFlow 建一条新流程并把 cs_item_config 步骤复制过去；copyTemplateSteps 往一个已存在的
  // 目标流程里加步骤。两者都不改不删任何已有流程/步骤（不复制根节点，目标流程自己那条
  // isRoot=1 保持不动）。与 config/copyAll、source/copySource 同性质。
  'flow/copyFlow',
  'flow/copyTemplateSteps',
  // 2026-09-09 拍板放开：数据删除（entry/entryDelete 单条/该源 × 当日/全量、
  // entry/entryDeleteBatch 按 IDs 批量）。源数据视图这轮迁入了数据中心的删除入口，
  // 两个端点本来就 live，不放开则生产上按钮能点、确认后被写保护拦下、后端收不到——
  // 跟 source/nextStep 当初同款的「界面骗人」。
  // 破坏性与 source/delete 同级（永久删数据，不可撤销），两处入口都保留二次确认，
  // 且 UI 侧只在测试表（tableMeta.state === 'C'）显示。
  'entry/entryDelete',
  'entry/entryDeleteBatch',
  // 2026-09-08 放开：任务实例重发（task/resetTaskInsts，画布任务视图行内「重发」）。
  // 只把选中任务重置为待发送重新排队，不改不删任何配置/源/流程。2026-08-13 测试环境实测：
  // E / L 都能重跑、都变 W1、响应无逐条结果、无效 ID 静默忽略、幂等。UI 侧保留二次确认。
  'task/resetTaskInsts',
  // 2026-09-21 放开：分类目录管理（新增/批量新增/修改/删除）。
  // 对齐老平台 CategoryTree.vue，仅在「全部分类」下拉底部入口唤起的分类管理抽屉中使用。
  'category/add',
  'category/addBatch',
  'category/update',
  'category/delete',
  // 2026-09-10：按需求放开规则脚本/抓取配置保存，直接写入文件服务。
  '/api/file/upload',
  /**
   * 2026-09-22 拍板放开：数据表的新建与修改（画布「表配置 → 新建表 / 查看编辑表」）。
   *
   * 起因是用户在生产点「新建表 → 确定」**毫无反应**：`entryTypeAddAll` 标了 danger 却不在
   * 本清单里，守卫在发请求前就拦下了，而 `TableEditDialog.onSave` 当时是裸 await，
   * 抛错变成未捕获 rejection、界面一声不响（那个"没反应"已单独修成明确的错误提示）。
   *
   * 放开的范围：**新建和修改都放**（用户 2026-09-22 定）。
   * - `entryTypeAddAll` 是纯新增，与本清单里 site/add、snatchSave、category/add 同性质；
   * - `modifyEntryType` 是**真改已落库的表结构**，破坏性高于前者：一张表可能被多个源共用，
   *   改错的影响面比建一张新表大得多。UI 侧没有二次确认，靠的是这个弹窗本身就要逐字段填、
   *   不是一键操作。**若日后出过事，先收回这一条，新建那条可以留。**
   */
  'config/entryTypeAddAll',
  'config/modifyEntryType',
  /**
   * 2026-10-26 放开：单独更新实体表数据源 DS_KIND（表 ID 列表 → 快速同步到 CK 的回写）。
   * 不新增权限面——同一个字段的修改，2026-09-22 已随 `modifyEntryType` 整对象保存在生产放开
   * （编辑抽屉「数据源类型」下拉走的就是它）；本接口只是把同一动作从「整对象 + 字段 diff」
   * 收窄成「只 UPDATE 一列」，破坏面严格小于 modifyEntryType。二次确认在弹窗的「创建任务」上。
   */
  'config/entry-type-ds-kind',
  /**
   * 2026-09-24 放开（0924-04）：节点类型的新增与修改（系统设置 → 节点类型）。
   * 0924 会议定的迁移项，旧平台「配置 → 源类型」同样即时写库。add 是纯新增；update 是后端**增量更新**
   * （只改传过去的字段），临时类型 99901 在生产闭环实测过。**删除不放**：被引用时是否拒删未验证，
   * 新平台不提供删除入口，需要删去旧平台（0924 方案 §4.2）。
   */
  'sourceType/add',
  'sourceType/update',
  /**
   * 2026-10-10 放开（流程版本）：217 后端 10-10 13:10 起全部流程进版本模式，v1 已发布只读，
   * 不先建草稿任何步骤都改不了（画布删除节点报「请先进入流程草稿编辑并重新加载版本信息」）。
   * draft 建草稿副本（纯新增，不动发布版）；publish 让新任务改用草稿（旧任务继续用原版本）；
   * abandon 放弃草稿（逻辑删除，不占版本号）。对齐 217 旧平台 FlowNodeDrawer 的同名按钮，
   * publish / abandon 在 UI 侧都有二次确认。
   */
  'flow/version/draft',
  'flow/version/publish',
  'flow/version/abandon',
])

function isProductionWriteAllowed(httpEndpoint: string): boolean {
  return PRODUCTION_CREATE_ENDPOINTS.has(httpEndpoint)
}

function isProtectedSourceIssueTarget(target: string): boolean {
  if (!target) return false
  const url = new URL(target, window.location.href)
  return SOURCE_ISSUE_WRITE_BLOCKED_HOSTS.includes(url.hostname)
    || SOURCE_ISSUE_WRITE_BLOCKED_GATEWAYS.includes(url.host)
}

export class ProductionWriteBlockedError extends Error {
  httpEndpoint: string

  constructor(httpEndpoint: string) {
    super(`生产环境写保护：端点 [${httpEndpoint}] 不在允许清单（仅允许新建网站/源/配置及编排元数据，禁止改删），已阻止发送，未联网`)
    this.httpEndpoint = httpEndpoint
    this.name = 'ProductionWriteBlockedError'
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function appendQuery(url: string, params?: Record<string, unknown>, keepEmpty: string[] = []): string {
  if (!params) return url
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return
    if (value === '' && !keepEmpty.includes(key)) return
    if (Array.isArray(value)) {
      query.set(key, value.join(','))
      return
    }
    query.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  })
  const text = query.toString()
  return text ? `${url}?${text}` : url
}

/** 表单编码。与 appendQuery 同一口径：跳过 undefined/null/''，数组按逗号串，对象序列化成 JSON。 */
function formEncode(params: Record<string, unknown> | undefined): string {
  const form = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      form.set(key, value.join(','))
      return
    }
    form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  })
  return form.toString()
}

function normalizeHttpPayload(endpoint: string, payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const envelope = payload as Record<string, unknown>
  if (!('code' in envelope)) return payload

  const code = String(envelope.code ?? '')
  if (code && code !== '0') {
    // M3-0K（2026-08-18 实测）：业务失败时 envelope.data 有时带着比 msg 更具体的诊断（例如
    // nextStep 的 cond 语法错误，msg 只有"错误信息:运行时异常"，data 却是真实的解释器报错
    // "<Long, 1> can't be a left value for assignment."）。此前只取 msg，data 被静默丢弃。
    const detail = typeof envelope.data === 'string' && envelope.data.trim() ? `：${envelope.data}` : ''
    const err = new Error(String(envelope.msg || envelope.message || `业务请求失败 [${endpoint}]`) + detail) as Error & {
      payload?: Record<string, unknown>
    }
    err.payload = envelope
    throw err
  }

  const data = envelope.data
  // 实测修正（2026-07-17 T3 真实联调）：旧平台文档/脚手架注释写的是 totalCount，
  // 但实际 s-table 组件读的是 r.count（components/table/index.js:160），真实后端分页响应也是 count，
  // 不是 totalCount；totalCount 保留作兜底，避免其他未逐一验证的分页端点确实用了这个名字。
  if (Array.isArray(data) && ('count' in envelope || 'totalCount' in envelope || 'total' in envelope)) {
    return {
      list: data,
      total: Number(envelope.count ?? envelope.totalCount ?? envelope.total ?? data.length),
    }
  }
  // data 有时只是个诊断用的标量，不是调用方要的载荷——2026-08-19 真实联调 nextStep2 实测撞见：
  // 后端回 {msg:"操作成功，请等待处理，本次发送:0 条任务", data:0}，"0 !== null" 成立，旧逻辑把
  // 标量 0 当整个响应体返回，调用方按 {message} 取值时 msg 被静默丢弃，UI 只能落到兜底文案。
  // 只有 data 是对象/数组（详情、列表）时才是调用方真正要用的载荷，可以直接透传；标量场景下
  // envelope.msg 才是要展示给用户的真实文案。
  // 1008-10 补充：同步服务 add 类接口标量 data 是新增记录 id（如 sql-execute/add → data:101），
  // 调用方要展示「已下发，任务 #ID」，所以把 data 一并带回（nextStep2 只读 message，不受影响）。
  if (data !== undefined && data !== null && typeof data === 'object') return data
  return { ok: true, message: String(envelope.msg || '操作成功'), data: data as never }
}

// 未实现专属 mock 的契约端点 → 通用占位，保证 142 端点全部可调用、切 http 零改动。
function fallback(endpoint: string): unknown {
  if (/paged/i.test(endpoint)) return { total: 0, list: [] }
  if (
    DANGER_ENDPOINTS.has(endpoint) ||
    /add|update|delete|save|copy|enable|clear|run|gen|modify|rebuild|send|reset|purge|create|process|reply|recommend|chat/i.test(endpoint)
  ) {
    return { ok: true, demo: true, message: '演示环境：契约占位端点，mock 未实现具体数据' }
  }
  return null
}

/** 是否走 mock（与 request 内判定一致，供流式等非 JSON 客户端复用） */
export function usesMockAdapter(endpoint: string, options: RequestOptions = {}): boolean {
  // 按调用覆盖优先：强制 mock 用于未迁移域；强制 http 用于少数已迁移写路径（如生产新建）。
  if (options.mode === 'mock') return true
  if (options.mode === 'http') return false
  // live 判定键：
  // - data 域：httpEndpoint 为相对真实路径（如 entry/entryDataPaged），优先用它（逻辑键不在清单里）
  // - vrule：httpEndpoint 为根相对绝对路径（/vrule/...），不在清单里，改用逻辑键（rule/orchestration*）
  const httpKey = options.httpEndpoint
  const liveCheckKey = httpKey && !httpKey.startsWith('/') ? httpKey : endpoint
  return MODE === 'mock' && (DISABLE_LIVE_ENDPOINTS || !LIVE_ENDPOINTS.has(liveCheckKey))
}

/**
 * 请求体参数：绝大多数接口是对象（`{ id }` 这类），但批量接口会把数组直接当 body
 * （如 `config/entryType/batchGenerateAiCommont` 传 `tableIds: (string | number)[]`），
 * 序列化走 `JSON.stringify`，数组本身就是合法的 JSON 体，所以这里一并放行。
 */
export type RequestParams = Record<string, unknown> | unknown[]

export async function request<T>(
  endpoint: string,
  params?: RequestParams,
  options: RequestOptions = {},
): Promise<T> {
  try {
    if (usesMockAdapter(endpoint, options)) {
      await delay(120)
      if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
        throw new Error(`mock 随机失败注入: ${endpoint}`)
      }
      if (new URLSearchParams(location.search).get('fail') === endpoint) {
        throw new Error(`mock URL 参数失败注入: ${endpoint}`)
      }
      const handler = mockRegistry[endpoint]
      if (handler) return handler(params as Record<string, unknown> | undefined) as T
      if (ENDPOINT_PATHS.has(endpoint)) return fallback(endpoint) as T
      throw new Error(`[mock] 端点不在契约清单: ${endpoint}`)
    }
    const method = options.method ?? 'POST'
    const paramsIn = options.paramsIn ?? (method === 'GET' ? 'query' : 'body')
    // body 分支走 JSON.stringify，数组体原样序列化；query / form 分支只能是键值对象，这里收回对象类型。
    const httpParams = (options.httpParams ?? params) as Record<string, unknown> | undefined
    const httpEndpoint = options.httpEndpoint ?? endpoint
    const originalPath = httpEndpoint.startsWith('/') ? httpEndpoint : BASE_URL + httpEndpoint
    const resolvedPath = flowRequestPath(originalPath, httpEndpoint, import.meta.env.VITE_FLOW_PROXY_TARGET, window.location.hash, options.backendScope)
    // /api/poc（模板配置域）是独立进程，请求由 vite/nginx 直接送到 POC 服务，根本不经过业务后端。
    // 目的地按它自己的代理目标算，否则日常代理指着生产 217 时，写守卫会去拦一条
    // 压根不落在 217 上的请求——用户在页面上点「禁用」只会看到一条生产写保护报错。
    const destination = originalPath.startsWith(`${POC_API_PREFIX}/`)
      ? import.meta.env.VITE_POC_PROXY_TARGET || DEFAULT_POC_PROXY_TARGET
      : resolvedPath !== originalPath
      ? import.meta.env.VITE_FLOW_PROXY_TARGET
      : /^https?:\/\//.test(originalPath)
      ? originalPath
      : currentBackendTarget()
    const productionDestination = PRODUCTION_BACKEND_HOSTS.some((host) => destination.includes(host))
    // 同域静态部署的反代不一定注入构建变量，因此还要检查浏览器实际请求的地址。
    const protectedSourceIssueWrite = (httpEndpoint === 'source/issue/addBatch' || httpEndpoint === 'source/issue/handle')
      && (isProtectedSourceIssueTarget(resolvedPath) || isProtectedSourceIssueTarget(destination))
    if (protectedSourceIssueWrite || (isDanger(endpoint) && productionDestination && !isProductionWriteAllowed(httpEndpoint))) {
      throw new ProductionWriteBlockedError(httpEndpoint)
    }
    const headers: Record<string, string> = {}
    const token = readStoredToken()
    if (token) headers[ACCESS_TOKEN_HEADER] = token
    // 以 `/` 开头的 httpEndpoint 视为站点根相对路径（如 /vrule/...），不再拼 BASE_URL（/api/v1/）。
    // 规则编排 Sprint 4 直连旧 vrule 网关时用这个口径；采集中心同域端点仍走相对 path。
    const url = paramsIn === 'query' ? appendQuery(resolvedPath, httpParams, options.keepEmptyParams) : resolvedPath
    const requestUrl = options.query ? appendQuery(url, options.query) : url
    const controller = new AbortController()
    let timeoutExpired = false
    const onExternalAbort = () => controller.abort()
    if (options.signal) {
      if (options.signal.aborted) controller.abort()
      else options.signal.addEventListener('abort', onExternalAbort, { once: true })
    }
    const timeoutMs = options.timeoutMs ?? 20_000
    const timeout = window.setTimeout(() => {
      if (controller.signal.aborted) return
      timeoutExpired = true
      controller.abort()
    }, timeoutMs)
    if (paramsIn === 'body') headers['Content-Type'] = 'application/json'
    if (paramsIn === 'form') headers['Content-Type'] = 'application/x-www-form-urlencoded'
    let res: Response
    try {
      res = await fetch(requestUrl, {
        method,
        credentials: 'include',
        headers,
        body: paramsIn === 'body'
          ? JSON.stringify(httpParams ?? {})
          : paramsIn === 'form' ? formEncode(httpParams) : undefined,
        signal: controller.signal,
      })
    } catch (error) {
      if (timeoutExpired) throw Object.assign(new Error(`请求超时（${timeoutMs / 1000} 秒），后端未及时响应，请稍后重试`), { name: 'TimeoutError' })
      // 保留 AbortError 名称：调用方（如 taskStat 的 isAbort）靠 ApiError.cause.name 区分「取消」与真实错误。
      if (options.signal?.aborted && controller.signal.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' })
      throw error
    } finally {
      window.clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onExternalAbort)
    }
    // S1（计划 §12.2）：会话失效以 302→logout.htm 落地，与 auth.ts authRequest 共用同一检测与处理器
    if (isSessionExpiredRedirect(res)) {
      triggerSessionExpired()
      throw new Error('登录失效,请重新登录')
    }
    if (!res.ok) {
      // 尝试解出后端业务 message（4xx/5xx 通常仍带 code/msg envelope）
      let detail = ''
      let body: Record<string, unknown> | undefined
      try {
        body = await res.clone().json() as Record<string, unknown>
        if (body && typeof body === 'object') {
          if (body.msg) detail = `: ${String(body.msg)}`
          else if (body.message) detail = `: ${String(body.message)}`
        }
      } catch { /* 无 body 或非 JSON */ }
      const err = new Error(`请求失败 ${res.status}${detail}`) as Error & {
        body?: Record<string, unknown>
        status?: number
        gatewayDetail?: string
      }
      err.body = body
      err.status = res.status
      err.gatewayDetail = detail
      throw err
    }
    // 2xx 但响应体为空是部分真实后端网关的合法成功态（实测撞见 vrule AI 编辑网关），
    // 不能直接 res.json() 空字符串——那会抛 "Unexpected end of JSON input"。
    // 只在正文真为空时按 null 处理（走各 xxxFromLegacy 适配器的空输入兜底分支）；
    // 非空但解析失败仍然是真实错误，照样往外抛，不吞掉。
    const bodyText = await res.text()
    let body: unknown = null
    if (bodyText.trim()) {
      if (options.responseType === 'json-or-text') {
        try {
          body = JSON.parse(bodyText)
        } catch {
          body = { ok: true, message: bodyText }
        }
      } else {
        body = JSON.parse(bodyText)
      }
    }
    return normalizeHttpPayload(httpEndpoint, body) as T
  } catch (e) {
    throw new ApiError(endpoint, e)
  }
}
