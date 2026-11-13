// @vitest-environment jsdom
// captureConfig.ts 用 DOMParser 解析 XML，node 环境下没有这个全局对象，必须切 jsdom（默认 vitest 环境是 node，见 vitest.config.ts）。
// 项目不含 @types/node，测试固件不走 fs 读文件，直接内联——下面这份是
// 参考_抓取配置XML样例_2026-08-04.xml（附录 §十 逐条核对过的那份，海关进出口数据抓取）的结构等价简化版：
// ActionId/NextActionId/LastActionId/DisplayTitle/ColumnCfg/入口 URL 的值原样保留，
// 只删掉了 parseCaptureConfig 不读取的部分（XpathConfig 的海量冗余属性、ParaCfg、JSON-in-CDATA 等）。
import { describe, expect, it } from 'vitest'
import { parseCaptureConfig, validateColumns } from './captureConfig'

const SAMPLE_XML = `<Actions>
    <OpenUrlAction DisplayTitle="打开网页" ActionId="7fcadca9-b326-4861-8a14-0bab68f87eb3" NextActionId="cae34015-fc59-42b6-95e3-e9e984ca970d" LastActionId="">
        <Config>
            <Url><![CDATA[http://43.248.49.97/?outerValue1=7405,2603,7402&year=2021&startMonth=8&endMonth=9]]></Url>
        </Config>
    </OpenUrlAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="3b230630-0b6c-43bb-861d-6305ab85abec" NextActionId="" LastActionId="5fbb46ee-073c-4f93-a666-6520d2102e32">
        <Config>
            <ColumnCfg><Column BizId="1107021" BizName="币类型">0</Column></ColumnCfg>
        </Config>
    </ExtractSingleValueAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="5fbb46ee-073c-4f93-a666-6520d2102e32" NextActionId="3b230630-0b6c-43bb-861d-6305ab85abec" LastActionId="c4e7f7a8-3b92-4b75-8ef8-d75b82c22fcb">
        <Config>
            <ColumnCfg><Column BizId="1106473" BizName="结束时间">0</Column></ColumnCfg>
        </Config>
    </ExtractSingleValueAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="c4e7f7a8-3b92-4b75-8ef8-d75b82c22fcb" NextActionId="5fbb46ee-073c-4f93-a666-6520d2102e32" LastActionId="cae34015-fc59-42b6-95e3-e9e984ca970d">
        <Config>
            <ColumnCfg><Column BizId="1106472" BizName="起始时间">0</Column></ColumnCfg>
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
        </Config>
    </ExtractDataTableAction>
</Actions>`

describe('parseCaptureConfig · 真实样例（附录 §十）', () => {
  it('动作顺序按 NextActionId 链表走，不是文档顺序：OpenUrl → 提取表格 → 起始时间 → 结束时间 → 币类型', () => {
    const parsed = parseCaptureConfig(SAMPLE_XML)
    expect(parsed.warnings).toEqual([])
    expect(parsed.actions.map((a) => a.title)).toEqual(['打开网页', '提取表格', '提取单值', '提取单值', '提取单值'])
    // 按 BizName 区分三个同名"提取单值"，确认真是按链表顺序（起始时间先于结束时间先于币类型）而非文档顺序
    // （文档顺序是 币类型 → 结束时间 → 起始时间 → 提取表格，见样例文件本身的元素排列）
    expect(parsed.actions.map((a) => a.actionId)).toEqual([
      '7fcadca9-b326-4861-8a14-0bab68f87eb3', // 打开网页
      'cae34015-fc59-42b6-95e3-e9e984ca970d', // 提取表格
      'c4e7f7a8-3b92-4b75-8ef8-d75b82c22fcb', // 起始时间
      '5fbb46ee-073c-4f93-a666-6520d2102e32', // 结束时间
      '3b230630-0b6c-43bb-861d-6305ab85abec', // 币类型
    ])
  })

  it('提取表格的 ColumnCfg 解出 6 个有效字段，Col5/Col6/Col7 占位列被排除', () => {
    const parsed = parseCaptureConfig(SAMPLE_XML)
    const tableBizIds = ['1106469', '1106470', '1107025', '1107026', '1107019', '1106471']
    const tableColumns = parsed.columns.filter((c) => tableBizIds.includes(c.bizId))
    expect(tableColumns).toHaveLength(6)
    expect(tableColumns.map((c) => c.bizName)).toEqual([
      '商品编码', '商品名称', '贸易伙伴编码', '贸易伙伴名称', '第一数量', '进出口金额',
    ])
    expect(parsed.columns.some((c) => c.bizId === 'Col5')).toBe(false)
    expect(parsed.columns.some((c) => c.bizId === 'Col6')).toBe(false)
    expect(parsed.columns.some((c) => c.bizId === 'Col7')).toBe(false)
  })

  it('3 个提取单值动作的 ColumnCfg 也计入字段绑定（附录 §10.5：两种动作的 Column 是同一套 BizId 语义）', () => {
    const parsed = parseCaptureConfig(SAMPLE_XML)
    const singleValueColumns = parsed.columns.filter((c) => ['1107021', '1106473', '1106472'].includes(c.bizId))
    expect(singleValueColumns.map((c) => c.bizName).sort()).toEqual(['币类型', '结束时间', '起始时间'])
    // 合计 9 个有效字段绑定（表格 6 + 单值 3）
    expect(parsed.columns).toHaveLength(9)
  })

  it('入口 URL 取自 OpenUrlAction/Config/Url', () => {
    const parsed = parseCaptureConfig(SAMPLE_XML)
    expect(parsed.entryUrl).toContain('http://43.248.49.97/?outerValue1=')
  })
})

