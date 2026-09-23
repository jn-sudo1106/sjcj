// flowModel.seeds.ts — 节点配置种子与流程构造器
//
// 从 flowModel.ts（1270 行）物理切出：
//   - 采集能力字典（COLLECTOR_CAPABILITIES / inferCollectorKind / collectorCapabilityOf）
//   - 规则编排（DEFAULT_RULE_SYSTEM_PROMPT / makeDefaultRuleOrchestration）
//   - 节点种子配置（NODE_CONFIG_SEEDS / NODE_CONFIGS）
//   - 模板映射（TEMPLATE_TO_NODE / SNATCH_TYPES / WEB_KIND_OPTIONS / CONFIG_STRATEGY_OPTIONS
//     / TEMPLATE_TO_SNATCH / Pill / LibItem / LibGroup / LIB_GROUPS / TEMPLATE_TO_NAME）
//   - 流程构造器（buildSourceSeed / makeSiteSeedTemplate / makeBlankFlow / makeStandardFlow
//     / buildFlow / PRESET_INTENTS）
//
// 依赖关系：seeds → layout（用 cloneConfig / normalizeNodeConfigs / backfillOutputTables）
// 切分后 flowModel.ts 末尾 re-export `* from './flowModel.seeds'`，外部所有引用方零改动。

import type { Source, Step } from '@/api'
import type {
  CollectConfig,
  CollectorCapability,
  CollectorKind,
  FlowDef,
  LibGroup,
  NodeConfig,
  NodeConfigSeed,
  Pill,
  PresetIntent,
  RuleOrchestration,
} from './flowModel'
import { cloneConfig, normalizeNodeConfigs, backfillOutputTables } from './flowModel.layout'
import { isAudioTextNode, isRuleLikeNode, isTranslateNode } from './flowModel'
import { RULE_DATA_SOURCE } from '@/constants/rule'

// ---------- 采集能力 ----------
/** 采集节点能力字典：固定产物类型节点的表/队列不可编辑，UI 与 store 双重防线都据此判断（0711 T5） */
export const COLLECTOR_CAPABILITIES: Record<CollectorKind, CollectorCapability> = {
  web: { kind: 'web', label: '网页抓取', artifactType: 'structured', outputMode: 'selectable', queueMode: 'editable', supportsProxy: true, supportsResume: true, supportsLogin: true, supportsUrlParams: true },
  browser_html: {
    kind: 'browser_html', label: '浏览器抓取', artifactType: 'html', outputMode: 'fixed', fixedOutputTable: 'raw_html_browser',
    queueMode: 'fixed', fixedQueue: 'browser_html_collect', supportsProxy: true, supportsResume: true, supportsLogin: true, supportsUrlParams: true,
  },
  wechat_official_html: {
    kind: 'wechat_official_html', label: '公众号抓取', artifactType: 'html', outputMode: 'fixed', fixedOutputTable: 'raw_html_wechat_official',
    queueMode: 'fixed', fixedQueue: 'wechat_official_html_collect', supportsProxy: true, supportsResume: true, supportsLogin: true, supportsUrlParams: true,
  },
  app: { kind: 'app', label: 'APP 抓取', artifactType: 'structured', outputMode: 'selectable', queueMode: 'editable', supportsProxy: false, supportsResume: false, supportsLogin: true, supportsUrlParams: false },
  file_download: { kind: 'file_download', label: '文件下载', artifactType: 'file', outputMode: 'selectable', queueMode: 'editable', supportsProxy: false, supportsResume: true, supportsLogin: false, supportsUrlParams: false },
  python: { kind: 'python', label: 'Python 抓取', artifactType: 'structured', outputMode: 'selectable', queueMode: 'editable', supportsProxy: false, supportsResume: false, supportsLogin: false, supportsUrlParams: false },
  // S4-1（方案 §6.1）：登录从采集节点运行设置里的勾选项拆成独立节点——它自己就是登录动作，不需要
  // "本节点是否需要登录"这个开关（supportsLogin: false），账号/凭据是它自己的核心字段，见 ConfigTab.vue
  // 的 kind === 'login' 专属输入框。产物是会话/凭据，落哪张表由用户选（0805 确认 outputMode: selectable）。
  login: { kind: 'login', label: '网页登录', artifactType: 'structured', outputMode: 'selectable', queueMode: 'editable', supportsProxy: true, supportsResume: false, supportsLogin: false, supportsUrlParams: false },
}

/** 从旧字段推导采集类型（1:1+fallback，0701 问题五同款口径）：显式 collectorKind 优先，否则按 snatchType 特征推断 */
export function inferCollectorKind(cc?: CollectConfig): CollectorKind {
  if (cc?.collectorKind) return cc.collectorKind
  const st = cc?.snatchType || ''
  if (/BROWSER/.test(st)) return 'browser_html'
  if (/WECHAT/.test(st)) return 'wechat_official_html'
  if (/\[170\]/.test(st)) return 'python'
  if (/\[95\]/.test(st)) return cc?.webKind === 'attachment' ? 'file_download' : 'app'
  return 'web'
}

/** 节点的采集能力描述；非采集节点（无 collectCfg）返回 undefined */
export function collectorCapabilityOf(cfg: NodeConfig): CollectorCapability | undefined {
  if (!cfg.collectCfg) return undefined
  return COLLECTOR_CAPABILITIES[inferCollectorKind(cfg.collectCfg)]
}

// ---------- 规则编排 ----------
export const DEFAULT_RULE_SYSTEM_PROMPT =
  '生成 Python 规则脚本：入口函数名为 main，参数为指定入参字段列表，返回包含指定出参字段的 JSON 对象；只做字段转换与判断，禁止访问未授权外部网络或本地文件。'

export function makeDefaultRuleOrchestration(): RuleOrchestration {
  return {
    mode: 'new',
    describe: '',
    systemPrompt: DEFAULT_RULE_SYSTEM_PROMPT,
    script: '',
    scriptPath: '',
    enabled: true,
    // 表相关字段一律双值（物理表名 + tableId），见 0801 方案 §4.6；数据源固定采集库（0804 拍板）
    dataSource: RULE_DATA_SOURCE,
    inputTable: '',
    inputTableId: '',
    outputTable: '',
    outputTableId: '',
    inputFields: [],
    outputFields: [],
  }
}

// ---------- 抓取配置（0804 S3-3，方案 §3.1 修正 C/D；0805 S3-5 补全为 few-shot，见方案 §十 附录）----------
// 动作类型清单会议未给全（方案 §9.1 D10 连带效果：降级为"填默认提示词"，不卡排期），
// 下面这份提示词按已拿到的 XML 样例（参考_抓取配置XML样例_2026-08-04.xml）总结出结构说明 + 完整中文属性名清单 +
// $$$ iframe 拼接规则 + 四份路径冗余规则，并把样例原文整份作为 few-shot 附在最后——比纯文字描述可靠（方案 §十.8 第 4 条）。
// 后续拿到官方完整动作清单，只需要在这个常量里补充新动作类型的说明，不改代码、不改调用方（用户可编辑，不是写死行为）。
export const CAPTURE_CONFIG_SAMPLE_XML = `<Actions>
    <OpenUrlAction DisplayTitle="打开网页" ActionId="7fcadca9-b326-4861-8a14-0bab68f87eb3" NextActionId="cae34015-fc59-42b6-95e3-e9e984ca970d" LastActionId="">
        <Config>
            <Url>
                <![CDATA[http://43.248.49.97/?outerValue1=7405,2603,7402,7404,7405,7406,7407,7408,7409,7410,7411,7412,2603,7402,7603,7604,7604,7608,7609,2606,7602,7903,7904,7905,7906,7907,7901,7601,7903,2608,7901,7804,7805,7806,2607,2604,2609,8003,8007,7502,2609,7504&year=2021&startMonth=8&endMonth=9]]>
            </Url>
            <UseHttp>False</UseHttp>
            <Proxy>
                <![CDATA[{"ip":null,"ttl":0,"protocol":null,"port":0,"time":null,"ntype":0,"strLoginName":null,"strPass":null,"isNeedUpdate":false,"strMode":null}]]>
            </Proxy>
            <HideImage>False</HideImage>
            <ReqType>GET</ReqType>
            <ReqParam></ReqParam>
            <BrowserScrollLoad>False</BrowserScrollLoad>
            <AsyncComplete>False</AsyncComplete>
            <MaxView>False</MaxView>
            <SingleProcess>False</SingleProcess>
            <CaptchaList>
                <![CDATA[]]>
            </CaptchaList>
            <WaitEngineAct>60</WaitEngineAct>
            <ErrorUrl></ErrorUrl>
            <VerifingAuths></VerifingAuths>
            <HTTPMonitor>False</HTTPMonitor>
            <AsyncUrls></AsyncUrls>
            <ContentLoad>False</ContentLoad>
            <FilterUrls></FilterUrls>
            <ChangeEnv>False</ChangeEnv>
            <FailedMaxNum>60</FailedMaxNum>
            <RunAsyncMode>True</RunAsyncMode>
            <SaveOriFile>False</SaveOriFile>
            <FailedExit>True</FailedExit>
            <AntiCraw>
                <![CDATA[{"strUrl":"","strCont":"","strTitle":"","xpaths":[],"isPause":false}]]>
            </AntiCraw>
            <HeadCont></HeadCont>
            <UnUseComUrl></UnUseComUrl>
            <SameUrlNotNav>False</SameUrlNotNav>
            <MonNav>False</MonNav>
            <ContIsSame>False</ContIsSame>
            <MinContSizeLimit>1000</MinContSizeLimit>
            <BodyCont>
                <![CDATA[]]>
            </BodyCont>
        </Config>
        <CfgNode>
            <![CDATA[{"headCont":null,"bodyCont":null,"strReqType":null,"strUrl":null}]]>
        </CfgNode>
    </OpenUrlAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="3b230630-0b6c-43bb-861d-6305ab85abec" NextActionId="" LastActionId="5fbb46ee-073c-4f93-a666-6520d2102e32">
        <Config>
            <ColumnCfg>
                <Column BizId="1107021" BizName="币类型">0</Column>
            </ColumnCfg>
            <XpathConfig>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="FullXpath" AttrValue="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="RelXpath" AttrValue="//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="下一个动作" AttrValue="无">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="等待页面跳转" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="忽略动作失败" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="等待时间" AttrValue="0">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="自动抓取" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="提取类型" AttrValue="提取文本">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="ReqActId" AttrValue="无">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="正则过滤" AttrValue="">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[6]/div[1]" isFrame="True" AttrName="点评解码" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[6]/div[1]</Xpath>
            </XpathConfig>
        </Config>
    </ExtractSingleValueAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="5fbb46ee-073c-4f93-a666-6520d2102e32" NextActionId="3b230630-0b6c-43bb-861d-6305ab85abec" LastActionId="c4e7f7a8-3b92-4b75-8ef8-d75b82c22fcb">
        <Config>
            <ColumnCfg>
                <Column BizId="1106473" BizName="结束时间">0</Column>
            </ColumnCfg>
            <XpathConfig>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="FullXpath" AttrValue="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="RelXpath" AttrValue="//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="下一个动作" AttrValue="3b230630-0b6c-43bb-861d-6305ab85abec">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="等待页面跳转" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="忽略动作失败" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="等待时间" AttrValue="0">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="自动抓取" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="提取类型" AttrValue="提取文本">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="ReqActId" AttrValue="无">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="正则过滤" AttrValue="">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="点评解码" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
            </XpathConfig>
        </Config>
    </ExtractSingleValueAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="c4e7f7a8-3b92-4b75-8ef8-d75b82c22fcb" NextActionId="5fbb46ee-073c-4f93-a666-6520d2102e32" LastActionId="cae34015-fc59-42b6-95e3-e9e984ca970d">
        <Config>
            <ColumnCfg>
                <Column BizId="1106472" BizName="起始时间">0</Column>
            </ColumnCfg>
            <XpathConfig>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="FullXpath" AttrValue="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="RelXpath" AttrValue="//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="下一个动作" AttrValue="5fbb46ee-073c-4f93-a666-6520d2102e32">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="等待页面跳转" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="忽略动作失败" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="等待时间" AttrValue="0">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="自动抓取" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="提取类型" AttrValue="提取文本">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="ReqActId" AttrValue="无">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="正则过滤" AttrValue="">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/table[1]/tbody[1]/tr[1]/td[4]/div[1]" isFrame="True" AttrName="点评解码" AttrValue="False">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@class='table table-border  table-hover table-sort table-responsive']/tbody[1]/tr[@class='text-r'][1]/td[4]/div[1]</Xpath>
            </XpathConfig>
        </Config>
    </ExtractSingleValueAction>
    <ExtractDataTableAction DisplayTitle="提取表格" ActionId="cae34015-fc59-42b6-95e3-e9e984ca970d" NextActionId="c4e7f7a8-3b92-4b75-8ef8-d75b82c22fcb" LastActionId="7fcadca9-b326-4861-8a14-0bab68f87eb3">
        <Config>
            <ColumnCfg>
                <Column BizId="1106469" BizName="商品编码">0</Column>
                <Column BizId="1106470" BizName="商品名称">1</Column>
                <Column BizId="1107025" BizName="贸易伙伴编码">2</Column>
                <Column BizId="1107026" BizName="贸易伙伴名称">3</Column>
                <Column BizId="1107019" BizName="第一数量">4</Column>
                <Column BizId="Col5" BizName="Col5">5</Column>
                <Column BizId="Col6" BizName="Col6">6</Column>
                <Column BizId="Col7" BizName="Col7">7</Column>
                <Column BizId="1106471" BizName="进出口金额">8</Column>
            </ColumnCfg>
            <XpathConfig>
                <Xpath RealPath="html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]$$$html[1]/body[1]/div[1]/div[2]/table[1]/tbody[1]/tr[1]/td[1]/div[1]" isFrame="True">//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]$$$//table[@id='table']/tbody[1]/tr[@class='text-c  mt-10'][1]/td[1]/div[@class='th-line'][1]</Xpath>
            </XpathConfig>
            <ParaCfg>
                <Para name="FullXpath">
                    <![CDATA[html[1]/body[1]/div[1]/section[1]/div[2]/div[2]/iframe[1]]]>
                </Para>
                <Para name="RelXpath">
                    <![CDATA[//div[@id='iframe_box']/div[@class='show_iframe'][2]/iframe[1]]]>
                </Para>
                <Para name="下一个动作">
                    <![CDATA[c4e7f7a8-3b92-4b75-8ef8-d75b82c22fcb]]>
                </Para>
                <Para name="等待页面跳转">
                    <![CDATA[False]]>
                </Para>
                <Para name="忽略动作失败">
                    <![CDATA[False]]>
                </Para>
                <Para name="等待时间">
                    <![CDATA[0]]>
                </Para>
                <Para name="自动抓取">
                    <![CDATA[False]]>
                </Para>
                <Para name="表格Row筛选">
                    <![CDATA[]]>
                </Para>
                <Para name="关键字识别表格">
                    <![CDATA[]]>
                </Para>
                <Para name="选择列表">
                    <![CDATA[无]]>
                </Para>
                <Para name="多Table模式">
                    <![CDATA[False]]>
                </Para>
                <Para name="列表模式">
                    <![CDATA[False]]>
                </Para>
                <Para name="点击表内元素">
                    <![CDATA[]]>
                </Para>
                <Para name="去除表头">
                    <![CDATA[True]]>
                </Para>
                <Para name="检查隐藏属性">
                    <![CDATA[False]]>
                </Para>
                <Para name="行列转置">
                    <![CDATA[False]]>
                </Para>
                <Para name="关键字删除行">
                    <![CDATA[]]>
                </Para>
                <Para name="关键字筛选列">
                    <![CDATA[]]>
                </Para>
                <Para name="删除列">
                    <![CDATA[]]>
                </Para>
                <Para name="复制列">
                    <![CDATA[]]>
                </Para>
                <Para name="行列转换">
                    <![CDATA[]]>
                </Para>
                <Para name="表格筛选">
                    <![CDATA[]]>
                </Para>
                <Para name="开始和结束关键字(|)分割">
                    <![CDATA[]]>
                </Para>
                <Para name="列配置">
                    <![CDATA[]]>
                </Para>
                <Para name="是否Trim">
                    <![CDATA[True]]>
                </Para>
                <Para name="补空列">
                    <![CDATA[]]>
                </Para>
                <Para name="去除重复列">
                    <![CDATA[False]]>
                </Para>
            </ParaCfg>
            <TableAct>{}</TableAct>
        </Config>
    </ExtractDataTableAction>
</Actions>`

