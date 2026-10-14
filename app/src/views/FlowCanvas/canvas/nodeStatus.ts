// 节点状态（待配置 / 运行 / 已停止 / 规划中）的唯一判定口径。
// 画布卡片和右侧节点面板都从这里取，避免一边按配置算、一边直接显示种子里的占位 status（2026-10-14 用户报两处不一致）。
import {
  effectiveOutputTable,
  isDataNode,
  isRuleNode,
  collectorCapabilityOf,
  type NodeConfig,
} from './flowModel'

// 节点运行状态语义（0703 问题九）：待配置 → 运行 ↔ 停止；"运行"即业务口中"配置完成、点启动进入运行"的状态，
// "停止"即"数据在此节点不处理"——均为纯文案层，disabled 字段名/序列化结构不变。
// 与 runtime.isRunnable 同源判定：登录和规则节点按各自能力判断，不能只看输出表。

function hasLoginConfig(cfg: NodeConfig): boolean {
  const collect = cfg.collectCfg
  if (!collect || collectorCapabilityOf(cfg)?.kind !== 'login') return true
  const configs = collect.loginConfigs?.length
    ? collect.loginConfigs
    : collect.account || collect.loginUrl
      ? [{
        id: 'legacy-default', loginUrl: collect.loginUrl || collect.url || '', loginName: collect.account || '', loginPwd: '',
        newLoginConfig: '1' as const, authConfig: '', enabled: true,
      }]
      : []
  return configs.some((config) => config.enabled && (config.newLoginConfig === '0' ? config.authConfig.trim() : config.loginUrl.trim() && config.loginName.trim() && config.loginPwd.trim()))
}

/** 「待配置」到底缺什么——只写状态不写原因，用户没法自查。 */
function missingFor(cfg: NodeConfig): string[] {
  const miss: string[] = []
  const collect = cfg.collectCfg
  if (collect) {
    if (!collectUrlOf(cfg)) miss.push('URL')
    if (!hasLoginConfig(cfg)) miss.push('登录配置')
    if (collectorCapabilityOf(cfg)?.kind !== 'login' && !collect.outputTable) miss.push('输出表')
    return miss
  }
  if (isRuleNode(cfg)) {
    // 用词跟 stores/flow.ts 的保存校验对齐（「请先保存表配置」/「尚未生成规则脚本」）
    if (!cfg.configId) miss.push('表配置')
    if (!cfg.ruleCfg?.script?.trim()) miss.push('规则脚本')
    return miss
  }
  // 用 effectiveOutputTable 而不是 nodeOutputTable（2026-09-18）：
  // 非采集节点没显式设输出表时**默认继承上游**，`tableChip` 就是这么显示的
  // （卡片上「⊞ 通用新闻表」，title 还写着"未显式设置，默认继承上游"）。
  // 判定这边只认显式值的话，就出现卡片说有表、状态说缺表的自相矛盾——
  // 这正是本文件 221 行记的那个 bug，当时只修了采集节点那半边。
  if (isDataNode(cfg) && !effectiveOutputTable(cfg)) miss.push('输出表')
  return miss
}

/**
 * 采集节点的 URL 统一读取口径（2026-09-04 修）。
 *
 * `collectCfg.url` 是**源 URL**，只有源视图的 `buildSourceSeed` 会填它。
 * 而节点配置 Tab 里用户看到、编辑、保存的那个「URL」是 **`cfg.configUrl`**
 * （旧平台「配置编辑」的 configUrl，见 ConfigTab.vue:440 的注释）——两者本就不是一份。
 *
 * 只认 `collectCfg.url` 的后果：**流程视图里的采集节点永远是「待配置」**，因为那里没有源，
 * 这个字段填不上。用户实例：流程 1400984 的「网页抓取测试01」右侧明明写着
 * 「已有配置 #1400990」、URL = www.baidu.com，卡片却一直是待配置
 * （实测该节点 configUrl='www.baidu.com'、collectCfg.url=''）。
 *
 * 判"配没配"要跟用户看到的那个字段对齐，所以两者取其一即可。
 */
function collectUrlOf(cfg: NodeConfig): string {
  return cfg.collectCfg?.url || cfg.configUrl || ''
}

export function nodeStatusOf(cfg: NodeConfig): { configured: boolean; left: string; missing: string[] } {
  const configured = cfg.collectCfg
    ? !!(collectUrlOf(cfg) && hasLoginConfig(cfg) && (collectorCapabilityOf(cfg)?.kind === 'login' || cfg.collectCfg.outputTable))
    : isRuleNode(cfg)
      ? !!(cfg.configId && cfg.ruleCfg?.script?.trim())
    // 与 tableChip 同口径：非采集节点的输出表可以继承上游，见 missingFor 的说明
    : isDataNode(cfg) && !!effectiveOutputTable(cfg)
  const left = cfg.disabled
    ? '已停止'
    : cfg.planned
      ? '规划中'
      : cfg.collect || isDataNode(cfg)
        ? configured
          // `cfg.status` 是**运行态**（"运行中"这类）。但节点种子里给的初始值就写着
          // '待配置'（flowModel.seeds 里几乎每个模板都有），配好之后没人去清它——
          // 于是 configured 明明是 true，这里仍旧原样吐出"待配置"，而且 missingFor
          // 查不出缺什么，卡片上只剩一个没有任何解释的「待配置」（2026-09-18 用户报）。
          // 占位值不当运行态用。
          ? (cfg.status && cfg.status !== '待配置' ? cfg.status : '运行')
          : '待配置'
        : '待配置'
  return { configured, left, missing: left === '待配置' ? missingFor(cfg) : [] }
}
