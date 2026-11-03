import { expect, it } from 'vitest'
import { withSiteScriptOutputFields, withSiteScriptQueuePrompt } from './siteScriptOutputPrompt'

it('输出字段包含名称、实际字段 ID、业务标识和物理列，缺少 ID 时保留业务标识', () => {
  const prompt = withSiteScriptOutputFields('采集新闻', [
    { desc: '标题', prop: 'news_title', itemId: '1234', columnName: 'K1' },
    { desc: '链接', prop: 'news_url' },
  ], 'sense_data.TB_NEWS')
  expect(prompt).toContain('采集新闻\n\n【当前节点输出字段】')
  expect(prompt).toContain('输出表：sense_data.TB_NEWS')
  expect(prompt).toContain('字段名：标题；字段 ID：1234；字段标识：news_title；物理列：K1')
  expect(prompt).toContain('字段名：链接；字段 ID：news_url')
})

it('字段变化只替换自动生成的字段段落，不重复追加或覆盖用户说明', () => {
  const original = withSiteScriptOutputFields('不要翻页', [{ desc: '旧字段', prop: 'old' }])
  const fields = [{ desc: '新字段', prop: 'new' }]
  const updated = withSiteScriptOutputFields(original, fields)
  expect(updated).toContain('不要翻页')
  expect(updated).not.toContain('旧字段')
  expect(updated.match(/【当前节点输出字段】/g)).toHaveLength(1)
  expect(withSiteScriptOutputFields(updated, fields)).toBe(updated)
  expect(withSiteScriptOutputFields(updated, [])).toBe('不要翻页')
})

it('MQ 主题独立于字段追加，重复同步和修改主题不残留旧值，未配置时不编造主题', () => {
  const original = withSiteScriptQueuePrompt('采集新闻', ' news_list ')
  expect(original).toContain('MQ 主题：news_list')
  expect(withSiteScriptQueuePrompt(original, 'news_list')).toBe(original)
  const updated = withSiteScriptQueuePrompt(original, 'download_pdf')
  expect(updated).toContain('MQ 主题：download_pdf')
  expect(updated).not.toContain('news_list')
  expect(updated.match(/【当前节点 MQ 主题】/g)).toHaveLength(1)
  expect(withSiteScriptQueuePrompt(updated, '')).toBe('采集新闻')
})