export const DEFAULT_CAPTURE_CONFIG_SYSTEM_PROMPT =
  '你要生成抓取配置 XML（老引擎直接读取执行，格式必须完全兼容，不能自创字段或属性名）。\n\n' +
  '【整体结构】根节点 <Actions>；每个子元素名本身就是动作类型（不是 <Action type="...">）；' +
  'DisplayTitle 是中文显示名；ActionId 是 GUID；NextActionId/LastActionId 构成双向链表——' +
  '执行顺序按 NextActionId 串联，不是 XML 文档顺序；链头的 LastActionId=""，链尾的 NextActionId=""。\n\n' +
  '【已知动作类型】\n' +
  '- OpenUrlAction（打开网页）：属性是 <Config> 的直接子元素，如 <Url><![CDATA[...]]></Url>、<ReqType>GET</ReqType>、<WaitEngineAct>60</WaitEngineAct>、<FailedExit>True</FailedExit>。\n' +
  '- ExtractSingleValueAction（提取单值）：属性走 <Config><XpathConfig><Xpath RealPath="绝对路径" isFrame="True/False" AttrName="属性中文名" AttrValue="属性值">相对路径xpath正文</Xpath>，' +
  '每个属性单独一个 <Xpath> 元素、完整重复一遍 xpath 正文，缺一个属性都不行。\n' +
  '- ExtractDataTableAction（提取表格）：属性走 <Config><ParaCfg><Para name="属性中文名"><![CDATA[值]]></Para>，同样要写全，不能省略。\n' +
  '还可能有登录、下载、翻页等动作类型（会议未给全清单）——若需要，按同样的「元素名=动作类型」「属性挂在 <Config> 下」思路类推，不要臆造跟已知动作冲突的结构。\n\n' +
  '【中文属性名清单，必须原样使用，不能翻译、不能增删】\n' +
  'ExtractSingleValueAction 的 XpathConfig 固定 11 个：FullXpath、RelXpath、下一个动作、等待页面跳转、忽略动作失败、等待时间、自动抓取、提取类型、ReqActId、正则过滤、点评解码。\n' +
  'ExtractDataTableAction 的 ParaCfg 固定 26 个：FullXpath、RelXpath、下一个动作、等待页面跳转、忽略动作失败、等待时间、自动抓取、表格Row筛选、关键字识别表格、选择列表、多Table模式、列表模式、点击表内元素、去除表头、检查隐藏属性、行列转置、关键字删除行、关键字筛选列、删除列、复制列、行列转换、表格筛选、开始和结束关键字(|)分割、列配置、是否Trim、补空列、去除重复列。\n\n' +
  '【$$$ iframe 拼接规则】isFrame="True" 时，把「iframe 自身的 xpath」和「iframe 内目标元素的 xpath」用 $$$ 拼接成一条，可以多级嵌套（跨多层 iframe）；isFrame="False" 时不需要 $$$。\n\n' +
  '【四份路径冗余规则】同一个提取点，下面四处必须保持完全一致，任何一处写错都会导致老引擎解析失败：' +
  '① <Xpath> 的 RealPath 属性（绝对路径，如 html[1]/body[1]/…）；' +
  '② <Xpath> 元素的正文（相对路径，如 //div[@id=...]，含 $$$ 拼接）；' +
  '③ AttrName="FullXpath" 那一行的 AttrValue（= iframe 自身的绝对路径部分）；' +
  '④ AttrName="RelXpath" 那一行的 AttrValue（= iframe 自身的相对路径部分）。\n\n' +
  '【字段绑定】<ColumnCfg><Column BizId="字段id" BizName="字段中文名">列序号</Column></ColumnCfg>；' +
  'BizId/BizName 必须取自当前节点「表配置」里已选中的输出字段，不要虚构字段；' +
  '提取表格动作的列序号是表格实际列位置（从 0 开始数）；提取单值动作的列序号恒为 0；' +
  '暂时没有对应业务字段的列，用 BizId=BizName="Col{n}"（n = 该列列序号）占位，不要跳过这一列。\n\n' +
  '【输出要求】只输出合法 XML 本身，不要输出 Markdown 代码块标记，不要输出任何解释性文字。\n\n' +
  '【完整示例】下面是一份真实可用的抓取配置（海关进出口数据抓取场景，5 个动作），结构、属性名、四份路径冗余、' +
  '$$$ iframe 拼接、ColumnCfg 占位列写法都以这份为准：\n\n' +
  CAPTURE_CONFIG_SAMPLE_XML

export function makeDefaultExecConfig(): RuleOrchestration {
  return {
    mode: 'new',
    format: 'xml',
    describe: '',
    systemPrompt: DEFAULT_CAPTURE_CONFIG_SYSTEM_PROMPT,
    script: '',
    scriptPath: '',
    enabled: true,
  }
}