describe('parseCaptureConfig · 防御场景（断链/环/多链头/非 well-formed）', () => {
  function action(id: string, next: string, last: string, extra = '') {
    return `<OpenUrlAction DisplayTitle="动作${id}" ActionId="${id}" NextActionId="${next}" LastActionId="${last}">${extra}</OpenUrlAction>`
  }

  it('断链（NextActionId 指向不存在的动作）：降级为文档顺序，给出可读提示，不抛异常', () => {
    const xml = `<Actions>${action('a', 'ghost', '')}${action('b', '', 'a')}</Actions>`
    const parsed = parseCaptureConfig(xml)
    expect(parsed.actions.map((a) => a.actionId)).toEqual(['a', 'b']) // 文档顺序
    expect(parsed.warnings.length).toBeGreaterThan(0)
    expect(parsed.warnings[0]).toContain('断链')
  })

  it('成环（a→b→a）：降级为文档顺序，给出可读提示，不抛异常', () => {
    const xml = `<Actions>${action('a', 'b', '')}${action('b', 'a', 'a')}</Actions>`
    const parsed = parseCaptureConfig(xml)
    expect(parsed.actions.map((a) => a.actionId)).toEqual(['a', 'b'])
    expect(parsed.warnings.some((w) => w.includes('成环'))).toBe(true)
  })

  it('多链头（两个 LastActionId 为空）：降级为文档顺序，给出可读提示，不抛异常', () => {
    const xml = `<Actions>${action('a', '', '')}${action('b', '', '')}</Actions>`
    const parsed = parseCaptureConfig(xml)
    expect(parsed.actions.map((a) => a.actionId)).toEqual(['a', 'b'])
    expect(parsed.warnings.some((w) => w.includes('2 个动作链头'))).toBe(true)
  })

  it('无链头（都不是 LastActionId 为空）：降级为文档顺序，给出可读提示，不抛异常', () => {
    const xml = `<Actions>${action('a', 'b', 'b')}${action('b', 'a', 'a')}</Actions>`
    const parsed = parseCaptureConfig(xml)
    expect(parsed.actions.map((a) => a.actionId)).toEqual(['a', 'b'])
    expect(parsed.warnings.some((w) => w.includes('未找到动作链头'))).toBe(true)
  })

  it('非 well-formed XML：不抛异常，返回空结果 + 可读提示', () => {
    const parsed = parseCaptureConfig('<Actions><OpenUrlAction></Actions>')
    expect(parsed.actions).toEqual([])
    expect(parsed.columns).toEqual([])
    expect(parsed.warnings.length).toBeGreaterThan(0)
  })

  it('空字符串：不抛异常，返回空结果 + 可读提示', () => {
    const parsed = parseCaptureConfig('')
    expect(parsed.actions).toEqual([])
    expect(parsed.warnings).toEqual(['配置内容为空'])
  })

  it('没有任何动作节点（根元素为空）：不抛异常，返回空结果 + 可读提示', () => {
    const parsed = parseCaptureConfig('<Actions></Actions>')
    expect(parsed.actions).toEqual([])
    expect(parsed.warnings).toEqual(['未找到任何动作节点'])
  })
})

describe('validateColumns · 单向校验（BizId ⊆ 已选字段，不要求反向全覆盖）', () => {
  it('全部 BizId 都在已选字段内：返回空数组', () => {
    const parsed = parseCaptureConfig(SAMPLE_XML)
    const allBizIds = parsed.columns.map((c) => c.bizId)
    expect(validateColumns(parsed, allBizIds)).toEqual([])
  })

  it('已选字段是 BizId 的超集（多选了不在配置里的字段）：仍算通过，不要求反向覆盖', () => {
    const parsed = parseCaptureConfig(SAMPLE_XML)
    const allBizIds = parsed.columns.map((c) => c.bizId)
    expect(validateColumns(parsed, [...allBizIds, '9999999'])).toEqual([])
  })

  it('有 BizId 不在已选字段内：返回对应提示', () => {
    const parsed = parseCaptureConfig(SAMPLE_XML)
    const missingOne = parsed.columns.map((c) => c.bizId).filter((id) => id !== '1106469')
    const result = validateColumns(parsed, missingOne)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('商品编码')
    expect(result[0]).toContain('1106469')
  })
})
