// @vitest-environment jsdom
// OSS 上传页接线回归：选文件 → 自动生成「前缀 + UUID + 扩展名」路径 → 上传时把这个路径发给上传接口
// → 结果与上传历史各写一条。这页最容易静默坏掉的就是「路径没跟上前缀」和「上传没带 fileId」。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import OssUpload from './index.vue'
import { uploadOssFile } from '@/api/oss'

vi.mock('@/api/oss', async () => {
  const actual = await vi.importActual<typeof import('@/api/oss')>('@/api/oss')
  return { ...actual, uploadOssFile: vi.fn() }
})
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: vi.fn() }))

const mockedUpload = vi.mocked(uploadOssFile)

function makeFile(name = 'report.pdf'): File {
  return new File(['hello'], name, { type: 'application/pdf', lastModified: 1_700_000_000_000 })
}

beforeEach(() => {
  mockedUpload.mockReset().mockResolvedValue({ success: true, message: 'ok' })
})

function mountPage() {
  return mount(OssUpload, { global: { plugins: [ElementPlus] } })
}

/** el-upload 的 on-change：auto-upload=false 时它就是"选中文件"的入口 */
function pickFile(wrapper: ReturnType<typeof mountPage>, file: File) {
  const upload = wrapper.findComponent({ name: 'ElUpload' })
  const onChange = upload.props('onChange') as (f: { name: string; raw: File }) => void
  onChange({ name: file.name, raw: file })
}

describe('OSS 上传页', () => {
  it('初始状态：无文件、上传按钮不可点', () => {
    const wrapper = mountPage()
    const uploadButton = wrapper.findAll('button').find((btn) => btn.text() === '上传')
    expect(uploadButton?.attributes('disabled')).toBeDefined()
  })

  it('选文件后生成 前缀 + UUID + 扩展名 的自动路径，并可上传', async () => {
    const wrapper = mountPage()
    pickFile(wrapper, makeFile())
    await flushPromises()

    // 注意：带 /qinlong/report/ 前缀的输入框有两个（路径前缀 + 文件路径），按 placeholder 定位文件那个
    const pathInput = wrapper.find('input[placeholder="/xxx/xxx/xx.txt"]')
    expect(pathInput.exists()).toBe(true)
    expect((pathInput!.element as HTMLInputElement).value).toMatch(
      /^\/qinlong\/report\/\d{8}\/[0-9a-f-]{36}\.pdf$/,
    )
    expect(wrapper.text()).toContain('自动')
    expect(wrapper.text()).toContain('已选择 1/5 个文件')
  })

  it('上传：把该文件路径作为 fileId 发出去，并写入结果与历史', async () => {
    const wrapper = mountPage()
    pickFile(wrapper, makeFile('a.txt'))
    await flushPromises()

    const uploadButton = wrapper.findAll('button').find((btn) => btn.text() === '上传')!
    await uploadButton.trigger('click')
    await flushPromises()

    expect(mockedUpload).toHaveBeenCalledTimes(1)
    const payload = mockedUpload.mock.calls[0]![0]
    expect(payload.file.name).toBe('a.txt')
    expect(payload.fileId).toMatch(/^\/qinlong\/report\/\d{8}\/[0-9a-f-]{36}\.txt$/)

    expect(wrapper.text()).toContain('上传完成')
    expect(wrapper.text()).toContain('上传历史')
    expect(wrapper.text()).toContain('成功')
  })

  it('路径非法（纯斜杠）时上传按钮置灰', async () => {
    const wrapper = mountPage()
    pickFile(wrapper, makeFile())
    await flushPromises()

    const pathInput = wrapper.find('input[placeholder="/xxx/xxx/xx.txt"]')
    await pathInput.setValue('/')
    await flushPromises()

    const uploadButton = wrapper.findAll('button').find((btn) => btn.text() === '上传')
    expect(uploadButton?.attributes('disabled')).toBeDefined()
  })
})