// ---------- 节点种子配置（key = 节点 id）。插入新节点时克隆对应模板生成新 key ----------
const NODE_CONFIG_SEEDS = {
  'web-list': {
    title: '公告列表抓取', sub: '[90] 网页抓取 · 源配置', status: '运行', planned: false, collect: true,
    base: [['源 URL', 'https://example.com/announcements?page=${page}'], ['源名称', '交易所公告列表 - A 股'], ['源分类', '公告 / 交易所 / 列表'], ['定时策略', '30 8 * * 1-5']],
    fields: [['使用代理', '否'], ['断点续爬', '开启'], ['源标签', '公告、A股、列表页']],
    inmap: [['page', '序列参数', '1..20'], ['publish_date', '动态日期', '$CUR_DATA,-1']],
    params: [['page', 'sequence', '1..20'], ['publish_date', 'date', '$CUR_DATA,-1,yyyy-MM-dd']],
    output: [['detail_url', 'url', '详情页子步骤入口'], ['title', 'string', '公告标题'], ['publish_time', 'date', '发布时间']],
    collectCfg: {
      snatchType: '[90] - 网页抓取', url: 'https://example.com/announcements?page=${page}',
      webKind: 'list',
      outputTable: '2101001', inputTable: '', inputParams: ['p-date'],
      isDetail: false,
    },
    taskCfg: { queue: 'announcement.list', urlRule: '' },
  },
  'web-detail': {
    title: '公告详情抓取', sub: '[90] 网页抓取 · 子步骤产物', status: '运行', planned: false, collect: true,
    base: [['失败策略', '跳过并记录'], ['启用状态', '启用'], ['原始文件', '保存 HTML/PDF']],
    fields: [['父步骤', '公告列表抓取'], ['去重', '由列表表去重'], ['超时', '30s'], ['重试', '2']],
    inmap: [['detail_url', '← 列表抓取.detail_url', '上一步属性'], ['retry', '常量', '2']],
    params: [['detail_url', 'from parent', '列表页输出'], ['retry', 'number', '2']],
    output: [['content', 'longtext', '正文'], ['attachments', 'json', '附件列表'], ['source_file', 'url', '原始文件']],
    collectCfg: {
      snatchType: '[90] - 网页抓取', url: 'https://example.com/detail/${detail_url}',
      webKind: 'detail',
      outputTable: '2101001', inputTable: '2101001', inputParams: [],
      isDetail: true,
    },
    taskCfg: { queue: '', urlSourceField: 'file_url-K4', urlRule: '$VAL$' },
  },
  'app-collect': {
    title: 'APP 抓取', sub: '[95] APP 抓取 · 移动端接口', status: '待配置', planned: false, collect: true,
    base: [['包名', 'com.example.app'], ['接口地址', 'https://m.example.com/api/list?page=${page}'], ['采集方式', 'APP 接口抓取'], ['鉴权方式', '接口 token / 设备参数']],
    fields: [['登录态', '按接口鉴权'], ['设备参数', '二期接入'], ['源标签', 'APP、接口']],
    inmap: [['page', '序列参数', '1..20'], ['token', '常量 / 登录态', '按接口鉴权']],
    params: [['page', 'sequence', '1..20'], ['token', 'credential', '接口鉴权参数']],
    output: [['payload', 'json', '接口返回'], ['content', 'longtext', '正文'], ['source_url', 'url', '来源链接']],
    collectCfg: {
      snatchType: '[95] - APP 抓取', url: 'https://m.example.com/api/list?page=${page}',
      webKind: 'list',
      outputTable: '', inputTable: '', inputParams: [],
      isDetail: false,
    },
    taskCfg: { queue: 'app.collect', urlRule: '' },
  },
  // 0711 R7：浏览器抓取——渲染并保存 HTML 文件，输出表/队列固定（先做成与网页抓取同构，仅能力键+固定值不同）
  'browser-html-collect': {
    title: '浏览器抓取', sub: '[BROWSER] 浏览器抓取 · 源配置', status: '待配置', planned: false, collect: true,
    base: [['源 URL', 'https://example.com'], ['源名称', '浏览器抓取源'], ['产物', 'HTML 文件（固定输出表）'], ['定时策略', '30 8 * * 1-5']],
    fields: [['使用代理', '否'], ['断点续爬', '开启'], ['源标签', '']],
    inmap: [],
    params: [],
    output: [['html_file', 'file', '渲染后的 HTML 文件']],
    collectCfg: {
      snatchType: '[BROWSER] - 浏览器抓取', url: 'https://example.com',
      webKind: 'list',
      outputTable: COLLECTOR_CAPABILITIES.browser_html.fixedOutputTable ?? '', inputTable: '', inputParams: [],
      isDetail: false,
      collectorKind: 'browser_html',
    },
    taskCfg: { queue: COLLECTOR_CAPABILITIES.browser_html.fixedQueue ?? '', urlRule: '' },
  },
  // 0711 R8：公众号抓取——同构于浏览器抓取，仅固定表/队列取另一组能力键
  'wechat-html-collect': {
    title: '公众号抓取', sub: '[WECHAT] 公众号抓取 · 源配置', status: '待配置', planned: false, collect: true,
    base: [['源 URL', 'https://mp.weixin.qq.com/s/xxx'], ['源名称', '公众号抓取源'], ['产物', 'HTML 文件（固定输出表）'], ['定时策略', '30 8 * * 1-5']],
    fields: [['使用代理', '否'], ['断点续爬', '开启'], ['源标签', '']],
    inmap: [],
    params: [],
    output: [['html_file', 'file', '公众号页面 HTML 文件']],
    collectCfg: {
      snatchType: '[WECHAT] - 公众号抓取', url: 'https://mp.weixin.qq.com/s/xxx',
      webKind: 'list',
      outputTable: COLLECTOR_CAPABILITIES.wechat_official_html.fixedOutputTable ?? '', inputTable: '', inputParams: [],
      isDetail: false,
      collectorKind: 'wechat_official_html',
    },
    taskCfg: { queue: COLLECTOR_CAPABILITIES.wechat_official_html.fixedQueue ?? '', urlRule: '' },
  },
  // 网页登录：无输入表；登录配置清单维护多条完整登录数据配置，发起任务时可临时切换默认配置。
  'login-collect': {
    title: '网页登录', sub: '[LOGIN] 网页登录 · 源配置', status: '待配置', planned: false, collect: true,
    base: [['登录页 URL', 'https://example.com/login'], ['源名称', '网页登录源'], ['产物', '登录会话/凭据（输出表可选）'], ['定时策略', '']],
    fields: [['使用代理', '否'], ['登录配置', ''], ['默认配置', '']],
    inmap: [],
    params: [],
    output: [['session_token', 'string', '登录会话/凭据'], ['login_status', 'string', '登录结果']],
    collectCfg: {
      snatchType: '[LOGIN] - 网页登录', url: 'https://example.com/login',
      webKind: 'list',
      outputTable: '', inputTable: '', inputParams: [],
      isDetail: false,
      collectorKind: 'login',
    },
    taskCfg: { queue: 'login.collect', urlRule: '' },
  },
  'file-parse': {
    title: '文件解析', sub: '文件解析类 · PDF/Word/Excel/图片', status: '建议补充 · P1', planned: false,
    base: [['文件来源', '← 文件下载.source_file / 原始文件归档'], ['文件类型', 'PDF / Word / Excel / 图片'], ['解析方式', '按页解析 + 表格抽取'], ['输出策略', '文本 + 结构化表']],
    fields: [['页码 / Sheet', '全部'], ['字段范围', '标题、正文、表格、附件'], ['失败策略', '保留原始文件并告警'], ['能力状态', '建议补充']],
    inmap: [['source_file', '← 文件下载.source_file', '原始文件'], ['file_type', '← 文件下载.file_type', '文件类型']],
    params: [['parse_mode', 'enum', '全文/表格/图片'], ['page_range', 'string', '1-*'], ['sheet_name', 'string', '全部']],
    output: [['parsed_text', 'longtext', '解析文本'], ['parsed_tables', 'json', '表格结构'], ['parse_trace', 'json', '解析日志']],
  },
  // ---- 2026-09-17 补齐后端字典里其余抓取类型（110/120/130/150/160/500） ----
  // 都是**采集类**节点（与网页抓取同构：有 collectCfg、走源 URL + 表/队列），只是类型不同。
  // 与 python 复用 'web-list' 的那套不一样：各自给一份种子，卡片上的类型副标题（sub 里的
  // `[编号]`）才对得上——iconFor() 就是读 sub 取徽标的。
  'excel-collect': {
    title: 'EXCEL抓取', sub: '[110] EXCEL抓取 · 表格文件', status: '待配置', planned: false, collect: true,
    base: [['源 URL', 'https://example.com/data.xlsx'], ['源名称', 'EXCEL 数据源'], ['文件类型', 'XLS/XLSX'], ['定时策略', '30 8 * * 1-5']],
    fields: [['Sheet', '全部'], ['表头行', '第 1 行'], ['使用代理', '否'], ['源标签', '']],
    inmap: [['row', '表格行', '逐行输出']],
    params: [['sheet_name', 'string', '全部'], ['header_row', 'number', '1']],
    output: [['row_data', 'json', '表格行数据'], ['sheet_name', 'string', '来源 Sheet']],
    collectCfg: {
      snatchType: '[110] - EXCEL抓取', url: 'https://example.com/data.xlsx',
      webKind: 'attachment',
      outputTable: '', inputTable: '', inputParams: [],
      isDetail: false,
    },
    taskCfg: { queue: 'excel.collect', urlRule: '' },
  },
  'doc-collect': {
    title: 'DOC抓取', sub: '[120] DOC抓取 · 文档文件', status: '待配置', planned: false, collect: true,
    base: [['源 URL', 'https://example.com/report.doc'], ['源名称', 'DOC 数据源'], ['文件类型', 'DOC/DOCX'], ['定时策略', '30 8 * * 1-5']],
    fields: [['解析段落', '开启'], ['保留表格', '开启'], ['使用代理', '否'], ['源标签', '']],
    inmap: [['paragraph', '段落', '逐段输出']],
    params: [['with_table', 'boolean', 'true']],
    output: [['doc_text', 'longtext', '文档正文'], ['doc_tables', 'json', '文档表格']],
    collectCfg: {
      snatchType: '[120] - DOC抓取', url: 'https://example.com/report.doc',
      webKind: 'attachment',
      outputTable: '', inputTable: '', inputParams: [],
      isDetail: false,
    },
    taskCfg: { queue: 'doc.collect', urlRule: '' },
  },
  'pdf-collect': {
    title: 'PDF抓取', sub: '[130] PDF抓取 · 版式文件', status: '待配置', planned: false, collect: true,
    base: [['源 URL', 'https://example.com/report.pdf'], ['源名称', 'PDF 数据源'], ['文件类型', 'PDF'], ['定时策略', '30 8 * * 1-5']],
    fields: [['按页解析', '开启'], ['保留版面', '开启'], ['使用代理', '否'], ['源标签', '']],
    inmap: [['page', '页', '逐页输出']],
    params: [['page_range', 'string', '1-*']],
    output: [['pdf_text', 'longtext', 'PDF 文本'], ['page_count', 'number', '页数']],
    collectCfg: {
      snatchType: '[130] - PDF抓取', url: 'https://example.com/report.pdf',
      webKind: 'attachment',
      outputTable: '', inputTable: '', inputParams: [],
      isDetail: false,
    },
    taskCfg: { queue: 'pdf.collect', urlRule: '' },
  },
  'mail-collect': {
    title: 'Mail抓取', sub: '[160] Mail抓取 · 邮件正文与附件', status: '待配置', planned: false, collect: true,
    base: [['收件配置', '信箱 / 文件夹'], ['源名称', 'Mail 数据源'], ['产物', '邮件正文 + 附件'], ['定时策略', '0 */1 * * *']],
    fields: [['抓取范围', '未读 / 指定主题'], ['附件下载', '开启'], ['使用代理', '否'], ['源标签', '']],
    inmap: [['mail', '邮件', '逐封输出']],
    params: [['folder', 'string', 'INBOX'], ['unread_only', 'boolean', 'true']],
    output: [['mail_subject', 'string', '主题'], ['mail_body', 'longtext', '正文'], ['attachments', 'json', '附件列表']],
    collectCfg: {
      snatchType: '[160] - Mail抓取', url: '',
      webKind: 'list',
      outputTable: '', inputTable: '', inputParams: [],
      isDetail: false,
    },
    taskCfg: { queue: 'mail.collect', urlRule: '' },
  },
  'news-collect': {
    title: '资讯抓取', sub: '[500] 资讯抓取 · 源配置', status: '待配置', planned: false, collect: true,
    base: [['源 URL', 'https://example.com/news'], ['源名称', '资讯数据源'], ['源分类', '资讯'], ['定时策略', '30 8 * * 1-5']],
    fields: [['使用代理', '否'], ['断点续爬', '开启'], ['源标签', '资讯']],
    inmap: [['page', '序列参数', '1..20']],
    params: [['page', 'sequence', '1..20']],
    output: [['detail_url', 'url', '详情页入口'], ['title', 'string', '标题'], ['publish_time', 'date', '发布时间']],
    collectCfg: {
      snatchType: '[500] - 资讯抓取', url: 'https://example.com/news',
      webKind: 'list',
      outputTable: '', inputTable: '', inputParams: [],
      isDetail: false,
    },
    taskCfg: { queue: 'news.collect', urlRule: '' },
  },
  // ---- 2026-09-17 补齐 700/710/720：媒体与摘要类（数据处理型，没有 collectCfg） ----
  // 与「数据处理」一样是通用处理节点：不绑采集能力，进出都是上游产物。
  'video-audio': {
    title: '视频提取音频', sub: '[700] 视频提取音频 · 媒体处理', status: '待配置', planned: false,
    base: [['视频来源', '← 上游节点产物'], ['输出格式', 'mp3'], ['采样率', '16k'], ['失败策略', '记录并跳过']],
    fields: [['音轨', '默认音轨'], ['切片时长', '不切片'], ['保留视频', '否'], ['能力状态', '通用处理节点']],
    inmap: [['video_file', '← 上游节点.video_file', '视频文件']],
    params: [['audio_format', 'enum', 'mp3/wav'], ['sample_rate', 'string', '16k']],
    output: [['audio_file', 'file', '音频文件'], ['duration', 'number', '时长（秒）']],
    taskCfg: { queue: 'dev_web_videotoaudio', urlRule: '' },
  },
  'audio-text': {
    title: '音频提取文字', sub: '[710] 音频提取文字 · 语音转写', status: '待配置', planned: false,
    base: [['音频来源', '← 上游节点产物'], ['识别语言', '中文 + 英文'], ['输出策略', '分段文本'], ['失败策略', '记录并跳过']],
    fields: [['说话人分离', '关闭'], ['时间戳', '保留'], ['置信度阈值', '0.8'], ['能力状态', '通用处理节点']],
    inmap: [['audio_file', '← 上游节点.audio_file', '音频文件']],
    params: [['language', 'enum', 'zh,en'], ['min_confidence', 'number', '0.8']],
    output: [['asr_text', 'longtext', '转写文本'], ['segments', 'json', '分段与时间戳']],
    taskCfg: { queue: 'dev_web_audiototext', urlRule: '' },
  },
  'article-tag': {
    title: '文章打标签', sub: '[730] 文章打标签 · 舆情多维标注', status: '待配置', planned: false,
    base: [['文本来源', '← 上游节点产物 / 手动上传'], ['标签体系', '主题 / 情感 / 风险 / 意图等 12 个维度'], ['输出策略', '结构化 JSON'], ['失败策略', '记录并跳过']],
    fields: [['主题标签', '不超过 3 个，按相关度排序'], ['风险等级', '与风险标签一致'], ['置信度', '低于 0.6 表示无把握'], ['能力状态', '通用标注节点']],
    inmap: [['content', '← 上游节点.content', '待标注文本']],
    params: [['label_schema', 'text', '提示词内置标签体系']],
    output: [['labels', 'json', '各维度标签'], ['summary', 'string', '一句话概括'], ['risk_level', 'string', '风险等级']],
    taskCfg: { queue: 'dev_web_llm_generate', urlRule: '' },
  },
  translate: {
    title: '翻译助手', sub: '[800] 翻译助手 · 文本翻译', status: '待配置', planned: false,
    base: [['文本来源', '← 上游节点产物 / 手动上传'], ['目标语言', '中文简体'], ['输出策略', '仅输出译文'], ['失败策略', '记录并跳过']],
    fields: [['保留格式', '段落 / 标题 / 列表'], ['代码块', '不翻译'], ['术语表', '待补充'], ['能力状态', '通用翻译节点']],
    inmap: [['content', '← 上游节点.content', '待翻译正文']],
    params: [['target_language', 'enum', '中文简体/中文繁体/英语/日语/韩语/法语/德语/西班牙语/俄语']],
    output: [['translated_text', 'longtext', '译文']],
    // 源/目标语言与引擎的默认值（编排配置 Tab 三个下拉）：保存时随 buildConfigPayload 写进 core_param
    //（2026-09-21 从 code_rule 调整到 core_param），格式与 /api/translate 同口径
    //（from/to 是百度语言码，自动检测 = auto；engine 存英文引擎码：baidu / google / youdao）。
    structuredConfig: '{"from":"auto","to":"en","engine":"baidu"}',
    taskCfg: { queue: 'dev_web_translate', urlRule: '' },
  },
  'article-summary': {
    title: '文章生成摘要', sub: '[720] 文章生成摘要 · 文本生成', status: '待配置', planned: false,
    base: [['文本来源', '← 上游节点产物'], ['摘要长度', '200 字以内'], ['输出策略', '摘要 + 关键词'], ['失败策略', '记录并跳过']],
    fields: [['关键词数量', '5'], ['保留小标题', '开启'], ['模型策略', '待配置'], ['能力状态', '通用处理节点']],
    inmap: [['content', '← 上游节点.content', '正文']],
    params: [['max_length', 'number', '200'], ['keyword_count', 'number', '5']],
    output: [['summary', 'longtext', '摘要'], ['keywords', 'json', '关键词']],
    taskCfg: { queue: 'dev_web_llm_generate', urlRule: '' },
  },
  ocr: {
    title: 'OCR抓取', sub: '[150] OCR抓取 · 执行器待确认', status: '规划中（待执行器）', planned: true,
    base: [['OCR 引擎', '待数据中心确认'], ['文件来源', '← 文件解析 / 原始图片'], ['输出表', 'ocr_text_result'], ['置信度阈值', '0.82']],
    fields: [['低置信度处理', '进入人工复核'], ['语言', '中文 + 英文'], ['版面保留', '开启'], ['能力状态', '页面可见，执行器待确认']],
    inmap: [['image_file', '← 文件下载.source_file', '图片或扫描件'], ['page_image', '← 文件解析.page_image', '页面图片']],
    params: [['min_confidence', 'number', '0.82'], ['language', 'enum', 'zh,en']],
    output: [['ocr_text', 'longtext', '识别文本'], ['confidence', 'number', '置信度'], ['bbox', 'json', '位置']],
    taskCfg: { queue: 'dev_web_snatch_ocr', urlRule: '' },
  },
  'ai-extract': {
    title: '公告要素 AI 提取', sub: '[155] AI 提取 · schema', status: '规划中（待执行器）', planned: true,
    base: [['模型策略', '公告要素抽取 v3'], ['输出实体表', 'announcement_event'], ['最低置信度', '0.80'], ['低置信度处理', '进入人工队列']],
    fields: [['schema 校验', '开启'], ['敏感字段', '金额、主体、事项'], ['版本', 'draft-ai-0.3'], ['执行器', '待确认']],
    inmap: [['content', '← 详情抓取.content', '正文'], ['attachments_text', '← 详情抓取.attachments', '附件解析文本']],
    params: [['event_type', 'enum', '增持/减持/诉讼/回购'], ['amount', 'number', '万元'], ['company_name', 'string', '主体公司']],
    output: [['event_type', 'string', '事项类型'], ['summary', 'text', '摘要'], ['confidence', 'number', '置信度']],
  },
  'field-map': {
    title: '字段抽取 / 结构化映射', sub: '文本结构化类 · schema 映射', status: '建议补充 · P1', planned: false,
    base: [['输入字段', 'parsed_text / content'], ['目标 schema', 'announcement_event'], ['缺失字段策略', '空值标记 + 异常输出'], ['置信度', '字段级记录']],
    fields: [['映射方式', '规则 + 函数工具'], ['日期标准化', 'normalize_date'], ['金额单位', '万元'], ['能力状态', '新前端扩展']],
    inmap: [['parsed_text', '← 文件解析.parsed_text', '解析文本'], ['content', '← 详情抓取.content', '正文']],
    params: [['schema', 'json', '字段定义'], ['missing_policy', 'enum', '空值/阻断/告警']],
    output: [['mapped_rows', 'table', '结构化行'], ['missing_fields', 'json', '缺失字段'], ['mapping_trace', 'json', '映射日志']],
  },
  clean: {
    title: '字段清洗 / 格式转换', sub: '清洗类 · 函数工具', status: '建议补充 · P1', planned: false,
    base: [['清洗函数', 'trim + normalize_date + unit_convert'], ['空值处理', '保留并标记'], ['日期转换', 'yyyy-MM-dd'], ['单位换算', '元 → 万元']],
    fields: [['函数来源', '数据中心函数工具 + 新前端扩展'], ['异常输出', 'error_rows'], ['处理范围', '标题、日期、金额、主体'], ['能力状态', '建议补充']],
    inmap: [['mapped_rows', '← 结构化映射.mapped_rows', '待清洗行']],
    params: [['date_format', 'string', 'yyyy-MM-dd'], ['amount_unit', 'enum', '万元'], ['null_policy', 'enum', '标记']],
    output: [['clean_rows', 'table', '清洗后数据'], ['clean_errors', 'json', '清洗异常'], ['clean_trace', 'json', '处理日志']],
  },
  dedupe: {
    title: '去重处理', sub: '清洗类 · 去重字段', status: '建议补充 · P1', planned: false,
    base: [['去重字段', 'source_url + publish_time'], ['重复策略', '保留最新'], ['异常输出', 'duplicate_rows'], ['保留规则', '优先完整字段']],
    fields: [['表去重键', 'entry_type.dedupe_fields'], ['重复率阈值', '<= 1%'], ['处理方式', '写入前检查'], ['能力状态', '建议补充']],
    inmap: [['clean_rows', '← 字段清洗.clean_rows', '待去重数据']],
    params: [['dedupe_key', 'expr', 'source_url + publish_time'], ['keep_policy', 'enum', 'latest']],
    output: [['unique_rows', 'table', '去重后数据'], ['duplicate_rows', 'json', '重复明细'], ['dedupe_rate', 'number', '重复率']],
  },
  rule: {
    title: '规则引擎处理', sub: '规则处理 · group/page', status: '可批测', planned: false,
    base: [['规则组', 'NEWS_SENTIMENT'], ['执行阶段', 'BASIC'], ['逻辑', 'AND · 命中即追踪'], ['规则版本', 'rulepkg-0616-draft']],
    fields: [['表达式', 'RULE_STOCK_PRICE_COUNT'], ['共享配置', 'stockPriceKeywords'], ['Trace', '记录命中与过滤原因'], ['鉴权', '经采集配置中心网关代理']],
    inmap: [['content', '← 详情抓取.content', '输入正文'], ['stockPriceKeywords', '← 共享配置', '关键词列表']],
    params: [['minContentLength', 'number', '50'], ['stockPriceThreshold', 'number', '5'], ['stockPriceKeywords', 'list', '股价,涨停,跌停']],
    output: [['rule_hit', 'boolean', '是否命中'], ['rule_reason', 'text', '命中原因'], ['risk_level', 'enum', 'low/mid/high']],
    ruleCfg: makeDefaultRuleOrchestration(),
  },
  check: {
    title: '质量校验', sub: '[300] 校验类 · 质量门禁', status: '异常分流', planned: false,
    base: [['校验对象', 'announcement_event'], ['完整性规则', '主体/时间/事项必填'], ['去重键', 'source_url + publish_time'], ['异常去向', '回详情抓取或人工队列']],
    fields: [['字段完整率', '>= 95%'], ['重复率', '<= 1%'], ['前处理函数', 'trim + normalize_date'], ['阻断策略', '高风险阻断发布']],
    inmap: [['rows', '← AI提取.* / 详情.*', '待校验数据行'], ['risk_level', '← 规则处理.risk_level', '风险等级']],
    params: [['required_fields', 'list', 'company,event_type,publish_time'], ['dedupe_key', 'expr', 'source_url + publish_time']],
    output: [['quality_score', 'number', '质量分'], ['error_rows', 'json', '异常明细'], ['pass', 'boolean', '是否通过']],
  },
  // 「落表输出」节点已移除（优化 0701 问题四）：落表是每个节点的固有配置能力（产物 Tab），不再作为独立节点类型。
  metric: {
    title: '指标引用', sub: '输出类 · 指标中心引用', status: 'P1 · 跳转指标中心', planned: false,
    base: [['指标数据集', 'announcement_event_dataset'], ['指标', '高风险公告数'], ['编辑入口', '指标中心轻编辑器'], ['引用方式', '只引用，不在画布编辑口径']],
    fields: [['结果回溯', 'dataset -> table -> source -> task'], ['负责人', '数据运营'], ['状态', '已发布'], ['能力状态', '新前端扩展节点']],
    inmap: [['entry_type_id', '← 上游节点.entry_type_id', '来源表'], ['data_id', '← 上游节点.data_id', '结果明细']],
    params: [['dataset_id', 'string', 'ds_announcement_event'], ['measure_id', 'string', 'm_risk_notice']],
    output: [['measure_result', 'url', '指标结果链接'], ['lineage', 'json', '回溯链路']],
  },
  mail: {
    title: '提取数据发邮件', sub: '[400] 通知 · 模板与审计', status: '规划中（待执行器）', planned: true,
    base: [['邮件模板', '投研公告日报'], ['收件组', '行业研究组 / 公司研究组'], ['触发条件', 'risk_level = high 或 人工确认'], ['发送窗口', '交易日 09:00-17:00']],
    fields: [['附件', '规则命中明细.xlsx'], ['抄送', '合规留痕邮箱'], ['发送前确认', '开启'], ['执行器', '待确认']],
    inmap: [['payload', '← 校验.pass + 规则.* ', '发送数据'], ['recipients', '← 收件组', '收件人']],
    params: [['subject', 'template', '${date} 公告规则日报'], ['recipients', 'list', 'research-team']],
    output: [['mail_id', 'string', '邮件 ID'], ['sent_at', 'datetime', '发送时间'], ['audit_link', 'url', '审计链接']],
  },
  alert: {
    title: '异常告警', sub: '通知类 · 失败/阻断/恢复', status: 'P2 · 建议补充', planned: true,
    base: [['告警条件', '校验失败 / 规则阻断 / 任务 E'], ['告警级别', 'warn / high'], ['接收人', '数据运营组'], ['恢复条件', '重跑成功或人工关闭']],
    fields: [['渠道', '站内 + 邮件'], ['去重窗口', '30 分钟'], ['升级策略', '连续失败 3 次升级'], ['能力状态', '建议补充']],
    inmap: [['error_rows', '← 校验.error_rows', '异常数据'], ['task_status', '← 运行记录.status', '任务状态']],
    params: [['severity', 'enum', 'warn/high'], ['dedupe_window', 'number', '30m']],
    output: [['alert_id', 'string', '告警 ID'], ['status', 'enum', 'open/closed'], ['audit_link', 'url', '审计链接']],
  },
  decision: {
    title: '决策分支', sub: '逻辑控制 · 条件路径', status: '静态保留 · 待执行器', planned: false, kind: 'decision',
    base: [['分支名称', '按条件分流'], ['条件 1', '抓取成功且字段完整'], ['条件 2', '失败或待复核'], ['默认路径', '人工复核']],
    fields: [['节点来源', '研究工作台保留能力'], ['适配状态', '采集链路静态可配置'], ['上线依赖', '编排执行器支持条件路由'], ['失败策略', '保留运行记录']],
    inmap: [['status', '← 上游节点.status', '运行状态'], ['quality_score', '← 校验.quality_score', '质量分']],
    params: [['if', 'expr', 'status = "C" AND quality_score >= 0.95'], ['else', 'expr', '进入复核或告警']],
    output: [['true_path', 'path', '继续落表或指标'], ['false_path', 'path', '回补 / 告警 / 人工复核'], ['decision_trace', 'json', '判断依据']],
  },
  parallel: {
    title: '分头处理', sub: '逻辑控制 · 多路径并行', status: '静态保留 · 待编排', planned: false, kind: 'parallel',
    base: [['并行名称', '抓取后分头处理'], ['路径 A', '结构化清洗'], ['路径 B', '规则命中'], ['汇合点', '质量校验']],
    fields: [['节点来源', '研究工作台保留能力'], ['适配状态', '采集链路静态可配置'], ['上线依赖', '编排执行器支持 fan-out/fan-in'], ['并发上限', '待后端确认']],
    inmap: [['rows', '← 上游节点.output', '待处理数据'], ['run_id', '← 当前运行', '运行标识']],
    params: [['branches', 'list', 'clean,rule,notify'], ['join_policy', 'enum', '全部成功 / 任一失败告警']],
    output: [['branch_results', 'json', '各路径结果'], ['join_status', 'enum', 'C/E/L'], ['parallel_trace', 'json', '分头处理日志']],
  },
  // 0714 会议：节点面板精简，用一个通用「数据处理」节点顶替原「解析结构化/数据清洗/数据校验」三组
  // （file-parse/ocr/ai-extract/field-map/clean/dedupe/check 定义本身保留不删，历史节点仍可正常打开/编辑，
  // 只是新增节点入口收敛到这一个）。形态参照 custom：通用/灵活配置，不绑定固定语义。
  process: {
    title: '数据处理', sub: '数据处理类 · 通用配置', status: '待配置', planned: false,
    base: [['处理方式', '待配置：清洗 / 去重 / 校验 / 结构化等，按需自定义'], ['输入来源', '上游节点产物'], ['失败策略', '记录并阻断'], ['能力状态', '通用数据处理节点']],
    fields: [['负责人', '数据运营'], ['处理范围', '待补充'], ['异常输出', '待补充'], ['配置状态', '待补充']],
    inmap: [['input', '← 上游节点.output', '输入数据']],
    params: [['config', 'json', '自定义处理参数']],
    output: [['result', 'table', '处理结果'], ['trace', 'json', '处理日志']],
  },
  custom: {
    title: '自定义节点', sub: '自定义 · 待配置', status: '待配置', planned: false,
    base: [['节点说明', '请在此描述节点用途'], ['执行器', '待选择'], ['失败策略', '记录并阻断'], ['能力状态', '自定义草稿']],
    fields: [['负责人', '数据运营'], ['输入来源', '上游节点'], ['输出去向', '下游节点'], ['配置状态', '待补充']],
    inmap: [['input', '← 上游节点.output', '输入数据']],
    params: [['config', 'json', '自定义参数']],
    output: [['result', 'json', '节点输出'], ['trace', 'json', '执行日志']],
  },
} satisfies Record<string, NodeConfigSeed>

