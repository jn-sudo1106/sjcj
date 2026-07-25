<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { siteApi, type Site, type SourceCategory } from '@/api'

const props = defineProps<{
  visible: boolean
  site: Site | null
  categories: SourceCategory[]
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'saved': []
}>()

const saving = ref(false)
const form = reactive({ siteId: '', name: '', categoryPath: '', owner: '' })

const siteCategoryOptions = computed(() => props.categories.flatMap((group) => [
  { path: group.id, label: group.name },
  ...(group.children ?? []).map((child) => ({ path: child.id, label: `${group.name} / ${child.name}` })),
]))

function openEditor(site: Site) {
  Object.assign(form, {
    siteId: site.siteId,
    name: site.name,
    categoryPath: site.categoryPath ?? '',
    owner: site.owner,
  })
  emit('update:visible', true)
}

async function save() {
  const category = form.categoryPath.split('/').filter(Boolean)[0]
  if (!form.name.trim() || !category) {
    ElMessage.warning('请填写网站名称和分类')
    return
  }
  saving.value = true
  try {
    const res = await siteApi.siteUpdate({
      siteId: form.siteId,
      name: form.name,
      category,
      categoryPath: form.categoryPath,
      owner: form.owner,
    })
    if (!res?.ok) throw new Error(res?.message)
    ElMessage.success(res.message || '网站基本信息已保存')
    emit('update:visible', false)
    emit('saved')
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '保存网站基本信息失败')
  } finally {
    saving.value = false
  }
}

defineExpose({ openEditor })
</script>

<template>
  <el-dialog :model-value="visible" class="ca-site-editor" title="编辑网站基本信息" width="520px" align-center destroy-on-close @closed="emit('update:visible', false)" @update:model-value="(v: boolean) => emit('update:visible', v)">
    <div v-if="site" class="ca-site-summary">
      <span>网站 ID：<b>{{ site.siteId }}</b></span><span>子源：<b>{{ site.sourceCount }}</b></span><span>数据量：<b>{{ (site.dataCount ?? 0).toLocaleString() }} 条</b></span>
    </div>
    <el-form class="ca-site-form" label-position="top">
      <el-form-item label="网站名称" required><el-input v-model="form.name" placeholder="请输入网站名称" /></el-form-item>
      <el-form-item label="所属分类" required>
        <el-select v-model="form.categoryPath" filterable placeholder="请选择分类" style="width: 100%"><el-option v-for="option in siteCategoryOptions" :key="option.path" :label="option.label" :value="option.path" /></el-select>
      </el-form-item>
      <el-form-item label="网站负责人"><el-input v-model="form.owner" placeholder="用于网站默认归属，不会批量覆盖子源负责人" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="emit('update:visible', false)">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
  </el-dialog>
</template>

<style scoped>
.ca-site-summary { display: flex; gap: 14px; margin-bottom: 18px; color: var(--rc-faint); font-size: 12px; }
.ca-site-summary b { color: var(--rc-text-2); font-weight: 600; }
.ca-site-form :deep(.el-form-item) { margin-bottom: 16px; }
.ca-site-form :deep(.el-form-item__label) { padding-bottom: 5px; color: var(--rc-text-2); font-size: 12px; line-height: 1.2; }
.ca-site-form :deep(.el-input__wrapper),
.ca-site-form :deep(.el-select__wrapper) { min-height: 34px; border-radius: 6px; box-shadow: 0 0 0 1px var(--rc-border) inset; }
</style>
