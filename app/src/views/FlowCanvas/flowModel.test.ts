import { describe, expect, it } from 'vitest'
import { buildHorizontalLayout, iconFor, NODE_CONFIGS, normalizeNodeConfig } from './flowModel'

describe('流程参数配置迁移', () => {
  it('旧流程加载时从 URL token 初始化节点参数绑定', () => {
    const cfg = normalizeNodeConfig({
      ...NODE_CONFIGS['web-list'],
      collectCfg: {
        ...NODE_CONFIGS['web-list'].collectCfg!,
        url: 'https://example.com/list?price=$PARAM$_1035&type=$PARAM$_1036',
      },
    })

    expect(cfg.collectCfg?.urlParamRefs).toEqual(['1035', '1036'])
  })
})

describe('横向节点布局', () => {
  it('隐藏终端时只布局实际节点，连线不保留开始或结束空箭头', () => {
    const layout = buildHorizontalLayout(
      ['start', 'web-list', 'web-detail', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false },
    )
    expect(layout.terminals).toEqual([])
    expect(layout.nodes.map((node) => node.id)).toEqual(['web-list', 'web-detail'])
    expect(layout.mainEdges).toHaveLength(1)
  })
})

describe('画布节点图标', () => {
  it('浏览器与公众号抓取使用中文编号，不展示内部英文类型码', () => {
    expect(iconFor(NODE_CONFIGS['browser-html-collect'])).toBe('180')
    expect(iconFor(NODE_CONFIGS['wechat-html-collect'])).toBe('185')
  })
})