export const NODE_CONFIGS: Record<string, NodeConfig> = normalizeNodeConfigs(NODE_CONFIG_SEEDS)

// ---------- 模板映射 ----------
// 模板 → 节点配置 key
export const TEMPLATE_TO_NODE: Record<string, string> = {
  web: 'web-list', app: 'app-collect', file: 'web-detail', python: 'web-list', parse: 'file-parse', ocr: 'ocr',
  ai: 'ai-extract', map: 'field-map', clean: 'clean', dedupe: 'dedupe', check: 'check', process: 'process',
  rule: 'rule', 'rule-trace': 'rule', monitor: 'rule', 'data-validation': 'rule', metric: 'metric', mail: 'mail',
  alert: 'alert', decision: 'decision', parallel: 'parallel', custom: 'custom',
  // 0711 R7/R8：两个独立的固定产物类型采集节点
  'browser-html': 'browser-html-collect', 'wechat-html': 'wechat-html-collect',
  // S4-1：网页登录，独立节点类型（方案 §6.1）
  login: 'login-collect',
  // 2026-09-17 补齐后端字典里其余类型：抓取类各给一份采集种子，媒体/摘要类给处理型种子
  excel: 'excel-collect', doc: 'doc-collect', pdf: 'pdf-collect', 'mail-collect': 'mail-collect',
  news: 'news-collect', 'video-audio': 'video-audio', 'audio-text': 'audio-text', 'article-summary': 'article-summary',
  translate: 'translate', 'article-tag': 'article-tag',
}

