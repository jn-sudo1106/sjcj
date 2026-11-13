<script setup lang="ts">
// 流程中心「改结构守护」弹窗（1109 原型 #frame6 / 方案 §5 F06）。
//
// 在实例画布增加 / 删除 / 改节点类型或连接之前拦住，先把「改的是谁、影响哪些源」说清楚：
// 保护同模板的其它实例 ≠ 保护共用当前实例的源，所以标题和正文都按受影响源数说话。
//
// 三个出口按「是否修改当前实例」命名，不再用含糊的「另存」：
//   ① migrate      修改当前实例并迁移到新模板：实例 ID / 配置 / 源绑定不变，原模板与其它实例不受影响；
//   ② copy-as-new  复制为新实例并另存为新模板：当前实例与这些源保持原状，下一步再选迁哪些源；
//   ③ close        取消修改。
// 这里不发任何请求，也不接 busy 状态——父组件收到 emit 后自己决定请求与关闭时机。
// 结构写请求本身与弹窗打开顺序无关：调用方必须在发结构写请求之前弹这个框（原型 §07 的约束）。
//
// 视觉按项目设计系统：弹窗用 el-dialog（居中短流程确认，符合「详情弹层」约定里 dialog 的定位），
// 影响范围用 el-alert type="warning"，选项用 el-radio-group + el-radio（推荐项配 el-tag success），
// 底部 el-button。颜色只取 var(--rc-*) 与 Element 变量，间距/选中态写在 scoped 的 .sgd-* 里。
// 对外契约不变：visible prop + @close；el-dialog 只认 v-model，用 computed 桥接。
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  instanceName: string
  affectedSourceCount: number
  /** 其中多少个源把该实例设为默认流程；没传就不显示这一项 */
  defaultSourceCount?: number
}>()
const emit = defineEmits<{ close: []; migrate: []; 'copy-as-new': []; 'view-sources': [] }>()

type GuardChoice = 'migrate' | 'copy-as-new' | 'cancel'

/** 默认不选：「继续」保持禁用，必须先明确改的是谁 */
const picked = ref<GuardChoice | ''>('')
const defaultCount = computed(() => props.defaultSourceCount ?? null)

/** el-dialog 的 v-model 桥：关闭统一走 close，不直接改 props */
const open = computed({
  get: () => props.visible,
  set: (value: boolean) => {
    if (!value) close()
  },
})

const options = computed<Array<{ value: GuardChoice; label: string; recommend: boolean; hint: string }>>(() => [
  {
    value: 'migrate',
    label: '修改当前实例并迁移到新模板',
    recommend: true,
    hint: '实例 ID 与源绑定不变，原模板留存不变',
  },
  {
    value: 'copy-as-new',
    label: '复制为新实例并另存为新模板',
    recommend: false,
    hint: `当前实例与这 ${props.affectedSourceCount} 个源保持原状；新实例另存为新模板，可在下一步勾选要把哪些源迁过去（未选的源仍绑原实例）。`,
  },
  {
    value: 'cancel',
    label: '取消修改',
    recommend: false,
    hint: '回到画布，撤销未保存的结构改动，继续按原模板编辑。',
  },
])

function close() {
  emit('close')
}

/** el-radio-group 的 update:modelValue 是宽类型（string | number | boolean | undefined），这里收窄回三选一 */
function onPick(value: string | number | boolean | undefined) {
  picked.value = value === 'migrate' || value === 'copy-as-new' || value === 'cancel' ? value : ''
}

/** 「继续」按当前选择分流；③ 取消修改等价于关闭，不产生结构写请求 */
function proceed() {
  if (picked.value === 'migrate') emit('migrate')
  else if (picked.value === 'copy-as-new') emit('copy-as-new')
  else if (picked.value === 'cancel') close()
}

// 每次打开都从「未选」开始，避免上一次的选择残留成下一次的默认动作
watch(
  () => props.visible,
  () => {
    picked.value = ''
  },
  { immediate: true },
)
</script>

