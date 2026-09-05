<script setup lang="ts">
// 流程「使用源数」下钻：列出挂在该流程下的源。
//
// 走 sourcePaged 的 flowId 过滤——2026-09-02 生产实测确认后端认这个条件（无条件 16929 条，
// flowId=1400330 得 46 条且与该流程 sourceCnt 一致，传不存在的 flowId 得 0 条），不是静默忽略。
// 服务端分页：单个流程下最多见过 46 个源，但存量是后端从配置整批灌过来的，不能假设一定小。
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { sourceApi, type FlowRecord, type Source } from '@/api'

const props = defineProps<{ flow: FlowRecord | null }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const rows = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
const error = ref('')

async function load() {
  const flow = props.flow
  if (!flow) return
  loading.value = true
  error.value = ''
  try {
    const result = await sourceApi.sourcePaged({ flowId: flow.id, page: page.value, size: size.value })
    rows.value = result.list
    total.value = result.total
  } catch (e) {
    rows.value = []
    total.value = 0
    error.value = `关联源加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    loading.value = false
  }
}

watch(() => props.flow?.id, (id) => {
  if (!id) return
  page.value = 1
  rows.value = []
  void load()
}, { immediate: true })

function onSizeChange() {
  page.value = 1
  void load()
}

/** 点行进入该源的工作区——这是「看看这个流程到底挂了些什么源」之后最自然的下一步 */
function openSource(source: Source) {
  emit('close')
  void router.push({
    path: '/canvas',
    query: { ...(source.siteId ? { siteId: source.siteId } : {}), sourceId: source.sourceId, view: 'flow' },
  })
}

/**
 * 「在源视图中查看全部」（0904 I16 / Z7-2）。走查原话：
 * 「如果有 7 个怎么办？你要一个一个点过来嘛，还是点查看全部……你的详情里面点查看全部
 *  就把全部带过来，然后你点一个，他如果一个就可以点」。
 *
 * **两个边界**：
 * 1. 源视图锁死在单网站内（0812 纠偏），而一个流程的关联源理论上可跨网站
 *    （`cs_flow.siteId` 只是流程自己的登记值，不是源的归属）。跨网站时不做聚合视图——
 *    那违反源视图的边界——降级成提示，让用户在这个清单里逐个进。
 * 2. **不把源 ID 拼进 URL**：一个流程最多见过 5439 个源（流程 1400976）。改传 flowId，
 *    源视图那边按服务端条件筛（sourcePaged 认这个条件，见文件头注释）。
 */
function openAllInSourceView() {
  const flow = props.flow
  if (!flow) return
  const sites = [...new Set(rows.value.map((r) => r.siteId).filter(Boolean))] as string[]
  if (!sites.length) {
    ElMessage.warning('这批源没有回填所属网站，无法定位到源视图，请在下面的清单里逐个进入')
    return
  }
  if (sites.length > 1) {
    ElMessage.warning(`该流程的源跨 ${sites.length} 个网站，源视图一次只能看一个网站，请在下面的清单里逐个进入`)
    return
  }
  emit('close')
  void router.push({ path: '/canvas', query: { siteId: sites[0], view: 'source', flowId: flow.id } })
}

function stateText(source: Source) {
  if (source.disabled) return '已停用'
  return source.state === 'E' ? '异常' : source.state === 'L' ? '运行中' : '正常'
}
</script>

<template>
  <el-dialog
    :model-value="!!flow"
    :title="flow ? `流程「${flow.name}」的关联源` : ''"
    width="860px"
    destroy-on-close
    @close="emit('close')"
  >
    <div class="fs-head">
      <span v-if="!error">共 {{ total }} 个源</span>
      <span v-else class="fs-error">{{ error }}</span>
      <button
        v-if="!error && total > 1"
        class="fs-viewall"
        type="button"
        data-testid="flow-sources-view-all"
        @click="openAllInSourceView"
      >在源视图中查看全部 {{ total }} 个源 →</button>
    </div>
    <div class="fs-table-wrap" v-loading="loading">
      <table class="fs-table">
        <thead>
          <tr>
            <th>源 ID / 名称</th>
            <th style="width: 84px">状态</th>
            <th style="width: 92px">步骤数</th>
            <th style="width: 104px">数据量</th>
            <th style="width: 150px">最近任务</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in rows" :key="s.sourceId" data-testid="flow-source-row" @click="openSource(s)">
            <td>
              <div class="fs-name">
                <b>{{ s.name || s.sourceId }}</b>
                <small>{{ s.sourceId }}</small>
              </div>
            </td>
            <td>{{ stateText(s) }}</td>
            <!-- 步骤数 = sourcePaged 的 stepCnt（真实子步骤条数，不含 nextConfigPaged 里那条
                 按当前源现算出来的 itemConfig=0 起点行——那行不是 cs_item_config 的真实记录，
                 见 endpoints.ts 里 item/next/nextConfigPaged 的注释） -->
            <td class="fs-muted">{{ s.stepCount == null ? '—' : s.stepCount }}</td>
            <td class="fs-muted">{{ s.dataCount == null ? '—' : s.dataCount.toLocaleString() }}</td>
            <td class="fs-muted">{{ s.lastTaskAt || '—' }}</td>
          </tr>
          <tr v-if="!loading && !rows.length">
            <td colspan="5" class="fs-empty">{{ error || '该流程下没有关联的源' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 分页与数据中心一致（DataQueryPanel 的 .dqp-pager 同款 el-pagination） -->
    <div class="fs-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="load"
        @size-change="onSizeChange"
      />
    </div>
  </el-dialog>
</template>

<style scoped>
.fs-viewall { margin-left: auto; border: 0; background: transparent; color: var(--rc-primary, #2563eb); font-size: 12px; cursor: pointer; }
.fs-viewall:hover { text-decoration: underline; }
.fs-head { margin-bottom: 8px; color: var(--rc-muted); font-size: 12px; }
.fs-error { color: #dc2626; }
.fs-table-wrap { max-height: 420px; overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; }
.fs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.fs-table th { position: sticky; top: 0; z-index: 1; padding: 9px 12px; background: #f8fafc; color: var(--rc-text-2); font-weight: 700; text-align: left; border-bottom: 1px solid var(--rc-border); }
.fs-table td { padding: 9px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.fs-table tbody tr { cursor: pointer; }
.fs-table tbody tr:hover { background: var(--rc-primary-bg); }
.fs-name b { display: block; color: var(--rc-primary); font-size: 13px; }
.fs-name small { color: var(--rc-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.fs-muted { color: var(--rc-faint); }
.fs-empty { padding: 36px; text-align: center; color: var(--rc-faint); }
.fs-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 0 0; }
</style>