/**
 * 抓取类型 = **节点类型** = 配置的 `configType`（2026-08-28 确认）。
 *
 * 取值**照抄后端字典** `GET /v1/config/sourceTypes`（旧 `api/source-type.js` 的 allSourceTypes）。
 *
 * 此前这里是硬编码的臆造值，实测查出三处错（0824-11 §1.2d 同类问题）：
 *   - `[95] - APP 抓取` / `[95] - 文件下载`：**后端没有 95**。真实 App 抓取是 **140**；
 *   - `[155] - AI 提取`：**后端没有 155**；
 *   - `[150]` 的名字是「OCR抓取」不是「OCR 识别」。
 * 95/155 不是无害的显示问题——`legacyAdapters.sourceTypeFromSnatchType()` 会把 `[95]` 解析成
 * sourceType=95 写进新建源的请求体。
 *
 * 生产分布实测（2026-08-28，1050 条配置抽样 600 条）：**全部是 90**，
 * 连「通用浏览器下载」（#1400232）也是 90——浏览器/公众号/文件下载/登录都不是独立类型，
 * 区分在别的字段上（登录是 `templetCode='login'`，见 §1.2d）。
 *
 * **2026-09-17 与后端表重新对齐（用户提供 source_type/type_name 全量）**：
 *   - 补上原先没有的 110/120/130/150/160/500 与 700/710/720，凑齐 17 条；
 *   - **数据监控从 700 改成 610、数据校验从 800 改成 620**（2026-09-07 那次据 `config/sourceTypes`
 *     写死 600/700/800，现在后端表里 700 已经另有其主——「视频提取音频」——所以必须改，
 *     否则监控节点保存会把类型写成视频提取音频）。回读侧对 700/800 保留兼容，见 buildNodeForStep；
 *   - **800 现在归「翻译助手」**（2026-09-17 直接读 sense_db.cfg_source_type 核对）。
 *     注意 800 在 09-07～09-17 之间被本前端当作「数据校验」写过，所以回读时**按节点名**区分：
 *     名字指向校验的按校验认，其余的 800 才是翻译助手。
 */
export const SNATCH_TYPES = [
  '[90] - 网页抓取',
  '[110] - EXCEL抓取',
  '[120] - DOC抓取',
  '[130] - PDF抓取',
  '[140] - App抓取',
  '[150] - OCR抓取',
  '[160] - Mail抓取',
  '[170] - Python抓取',
  '[300] - 校验类',
  '[400] - 提取数据发邮件',
  '[500] - 资讯抓取',
  '[600] - 规则处理',
  '[610] - 数据监控',
  '[620] - 数据校验',
  '[700] - 视频提取音频',
  '[710] - 音频提取文字',
  '[720] - 文章生成摘要',
  '[730] - 文章打标签',
  '[800] - 翻译助手',
]

export const WEB_KIND_OPTIONS: { value: 'list' | 'detail' | 'attachment'; label: string; desc: string }[] = [
  { value: 'list', label: '列表页', desc: '分页、搜索结果、列表入口' },
  { value: 'detail', label: '详情页', desc: '正文、详情字段、附件入口' },
  { value: 'attachment', label: '文件附件页', desc: '文件下载、附件直链入口' },
]

// 新建配置：运行策略下拉选项
// 「是否列表」三态（旧 config.isMulti，旧前端 column.config.js:640 权威定义）：
// 决定落库去重口径，属于配置（config-meta）而不是步骤——旧平台的步骤表单里根本没有这一项。
// 文案照抄旧平台，方便真实源逐字段核对（0824-00 §9）。
export const MULTI_MODE_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '列表类[根据去重字段去重]' },
  { value: 0, label: '详情类[根据父ID去重]' },
  { value: 2, label: '更新父表[根据父ID更新父表]' },
]

/**
 * 「网页类型」下拉（2026-08-28 拍板）：**展示只有列表页 / 详情页两项**，落库仍是旧 `isMulti`。
 *
 * 三态里的 `2 更新父表` **不给用户选**——它由「输入表 == 输出表」推导（见
 * `utils/flow/nodeConfigPayload.ts` 的 `resolveMultiMode`）。所以：
 *
 * ```
 * 列表页            → isMulti = 1
 * 详情页 + 输入≠输出 → isMulti = 0   详情类[根据父ID去重]
 * 详情页 + 输入==输出 → isMulti = 2   更新父表[根据父ID更新父表]
 * ```
 *
 * 回显方向上 **0 和 2 都显示成「详情页」**（存量配置线上真实分布是 1:197 / 2:3，见 0824-11 §5）。
 *
 * `legacy` 是旧平台该取值的原文，挂在 option 的 title 上，新旧平台逐字段核对时直接可见（0824-00 §9）。
 * MULTI_MODE_OPTIONS **不删**：它是旧平台三态原文的唯一来源，由 legacyEnums.test.ts 逐字锁死。
 *
 * ⚠️ **2026-09-05 复核，维持原样，不要再提。** 当时对着旧平台「配置编辑」的下拉逐项核过，
 * 它确实是三项（`1.列表类[根据去重字段去重]` / `0.详情类[根据父ID去重]` /
 * `2.更新父表[根据父ID更新父表]`），配置 1400761 选的就是第三项；我们只给两项、且把
 * 0 和 2 都显示成「详情页」，**是 0828 明确要求的**，不是遗漏。
 * 写回方向三态齐全（见 resolveMultiMode），所以数据不会写坏，差别只在显示措辞。
 */
export const WEB_TYPE_OPTIONS: { value: number; label: string; desc: string; legacy: string }[] = [
  { value: 1, label: '列表页', desc: '分页、搜索结果、列表入口', legacy: '列表类[根据去重字段去重]' },
  { value: 0, label: '详情页', desc: '正文、详情字段；输入表与输出表相同时按「更新父表」落库', legacy: '详情类[根据父ID去重]' },
]

// 「业务类型」（旧 config.templetCode，旧前端 column.config.js:620 权威定义）。
// 值和文案都照抄旧平台——2026-08-28 踩过坑：此前这里是按会议口头举例编的
// （news/login/分类/公告），其中「分类」「公告」后端根本不存在，选了就是写脏数据；
// 而真实存在的 data（另类）不在列表里，导致旧平台设成「另类」的配置在新平台显示成空。
// 注意 templetCode === 'login' 会被 configFromLegacy 判定为登录类配置，不是普通标签。
export const BIZ_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'data', label: '另类' },
  { value: 'news', label: '新闻' },
  { value: 'login', label: '登陆' },
]

/**
 * 「网页类型」的默认值（0828 D10：去掉「未设置」占位，必须有默认）。
 *
 * 从节点自己的形态推导，不猜：种子模板上 `webKind`/`isDetail` 已经表明它是列表还是详情
 * （见 NODE_CONFIGS 的 web-list / web-detail）。推导不出就按列表页——
 * 线上真实分布 1:197 / 2:3（0824-11 §5），列表类是绝对多数。
 *
 * 展示与落库共用这一个推导（ConfigTab 的回显兜底、nodeConfigPayload 的 resolveMultiMode），
 * 保证"看到的就是会写进去的"。
 */
export function defaultMultiMode(cfg: NodeConfig): number {
  const cc = cfg.collectCfg
  if (cc?.webKind === 'detail' || cc?.isDetail) return 0
  return 1
}

export const CONFIG_STRATEGY_OPTIONS = ['增量', '全量', '按需触发']

/**
 * 模板 → 默认抓取类型。取值必须出自 SNATCH_TYPES，见其注释。
 *
 * 浏览器抓取 / 公众号抓取 / 文件下载 / 网页登录**都归 90 网页抓取**——2026-08-28 生产实测：
 * 后端字典里没有它们各自的类型，「通用浏览器下载」#1400232 的 configType 就是 90，
 * 抽样 600 条配置也全是 90。它们的差异体现在别的字段上（登录是 `templetCode='login'`），
 * 不是靠 configType 区分。**不要再为它们臆造 `[BROWSER]`/`[WECHAT]`/`[LOGIN]` 这类伪代码。**
 *
 * 2026-09-17 补齐其余类型（110/120/130/160/500/700/710/720），并把 `data-validation` 从
 * `[800]` 改成字典里的 `[620]`；`mail` 之前挂的是 `[160] - Mail抓取`，但它的节点库条目是
 * 「提取数据发邮件」（400），两者对不上——邮件抓取另开了 `mail-collect` 模板，这里按 400 写。
 */
export const TEMPLATE_TO_SNATCH: Record<string, string> = {
  web: '[90] - 网页抓取',
  app: '[140] - App抓取',
  python: '[170] - Python抓取',
  ocr: '[150] - OCR抓取',
  excel: '[110] - EXCEL抓取',
  doc: '[120] - DOC抓取',
  pdf: '[130] - PDF抓取',
  'mail-collect': '[160] - Mail抓取',
  news: '[500] - 资讯抓取',
  // 以下四类后端没有独立 configType，统一按网页抓取落库
  file: '[90] - 网页抓取',
  'browser-html': '[90] - 网页抓取',
  'wechat-html': '[90] - 网页抓取',
  login: '[90] - 网页抓取',
  rule: '[600] - 规则处理',
  monitor: '[610] - 数据监控',
  'data-validation': '[620] - 数据校验',
  mail: '[400] - 提取数据发邮件',
  check: '[300] - 校验类',
  'video-audio': '[700] - 视频提取音频',
  'audio-text': '[710] - 音频提取文字',
  'article-summary': '[720] - 文章生成摘要',
  translate: '[800] - 翻译助手',
  'article-tag': '[730] - 文章打标签',
}

/**
 * 媒体/文本/OCR 等处理类节点默认任务队列（2026-09-23 用户拍板）。
 * 在节点新增（insertAfter / addNodeToBranch）与任务配置时赋默认队列名。
 */
export const DEFAULT_TASK_QUEUES: Record<string, string> = {
  ocr: 'dev_web_snatch_ocr',
  translate: 'dev_web_translate',
  'article-summary': 'dev_web_llm_generate',
  'article-tag': 'dev_web_llm_generate',
  'audio-text': 'dev_web_audiototext',
  'video-audio': 'dev_web_videotoaudio',
}