<template>
  <el-dialog
    v-model="open"
    class="sgd-dialog"
    title="改结构守护"
    width="560px"
    append-to-body
    :close-on-click-modal="false"
  >
    <div class="sgd-body" data-testid="structure-guard-dialog">
      <h3 class="sgd-title" data-testid="guard-title">
        改结构会修改当前实例：影响 <b>{{ affectedSourceCount }}</b> 个源
      </h3>
      <p class="sgd-copy">
        「{{ instanceName }}」的结构修改会立刻作用于这 {{ affectedSourceCount }} 个源；同模板其它实例不受影响。
        <template v-if="defaultCount != null">其中 {{ defaultCount }} 个源把该实例设为默认流程。</template>
        请先确认要改的对象——保护同模板的其它实例，不等于保护共用当前实例的这些源。
      </p>

      <!-- 影响范围：按源数说话，清单入口留给父组件打开受影响源列表 -->
      <el-alert class="sgd-scope" type="warning" :closable="false" show-icon>
        <div class="sgd-scope-line">
          受影响源 <b>{{ affectedSourceCount }}</b> 个<span v-if="defaultCount != null"> · 默认流程 <b>{{ defaultCount }}</b> 个</span> ·
          <el-button
            class="sgd-scope-link"
            link
            type="primary"
            size="small"
            data-testid="guard-view-sources"
            @click="emit('view-sources')"
          >查看受影响源清单</el-button>
        </div>
      </el-alert>

      <div class="sgd-sec-title">改结构方式</div>
      <!-- 不用 v-model 直接绑 picked：el-radio-group 的值是宽联合类型，会让 vue-tsc 报窄化错误 -->
      <el-radio-group
        class="opts sgd-opts"
        :model-value="picked"
        aria-label="改结构方式"
        @update:model-value="onPick"
      >
        <el-radio
          v-for="option in options"
          :key="option.value"
          class="opt sgd-opt"
          :value="option.value"
          data-testid="guard-option"
        >
          <span :data-testid="`guard-choice-${option.value}`" class="sgd-opt-tx">
            <span class="sgd-opt-head">
              <span class="sgd-opt-label">{{ option.label }}</span>
              <el-tag v-if="option.recommend" class="sgd-pill" type="success" size="small" effect="plain">推荐</el-tag>
            </span>
            <small class="sgd-opt-hint">{{ option.hint }}</small>
          </span>
        </el-radio>
      </el-radio-group>
    </div>

    <template #footer>
      <div class="sgd-foot rc-actions">
        <el-button data-testid="guard-cancel" @click="close">取消</el-button>
        <el-button type="primary" data-testid="guard-continue" :disabled="!picked" @click="proceed">继续</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.sgd-body { display: flex; flex-direction: column; font-size: 12px; }

.sgd-title { margin: 0 0 8px; color: var(--rc-text); font-size: 14px; font-weight: 700; line-height: 1.45; }
.sgd-title b { color: var(--rc-warn); font-weight: 700; }
.sgd-copy { margin: 0 0 12px; color: var(--rc-text-2); font-size: 12px; line-height: 1.7; }

/* 影响范围：el-alert 只负责底色与竖条，内部行距自己压紧 */
.sgd-scope { margin-bottom: 14px; }
.sgd-scope-line { color: var(--rc-text-2); font-size: 12px; line-height: 1.7; }
.sgd-scope-line b { color: var(--rc-warn); font-weight: 700; }
.sgd-scope-link { padding: 0; vertical-align: baseline; font-size: 12px; }

.sgd-sec-title { margin: 0 0 8px; color: var(--rc-text-2); font-size: 12px; font-weight: 700; }

.sgd-opts { display: flex; flex-direction: column; gap: 8px; }

/* el-radio 默认是 32px 行高的 inline 项，这里改成整块可点的选项卡 */
.sgd-opt {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  height: auto;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--rc-border);
  border-radius: 8px;
  background: var(--rc-surface);
  transition: border-color 0.15s ease, background-color 0.15s ease;
  white-space: normal;
}
.sgd-opt:hover { border-color: var(--rc-primary); }
.sgd-opt.is-checked { border-color: var(--rc-primary); background: var(--rc-primary-bg); }
.sgd-opt :deep(.el-radio__input) { margin-top: 1px; flex: none; }
.sgd-opt :deep(.el-radio__label) { min-width: 0; padding-left: 0; color: var(--rc-text); font-size: 12px; line-height: 1.5; }
.sgd-opt.is-checked :deep(.el-radio__label) { color: var(--rc-text); }

.sgd-opt-tx { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.sgd-opt-head { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.sgd-opt-label { color: var(--rc-text); font-size: 13px; font-weight: 700; line-height: 1.4; }
.sgd-opt-hint { color: var(--rc-muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.sgd-pill { flex: none; }

.sgd-foot { justify-content: flex-end; }
</style>