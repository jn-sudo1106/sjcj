// @vitest-environment jsdom
// 「从模板新建实例」四步向导（1109 方案 §5 / §12 C12）。测接线，不测样式：
//   ① 四步步骤条、第 3 步默认流程默认不勾
//   ② 切换源范围会重新调 previewScope 并刷新计数卡
//   ③ 实例名称为空点保存：拦住、不发请求
//   ④ 保存成功 emit created 并在同一弹窗内切「保存结果卡」
//   ⑤ 保存失败 ElMessage.error 报错、不 emit（不假装成功）
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import NewInstanceWizard from './NewInstanceWizard.vue'
import { createInstanceDraft, previewScope } from '@/api/flowCenterCenter'
import type { InstanceDraftResult, ScopeMode, ScopePreview, TemplateMeta } from '@/api/types/flowCenterCenter'

vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
vi.mock('@/api/flowCenterCenter', () => ({ previewScope: vi.fn(), createInstanceDraft: vi.fn() }))

const previewMock = vi.mocked(previewScope)
const createDraftMock = vi.mocked(createInstanceDraft)
const errorMsg = vi.mocked(ElMessage.error)
const warnMsg = vi.mocked(ElMessage.warning)

const templates: TemplateMeta[] = [
  {
    id: 'tpl-a',
    name: '公告列表→详情',
    sourceCount: 86,
    instanceCount: 312,
    updatedAt: '11-08',
    structure: {
      nodes: [
        { id: 'n1', kind: 'start', label: '开始' },
        { id: 'n2', kind: 'capture', label: '列表采集', code: 'web-list' },
        { id: 'n3', kind: 'rule', label: '规则处理', code: 'rule-1' },
        { id: 'n4', kind: 'end', label: '结束' },
      ],
      branches: ['详情采集 → 翻译'],
      fingerprint: '#8f3c-6n-2b',
    },
  },
  {
    id: 'tpl-b',
    name: '单页列表入库',
    sourceCount: 23,
    instanceCount: 48,
    updatedAt: '11-05',
    structure: {
      nodes: [
        { id: 'n1', kind: 'start', label: '开始' },
        { id: 'n2', kind: 'capture', label: '列表采集', code: 'web-list' },
        { id: 'n3', kind: 'end', label: '结束' },
      ],
      branches: [],
      fingerprint: '#4a12-9k-7d',
    },
  },
]

const DRAFT: InstanceDraftResult = {
  id: '4821',
  name: '公告列表→详情·上交所 2026 新增',
  templateId: 'tpl-a',
  scopeIntentCount: 6564,
  createdAt: '2026-11-11T10:00:00.000Z',
}

/** 与 mock/flowCenterCenter.ts 同口径的两个范围总数（原型 6,564 / 5,988） */
function previewOf(mode: ScopeMode): ScopePreview {
  const total = mode === 'unbound' ? 5988 : mode === 'skip' ? 0 : 6564
  return {
    templateId: 'tpl-a',
    total,
    toAdd: mode === 'unbound' ? 5977 : mode === 'skip' ? 0 : 6553,
    toSkip: 0,
    groupSources: mode === 'skip' ? 0 : 5,
    expectedUnavailable: mode === 'unbound' ? 4 : mode === 'skip' ? 0 : 6,
    defaultFilled: 0,
  }
}

/**
 * 本文件把 element-plus mock 成只剩 ElMessage，模板里的 el-* 组件需要在这里补齐 stub：
 * Dialog 按 modelValue 显隐、Button 保留 disabled/loading、Input 双向绑定、Checkbox 点击发 change、
 * RadioButton 的 click 直接落到根元素（组件本身不监听 update:modelValue，靠 click 选范围）。
 * 只替组件外壳，不改组件逻辑与断言口径。
 */
const ElDialogStub = {
  name: 'ElDialog',
  props: ['modelValue', 'title', 'width', 'appendToBody', 'destroyOnClose', 'closeOnClickModal'],
  emits: ['update:modelValue'],
  template: '<div v-if="modelValue" class="el-dialog-stub"><slot /><div class="el-dialog-footer-stub"><slot name="footer" /></div></div>',
}

const ElButtonStub = {
  name: 'ElButton',
  props: ['type', 'size', 'disabled', 'loading'],
  template: '<button type="button" :disabled="disabled"><slot /></button>',
}