// 左侧节点库分组
export const LIB_GROUPS: LibGroup[] = [
  {
    // 2026-09-17：与后端 source_type 字典逐条对齐，17 条抓取类型全部可选（用户口径）。
    // 条目上的 code 就是字典编号；badge 只给后端没有独立编号的几类（浏览器/公众号/登录）
    // 或旧平台习惯叫法（LOGIN），它优先于 code 显示。
    title: '采集类', items: [
      { template: 'web', code: '90', name: '网页抓取', desc: '源 URL、配置、子步骤', pill: 'p1' as Pill },
      { template: 'excel', code: '110', name: 'EXCEL抓取', desc: 'XLS/XLSX 表格文件采集', pill: 'p1' as Pill },
      { template: 'doc', code: '120', name: 'DOC抓取', desc: 'DOC/DOCX 文档采集', pill: 'p1' as Pill },
      { template: 'pdf', code: '130', name: 'PDF抓取', desc: 'PDF 版式文件采集', pill: 'p1' as Pill },
      { template: 'app', code: '140', name: 'APP 抓取', desc: '包名、接口地址、移动端参数', pill: 'p1' as Pill },
      { template: 'ocr', code: '150', name: 'OCR抓取', desc: '图片/扫描件文字识别，待执行器确认', pill: 'p2' as Pill },
      { template: 'mail-collect', code: '160', name: 'Mail抓取', desc: '邮件正文与附件采集', pill: 'p1' as Pill },
      { template: 'python', code: '170', name: 'Python 抓取', desc: '青龙脚本、待确认权限', pill: 'p2' as Pill },
      { template: 'news', code: '500', name: '资讯抓取', desc: '资讯站点列表 + 详情采集', pill: 'p1' as Pill },
      { template: 'file', code: '90', name: '文件下载', desc: '附件、原始文件、入库', pill: 'p1' as Pill },
      // 0711 R7/R8：抓 HTML 文件，输出表/队列固定，不可编辑
      { template: 'browser-html', code: 'BROWSER', badge: '180', name: '浏览器抓取', desc: '渲染并保存 HTML，固定表/队列', pill: 'p1' as Pill },
      { template: 'wechat-html', code: 'WECHAT', badge: '185', name: '公众号抓取', desc: '公众号页面采集，固定表/队列', pill: 'p1' as Pill },
      // S4-1（方案 §6.1）：登录从采集节点的运行设置勾选项拆成独立节点，无输入表、有输出表（会话/凭据）
      { template: 'login', code: 'LOGIN', name: '网页登录', desc: '登录页 URL、账号、凭据，登录后交给后续抓取节点', pill: 'p1' as Pill },
    ]
  },
  {
    // 0714 会议：去掉「解析结构化/数据清洗/数据校验」三组细分节点，收敛为一个通用「数据处理」入口
    // （原 parse/ocr/ai/map/clean/dedupe/check 的节点定义仍保留在 NODE_CONFIG_SEEDS 里，历史节点不受影响）
    //
    // 2026-09-17 局部回补：后端字典里 300 校验类 / 700 视频提取音频 / 710 音频提取文字 /
    // 720 文章生成摘要 都是**独立节点类型**，用户要求全部可见可选，所以这四条回到清单里。
    // 「收敛成一个通用入口」的结论在"清洗/去重/字段映射"那几条上仍然成立，没有回退。
    //
    // 2026-09-23 用户明确要求：节点类型「数据处理」去除（纯前端移除 PROC 通用入口，保留字典里的具体类型）。
    title: '数据处理', items: [
      { template: 'check', code: '300', name: '校验类', desc: '质量门禁、完整性与重复率校验', pill: 'p1' as Pill },
      { template: 'video-audio', code: '700', name: '视频提取音频', desc: '视频抽音轨，输出音频文件', pill: 'p1' as Pill },
      { template: 'audio-text', code: '710', name: '音频提取文字', desc: '语音转写为文本，保留分段', pill: 'p1' as Pill },
      { template: 'article-summary', code: '720', name: '文章生成摘要', desc: '长文压缩为摘要与关键词', pill: 'p1' as Pill },
      { template: 'article-tag', code: '730', name: '文章打标签', desc: '舆情多维标注：主题 / 情感 / 风险 / 意图等', pill: 'p1' as Pill },
      { template: 'translate', code: '800', name: '翻译助手', desc: '把文本/文件内容翻译成目标语言', pill: 'p1' as Pill },
    ]
  },
  {
    // 0707 优化·Phase1：决策/分头处理从右键菜单单独入口收进添加节点浮层的「逻辑」分组（参照 Dify）
    title: '逻辑', items: [
      { template: 'decision', code: 'IF', badge: '310', name: '决策分支', desc: '按条件路由到下一个节点，命中一条走一条', pill: 'p1' as Pill },
      { template: 'parallel', code: 'PAR', badge: '315', name: '分头处理', desc: '多条路径无条件并行执行', pill: 'p1' as Pill },
    ]
  },
  {
    // 规则 Trace 不是独立节点类型（无执行器/配置），已从添加面板移除；历史 template=rule-trace 仍映射到 rule
    title: '规则类', items: [
      { template: 'rule', code: '600', name: '规则处理', desc: '规则组、表达式、配置', pill: 'p1' as Pill },
      // 2026-09-01 新增：配置先复用 rule 种子（TEMPLATE_TO_NODE.monitor='rule'），跟「规则处理」
      // 是同一套表/字段绑定、编排、任务配置——先跑通插入与保存，后续要分化再单独拆。旧平台的
      // 「数据监控」是源列表的行内菜单项（跳去独立监控中心看某个源的数据），跟这里同名但不是一回事。
      // 编号 2026-09-17 按后端字典订正：610 数据监控 / 620 数据校验（此前误挂 700/800，
      // 而 700 现在是「视频提取音频」）。
      { template: 'monitor', code: '610', name: '数据监控', desc: '按规则组、表达式监测数据，命中即标记异常', pill: 'p1' as Pill },
      { template: 'data-validation', code: '620', name: '数据校验', desc: '按规则组、表达式校验数据质量', pill: 'p1' as Pill },
    ]
  },
  {
    // 「落表输出」已并入每个节点的产物 Tab（0701 问题四），分组由"输出类"更名"引用类"
    title: '引用类', items: [
      { template: 'metric', code: 'M', badge: '350', name: '指标引用', desc: '跳转指标中心，不编辑口径', pill: 'p1' as Pill },
    ]
  },
  {
    title: '通知类', items: [
      { template: 'mail', code: '400', name: '提取数据发邮件', desc: '待执行器确认', pill: 'plan' as Pill, planned: true },
      { template: 'alert', code: 'ALERT', badge: '405', name: '异常告警', desc: '失败、阻断、恢复通知', pill: 'p2' as Pill, planned: true },
    ]
  },
  {
    // 移除节点库侧栏后（0706 优化·Phase3），画布内「+ 添加步骤」选单复用本清单；自定义节点原仅在弹窗 MODAL_TEMPLATES 出现，一并收进来保持能力不丢
    title: '其他', items: [
      { template: 'custom', code: '—', name: '自定义节点', desc: '自定义草稿，待补充配置', pill: 'p2' as Pill },
    ]
  },
]

// 模板 → 节点类型名（新插入节点的默认节点名称 / 源名称）
export const TEMPLATE_TO_NAME: Record<string, string> = Object.fromEntries(
  LIB_GROUPS.flatMap((g) => g.items.map((it) => [it.template, it.name])),
)

// 数据监控节点「监控方法」候选值（2026-09-01 新增，monitor 模板专用）。
// 旧平台的数据监控是源列表行内菜单（跳独立监控中心），没有可抄的节点类型号/枚举，这里按产品给的清单落。
export const MONITOR_METHODS: readonly string[] = [
  '当日数据是否正常入库',
  '数据延迟监控',
  '入库时间分布监控',
  '最新数据时间监控',
  '连续无数据天数监控',
  '每日数据量监控',
  '历史趋势稳定性监控',
  '环比数据量波动监控',
  '同比周期波动监控',
  '分品类数据量趋势',
  '核心字段为空监控',
  '数据完整性监控',
  '字段格式合法性监控',
  '字符串值监控',
  '单位规范性监控',
  '价格异常监控',
  '价格波动监控',
  '涨跌幅阈值监控',
  '品类覆盖率监控',
  '今日与昨日差异监控',
  '分系列数据量趋势',
  '系列覆盖率监控',
  '分品名数据量趋势',
  '品名覆盖率监控',
]

// ---------- 流程构造器 ----------
/**
 * item/next 返回的是后端步骤，而画布展示的是节点。这里保留后端给出的稳定 stepId，
 * 只把没有独立节点类型的历史字段转换成现有节点模板；这样流程视图不会再依赖页面自己生成的随机节点 ID。
 */
function templateKeyForStep(step: Step, index: number): string {
  const name = step.name || ''
  // 数据监控节点（0901 新增，monitor 复用 rule 种子）从后端回读时，Step 没有独立的 nodeType 标识
  // （新建时 nodeType 继承前置步骤，可能是 entry/list/detail），只能靠节点名识别，且必须优先于下方
  // nodeType 别名映射——否则 nodeType='list'/'detail' 会把它错路由成采集/详情节点，丢掉 ruleCfg。
  if ((/数据监控/.test(name) || /数据校验/.test(name)) && NODE_CONFIGS.rule) return 'rule'
  // 数据校验节点：620 是字典现值。800 现在是**翻译助手**，只有名字指向校验的存量行才按校验认
  //（09-07～09-17 本前端把 800 写成了数据校验），其余 800 落到下面的抓取类型表 → translate。
  if (step.configType === '620' && NODE_CONFIGS.rule) return 'rule'
  if (step.configType === '800' && /数据校验|校验/.test(name) && NODE_CONFIGS.rule) return 'rule'

  // 抓取类型（configType）→ 节点种子：2026-09-17 补齐字典里其余类型，让历史步骤回读时
  // 落到对应的节点形态上（110 表格 / 120 文档 / 130 PDF / 150 OCR / 160 邮件 / 500 资讯 /
  // 700 视频转音频 / 710 语音转文字 / 720 摘要 / 300 校验类）。查表命中才走，否则维持原兜底。
  //
  // **必须排在 nodeType 别名映射之前**（2026-09-18）：翻译助手 / 文章打标签的步骤现在与
  // 规则处理一样写 type='rule'（发后续按 type 派发执行器，写 entry 会 500），而别名表里
  // 'rule' → 规则种子——按别名先走会把它们错路由成带 ruleCfg 的规则节点。configType
  //（730/800）来自 config 详情，对这两个类型是比 nodeType 更可信的信号。
  const byConfigType: Record<string, string> = {
    '110': 'excel-collect',
    '120': 'doc-collect',
    '130': 'pdf-collect',
    '150': 'ocr',
    '160': 'mail-collect',
    '300': 'check',
    '500': 'news-collect',
    '700': 'video-audio',
    '710': 'audio-text',
    '720': 'article-summary',
    '730': 'article-tag',
    '800': 'translate',
  }
  const routed = step.configType ? byConfigType[step.configType] : undefined
  if (routed && NODE_CONFIGS[routed]) return routed

  const explicit = String(step.nodeType ?? '').trim().toLowerCase()
  // NODE_CONFIGS 里登录模板注册的 key 是 'login-collect'，不是 'login'（下面三处此前都在查
  // 一个不存在的 key，恒为 falsy，登录节点路由从未真正生效过；2026-08-26 加 isLoginConfig 路由时
  // 顺带一起修，不是本次新引入的问题）。
  const explicitAliases: Record<string, string> = {
    list: 'web-list', 'web-list': 'web-list', 'web_list': 'web-list',
    detail: 'web-detail', 'web-detail': 'web-detail', 'web_detail': 'web-detail',
    login: 'login-collect', 'rule': 'rule',
    // monitor 复用 rule 的节点键（TEMPLATE_TO_NODE.monitor='rule'）；没有这条的话，
    // 一个 nodeType='monitor' 但名字没含"数据监控"的存量步骤会漏到下面的通用正则，
    // 被错路由成采集/详情节点，丢掉 ruleCfg（Z6-2，2026-09-07）。
    monitor: 'rule',
    'data-validation': 'rule', validation: 'rule',
    'clean': 'clean', 'dedupe': 'dedupe', 'check': 'check',
  }
  if (explicitAliases[explicit] && NODE_CONFIGS[explicitAliases[explicit]]) return explicitAliases[explicit]

  // isLoginConfig 来自 configDetail.templetCode（见 attachStepConfigDetails），是比步骤名正则
  // 更可靠的信号：2026-08-26 生产实测配置 1400968「baidu-登陆」证明登录步骤的名字未必含
  // "登录"二字（该样本是"登陆"），名字正则会漏判；查不到时才回退到名字正则。
  if (step.isLoginConfig && NODE_CONFIGS['login-collect']) return 'login-collect'

  if (/登录/.test(name) && NODE_CONFIGS['login-collect']) return 'login-collect'
  if (/规则/.test(name) && NODE_CONFIGS.rule) return 'rule'
  if (/清洗/.test(name) && NODE_CONFIGS.clean) return 'clean'
  if (/去重/.test(name) && NODE_CONFIGS.dedupe) return 'dedupe'
  if (/校验/.test(name) && NODE_CONFIGS.check) return 'check'
  if (/详情|正文/.test(name)) return 'web-detail'
  // 列表类 / 非列表类按 **isMulti** 判（2026-09-05 定案，见下方 multiMode 那段注释）：
  // 后端自己的 `list`/`detail` 就是从它派生的，用它才跟旧平台一致。
  // 只有拿不到时（configDetail 还没回填）才退回"第一个就是列表页"这种按位置猜。
  if (step.multiMode !== undefined) return step.multiMode === 1 ? 'web-list' : 'web-detail'
  return index === 0 ? 'web-list' : 'web-detail'
}

/** 按 dependsOn（旧 lastStep）做稳定拓扑排序；无依赖或循环时保持接口返回顺序。
 *  ⚠️ **排序 ≠ 拓扑**：这里只保证父节点排在子节点前面，不表达分叉。真实拓扑（主链 + 分支分组）
 *  由 buildSourceSeed 另行按 dependsOn 构造（0903 YB-B）。
 *  注意 dependsOn 只是前置步骤 ID，不是 contextMap——后者是任务上下文字段（旧 context 字段），
 *  两者曾被误合并进同一个字段，2026-08-26 生产实测（源 430016821）后拆开，见 legacyAdapters.stepFromLegacy。 */
function orderSourceSteps(steps: Step[]): Step[] {
  const byId = new Set(steps.map((step) => step.stepId))
  const remaining = [...steps]
  const ordered: Step[] = []
  const emitted = new Set<string>()
  while (remaining.length) {
    const index = remaining.findIndex((step) =>
      (step.dependsOn ?? []).filter((id) => byId.has(id)).every((id) => emitted.has(id)),
    )
    const [next] = remaining.splice(index < 0 ? 0 : index, 1)
    ordered.push(next)
    emitted.add(next.stepId)
  }
  return ordered
}

/**
 * 已保存源可能只有 source 根配置、没有 item/next 后续步骤；此时仍需在流程视图显示列表节点。
 * 导出：FlowCenter/FlowDetailDrawer.vue 的 deriveFromFlowConfig 也用它——flowId 模式的
 * nextConfigPaged 天生不返回起点行（见 endpoints.ts 注释），不能靠 buildSourceSeed 里
 * "steps 为空才兜底"这条走到，得在有真实子步骤时也显式拼出来，见那边的调用点。
 */
export function rootStepForSource(source: Source): Step | null {
  if (!source.url?.trim() || !source.mainTable?.trim()) return null
  return {
    stepId: `source:${source.sourceId}`,
    sourceId: source.sourceId,
    name: '列表抓取',
    inputTable: '-',
    outputTable: source.mainTable,
    configId: source.configId,
    enabled: source.disabled !== true,
  }
}

function applyStepTaskFields(cfg: NodeConfig, step: Step) {
  cfg.taskCfg = {
    ...(cfg.taskCfg ?? { queue: '', urlRule: '' }),
    ...(step.topic ? { queue: step.topic } : {}),
    ...(step.urlSourceField !== undefined ? { urlSourceField: step.urlSourceField } : {}),
    ...(step.urlRule !== undefined ? { urlRule: step.urlRule } : {}),
    ...(step.contextMap !== undefined ? { contextMap: [...step.contextMap] } : {}),
    ...(step.outColumns !== undefined ? { outColumns: [...step.outColumns] } : {}),
  }
}

