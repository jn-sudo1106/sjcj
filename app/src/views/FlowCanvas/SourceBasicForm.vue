<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { configApi, sourceApi, type Config, type CredentialRef, type Source } from '../../api'

// 源基础信息表单（0706 优化·Phase3）：新建源闸门段与 Phase4 源信息编辑抽屉共用同一份字段与交互。
// 必填区（源ID/名称/分类）始终展示；URL 为选填（0707 微调）；标签/代理/选用配置/登录/定时等源级选填项收在「更多设置」折叠区默认收起。
// 0707 优化·补：showIdentity=false 时隐藏源ID/源名称/源URL（这三个是逐子源填的，不适合当"默认值"复用）——
// 供"新建采集"闸门的「子源默认设置」区复用同一套字段（分类/标签/代理/选用配置/登录/定时），批量套给本批子源。
// withDefaults 显式给 showIdentity 兜底 true：Vue 对 TS 字面量声明的可选 boolean prop 有个隐藏规则——
// 不传时运行时直接落 false（不是 undefined），`showIdentity !== false` 这种判断式不显式兜底会全线误判为"隐藏"。
const props = withDefaults(
  defineProps<{ modelValue: Source; sourceIdEditable?: boolean; showIdentity?: boolean; defaultOpen?: boolean }>(),
  { showIdentity: true, defaultOpen: false },
)
const emit = defineEmits<{ 'update:modelValue': [v: Source] }>()

const moreOpen = ref(!!props.defaultOpen)
const configs = ref<Config[]>([])
const cred = ref<CredentialRef | null>(null)
const WEEKDAYS: [number, string][] = [[1, '周一'], [2, '周二'], [3, '周三'], [4, '周四'], [5, '周五'], [6, '周六'], [7, '周日']]
const DIR_OPTIONS = [
  { dirId: '9008845', category: '数据采集', categoryPath: '/数据采集', label: '＋ 9008845 数据采集' },
  { dirId: '9009001', category: '研报', categoryPath: '/数据采集/研报', label: '　＋ 9009001 研报' },
  { dirId: '9009245', category: '公告', categoryPath: '/数据采集/公告/交易所/列表', label: '　└ 9009245 公告 / 交易所 / 列表' },
  { dirId: '9009302', category: '新闻舆情', categoryPath: '/数据采集/新闻/舆情', label: '　└ 9009302 新闻 / 舆情' },
]

onMounted(async () => {
  configs.value = (await configApi.configPaged({ size: 100 })).list
})
watch(
  () => props.modelValue.credentialRef,
  async (refId) => {
    cred.value = refId ? await sourceApi.credentialRef(refId) : null
  },
  { immediate: true },
)

function patch(p: Partial<Source>) {
  emit('update:modelValue', { ...props.modelValue, ...p })
}
function onInput(key: keyof Source, e: Event) {
  patch({ [key]: (e.target as HTMLInputElement).value } as Partial<Source>)
}
function onCheck(key: keyof Source, e: Event) {
  patch({ [key]: (e.target as HTMLInputElement).checked } as Partial<Source>)
}
function onTagsChange(e: Event) {
  patch({ tags: (e.target as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean) })
}
function toggleWeekday(d: number) {
  const cur = props.modelValue.weekdays ?? []
  patch({ weekdays: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort() })
}
function pickDir(dir: (typeof DIR_OPTIONS)[number]) {
  patch({ dirId: dir.dirId, category: dir.category, categoryPath: dir.categoryPath })
}
</script>

