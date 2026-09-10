<script setup lang="ts">
// 校验历史日志（0910 从旧平台 JobLogModal 迁入）。
//
// 尺寸跟项目里的 TableDataDialog 一档（1080px / top 6vh），不照搬旧平台那个 85% 宽的
// modal——在宽屏上它会铺满整个视口，反而看不清。
//
// 源 ID 不给输入框：从哪条监控点进来就锁定哪条，旧平台那个可编辑的「源」输入框在这里
// 是多余的（它是全局页面才需要）。
import { reactive, ref, watch } from 'vue'
import { sourceCheckApi, type SourceCheck, type SourceCheckLog } from '@/api'

const props = defineProps<{ modelValue: boolean; check: SourceCheck | null }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean] }>()

const filters = reactive({ state: '', name: '' })
const rows = ref<SourceCheckLog[]>([])
const total = ref(0)
const page = ref(1)
const PAGE_SIZE = 20
const loading = ref(false)
const error = ref('')

async function load() {
  const check = props.check
  if (!check) return
  loading.value = true
  error.value = ''
  try {
    const result = await sourceCheckApi.pagedLogs({
      sourceId: check.sourceId,
      jobId: check.id,
      state: filters.state,
      name: filters.name.trim(),
      page: page.value,
      size: PAGE_SIZE,
    })
    rows.value = result.list
    total.value = result.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : '日志加载失败'
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function runQuery() {
  page.value = 1
  void load()
}
function resetFilters() {
  filters.state = ''
  filters.name = ''
  runQuery()
}

// 每次打开都从第一页重新拉：日志是随时间增长的，留着上次的翻页位置没有意义。
watch(() => props.modelValue, (open) => {
  if (!open) return
  filters.state = ''
  filters.name = ''
  page.value = 1
  rows.value = []
  void load()
})

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="校验历史日志"
    width="1080px"
    top="6vh"
    :close-on-click-modal="false"
    @update:model-value="close"
  >
    <div class="cld-head">
      <span class="cld-name" :title="check?.name">{{ check?.name || '—' }}</span>
      <span class="cld-sub">源 {{ check?.sourceId || '—' }} · {{ check?.tableName || '—' }}</span>
      <select v-model="filters.state" class="cld-input" aria-label="状态">
        <option value="">状态（全部）</option>
        <option value="E">告警</option>
        <option value="C">正常</option>
      </select>
      <input v-model="filters.name" class="cld-input" placeholder="名称" aria-label="名称" />
      <button class="rc-btn primary" type="button" :disabled="loading" @click="runQuery">{{ loading ? '查询中…' : '查询' }}</button>
      <button class="rc-btn" type="button" @click="resetFilters">重置</button>
    </div>

    <div v-if="error" class="cld-empty">{{ error }}</div>
    <template v-else>
      <div class="cld-table-wrap">
        <table class="rc-data-table" v-loading="loading">
          <thead>
            <tr>
              <th style="width:160px">时间</th>
              <th style="min-width:320px">消息</th>
              <th style="width:160px">名称</th>
              <th style="width:72px">状态</th>
              <th style="width:88px">类型</th>
              <th style="width:180px">表名</th>
            </tr>
          </thead>
          <tbody>
            <!-- 告警行整条标红：这点旧平台做对了，保留 -->
            <tr v-for="log in rows" :key="log.logId" :class="{ 'is-alarm': log.state === 'E' }">
              <td>{{ log.createDt || '—' }}</td>
              <td class="cld-msg" :title="log.logMsg">{{ log.logMsg || '—' }}</td>
              <td :title="log.name">{{ log.name || '—' }}</td>
              <!-- 状态转中文：E/C 是后端口径，直接摆出来让人猜没有意义。
                   与「类型」列不重复——那列是 logType，后端给的就是"出错/正常"这类文案。 -->
              <td>{{ log.state === 'E' ? '告警' : log.state === 'C' ? '正常' : (log.state || '—') }}</td>
              <td>{{ log.logType || '—' }}</td>
              <td :title="log.tableName">{{ log.tableName || '—' }}</td>
            </tr>
            <tr v-if="!rows.length && !loading">
              <td colspan="6" class="cld-empty-cell">暂无校验日志</td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 日志量很大（实测单源 3000+ 条），走标准分页器，不做无限滚动 -->
      <div class="cld-pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="PAGE_SIZE"
          :total="total"
          layout="total, prev, pager, next, jumper"
          background
          small
          :disabled="loading"
          @current-change="load"
        />
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.cld-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--rc-border-soft); }
.cld-name { font-size: 13px; font-weight: 700; color: var(--rc-text); }
.cld-sub { font-size: 11.5px; color: var(--rc-faint); margin-right: auto; }
.cld-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); font-size: 12px; outline: none; min-width: 110px; background: #fff; }
.cld-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.cld-head .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.cld-table-wrap { max-height: 56vh; overflow: auto; margin-top: 12px; }
.cld-table-wrap td { font-size: 12px; }
.cld-msg { max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cld-table-wrap tbody tr.is-alarm td { color: #b91c1c; }
.cld-empty { padding: 40px; text-align: center; color: var(--rc-faint); font-size: 13px; }
.cld-empty-cell { padding: 32px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.cld-pager { display: flex; justify-content: flex-end; padding-top: 10px; }
</style>
