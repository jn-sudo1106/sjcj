<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { nodePromptApi, type NodePromptTemplate, type TemplateUse } from '@/api/nodePrompts'
import type { NodeType } from '@/api'

const props = defineProps<{ node: NodeType; canWrite: boolean }>()
const use = ref<TemplateUse>('config'), rows = ref<NodePromptTemplate[]>([])
const loading = ref(false), saving = ref(false), error = ref(''), selected = ref(0), ready = ref(false)
const form = reactive({ promptId: 0, promptName: '', nodeType: '', nodeTypeName: '', category: 'collect', isActive: 1, isDefault: 1,
  systemPrompt: '', userPromptTemplate: '', outputSchema: '', parameters: '', exampleInput: '', exampleOutput: '', revision: '' })
const jsonFields = [{ key: 'parameters', label: '模板变量定义（JSON）' }, { key: 'outputSchema', label: '输出结构（JSON）' }, { key: 'exampleInput', label: '示例输入（JSON）' }, { key: 'exampleOutput', label: '示例输出' }] as const
const baseline = ref('')
const dirty = computed(() => ready.value && JSON.stringify(form) !== baseline.value)
const refreshLabel = computed(() => error.value ? '重试' : '刷新')
const errorLabel = computed(() => error.value ? `模板加载或保存失败：${error.value}` : '')
let seq = 0
const asText = (v: unknown) => v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2)
function edit(row?: NodePromptTemplate) {
  Object.assign(form, { promptId: row?.promptId ?? 0, promptName: row?.promptName ?? '', nodeType: row?.nodeType ?? props.node.sourceType, nodeTypeName: props.node.typeName,
    category: row?.category || rows.value[0]?.category || 'collect',
    isActive: row?.isActive ?? 1, isDefault: row?.isDefault ?? (rows.value.length ? 0 : 1),
    systemPrompt: row?.systemPrompt ?? '', userPromptTemplate: row?.userPromptTemplate ?? '', outputSchema: asText(row?.outputSchema),
    parameters: asText(row?.parameters), exampleInput: asText(row?.exampleInput), exampleOutput: row?.exampleOutput ?? '', revision: row?.revision ?? '' })
  selected.value = row?.promptId ?? 0; baseline.value = JSON.stringify(form); ready.value = true
}
async function confirmLeave() {
  if (saving.value) return false
  if (!dirty.value) return true
  try { await ElMessageBox.confirm('提示词模板尚未保存，是否放弃修改？', '未保存的修改', { type: 'warning', confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' }); return true } catch { return false }
}
async function load(selectId?: number) {
  const request = ++seq; loading.value = true; error.value = ''; ready.value = false
  try {
    const result = await nodePromptApi.list({ sourceType: props.node.sourceType, templateUse: use.value })
    if (request !== seq) return
    rows.value = result; edit(result.find(r => r.promptId === selectId) ?? result[0])
  } catch (e) { if (request === seq) { error.value = e instanceof Error ? e.message : String(e); rows.value = [] } }
  finally { if (request === seq) loading.value = false }
}
async function changeUse(value: TemplateUse) { if (value !== use.value && await confirmLeave()) { use.value = value; await load() } }
function onUseChange(value: unknown) { if (value === 'config' || value === 'script') void changeUse(value) }
async function choose(row: NodePromptTemplate) { if (row.promptId !== selected.value && await confirmLeave()) edit(row) }
async function create() {
  if (!await confirmLeave()) return
  const previous = ready.value ? { ...form } : undefined
  edit()
  if (previous) for (const key of ['systemPrompt', 'userPromptTemplate', 'parameters', 'outputSchema', 'exampleInput', 'exampleOutput'] as const) form[key] = previous[key]
}
async function refresh() { if (await confirmLeave()) await load(selected.value) }
async function save() {
  if (!props.canWrite || !ready.value || saving.value) return
  if (!form.promptName.trim() || !form.systemPrompt.trim() || !form.category.trim()) { ElMessage.warning('请填写提示词名称、系统提示词和分类'); return }
  for (const key of ['parameters', 'outputSchema', 'exampleInput'] as const) {
    if (form[key].trim()) try { JSON.parse(form[key]) } catch { ElMessage.warning(`${jsonFields.find(f => f.key === key)!.label} 格式不正确`); return }
  }
  if (form.isDefault && !form.isActive) { ElMessage.warning('默认模板必须启用'); return }
  saving.value = true; error.value = ''
  try {
    const result = await nodePromptApi.save({ ...form, sourceType: props.node.sourceType, templateUse: use.value })
    baseline.value = JSON.stringify(form)
    ElMessage.success('提示词模板已保存'); await load(result.promptId)
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { saving.value = false }
}
watch(() => props.node.sourceType, () => { use.value = 'config'; void load() }, { immediate: true })
defineExpose({ confirmLeave })
</script>

<template>
  <section class="np-templates" v-loading="loading" data-testid="node-prompt-templates">
    <header class="np-toolbar">
      <el-radio-group :model-value="use" :disabled="loading || saving" @update:model-value="onUseChange">
        <el-radio-button value="config">生成配置</el-radio-button><el-radio-button value="script">生成 Python 代码</el-radio-button>
      </el-radio-group>
      <el-button :disabled="loading || saving" @click="refresh">{{ refreshLabel }}</el-button>
      <el-button v-if="canWrite" :disabled="loading || saving || !!error && !ready" data-testid="node-prompt-new" @click="create">新增提示词</el-button>
    </header>
    <el-alert v-if="errorLabel" :title="errorLabel" type="error" :closable="false" show-icon />
    <div class="np-workspace">
      <nav aria-label="提示词列表"><button v-for="row in rows" :key="row.promptId" type="button" :class="{ active: selected === row.promptId }" :disabled="loading || saving" @click="choose(row)"><b>{{ row.promptName }}</b><span>{{ row.isDefault ? '默认 · ' : '' }}{{ row.isActive ? '已启用' : '已停用' }}</span></button><p v-if="!rows.length" class="np-muted">暂无提示词{{ canWrite ? '，填写后保存即可创建' : '' }}</p></nav>
      <el-form v-if="ready" class="np-editor" label-position="top" :disabled="!canWrite || saving || loading" @submit.prevent>
        <div class="np-fields">
          <el-form-item label="提示词名称" required class="np-name"><el-input v-model="form.promptName" maxlength="100" data-testid="node-prompt-name" placeholder="例如：新闻列表抓取" /></el-form-item>
          <el-form-item label="类型编码"><el-input :model-value="form.nodeType" disabled /></el-form-item>
          <el-form-item label="分类" required><el-input v-model="form.category" maxlength="50" placeholder="collect / rule" /></el-form-item>
          <el-form-item label="状态"><el-switch v-model="form.isActive" :active-value="1" :inactive-value="0" /><span>{{ form.isActive ? '启用' : '停用' }}</span></el-form-item>
          <el-form-item label="默认模板"><el-switch v-model="form.isDefault" :active-value="1" :inactive-value="0" /></el-form-item>
        </div>
        <div class="np-prompts">
          <el-form-item label="系统提示词" required><el-input v-model="form.systemPrompt" type="textarea" :rows="12" maxlength="12000" data-testid="node-prompt-system" /></el-form-item>
          <el-form-item label="用户提示词模板"><el-input v-model="form.userPromptTemplate" type="textarea" :rows="12" maxlength="12000" placeholder="支持 {{变量名}}，如 {{describe}}、{{url}}" data-testid="node-prompt-user" /></el-form-item>
        </div>
        <p class="np-muted" v-pre>常用变量：{{describe}}、{{source_table}}、{{output_table}}、{{input_fields}}、{{output_fields}}；代码生成还支持 {{url}}、{{config_id}}、{{queue_name}}。</p>
        <el-collapse><el-collapse-item title="变量、输出结构与示例" name="extra"><div class="np-prompts"><el-form-item v-for="field in jsonFields" :key="field.key" :label="field.label"><el-input v-model="form[field.key]" type="textarea" :rows="5" :maxlength="field.key === 'exampleOutput' ? 12000 : 60000" /></el-form-item></div></el-collapse-item></el-collapse>
        <p class="np-muted">公共模板在工作区加载时使用；当前节点已保存的提示词不会被回写覆盖。</p>
        <footer><span v-if="dirty">有未保存的修改</span><el-button v-if="canWrite" type="primary" :loading="saving" data-testid="node-prompt-save" @click="save">保存模板</el-button></footer>
      </el-form>
    </div>
  </section>
</template>

<style scoped>
.np-toolbar { display:flex; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap; }
.np-workspace { display:grid; grid-template-columns:145px minmax(0,1fr); gap:18px; margin-top:14px; }
nav button { width:100%; display:flex; flex-direction:column; gap:5px; padding:10px; margin-bottom:7px; background:var(--el-fill-color-light); border:1px solid var(--el-border-color-light); border-radius:7px; color:var(--el-text-color-primary); cursor:pointer; text-align:left; }
nav button.active { border-color:var(--el-color-primary); background:var(--el-color-primary-light-9); }nav span,.np-muted { font-size:12px; color:var(--el-text-color-secondary); }
.np-fields { display:flex; gap:12px; flex-wrap:wrap; }.np-fields .el-form-item { width:125px; }.np-fields .el-form-item:nth-child(4),.np-fields .el-form-item:nth-child(5) { width:90px; }
.np-fields .np-name { width:100%; }nav b { overflow-wrap:anywhere; }
.np-prompts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; } .np-editor { min-width:0; }
footer { display:flex; justify-content:flex-end; gap:12px; align-items:center; margin-top:14px; }footer span { font-size:12px; color:var(--el-color-warning); }
@media(max-width:760px) { .np-workspace { grid-template-columns:1fr; }nav { display:flex; gap:8px; flex-wrap:wrap; }nav button { width:120px; }.np-prompts { grid-template-columns:1fr; } }
</style>
