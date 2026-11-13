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
