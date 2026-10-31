<script setup lang="ts">
// 源数据权限「范围面板」：把一个 Grant（整目录 + 单源）渲染成标签，供可见/排除两个 tab 复用同一套。
// 面板只展示与就地移除，编辑走父级打开的选择器弹窗；落库由父级调 groupSourceScope 服务。
import { reactive, watch } from 'vue'
import { sourceApi } from '@/api'
import type { SourceGrant } from '@/api/groupSourceScope'

const props = defineProps<{ grant: SourceGrant; kind: 'accept' | 'reject' }>()
const emit = defineEmits<{ edit: []; update: [g: SourceGrant] }>()

// CATEGORY_ID → 名称（面板没有整棵树，逐个 categoryById 解析，数量小、带缓存）
const dirNames = reactive<Record<string, string>>({})
const pending = new Set<string>()
async function ensureName(id: string) {
  if (dirNames[id] || pending.has(id)) return
  pending.add(id)
  try {
    const c = await sourceApi.categoryById(id)
    if (c) dirNames[id] = c.name
  } catch {
    // 解析不到就显示裸 ID
  } finally {
    pending.delete(id)
  }
}
watch(() => props.grant.dirIds, (ids) => ids.forEach(ensureName), { immediate: true })

function removeDir(id: string) {
  emit('update', { ...props.grant, dirIds: props.grant.dirIds.filter((i) => i !== id) })
}
function clearSrcs() {
  emit('update', { ...props.grant, sourceIds: [] })
}
</script>

<template>
  <div class="ssp-panel">
    <div class="ssp-panel-head">
      <span class="ssp-panel-title">
        <span class="ssp-dot" :class="kind"></span>
        {{ kind === 'accept' ? '可见范围（ACCEPT）' : '排除范围（REJECT）' }}
      </span>
      <el-button size="small" @click="emit('edit')">编辑</el-button>
    </div>
    <div class="ssp-panel-hint">
      整目录 {{ grant.dirIds.length }} 个（SOURCE/STRUCT · CATEGORY_ID IN 展开后代） · 单源 {{ grant.sourceIds.length }} 个（SOURCE/ID）
    </div>
    <div class="ssp-panel-body">
      <span v-if="!grant.dirIds.length && !grant.sourceIds.length" class="ssp-empty">
        {{ kind === 'accept' ? '未配置（默认不可见）' : '无排除项' }}
      </span>
      <span v-for="id in grant.dirIds" :key="`d${id}`" class="ssp-tag" :class="kind">
        📁 {{ dirNames[id] || id }}<span class="ssp-sub">整目录·含子级</span>
        <i class="ssp-x" @click="removeDir(id)">×</i>
      </span>
      <span v-if="grant.sourceIds.length" class="ssp-tag ssp-tag-src" :class="kind">
        📄 单源 · {{ grant.sourceIds.length }} 个<span class="ssp-sub">在弹窗内逐个增删</span>
        <i class="ssp-x" @click="clearSrcs">×</i>
      </span>
    </div>
  </div>
</template>

<style scoped>
.ssp-panel { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
.ssp-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.ssp-panel-title { font-weight: 600; font-size: 13px; }
.ssp-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.ssp-dot.accept { background: #16a34a; }
.ssp-dot.reject { background: #dc2626; }
.ssp-panel-hint { font-size: 11px; color: #94a3b8; padding: 8px 14px 0; }
.ssp-panel-body { padding: 14px; display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; min-height: 120px; }
.ssp-empty { color: #94a3b8; font-size: 12px; }
.ssp-tag { display: inline-flex; align-items: center; gap: 6px; background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; border-radius: 6px; padding: 5px 9px; font-size: 12px; }
.ssp-tag.reject { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }
.ssp-tag-src { background: #ecfdf5; border-color: #a7f3d0; color: #15803d; }
.ssp-sub { color: #64748b; font-size: 11px; }
.ssp-x { cursor: pointer; font-style: normal; font-weight: 700; opacity: .6; }
.ssp-x:hover { opacity: 1; }
</style>
