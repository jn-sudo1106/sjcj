<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { configApi, type Config, type Source } from '../../api'

// 源基础信息表单（0706 优化·Phase3）：新建源闸门段与 Phase4 源信息编辑抽屉共用同一份字段与交互。
// 必填区（源ID/名称/分类）始终展示；URL 为选填（0707 微调）；标签/选用配置等源级选填项收在「更多设置」折叠区默认收起。
// 0707 优化·补：showIdentity=false 时隐藏源ID/源名称/源URL（这三个是逐子源填的，不适合当"默认值"复用）——
// 供"新建采集"闸门的「子源默认设置」区复用同一套字段，批量套给本批子源。
// withDefaults 显式给 showIdentity 兜底 true：Vue 对 TS 字面量声明的可选 boolean prop 有个隐藏规则——
// 不传时运行时直接落 false（不是 undefined），`showIdentity !== false` 这种判断式不显式兜底会全线误判为"隐藏"。
// 0711 R5：代理/断点续爬/登录已从这里迁到 CollectorSettings.vue（节点级配置），本组件不再展示这几项。
const props = withDefaults(defineProps<{ modelValue: Source; defaultOpen?: boolean }>(), { defaultOpen: false })
const emit = defineEmits<{ 'update:modelValue': [v: Source] }>()

const moreOpen = ref(!!props.defaultOpen)
const configs = ref<Config[]>([])

onMounted(async () => {
  configs.value = (await configApi.configPaged({ size: 100 })).list
})

function patch(p: Partial<Source>) {
  emit('update:modelValue', { ...props.modelValue, ...p })
}
function onInput(key: keyof Source, e: Event) {
  patch({ [key]: (e.target as HTMLInputElement).value } as Partial<Source>)
}
</script>

<template>
  <div class="sbf">
    <div class="rc-field"><label>源名称</label><input class="rc-input" :value="modelValue.name" @input="onInput('name', $event)" placeholder="必填" /></div>
    <div class="rc-field"><label>源 URL</label><input class="rc-input" :value="modelValue.url" @input="onInput('url', $event)" placeholder="选填" /></div>

    <button class="sbf-more-toggle" type="button" @click="moreOpen = !moreOpen">
      {{ moreOpen ? '▾' : '▸' }} 更多设置（选用配置）
    </button>
    <div v-if="moreOpen" class="sbf-more-body">
      <div class="rc-field"><label>选用配置</label>
        <div class="rc-segment">
          <button type="button" :class="{ active: modelValue.configMode === 'new' }" @click="patch({ configMode: 'new' })">新建配置</button>
          <button type="button" :class="{ active: modelValue.configMode === 'existing' }" @click="patch({ configMode: 'existing' })">使用已有配置</button>
        </div>
      </div>
      <div v-if="modelValue.configMode === 'existing'" class="rc-field"><label>使用配置</label>
        <select class="rc-select" :value="modelValue.configId" @change="onInput('configId', $event)">
          <option v-for="c in configs" :key="c.configId" :value="c.configId">{{ c.configId }} · {{ c.name }}</option>
        </select>
      </div>
      <template v-else>
        <div class="rc-field"><label>配置名称</label><input class="rc-input" :value="modelValue.configName" @input="onInput('configName', $event)" placeholder="例如：交易所公告列表配置" /></div>
        <div class="rc-field"><label>Topic</label><input class="rc-input" :value="modelValue.configTopic" @input="onInput('configTopic', $event)" placeholder="例如：announcement.list" /></div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sbf-more-toggle { display: block; margin-top: 4px; border: 0; background: transparent; color: var(--rc-muted); font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px 0; }
.sbf-more-toggle:hover { color: var(--rc-primary-ink); }
.sbf-more-body { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--rc-border-soft); }

.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-input:disabled { background: #f8fafc; color: var(--rc-faint); }

.rc-segment { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; background: #fff; }
.rc-segment button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 7px 10px; font-size: 12px; cursor: pointer; }
.rc-segment button:first-child { border-left: 0; }
.rc-segment button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }

</style>