function applyRuleStepTables(cfg: NodeConfig, step: Step) {
  // 规则处理存 ruleCfg；翻译助手 / 打标签 / 摘要 / 音频转文字 / 视频转音频（2026-09-18 并入规则式表配置）
  // / OCR 抓取（2026-09-22）存 execCfg。
  // 几类共用同一套落库口径（入参/出参写步骤 context/outContext，见 stepPersist），
  // 回读时同样要把步骤里的 inputTable/outputTable 填回各自的编排对象——
  // 只回填 ruleCfg 的话，这几类节点的「表配置」刷新后输入表/输出表就是空的（用户 2026-09-18 反馈）。
  const inputId = step.inputTable && step.inputTable !== '-' ? step.inputTable : ''
  const outputId = step.outputTable || ''
  const target = cfg.ruleCfg ?? (isRuleLikeNode(cfg) ? cfg.execCfg : undefined)
  if (!target) {
    // 回读节点没有 execCfg（种子不带），步骤里有表信息时先建一份默认的再填
    if (!isRuleLikeNode(cfg) || (!inputId && !outputId)) return
    cfg.execCfg = { ...makeDefaultExecConfig() }
    applyRuleStepTables(cfg, step)
    return
  }
  if (inputId) {
    target.inputTableId = target.inputTableId || inputId
  }
  if (outputId) {
    target.outputTableId = target.outputTableId || outputId
  }
}

function applyStepMetadata(cfg: NodeConfig, step: Step) {
  cfg.disabled = !step.enabled
  if (step.configId) cfg.configId = step.configId
  if (step.configName) cfg.configName = step.configName
  if (step.configUrl !== undefined) cfg.configUrl = step.configUrl
  if (step.runPolicy !== undefined) cfg.runPolicy = step.runPolicy
  if (step.itemId !== undefined) cfg.itemId = step.itemId
  if (step.sourceId !== undefined) cfg.stepSourceId = step.sourceId
  if (cfg.collectCfg) {
    cfg.collectCfg.entryCondition = step.condition
      ? { mode: 'expr', logic: 'AND', items: [], expr: step.condition }
      : undefined
    applyStepTaskFields(cfg, step)
    // 旧 isMulti 三态：**它就是「列表页 / 详情页」的判据**（2026-09-05 实测定案）。
    //
    // 这里原来写着「不要拿它去改 isDetail/webKind——网页类型已改为『节点类别』，旧平台与之
    // 对应的是抓取类型 configType，不是 isMulti」。**前半句是错的**：抽 10 条配置逐个对照，
    // 后端返回的 `list`/`detail` 完全是从 isMulti 派生出来的——
    //   isMulti=1 → list=true,  detail=false   （列表类）
    //   isMulti=2 → list=false, detail=false   （非列表类，挂在父记录下的子步骤）
    // 10/10 吻合，没有一条例外。不用它就只能按"是不是第一个节点"猜，而那个猜法对
    // 1400979 这类 isMulti=2 的起点是错的（被画成「列表页」，实际非列表类）。
    //
    // 后半句（configType 是抓取类型）没问题，但那是**另一个维度**：configType 决定
    // 网页抓取/Python抓取/OCR抓取，isMulti 决定列表/非列表。两者不冲突，各管各的。
    if (step.multiMode !== undefined) {
      cfg.collectCfg.multiMode = step.multiMode
      cfg.collectCfg.isDetail = step.multiMode !== 1
      cfg.collectCfg.webKind = step.multiMode === 1 ? 'list' : 'detail'
    }
    // 配置正文里前端要展示 + 保存时要回写的字段（随 topic 一起从 configDetail 回填）。
    // 不写进节点的话，面板显示的是节点模板默认值，而保存会拿默认值覆盖后端真值。
    if (step.bizType !== undefined) cfg.collectCfg.bizType = step.bizType
    if (step.dedupType !== undefined) cfg.collectCfg.dedupMode = step.dedupType === 'ALL' ? 'table' : 'source'
    if (step.codeRule !== undefined) cfg.collectCfg.structuredConfig = step.codeRule
    if (step.contentRule !== undefined) cfg.collectCfg.contentRules = step.contentRule
    // 配置绑定的参数（旧「使用参数」表）回填到节点的参数配置。只在节点自己还没有绑定时才填：
    // 2026-08-26 拍板「后续听我们的，因为我们是新的平台」——新平台已有的绑定优先，迁移值只补空位，
    // 不覆盖用户在新平台做过的选择。取值沿用旧平台「参考值」的原样展示（不打码，与旧平台一致）。
    if (step.paramBindings?.length && !cfg.collectCfg.urlParamRefs?.length) {
      cfg.collectCfg.urlParamRefs = step.paramBindings.map((b) => b.paramId)
      const values = { ...(cfg.collectCfg.urlParamValues ?? {}) }
      step.paramBindings.forEach((b) => { if (b.value !== undefined && values[b.paramId] === undefined) values[b.paramId] = b.value })
      if (Object.keys(values).length) cfg.collectCfg.urlParamValues = values
    }
  } else {
    cfg.entryCondition = step.condition
      ? { mode: 'expr', logic: 'AND', items: [], expr: step.condition }
      : undefined
    if (step.inputTable !== undefined) cfg.inputTable = step.inputTable === '-' ? '' : step.inputTable
    if (step.outputTable !== undefined) cfg.outputTable = step.outputTable
    // 非采集类节点（规则/翻译助手等）的入库配置同样随步骤回填：buildConfigPayload 保存时
    // 从 NodeConfig 顶层读 structuredConfig 写回 code_rule，回读不填的话刷新后"看到的"与
    // "会写进去的"就对不上了（翻译助手的源/目标语言靠它回填编排 Tab 的两个下拉）。
    // 翻译助手 / 音频提取文字的结构化配置已挪到 core_param（见 nodeConfigPayload
    // isStructuredInCoreParam），回读先取 core_param、取不到回落 code_rule 兼容存量，与
    // applyConfigToNode 同口径。
    if (isTranslateNode(cfg) || isAudioTextNode(cfg)) {
      const migrated = step.coreParam || step.codeRule
      if (migrated != null) cfg.structuredConfig = migrated
    } else if (step.codeRule != null) {
      cfg.structuredConfig = step.codeRule
    }
    // 打标签/摘要节点同理：模型选择存 core_param，回读后靠它回填编排 Tab 的模型下拉。
    if (step.coreParam != null) cfg.coreParam = step.coreParam
    applyStepTaskFields(cfg, step)
    applyRuleStepTables(cfg, step)
  }
  if (step.failAction !== undefined) {
    cfg.outputAdvanced = {
      ...(cfg.outputAdvanced ?? { writeMode: 'append', dedupeKey: '', failPolicy: '' }),
      failPolicy: step.failAction,
    }
  }
}

/** 单个步骤 → 画布节点。buildSourceSeed 与 applyStepDetails（configDetail 异步回填）共用同一套构造。 */
function buildNodeForStep(source: Source, step: Step, index: number): NodeConfig {
  const cfg = cloneConfig(NODE_CONFIGS[templateKeyForStep(step, index)])
  cfg.title = step.name || (index === 0 ? '列表抓取' : '详情解析')
  // 数据监控节点（monitor 复用 rule 种子）：后端 Step 无独立 template 字段，靠别的信号补回
  // cfg.template='monitor'，让 isMonitorNode()（系统提示词分类 / 表配置监控方法 / 描述拼接等）
  // 在回读后仍能区分 monitor 与 rule。
  // 优先级（Z6-2，2026-09-07）：**nodeType 显式为 'monitor' 时权威**，覆盖标题正则——
  // 用户可能把节点改名成不含"数据监控"的名字，这时只有 nodeType 还能说清它的真实类型。
  // 只信 'monitor' 这一个值：新建时 nodeType 会继承前置步骤（entry/list/detail 之类），
  // 那些是不可信的默认值，不能反过来当权威覆盖标题猜测。
  //
  // 编号（2026-09-17）：字典里 610=数据监控、620=数据校验、700=视频提取音频。
  // `800` 只作为**存量兼容**留着——它是 2026-09-07～09-17 本前端自己写出去的值，如今字典里
  // 根本没有 800，所以见到它只能理解成"那段时间写的数据校验节点"，不会跟别的类型撞车。
  // `700` 则**不能**再当监控认：它在字典里已经另有其主（视频提取音频），
  // 于是老监控节点只靠名字/ nodeType 兜底（新建的监控节点名就是「数据监控」，能覆盖绝大多数）。
  const nodeType = String(step.nodeType ?? '').trim().toLowerCase()
  const looksMonitor = nodeType === 'monitor' || step.configType === '610' || /数据监控/.test(cfg.title)
  // 800 有歧义（2026-09-17 起 800=翻译助手，但 09-07～09-17 本前端把 800 当数据校验写过）：
  // 名字指向校验的按校验认，否则才是翻译助手
  const looksValidation = nodeType === 'data-validation' || nodeType === 'validation'
    || step.configType === '620'
    || (step.configType === '800' && /数据校验|校验/.test(cfg.title))
    || /数据校验/.test(cfg.title)
  if (looksMonitor) cfg.template = 'monitor'
  else if (looksValidation) cfg.template = 'data-validation'
  else if (step.configType === '800') cfg.template = 'translate'
  // AI / 处理类节点（700/710/720/730）回读时也把 template 显式写上。
  // 这几种此前只有插入那一刻才写 template，回读后全靠 sub 里的类型编号兜底识别
  //（iconFor / isXxxNode 都读 sub），显式写下来更稳，也让 configTypeFrom 的模板表查得到
  //——否则「回读 → 保存」这一轮 configType 只能靠 base 原值保留。
  // OCR 抓取（150）2026-09-22 一并补上：它并入 isRuleLikeNode 后，表配置/落库口径都按模板信号走。
  else if (step.configType === '730') cfg.template = 'article-tag'
  else if (step.configType === '720') cfg.template = 'article-summary'
  else if (step.configType === '710') cfg.template = 'audio-text'
  else if (step.configType === '700') cfg.template = 'video-audio'
  else if (step.configType === '150') cfg.template = 'ocr'
  if (cfg.collectCfg) {
    // 源级字段（源名称/分类/标签/登录/选用配置等）不再复制到节点：随 loadFromSource 整体挂到 flow.sourceCfg（0706 优化·源/节点配置分层）
    cfg.collectCfg.url = source.url
    cfg.collectCfg.outputTable = step.outputTable || source.mainTable || ''
    // 接口 1:1（Step.inputTable，'-' 表示无）：首步无输入表，次步起 = 上一步输出表（0701 问题五）
    cfg.collectCfg.inputTable = step.inputTable && step.inputTable !== '-' ? step.inputTable : ''
  }
  applyStepMetadata(cfg, step)
  return cfg
}

/**
 * configDetail 异步回填（2026-08-28）：画布首屏不再等 config/configDetail 那一轮请求，
 * 步骤先到先画，补充字段（topic / 配置名 / 登录语义 / isMulti / 参数绑定）随后打回节点。
 *
 * 绝大多数补充只是字段级 patch，applyStepMetadata 原样再跑一遍即可（它是幂等的：
 * 传进来的还是同一批步骤，只是多了几个字段）。唯一的结构性影响是 `isLoginConfig`——
 * 它参与 templateKeyForStep 的节点模板路由，回填前登录步骤可能被画成普通采集节点，
 * 这种情况必须整节点重建，不能只补字段。
 *
 * 返回被重建的 nodeId 列表，供调用方决定要不要刷新选中态。
 */
export function applyStepDetails(
  configs: Record<string, NodeConfig>,
  source: Source,
  steps: Step[],
): string[] {
  const rebuilt: string[] = []
  orderSourceSteps(steps).forEach((step, i) => {
    const current = configs[step.stepId]
    if (!current) return
    const shouldBeLogin = !!step.isLoginConfig
    const isLogin = collectorCapabilityOf(current)?.kind === 'login'
    const shouldBeDataValidation = step.configType === '800'
      || ['data-validation', 'validation'].includes(String(step.nodeType ?? '').trim().toLowerCase())
      || /数据校验/.test(step.name)
    const isDataValidation = current.template === 'data-validation'
    /**
     * AI / 媒体处理类（700 视频转音频 / 710 语音转文字 / 720 文章摘要 / 730 文章打标签）
     * 同样要整节点重建，不能只补字段（2026-09-18）。
     *
     * 首屏是按**位置**猜模板画出来的，第二个节点通常猜成采集类；configDetail 回来后
     * `applyStepMetadata` 只把 `cfg.template` 改成 'article-summary'，**`collectCfg` 还挂着**，
     * 于是节点一半是摘要、一半是采集：卡片显示「90 网页抓取 / 源配置」，
     * 底部状态也走采集分支去要 URL 和输出表。实测源 430022794 的第二个节点就是这样。
     *
     * 2026-09-18 起翻译助手 / 文章打标签步骤的 type 与规则处理一样写 'rule'（发后续按
     * type 派发执行器，写 entry 会 500），首屏没有 configType 时会被先画成**规则节点**
     *（带 ruleCfg）——它同样不是处理类节点，必须重建；所以 isProcessing 的判定要
     * 把「带着 ruleCfg 的规则节点」也排除掉，而不是只看有没有 collectCfg。
     */
    const shouldBeProcessing = ['700', '710', '720', '730'].includes(String(step.configType ?? ''))
    const isProcessing = !current.collectCfg && !current.ruleCfg
    if (
      (shouldBeLogin && !isLogin)
      || (shouldBeDataValidation && !isDataValidation)
      || (shouldBeProcessing && !isProcessing)
    ) {
      configs[step.stepId] = buildNodeForStep(source, step, i)
      rebuilt.push(step.stepId)
      return
    }
    applyStepMetadata(current, step)
  })
  return rebuilt
}

