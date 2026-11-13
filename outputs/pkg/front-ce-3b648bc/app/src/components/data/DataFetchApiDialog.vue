<script setup lang="ts">
import { Connection, CopyDocument } from '@element-plus/icons-vue'
import { copyToClipboard } from '@/utils/clipboard'

export interface DataFetchApiParam {
  name: string
  type: string
  required: string
  limit: string
  description: string
}

export interface DataFetchApiReturn {
  code: string
  name: string
  type: string
  description: string
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  url: string
  params: DataFetchApiParam[]
  returns: DataFetchApiReturn[]
  tableLabel?: string
  sourceLabel?: string
  testId?: string
}>(), {
  tableLabel: '',
  sourceLabel: '',
  testId: 'data-api-dialog',
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

async function copyUrl() {
  await copyToClipboard(props.url, 'API 地址')
}
</script>

<template>
  <el-dialog
    class="dap-dialog"
    :model-value="modelValue"
    width="920px"
    align-center
    append-to-body
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="dap-header">
        <span class="dap-header-icon"><el-icon><Connection /></el-icon></span>
        <div>
          <div class="dap-title">取数 API</div>
          <div class="dap-subtitle">通过接口分批读取当前数据范围，适合系统集成和自动化处理</div>
        </div>
      </div>
    </template>

    <div class="dap-content" :data-testid="testId">
      <section class="dap-endpoint">
        <div class="dap-endpoint-head">
          <div class="dap-endpoint-name">
            <span class="dap-method">GET</span>
            <span>ID 分批取数</span>
          </div>
          <div class="dap-scope">
            <span v-if="tableLabel" class="dap-chip" :title="tableLabel">表：{{ tableLabel }}</span>
            <span v-if="sourceLabel" class="dap-chip" :title="sourceLabel">源：{{ sourceLabel }}</span>
          </div>
        </div>
        <div class="dap-url-row">
          <code class="dap-url">{{ url }}</code>
          <button class="dap-copy" type="button" title="复制 API 地址" @click="copyUrl">
            <el-icon><CopyDocument /></el-icon><span>复制地址</span>
          </button>
        </div>
        <div class="dap-tip">
          每次响应会返回 <code>data.lastId</code>；读取下一批时，将 <code>startId</code> 设置为 <code>lastId + 1</code>。
        </div>
      </section>

      <section class="dap-section">
        <div class="dap-section-head">
          <div class="dap-section-title">
            <h3>请求参数</h3>
            <p>应用凭据由部署环境提供，地址中的值可直接用于当前环境。</p>
          </div>
          <span class="dap-count">{{ params.length }} 项</span>
        </div>
        <el-table :data="params" class="dap-table" size="small" stripe>
          <el-table-column prop="name" label="参数" width="125">
            <template #default="{ row }"><code class="dap-field">{{ row.name }}</code></template>
          </el-table-column>
          <el-table-column prop="type" label="类型" width="90" />
          <el-table-column prop="required" label="必填" width="72" />
          <el-table-column prop="limit" label="限制" width="110" />
          <el-table-column prop="description" label="说明" min-width="300" />
        </el-table>
      </section>

      <section class="dap-section">
        <div class="dap-section-head">
          <div class="dap-section-title">
            <h3>返回字段</h3>
            <p>除通用字段外，还会返回当前数据表的业务字段。</p>
          </div>
          <span class="dap-count">{{ returns.length }} 项</span>
        </div>
        <el-table :data="returns" class="dap-table dap-return-table" size="small" stripe max-height="310">
          <el-table-column prop="code" label="字段" width="210">
            <template #default="{ row }"><code class="dap-field">{{ row.code }}</code></template>
          </el-table-column>
          <el-table-column prop="name" label="名称" width="210" />
          <el-table-column prop="type" label="类型" width="100" />
          <el-table-column prop="description" label="说明" min-width="250" />
        </el-table>
      </section>
    </div>

    <template #footer>
      <div class="dap-footer">
        <button class="dap-btn" type="button" @click="emit('update:modelValue', false)">关闭</button>
        <button class="dap-btn primary" type="button" @click="copyUrl"><el-icon><CopyDocument /></el-icon>复制 API 地址</button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.dap-header { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dap-header-icon { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex: none; border-radius: 10px; background: var(--rc-primary-bg, #eff6ff); color: var(--rc-primary, #2563eb); font-size: 20px; }
.dap-title { color: var(--rc-text, #0f172a); font-size: 16px; font-weight: 700; line-height: 1.4; }
.dap-subtitle { margin-top: 2px; color: var(--rc-muted, #64748b); font-size: 12px; line-height: 1.4; }
.dap-content { display: grid; gap: 18px; min-width: 0; }
.dap-endpoint { padding: 14px; border: 1px solid #dbe7f5; border-radius: 10px; background: linear-gradient(135deg, #f8fbff 0%, #f5f8fc 100%); }
.dap-endpoint-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.dap-endpoint-name { display: flex; align-items: center; gap: 8px; color: var(--rc-text, #0f172a); font-size: 13px; font-weight: 700; }
.dap-method { display: inline-flex; align-items: center; justify-content: center; height: 24px; padding: 0 8px; border-radius: 6px; background: #dcfce7; color: #15803d; font: 700 11px/1 var(--rc-mono, monospace); letter-spacing: .04em; }
.dap-scope { display: flex; justify-content: flex-end; gap: 6px; min-width: 0; }
.dap-chip { max-width: 230px; overflow: hidden; padding: 4px 8px; border: 1px solid #dbe7f5; border-radius: 999px; background: rgba(255, 255, 255, .8); color: var(--rc-text-2, #334155); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.dap-url-row { display: flex; align-items: stretch; gap: 8px; }
.dap-url { flex: 1; min-width: 0; max-height: 72px; overflow: auto; padding: 10px 12px; border: 1px solid #dbe7f5; border-radius: 7px; background: #fff; color: #1e40af; font: 12px/1.55 var(--rc-mono, monospace); overflow-wrap: anywhere; }
.dap-copy, .dap-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; padding: 0 12px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2, #334155); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.dap-copy { height: auto; min-height: 38px; }
.dap-copy:hover, .dap-btn:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.dap-btn.primary { border-color: var(--rc-primary, #2563eb); background: var(--rc-primary, #2563eb); color: #fff; }
.dap-btn.primary:hover { border-color: #1d4ed8; background: #1d4ed8; }
.dap-tip { margin-top: 9px; color: var(--rc-muted, #64748b); font-size: 11px; line-height: 1.55; }
.dap-tip code { color: var(--rc-text-2, #334155); font-family: var(--rc-mono, monospace); }
.dap-section { min-width: 0; }
.dap-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
.dap-section-title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.dap-section-head h3 { margin: 0; color: var(--rc-text, #0f172a); font-size: 14px; line-height: 1.4; }
.dap-section-head p { margin: 0; color: var(--rc-muted, #64748b); font-size: 11px; }
.dap-count { flex: none; color: var(--rc-faint, #94a3b8); font-size: 11px; }
.dap-table { width: 100%; border: 1px solid var(--rc-border-soft, #e8eef6); border-radius: 8px; overflow: hidden; }
.dap-table :deep(.el-table__inner-wrapper::before) { display: none; }
.dap-table :deep(th.el-table__cell) { height: 38px; padding: 0; background: #f8fafc; color: var(--rc-text-2, #334155); font-size: 12px; font-weight: 700; }
.dap-table :deep(td.el-table__cell) { padding: 7px 0; color: #334155; }
.dap-table :deep(.cell) { color: inherit; font-size: 12px; line-height: 1.45; white-space: normal; word-break: break-word; }
.dap-field { color: #1d4ed8; font: 11.5px/1.45 var(--rc-mono, monospace); }
.dap-footer { display: flex; justify-content: flex-end; gap: 8px; }
.dap-dialog :deep(.el-dialog) { max-width: calc(100vw - 32px); overflow: hidden; border-radius: 12px; box-shadow: 0 18px 50px rgba(15, 23, 42, .18); }
.dap-dialog :deep(.el-dialog__header) { margin-right: 0; padding: 17px 20px 15px; border-bottom: 1px solid var(--rc-border-soft, #e8eef6); }
.dap-dialog :deep(.el-dialog__headerbtn) { top: 13px; right: 14px; width: 36px; height: 36px; }
.dap-dialog :deep(.el-dialog__body) { max-height: calc(100vh - 190px); overflow: auto; padding: 18px 20px; }
.dap-dialog :deep(.el-dialog__footer) { padding: 12px 20px 16px; border-top: 1px solid var(--rc-border-soft, #e8eef6); background: #fff; }
@media (max-width: 760px) {
  .dap-subtitle { display: none; }
  .dap-endpoint-head { align-items: flex-start; flex-direction: column; }
  .dap-scope { justify-content: flex-start; flex-wrap: wrap; }
  .dap-url-row { flex-direction: column; }
  .dap-copy { min-height: 34px; }
  .dap-section-title { align-items: flex-start; flex-direction: column; gap: 2px; }
}
</style>
