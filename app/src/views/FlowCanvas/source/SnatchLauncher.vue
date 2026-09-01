<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi } from '@/api'
import SourceParamModal from './SourceParamModal.vue'
import { hasLoadParams, normalizeLoadParams } from './paramNormalize'

const paramModalRef = ref<InstanceType<typeof SourceParamModal>>()
// 真实发送成功后触发（弹框确认后 / 直发后都会调用），用于衔接流程视图的运行态模拟。
let afterSend: (() => void) | undefined
// 调用方传了 onSuccess 时，它自己的提示（如「已发起抓取 RUN-xxx」）比弹窗通用的「发送成功…」
// 更具体，弹窗那条就该让路——不然一次发送弹两条提示（0901 生产实测反馈的真体验问题）。
const suppressModalToast = ref(false)

// 与 SourceParamModal 的 callback 契约一致：位置参数 (ids, param, all, include, skip, queue)。
async function sendWithParamsCallback(
  ids: string[],
  param: Record<string, string>,
  all: number,
  include: string[],
  skip: number,
  queue: string,
) {
  const res = await sourceApi.sendSnatchWithParam({ ids, param, all: all as 0 | 1, include, skip, queue })
  afterSend?.()
  return res
}

interface LaunchOptions {
  /** 节点引用的配置 ID；传入时仅展示/发送该配置的参数，其余忽略。 */
  configId?: string
  queue?: string
  onSuccess?: () => void
}

// 发起抓取（按源 + 可选节点配置范围）：loadParams → 有参数弹框 / 无参数直发。
// 真实后端：config/loadParams + source/sendSnatchWithParam（均已在 endpoints 标 live:true）。
// 返回真实回执（直发路径）；弹框路径在用户确认后才发送，故此处提前返回 undefined。
async function launch(
  sourceId: string,
  opts: LaunchOptions = {},
): Promise<Awaited<ReturnType<typeof sourceApi.sendSnatchWithParam>> | undefined> {
  afterSend = opts.onSuccess
  suppressModalToast.value = !!opts.onSuccess
  try {
    const raw = await sourceApi.loadParams([sourceId])
    const norm = normalizeLoadParams(raw)
    const scoped = opts.configId ? { [opts.configId]: norm[opts.configId] ?? [] } : norm
    if (hasLoadParams(scoped)) {
      paramModalRef.value?.showParam(scoped, [{ sourceId }], false, opts.queue)
      return
    }
    const res = await sourceApi.sendSnatchWithParam({
      ids: [sourceId],
      param: {},
      all: 0,
      include: [],
      skip: 0,
      queue: opts.queue,
    })
    afterSend?.()
    return res
  } catch (e: any) {
    ElMessage.error(`发起抓取失败：${e?.message || e}`)
  }
}

defineExpose({ launch })
</script>

<template>
  <SourceParamModal ref="paramModalRef" :callback="sendWithParamsCallback" :suppress-own-success-toast="suppressModalToast" />
</template>
