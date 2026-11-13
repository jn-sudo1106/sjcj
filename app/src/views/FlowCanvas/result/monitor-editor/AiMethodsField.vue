<script setup lang="ts">
import { computed, ref } from 'vue'
import { METHOD_GROUPS, isKnownMethod, methodLabel } from '@/utils/monitor/methods'

/**
 * 监控方法分组多选（8 类，METHOD_GROUPS）。
 *
 * 为什么不用 el-select 多选：24 个方法分属 8 类，平铺下拉无法表达分组，
 * 也无法让用户看到「已选方法」这一层（原型 R09 要求业务描述 → 已选方法 → 折叠目录）。
 */
const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const selected = computed(() => props.modelValue ?? [])
const dirOpen = ref(false)
const totalMethods = computed(() => METHOD_GROUPS.reduce((sum, group) => sum + group.methods.length, 0))
const unknownSelected = computed(() => selected.value.filter((code) => !isKnownMethod(code)))

function isOn(code: string): boolean {
  return selected.value.includes(code)
}

function toggle(code: string): void {
  const next = isOn(code) ? selected.value.filter((item) => item !== code) : [...selected.value, code]
  emit('update:modelValue', next)
}

function remove(code: string): void {
  emit('update:modelValue', selected.value.filter((item) => item !== code))
}
</script>

<template>
  <div class="mc-methods">
    <div class="mc-field-head">
      <span class="mc-label">已选方法 <em>*</em></span>
      <span class="mc-hint" data-testid="mc-method-count">已选 {{ selected.length }} 项 · 每项独立检查</span>
    </div>

    <div v-if="selected.length" class="mc-chips" data-testid="mc-method-chips">
      <span v-for="code in selected" :key="code" class="mc-chip">
        {{ methodLabel(code) }}
        <button type="button" class="mc-chip-remove" :aria-label="`移除 ${methodLabel(code)}`" @click="remove(code)">×</button>
      </span>
    </div>
    <p v-else class="mc-hint">尚未选择方法，可在下方目录选。</p>

    <div v-if="unknownSelected.length" class="mc-hint" data-testid="mc-method-legacy">
      旧记录里的未识别方法：{{ unknownSelected.join('、') }}（原样保留，不再展示分类）
    </div>

    <button type="button" class="mc-dir-toggle" data-testid="mc-method-dir-toggle" @click="dirOpen = !dirOpen">
      {{ dirOpen ? '收起方法目录' : `方法目录（${totalMethods} 项，按 8 类；其中 1 项为旧平台别名保留）` }}
    </button>

    <div v-show="dirOpen" class="mc-method-groups">
      <div
        v-for="group in METHOD_GROUPS"
        :key="group.key"
        class="mc-method-group"
        :data-testid="`mc-method-group-${group.key}`"
      >
        <div class="mc-method-group-title">
          {{ group.label }}
          <span class="mc-faint">{{ group.methods.length }} 项</span>
        </div>
        <div class="mc-method-grid">
          <label
            v-for="method in group.methods"
            :key="method.code"
            class="mc-method-option"
            :title="method.hint"
          >
            <input
              type="checkbox"
              :data-testid="`mc-method-${method.code}`"
              :checked="isOn(method.code)"
              @change="toggle(method.code)"
            >
            <span>{{ method.label }}</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mc-label { color: var(--rc-text); font-size: 12px; font-weight: 600; }
.mc-label em { color: var(--rc-error); font-style: normal; }
.mc-hint, .mc-faint { margin: 0; font-size: 11px; color: var(--rc-muted); line-height: 1.6; }

.mc-methods {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.mc-field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.mc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--rc-primary);
  color: #fff;
  font-size: 12px;
}

.mc-chip-remove {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 1px;
}

.mc-dir-toggle {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: var(--rc-primary);
  font-size: 12.5px;
  padding: 2px 0;
  cursor: pointer;
}

.mc-dir-toggle:hover {
  text-decoration: underline;
}

.mc-method-groups {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.mc-method-group {
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius-sm, 6px);
  background: #fff;
}

.mc-method-group-title {
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--rc-text, #0f172a);
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.mc-method-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;
  padding: 0 10px 10px;
}

.mc-method-option {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  color: var(--rc-text-2, #475569);
  cursor: pointer;
}

.mc-method-option span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .mc-method-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>