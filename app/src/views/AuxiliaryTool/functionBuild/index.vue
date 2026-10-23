<script setup lang="ts">
// 函数工具 —— 1:1 迁移旧 data-view `src/page/install/FunctionBuild.vue`（旧路由 /install/function-build）。
//
// 旧页面全貌：
//   顶部一条 warning 提示（表达式里怎么用上下文变量）
//   左半屏：a-tabs tab-position="left" 五个分组（核心结构 / 自定义函数 / 字符串操作 / 数学函数 /
//           系统常量），每个分组是一串整宽主按钮；点按钮 = 一键填好示例
//   右半屏：绿色底卡片，五行输入 —— 当前值[value] / 上下文[Map] / 表达式 + [计算] / 结果 / 函数说明
//   计算走 POST /v1/comm/exp { value, rule, env }（api/exp.ts）
//
// 点按钮的填充规则（旧 setRule，逐条对齐）：
//   · value ← preset.demo
//   · rule  ← preset.exp
//   · desc  ← preset.desc（preset.more 存在时用 more —— 这五个数组里没有 more，属死分支，不迁）
//   · env   ← preset.env 有值就用它；否则 `JSON.stringify({ value: demo })`
//
// 有意偏差：
//   1. 结果展示：旧版 `JSON.stringify(res)` 直接把整层信封（{code,msg,data}）塞进「结果」框，
//      看着像调试输出。新版取 data（见 api/exp.ts 的 expResultText），文档里写了。
//   2. 旧版「结果」框可编辑但改了没用（值由计算覆盖）；这里改成 readonly，避免让人以为能改。
//   3. 旧版 a-tab-pane 的 key 是 '1'..'5'，这里换成有语义的 key（core/string/…），纯内部标识。
import { ref } from 'vue'
import { ElNotification } from 'element-plus'
import { checkExp, expResultText } from '@/api/exp'
import { FN_GROUPS, FN_NOTICE, type FnPreset } from './presets'

defineOptions({ name: 'FunctionBuild' })

const activeGroup = ref<string>(FN_GROUPS[0]?.key ?? 'core')
const value = ref('abcdef')
const env = ref('')
const rule = ref('')
const result = ref('')
const desc = ref('暂无')
const loading = ref(false)

/** 旧 setRule：一键填示例 */
function setRule(preset: FnPreset) {
  value.value = String(preset.demo ?? '')
  rule.value = preset.exp
  desc.value = preset.desc
  env.value = preset.env ? preset.env : JSON.stringify({ value: preset.demo })
}

/** 旧 handleCheck：把当前三件套发给后端算一次 */
async function handleCheck() {
  loading.value = true
  try {
    const res = await checkExp(value.value, rule.value, env.value)
    result.value = expResultText(res)
  } catch (error) {
    ElNotification.error({
      title: '处理失败',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="fb-shell">
    <el-alert type="warning" :closable="false" :title="FN_NOTICE" class="fb-notice" />

    <div class="fb-body">
      <!-- 左：五个分组，tab 在左、按钮整宽（对齐旧 a-tabs tab-position="left" + block 按钮） -->
      <el-tabs v-model="activeGroup" tab-position="left" class="fb-tabs">
        <el-tab-pane v-for="group in FN_GROUPS" :key="group.key" :label="group.label" :name="group.key">
          <div class="fb-list">
            <el-button
              v-for="preset in group.items"
              :key="preset.name"
              type="primary"
              class="fb-item"
              @click="setRule(preset)"
            >
              {{ preset.name }}
            </el-button>
          </div>
        </el-tab-pane>
      </el-tabs>

      <!-- 右：参数面板（旧版是 #f6ffed 绿底卡片） -->
      <div class="fb-panel">
        <div class="fb-row">
          <div class="fb-label">当前值[value]</div>
          <el-input v-model="value" placeholder="值" />
        </div>
        <div class="fb-row">
          <div class="fb-label">上下文[Map]</div>
          <el-input v-model="env" type="textarea" :rows="4" placeholder="上下文" />
        </div>
        <div class="fb-row">
          <div class="fb-label">表达式</div>
          <div class="fb-rule">
            <el-input v-model="rule" type="textarea" :rows="5" placeholder="表达式" />
            <el-button type="primary" :loading="loading" class="fb-calc" @click="handleCheck">计算</el-button>
          </div>
        </div>
        <div class="fb-row">
          <div class="fb-label">结果</div>
          <el-input v-model="result" placeholder="结果" readonly />
        </div>
        <div class="fb-row">
          <div class="fb-label">函数说明</div>
          <el-alert type="info" :closable="false" :title="desc" class="fb-desc" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fb-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.fb-notice :deep(.el-alert__title) {
  font-size: 12px;
  line-height: 1.6;
}
.fb-body {
  display: grid;
  grid-template-columns: minmax(320px, 10fr) minmax(0, 14fr);
  gap: 12px;
  align-items: start;
}
/* 旧版左列是 a-tabs tab-position="left"，这里保持同一种浏览方式 */
.fb-tabs {
  min-height: 420px;
}
.fb-tabs :deep(.el-tabs__header) {
  margin-right: 8px;
}
.fb-tabs :deep(.el-tabs__item) {
  height: 40px;
  font-size: 13px;
}
.fb-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 2px 4px 2px 8px;
  max-height: 520px;
  overflow: auto;
}
.fb-item {
  width: 100%;
  height: auto;
  min-height: 32px;
  padding: 6px 10px;
  white-space: normal;
  text-align: left;
  line-height: 1.4;
  font-size: 12px;
}
.fb-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  border-radius: var(--rc-radius, 8px);
}
.fb-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.fb-label {
  padding-top: 6px;
  color: var(--rc-text-2, #475569);
  font-size: 12px;
}
.fb-rule {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px;
  gap: 8px;
  align-items: start;
}
.fb-calc {
  height: 34px;
}
.fb-desc :deep(.el-alert__title) {
  font-size: 12px;
  line-height: 1.6;
}
@media (max-width: 1100px) {
  .fb-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