/**
 * 源 → 链路种子（纯函数，从 flow store 的 loadFromSource 提取）：把源的子步骤编译为画布节点。
 * 分屏对比（Phase 5）用它独立构造第二栏的链路，不依赖/不污染全局 flow store。
 */
/**
 * 按 `dependsOn`（旧 `lastStep`）建真实拓扑（0903 YB-B）。
 *
 * **在此之前这里把子步骤一律推进 `main`、`branchGroups` 恒为空**，有分支的历史流程被画成
 * 直线。真实源 920663 长这样：
 *
 * ```
 * 920663 ──▶ 40597 ├─ _from=='api' && ... ──▶ 40598
 *                  └─ K24=="正文抓取失败" ──▶ 40620
 * ```
 *
 * **分叉点用的是那个普通采集节点本身当 `ownerId`，不合成决策节点。** 理由：
 *   - 机制本来就不要求 owner 是结构节点（`buildHorizontalLayout` 只做 `hbranchGroupByOwner[id]`
 *     查表、`branchGroupEntryIds` 只按 ownerId 找，都不检查 `isDecision`）；
 *   - 合成节点会引入一个旧平台不存在、也没有 `itemConfig` 可落库的虚拟节点，还会在数据视图
 *     的节点轨道上多出一个点不出数据的节点；
 *   - 条件的归属不一样：我们的决策节点条件属于**分支**（`branch.condition`），旧平台条件属于
 *     **目标步骤自己**（`entryCondition`，只有一个前驱时同样存在）。硬套等于把语义搬家，
 *     两处都有值之后改一处必须同步另一处。旧平台也没有 ELSE 概念。
 *
 * 已知限制：**分支链内部再分叉（嵌套分叉）仍然会被拍平**——`buildHorizontalLayout` 只对
 * `visibleMain` 上的节点查 owner，chain 里的 owner 画不出来。嵌套分叉的流程仍受
 * `hasRealBranches` 的写回冻结保护（stepPersist.ts），不会被改坏，只是画得不准。
 */
function realParentOf(step: Step, known: Set<string>): string | undefined {
  return (step.dependsOn ?? []).find((id) => id && id !== '0' && known.has(id))
}

/** 从某个步骤起沿单后继往下串；遇到嵌套分叉就把其后代按序摊平进同一条链（见上方限制说明）。 */
function chainFrom(startId: string, childrenOf: Map<string, string[]>, placed: Set<string>): string[] {
  const chain: string[] = []
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()!
    if (placed.has(id)) continue
    placed.add(id)
    chain.push(id)
    queue.unshift(...(childrenOf.get(id) ?? []))
  }
  return chain
}

export function buildSourceSeed(source: Source, steps: Step[]): {
  main: string[]
  branches: import('./flowModel').BranchSeed[]
  configs: Record<string, NodeConfig>
  branchGroups: import('./flowModel').FlowBranchGroup[]
} {
  const configs: Record<string, NodeConfig> = {}
  const sourceSteps = steps.length ? orderSourceSteps(steps) : (rootStepForSource(source) ? [rootStepForSource(source)!] : [])
  sourceSteps.forEach((step, i) => { configs[step.stepId] = buildNodeForStep(source, step, i) })

  const known = new Set(sourceSteps.map((step) => step.stepId))
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const step of sourceSteps) {
    const parent = realParentOf(step, known)
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), step.stepId])
    else roots.push(step.stepId)
  }

  const main: string[] = ['start']
  const branchGroups: import('./flowModel').FlowBranchGroup[] = []
  const placed = new Set<string>()
  // 主链：从第一个根节点沿**单后继**一路走，遇到分叉就停——旧平台的步骤没有汇合点概念
  // （每个步骤只有一个 lastStep），分叉之下的一切都归各自的分支链。
  let cursor: string | undefined = roots[0]
  while (cursor && !placed.has(cursor)) {
    placed.add(cursor)
    main.push(cursor)
    const owner: string = cursor
    const kids: string[] = childrenOf.get(owner) ?? []
    if (kids.length <= 1) {
      cursor = kids[0]
      continue
    }
    branchGroups.push({
      ownerId: owner,
      branches: kids.map((kid: string, i: number) => ({
        id: `${owner}-b${i + 1}`,
        // 分支名取目标步骤名：旧平台没有分支标签这个东西，拿目标节点名当标签最接近事实
        label: configs[kid]?.title || `分支 ${i + 1}`,
        // condition 刻意**不填**：条件属于目标步骤自己（configs[kid] 上的 entryCondition），
        // 复制一份到分支上就有了两个真值来源，改一处必须同步另一处。连线上的条件文案由
        // 渲染侧从目标节点读，不在这里搬家。
        chain: chainFrom(kid, childrenOf, placed),
      })),
    })
    cursor = undefined
  }
  // 兜底：`dependsOn` 指向集合外步骤的孤儿、以及成环时走不到的节点，一个都不能丢——
  // 画得不准可以接受，节点凭空消失不行。
  for (const step of sourceSteps) {
    if (!placed.has(step.stepId)) {
      placed.add(step.stepId)
      main.push(step.stepId)
    }
  }
  main.push('end')
  // 节点链严格来自 item/next 的真实子步骤，不按源名称猜测补节点：
  // 这里曾按 /规则/ 匹配源名插入一个「规则处理」节点（演示期遗留），会让存量源的画布
  // 与旧平台拓扑不一致，且该虚构节点会混入流程保存结果。2026-08-26 移除。
  return { main, branches: [], configs, branchGroups }
}

/**
 * 种子演示网站的默认模板骨架（0710）：存量演示网站模拟"后端已有统一流程模板"，
 * mockFlowLoad 对种子网站查无存档时用它兜底（虚拟态，保存后才真正落盘）；
 * 用户新建的网站不走这里，进画布是空白引导卡模式（见 makeSiteBlankTemplate）。
 */
export function makeSiteSeedTemplate(siteId: string, name: string): FlowDef {
  const list = cloneConfig(NODE_CONFIGS['web-list'])
  list.title = '列表抓取'
  if (list.collectCfg) { list.collectCfg.url = ''; list.collectCfg.outputTable = '' }
  const detail = cloneConfig(NODE_CONFIGS['web-detail'])
  detail.title = '详情解析'
  if (detail.collectCfg) { detail.collectCfg.url = ''; detail.collectCfg.outputTable = ''; detail.collectCfg.inputTable = '' }
  return {
    id: `site:${siteId}`,
    name,
    version: 'site-v1',
    main: ['start', 'web-list', 'web-detail', 'end'],
    branches: [],
    configs: { 'web-list': list, 'web-detail': detail },
    updatedAt: '',
  }
}

// ---------- 新建流程 / 初始化画布（M5.5） ----------
const nowStamp = (): string => new Date().toISOString().slice(0, 16).replace('T', ' ')

/** 空白流程：仅 开始 → 完成，供从零编排 */
export function makeBlankFlow(): FlowDef {
  return {
    id: `flow-${Date.now()}`,
    name: '未命名流程',
    version: 'draft-0.1',
    main: ['start', 'end'],
    branches: [],
    configs: {},
    updatedAt: nowStamp(),
  }
}

/** 标准链路模板的源级配置（0706 优化·源/节点配置分层）：原种子 Demo 的源信息，独立于节点配置存在 */
function demoStandardSource(): Source {
  return {
    sourceId: 'flow-default', name: '交易所公告列表 - A 股', url: 'https://example.com/announcements?page=${page}',
    configId: '81909', mainTable: '2101001', owner: 'admin', state: 'C',
    category: '公告', categoryPath: '/公告/交易所/列表', tags: ['公告', 'A股', '列表页'], dirId: '9009245',
    useProxy: false, resume: true,
    configMode: 'new', configName: '交易所公告列表配置', configTopic: 'announcement.list', configStrategy: '增量',
    needLogin: true, loginUrl: 'https://example.com/login', account: 'research_***', credentialRef: 'cred-zfb',
    scheduleType: '交易日定时', scheduleTime: '08:30', weekdays: [1, 2, 3, 4, 5], cron: '30 8 * * 1-5',
  }
}

/** 标准链路模板（= 原种子 Demo：公告规则采集，固定节点 id 供子步骤 / 测试引用） */
export function makeStandardFlow(): FlowDef {
  const configs: Record<string, NodeConfig> = {}
    ;['web-list', 'web-detail', 'ai-extract', 'rule', 'check', 'mail'].forEach((k) => {
      configs[k] = cloneConfig(NODE_CONFIGS[k])
    })
  return backfillOutputTables({
    id: 'flow-default',
    name: '公告规则采集链路_v3',
    version: 'draft-0.3',
    main: ['start', 'web-list', 'web-detail', 'ai-extract', 'rule', 'end'],
    branches: [
      { id: 'check', side: 'left', rowAnchor: 'ai-extract', edgeFrom: 'check', edgeTo: 'rule' },
      { id: 'mail', side: 'right', rowAnchor: 'ai-extract', edgeFrom: 'web-detail', edgeTo: 'mail' },
    ],
    configs,
    updatedAt: nowStamp(),
    source: demoStandardSource(),
  })
}

// 预置意图链路构造器：按模板序列克隆节点、清空采集占位（与 store.insertAfter 同口径）
let presetSeq = 1
interface StepSpec {
  template: string
  name?: string
  patch?: Partial<CollectConfig>
}
/** sourcePatch：预置意图若需要预设源级字段（如登录态），整条链路共用一份草稿源（0706 优化·源/节点配置分层） */
function buildFlow(name: string, steps: StepSpec[], sourcePatch?: Partial<Source>): FlowDef {
  const main: string[] = ['start']
  const configs: Record<string, NodeConfig> = {}
  steps.forEach((s) => {
    const srcKey = TEMPLATE_TO_NODE[s.template] || 'web-list'
    const cfg = cloneConfig(NODE_CONFIGS[srcKey])
    if (s.template === 'decision') cfg.kind = 'decision'
    if (s.template === 'parallel') cfg.kind = 'parallel'
    cfg.title = s.name || TEMPLATE_TO_NAME[s.template] || cfg.title
    if (cfg.collectCfg) {
      cfg.collectCfg.snatchType = TEMPLATE_TO_SNATCH[s.template] ?? cfg.collectCfg.snatchType
      cfg.collectCfg.url = ''
      cfg.collectCfg.outputTable = ''
      cfg.collectCfg.inputParams = []
      if (s.patch) Object.assign(cfg.collectCfg, s.patch)
    }
    const id = `${srcKey}-p${presetSeq++}`
    configs[id] = cfg
    main.push(id)
  })
  main.push('end')
  const source: Source | undefined = sourcePatch
    ? { sourceId: `src-${Date.now()}`, name, url: '', configId: '', mainTable: '', owner: '', state: 'C', ...sourcePatch }
    : undefined
  return backfillOutputTables({
    id: `flow-${Date.now()}-${presetSeq}`,
    name,
    version: 'draft-0.1',
    main,
    branches: [],
    configs,
    updatedAt: nowStamp(),
    source,
  })
}

/** 预置意图 → 链路（首期种子，可扩展）。智能体首期按关键词匹配，二期换真 LLM。 */
export const PRESET_INTENTS: PresetIntent[] = [
  // 预置链路不再带「落表输出」步骤（0701 问题四）：落表是每个节点的产物配置，最终结果 = 末端节点的输出表。
  {
    key: 'web-public',
    label: '公共网页抓取',
    keywords: ['公共', '网页', '网站', '抓取', '爬', 'web', '页面', '列表'],
    rationale: '识别为「公共网页数据抓取」：先抓列表页拿到详情链接，再抓详情正文；每个节点的结果自动落表。',
    build: () =>
      buildFlow('公共网页抓取链路', [
        { template: 'web', name: '网页抓取（列表）', patch: { webKind: 'list', isDetail: false } },
        { template: 'web', name: '网页抓取（详情）', patch: { webKind: 'detail', isDetail: true } },
      ]),
  },
  {
    key: 'web-login',
    label: '登录站点抓取',
    keywords: ['登录', '登陆', '账号', '凭据', 'cookie', '会员'],
    rationale: '识别为「登录态站点抓取」：列表页需登录，再抓详情正文；登录节点字段沿用旧平台 Step3。',
    build: () =>
      buildFlow('登录站点抓取链路', [
        { template: 'web', name: '网页抓取（列表·需登录）', patch: { webKind: 'list', isDetail: false } },
        { template: 'web', name: '网页抓取（详情）', patch: { webKind: 'detail', isDetail: true } },
      ], { needLogin: true }),
  },
  {
    key: 'file-parse',
    label: '文件下载解析',
    keywords: ['文件', '下载', 'pdf', 'word', 'excel', '附件', '解析', '报告'],
    rationale: '识别为「文件下载解析」：下载文件后交由数据处理节点完成解析、字段抽取等配置；每个节点的结果自动落表。',
    build: () =>
      buildFlow('文件下载解析链路', [
        { template: 'file', name: '文件下载', patch: { webKind: 'attachment', isDetail: false, snatchType: '[90] - 网页抓取' } },
        { template: 'process', name: '数据处理' },
      ]),
  },
  {
    key: 'announcement',
    label: '公告规则采集',
    keywords: ['公告', '规则', '交易所', '投研', '标准'],
    rationale: '识别为「公告规则采集」：套用标准链路（列表→详情→AI 提取→规则处理），含质量校验 / 告警旁路。',
    build: () => makeStandardFlow(),
  },
]