<template>
  <div class="sbf">
    <template v-if="showIdentity">
      <div class="rc-field"><label>源 ID{{ sourceIdEditable === false ? '' : '（创建后不可修改）' }}</label>
        <input class="rc-input" :disabled="sourceIdEditable === false" :value="modelValue.sourceId" @input="onInput('sourceId', $event)" placeholder="必填" />
      </div>
      <div class="rc-field"><label>源名称</label><input class="rc-input" :value="modelValue.name" @input="onInput('name', $event)" placeholder="必填" /></div>
      <div class="rc-field"><label>源 URL</label><input class="rc-input" :value="modelValue.url" @input="onInput('url', $event)" placeholder="选填" /></div>
      <div class="rc-field"><label>分类</label>
        <div class="rc-dir-picker">
          <div class="rc-dir-top">
            <input class="rc-input slim" :value="modelValue.dirId" @input="onInput('dirId', $event)" placeholder="目录 ID" />
            <input class="rc-input slim" :value="modelValue.category" @input="onInput('category', $event)" placeholder="目录名（必填）" />
          </div>
          <div class="rc-dir-tree">
            <button
              v-for="dir in DIR_OPTIONS"
              :key="dir.dirId"
              type="button"
              class="rc-dir-node"
              :class="{ active: modelValue.dirId === dir.dirId }"
              @click="pickDir(dir)"
            >{{ dir.label }}</button>
          </div>
        </div>
      </div>
    </template>

    <button class="sbf-more-toggle" type="button" @click="moreOpen = !moreOpen">
      {{ moreOpen ? '▾' : '▸' }} 更多设置（{{ showIdentity ? '标签 / ' : '' }}代理 / 选用配置 / 登录 / 定时）
    </button>
    <div v-if="moreOpen" class="sbf-more-body">
      <div v-if="showIdentity" class="rc-field"><label>标签</label><input class="rc-input" :value="(modelValue.tags ?? []).join(', ')" @input="onTagsChange" /></div>
      <div class="rc-field"><label>核心参数</label>
        <div class="rc-checks">
          <label class="rc-check"><input type="checkbox" :checked="modelValue.useProxy" @change="onCheck('useProxy', $event)" /> 使用代理</label>
          <label class="rc-check"><input type="checkbox" :checked="modelValue.resume" @change="onCheck('resume', $event)" /> 断点续爬</label>
        </div>
      </div>
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
      <div class="rc-field"><label>是否要求登陆</label>
        <div class="rc-segment">
          <button type="button" :class="{ active: !modelValue.needLogin }" @click="patch({ needLogin: false })">不登陆</button>
          <button type="button" :class="{ active: modelValue.needLogin }" @click="patch({ needLogin: true })">要求登陆</button>
        </div>
      </div>
      <template v-if="modelValue.needLogin">
        <div class="rc-field"><label>登陆URL</label><input class="rc-input" :value="modelValue.loginUrl" @input="onInput('loginUrl', $event)" /></div>
        <div class="rc-field"><label>登陆用户名</label><input class="rc-input" :value="modelValue.account" @input="onInput('account', $event)" /></div>
        <div class="rc-field"><label>登录凭据（只存引用，明文不回显）</label>
          <div class="rc-cred">
            <span v-if="cred">{{ cred.name }} · {{ cred.account }}</span>
            <span v-else class="rc-cred-empty">未绑定凭据</span>
          </div>
        </div>
      </template>
      <div class="rc-field"><label>定时策略（仅作用于首节点）</label>
        <div class="rc-scheduler">
          <div class="rc-scheduler-head">
            <select class="rc-select" :value="modelValue.scheduleType" @change="onInput('scheduleType', $event)">
              <option v-for="s in ['交易日定时', '每天', '每小时', '每周', '自定义 cron']" :key="s" :value="s">{{ s }}</option>
            </select>
            <input class="rc-input" type="time" :value="modelValue.scheduleTime" @input="onInput('scheduleTime', $event)" />
          </div>
          <div class="rc-weekdays">
            <span v-for="[d, label] in WEEKDAYS" :key="d" class="rc-day" :class="{ active: (modelValue.weekdays ?? []).includes(d) }" @click="toggleWeekday(d)">{{ label }}</span>
          </div>
          <div class="rc-cron-preview"><span>cron 表达式</span><input class="rc-input slim cron" :value="modelValue.cron" @input="onInput('cron', $event)" /></div>
        </div>
      </div>
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
.rc-input.slim { height: 30px; padding: 0 9px; }
.rc-input.cron { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

.rc-checks { display: flex; gap: 16px; padding: 4px 0; }
.rc-check { display: inline-flex; align-items: center; gap: 6px; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }

.rc-segment { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; background: #fff; }
.rc-segment button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 7px 10px; font-size: 12px; cursor: pointer; }
.rc-segment button:first-child { border-left: 0; }
.rc-segment button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }

.rc-dir-picker { border: 1px solid #dbe3ee; border-radius: 8px; overflow: hidden; background: #fff; }
.rc-dir-top { display: flex; align-items: center; gap: 6px; padding: 7px; border-bottom: 1px solid #eef2f7; background: #fbfdff; }
.rc-dir-tree { max-height: 104px; overflow: auto; padding: 6px 8px; color: var(--rc-text-2); font-size: 11px; line-height: 1.9; }
.rc-dir-node { display: block; width: 100%; border: 0; background: transparent; color: var(--rc-text-2); font: inherit; line-height: 1.9; text-align: left; cursor: pointer; border-radius: 5px; padding: 0 4px; }
.rc-dir-node:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-dir-node.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 700; }

.rc-scheduler { border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; overflow: hidden; }
.rc-scheduler-head { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px; border-bottom: 1px solid #eef2f7; background: #fbfdff; }
.rc-weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; padding: 8px; }
.rc-day { display: flex; align-items: center; justify-content: center; height: 26px; border: 1px solid var(--rc-border); border-radius: 6px; color: var(--rc-muted); background: #fff; font-size: 10px; cursor: pointer; }
.rc-day.active { border-color: #93c5fd; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 700; }
.rc-cron-preview { display: flex; align-items: center; gap: 8px; padding: 8px; border-top: 1px solid #eef2f7; background: #fff; }
.rc-cron-preview span { color: var(--rc-muted); font-size: 11px; flex: none; }

.rc-cred { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border: 1px solid #dbe3ee; border-radius: 7px; background: #f8fafc; font-size: 12px; color: var(--rc-text-2); }
.rc-cred-empty { color: var(--rc-faint); }
</style>