const ElInputStub = {
  name: 'ElInput',
  props: ['modelValue', 'size', 'disabled', 'placeholder'],
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" :disabled="disabled" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}

const ElCheckboxStub = {
  name: 'ElCheckbox',
  props: ['modelValue', 'value', 'size'],
  emits: ['change', 'update:modelValue'],
  template: '<label class="el-checkbox-stub" @click="$emit(\'change\', !modelValue)"><slot /></label>',
}

const ElCheckboxGroupStub = {
  name: 'ElCheckboxGroup',
  props: ['modelValue', 'size'],
  template: '<div class="el-checkbox-group-stub"><slot /></div>',
}

const ElRadioGroupStub = {
  name: 'ElRadioGroup',
  props: ['modelValue', 'size'],
  template: '<div class="el-radio-group-stub"><slot /></div>',
}

/** click 是原生属性（事件从组件根元素冒泡到这里的 @click） */
const ElRadioButtonStub = {
  name: 'ElRadioButton',
  props: ['value', 'label'],
  template: '<label class="el-radio-button-stub"><slot /></label>',
}

const ElAlertStub = {
  name: 'ElAlert',
  props: ['type', 'title', 'description', 'closable', 'showIcon'],
  template: '<div class="el-alert-stub"><slot name="title" /><slot /></div>',
}

const ElTagStub = {
  name: 'ElTag',
  props: ['type', 'size', 'effect'],
  template: '<span class="el-tag-stub"><slot /></span>',
}

const ElSelectStub = {
  name: 'ElSelect',
  props: ['modelValue', 'size', 'disabled', 'placeholder'],
  template: '<select :disabled="disabled"><slot /></select>',
}

const ElOptionStub = {
  name: 'ElOption',
  props: ['label', 'value'],
  template: '<option :value="value">{{ label }}</option>',
}

const STUBS = {
  ElDialog: ElDialogStub,
  ElButton: ElButtonStub,
  ElInput: ElInputStub,
  ElCheckbox: ElCheckboxStub,
  ElCheckboxGroup: ElCheckboxGroupStub,
  ElRadioGroup: ElRadioGroupStub,
  ElRadioButton: ElRadioButtonStub,
  ElAlert: ElAlertStub,
  ElTag: ElTagStub,
  ElSelect: ElSelectStub,
  ElOption: ElOptionStub,
  Teleport: true,
}

function mountWizard(extra: Record<string, unknown> = {}) {
  return mount(NewInstanceWizard, { props: { visible: true, templates, ...extra }, global: { stubs: STUBS } })
}

async function click(wrapper: ReturnType<typeof mountWizard>, selector: string) {
  await wrapper.get(selector).trigger('click')
  await flushPromises()
}

/** 第 1 步选模板 → 第 2 步 → 第 3 步（进入第 3 步会触发两次 previewScope） */
async function gotoStep3(wrapper: ReturnType<typeof mountWizard>) {
  await click(wrapper, '[data-testid="niw-template"]')
  await click(wrapper, '[data-testid="niw-next"]')
  await click(wrapper, '[data-testid="niw-next"]')
  await flushPromises()
}

async function gotoStep4(wrapper: ReturnType<typeof mountWizard>) {
  await gotoStep3(wrapper)
  await click(wrapper, '[data-testid="niw-next"]')
}

beforeEach(() => {
  vi.clearAllMocks()
  previewMock.mockImplementation(async (_templateId, scope) => previewOf(scope.mode))
  createDraftMock.mockResolvedValue(DRAFT)
})

describe('NewInstanceWizard · 步骤条与第 3 步默认值', () => {
  it('默认四步；第 3 步默认流程未勾选，进入步骤就拉范围预览', async () => {
    const wrapper = mountWizard()
    const steps = wrapper.findAll('[data-testid="niw-step"]')
    expect(steps).toHaveLength(4)
    // 原型 #frame2 的步骤条 .no 圈号和 .tx 文案里都带序号，这里 1:1 保留
    expect(steps.map((item) => item.text())).toEqual([
      '11 选择模板从模板复制结构',
      '22 查看结构只读预览',
      '33 网站与源范围决定这个实例服务谁',
      '44 命名并保存草稿不直接生效',
    ])

    await gotoStep3(wrapper)

    expect(previewMock).toHaveBeenCalledWith('tpl-a', expect.objectContaining({ mode: 'site-all', sites: ['上市公司网站'], setDefault: false }))
    expect(wrapper.get('[data-testid="niw-preview"]').text()).toContain('6,564')
    expect(wrapper.text()).toContain('设为这些源的默认流程')
    const defaultBox = wrapper.get('[data-testid="niw-set-default"] .cb')
    expect(defaultBox.classes()).not.toContain('on')
    // 默认流程默认不勾：预览里的补默认是 0，且标明不计入合计
    expect(wrapper.get('[data-testid="niw-preview"]').text()).toContain('0不计入合计')
  })

  it('presetTemplateId 时直接落到第 2 步（结构已定）', async () => {
    const wrapper = mountWizard({ presetTemplateId: 'tpl-a' })
    expect(wrapper.text()).toContain('第 2 步 · 查看结构')
    expect(wrapper.text()).toContain('只读 · 来自模板')
    expect(wrapper.text()).toContain('分支：详情采集 → 翻译')
  })
})

describe('NewInstanceWizard · 第 3 步范围预览', () => {
  it('切换源范围重新调 previewScope 并刷新计数卡', async () => {
    const wrapper = mountWizard()
    await gotoStep3(wrapper)
    // 进入步骤时两条候选范围各拉一次：该网站全部源 / 仅未绑定
    expect(wrapper.get('[data-testid="niw-preview"]').text()).toContain('6,564')
    const before = previewMock.mock.calls.length

    await click(wrapper, '[data-testid="niw-mode"][data-mode="unbound"]')

    expect(previewMock.mock.calls.length).toBe(before + 1)
    expect(previewMock).toHaveBeenLastCalledWith('tpl-a', expect.objectContaining({ mode: 'unbound' }))
    expect(wrapper.get('[data-testid="niw-preview"]').text()).toContain('5,988')
    expect(wrapper.get('[data-testid="niw-preview"]').text()).toContain('预计不可操作 4')
  })

  it('勾选默认流程也会刷新预览的补默认计数', async () => {
    previewMock.mockImplementation(async (_templateId, scope) => ({ ...previewOf(scope.mode), defaultFilled: scope.setDefault ? 6553 : 0 }))
    const wrapper = mountWizard()
    await gotoStep3(wrapper)
    expect(wrapper.get('[data-testid="niw-preview"]').text()).toContain('预计补默认 0')

    await click(wrapper, '[data-testid="niw-set-default"]')

    expect(previewMock).toHaveBeenLastCalledWith('tpl-a', expect.objectContaining({ setDefault: true }))
    expect(wrapper.get('[data-testid="niw-set-default"] .cb').classes()).toContain('on')
    expect(wrapper.get('[data-testid="niw-preview"]').text()).toContain('预计补默认 6,553')
  })

  it('预览失败用 ElMessage.error 报错，不吞错', async () => {
    previewMock.mockRejectedValue(new Error('scopePreview 502'))
    const wrapper = mountWizard()
    await gotoStep3(wrapper)

    expect(errorMsg).toHaveBeenCalledWith(expect.stringContaining('scopePreview 502'))
    expect(wrapper.find('[data-testid="niw-preview"]').text()).not.toContain('6,564')
  })
})

describe('NewInstanceWizard · 第 4 步命名并保存', () => {
  it('名称为空点保存：拦住并提示，不发请求、不 emit', async () => {
    const wrapper = mountWizard()
    await gotoStep4(wrapper)

    await click(wrapper, '[data-testid="niw-save"]')

    expect(warnMsg).toHaveBeenCalledWith('请输入实例名称')
    expect(createDraftMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')).toBeUndefined()
  })

  it('保存成功 emit created，并在同一弹窗内切到保存结果卡', async () => {
    const wrapper = mountWizard()
    await gotoStep4(wrapper)
    await wrapper.get('[data-testid="niw-name"]').setValue('公告列表→详情·上交所 2026 新增')
    await click(wrapper, '[data-testid="niw-save"]')

    expect(createDraftMock).toHaveBeenCalledWith({
      name: '公告列表→详情·上交所 2026 新增',
      templateId: 'tpl-a',
      scope: { sites: ['上市公司网站'], mode: 'site-all', manualSourceIds: [], setDefault: false },
    })
    const created = wrapper.emitted('created')
    expect(created).toHaveLength(1)
    expect((created![0]![0] as InstanceDraftResult).id).toBe('4821')

    const result = wrapper.get('[data-testid="niw-result"]')
    expect(result.text()).toContain('实例 #4821 已创建 · 草稿，未生效')
    expect(result.text()).toContain('记录 6,553 个源为目标范围（未建立绑定；合计 6,564）')
    expect(wrapper.text()).toContain('配置就绪检查')
    expect(wrapper.text()).toContain('缺失：输出表未选、脚本模板未指定。')
    expect(wrapper.find('[data-testid="niw-name"]').exists()).toBe(false)

    await click(wrapper, '[data-testid="niw-go-config"]')
    expect(wrapper.emitted('go-config')).toHaveLength(1)
    await click(wrapper, '[data-testid="niw-bind-failed"]')
    expect(wrapper.emitted('bind-failed')).toHaveLength(1)
    await click(wrapper, '[data-testid="niw-later"]')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('保存失败弹错误且不 emit created（不假装成功）', async () => {
    createDraftMock.mockRejectedValue(new Error('保存草稿失败：后端未返回实例 ID'))
    const wrapper = mountWizard()
    await gotoStep4(wrapper)
    await wrapper.get('[data-testid="niw-name"]').setValue('公告列表→详情')
    await click(wrapper, '[data-testid="niw-save"]')

    expect(errorMsg).toHaveBeenCalledWith(expect.stringContaining('后端未返回实例 ID'))
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.find('[data-testid="niw-result"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="niw-save"]').text()).toBe('保存草稿')
  })

  it('visible 关掉再打开会重置回第 1 步', async () => {
    const wrapper = mountWizard()
    await gotoStep3(wrapper)
    expect(wrapper.text()).toContain('第 3 步 · 网站与源范围')

    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })

    expect(wrapper.text()).toContain('第 1 步 · 选择模板')
    expect(wrapper.find('[data-testid="niw-preview"]').exists()).toBe(false)
  })
})