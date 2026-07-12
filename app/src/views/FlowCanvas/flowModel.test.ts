import { describe, expect, it } from 'vitest'
import { NODE_CONFIGS, normalizeNodeConfig } from './flowModel'

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
