// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MarkdownOutput from './MarkdownOutput.vue'

it('渲染标题、强调、列表、引用、表格和代码块，流式更新后重新渲染', async () => {
  const w = mount(MarkdownOutput, { props: { content: '# 标题\n\n**重点**\n\n- 第一条\n- 第二条\n\n> 引用\n\n| 名称 | 值 |\n| --- | --- |\n| A | B |\n\n```python\nprint("你好")\n```' } })
  expect(w.get('h1').text()).toBe('标题')
  expect(w.get('strong').text()).toBe('重点')
  expect(w.findAll('li')).toHaveLength(2)
  expect(w.get('blockquote').text()).toBe('引用')
  expect(w.get('td').text()).toBe('A')
  expect(w.get('pre code').text()).toContain('print("你好")')
  await w.setProps({ content: '## 新的流式内容' })
  expect(w.get('h2').text()).toBe('新的流式内容')
})
it('清除脚本、事件属性和危险链接，代码块中的HTML保持为文本', () => {
  const w = mount(MarkdownOutput, { props: { content: '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险链接](javascript:alert(1))\n\n```html\n<script>示例</script>\n```' } })
  expect(w.find('script').exists()).toBe(false)
  expect(w.find('img').exists()).toBe(false)
  expect(w.find('[onerror]').exists()).toBe(false)
  expect(w.find('a[href^="javascript:"]').exists()).toBe(false)
  expect(w.get('pre code').text()).toContain('<script>示例</script>')
})
it('流式期按块增量渲染：已定稿块的 DOM 节点不被替换，只有尾块更新', async () => {
  const w = mount(MarkdownOutput, { props: { content: '# 标题\n\n第一段', streaming: true } })
  const blocks = w.findAll('.markdown-block')
  expect(blocks).toHaveLength(2)
  const firstEl = blocks[0].element
  const firstInner = blocks[0].element.firstChild

  // 尾块继续输出：首块 DOM 必须原样保留（不整体重渲染）
  await w.setProps({ content: '# 标题\n\n第一段补充' })
  expect(w.findAll('.markdown-block')[0].element).toBe(firstEl)
  expect(w.findAll('.markdown-block')[0].element.firstChild).toBe(firstInner)
  expect(w.findAll('.markdown-block')[1].text()).toBe('第一段补充')

  // 新增定稿块：旧块节点依旧复用
  await w.setProps({ content: '# 标题\n\n第一段补充\n\n**新块**' })
  const after = w.findAll('.markdown-block')
  expect(after).toHaveLength(3)
  expect(after[0].element).toBe(firstEl)
  expect(after[0].element.firstChild).toBe(firstInner)
  expect(after[1].text()).toBe('第一段补充')
  expect(after[2].find('strong').text()).toBe('新块')
})
it('流式切块不拆断代码围栏：围栏内空行不产生新块', () => {
  const w = mount(MarkdownOutput, {
    props: { content: '前置说明\n\n```python\na = 1\n\nb = 2\n```', streaming: true },
  })
  const blocks = w.findAll('.markdown-block')
  expect(blocks).toHaveLength(2)
  expect(blocks[1].find('pre code').text()).toContain('a = 1')
  expect(blocks[1].find('pre code').text()).toContain('b = 2')
})
it('非流式渲染为单一全文块，切回流式后仍可增量', async () => {
  const w = mount(MarkdownOutput, { props: { content: '# A\n\n# B', streaming: false } })
  expect(w.findAll('.markdown-block')).toHaveLength(1)
  await w.setProps({ content: '# A\n\n# B\n\n# C', streaming: true })
  expect(w.findAll('.markdown-block')).toHaveLength(3)
})
