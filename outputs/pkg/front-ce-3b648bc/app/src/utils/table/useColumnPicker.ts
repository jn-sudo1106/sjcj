import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  mergeColumnOrder,
  readColumnPrefs,
  writeColumnPrefs,
  type ColumnPrefs,
} from './columnPrefs'

export function useColumnPicker(
  getTableId: () => string,
  getSchemaProps: () => string[],
  options?: {
    scope?: string
    /** 默认只显示这批列（0831 F10「下一步字段」）。用户在本表存过偏好时以偏好为准。 */
    getPresetProps?: () => string[]
  },
): {
  hidden: Ref<Set<string>>
  order: Ref<string[]>
  widths: Ref<Record<string, number>>
  open: Ref<boolean>
  visibleCount: ComputedRef<number>
  presetActive: ComputedRef<boolean>
  apply: (next: ColumnPrefs) => void
  applyPreset: () => void
  showAll: () => void
  setWidth: (prop: string, width: number) => void
  resetWidth: (prop?: string) => void
} {
  const scope = options?.scope ?? 'datagrid'
  const getPreset = options?.getPresetProps ?? (() => [])
  const hidden = ref<Set<string>>(new Set())
  const order = ref<string[]>([])
  const widths = ref<Record<string, number>>({})
  const open = ref(false)

  function presetHidden(schema: string[]): Set<string> {
    const keep = new Set(getPreset().filter((prop) => schema.includes(prop)))
    if (!keep.size) return new Set()
    return new Set(schema.filter((prop) => !keep.has(prop)))
  }

  function reload() {
    const schema = getSchemaProps()
    const saved = readColumnPrefs(getTableId(), scope)
    order.value = mergeColumnOrder(schema, saved?.order)
    const allowed = new Set(schema)
    // 存过偏好就听用户的：预设只是"没表过态时的默认"，不能每次切表都把人手动打开的列又收起来
    hidden.value = saved
      ? new Set((saved.hidden ?? []).filter((prop) => allowed.has(prop)))
      : presetHidden(schema)
    widths.value = saved?.widths ? { ...saved.widths } : {}
  }

  watch(
    () => [getTableId(), getSchemaProps().join('\0'), getPreset().join('\0')] as const,
    reload,
    { immediate: true },
  )

  const visibleCount = computed(() => order.value.filter((prop) => !hidden.value.has(prop)).length)

  const presetActive = computed(() => {
    const preset = getPreset().filter((prop) => order.value.includes(prop))
    if (!preset.length) return false
    const visible = order.value.filter((prop) => !hidden.value.has(prop))
    return visible.length === preset.length && visible.every((prop) => preset.includes(prop))
  })

  function commit(nextHidden: Set<string>, nextOrder = order.value, nextWidths = widths.value) {
    hidden.value = nextHidden
    order.value = nextOrder
    widths.value = nextWidths
    const tableId = getTableId()
    if (tableId) {
      writeColumnPrefs(tableId, {
        hidden: [...nextHidden],
        order: nextOrder,
        ...(Object.keys(nextWidths).length > 0 ? { widths: nextWidths } : {}),
      }, scope)
    }
  }

  function setWidth(prop: string, width: number) {
    const rounded = Math.round(width)
    const next = { ...widths.value, [prop]: rounded }
    commit(hidden.value, order.value, next)
  }

  function resetWidth(prop?: string) {
    const next = { ...widths.value }
    if (prop) {
      delete next[prop]
    } else {
      Object.keys(next).forEach((k) => delete next[k])
    }
    commit(hidden.value, order.value, next)
  }

  function apply(next: ColumnPrefs) {
    const schema = getSchemaProps()
    order.value = mergeColumnOrder(schema, next.order)
    const allowed = new Set(schema)
    commit(
      new Set(next.hidden.filter((prop) => allowed.has(prop))),
      order.value,
      next.widths ?? widths.value,
    )
  }

  function applyPreset() {
    const next = presetHidden(getSchemaProps())
    if (!next.size) return
    commit(next)
  }

  function showAll() {
    commit(new Set())
  }

  return { hidden, order, widths, open, visibleCount, presetActive, apply, applyPreset, showAll, setWidth, resetWidth }
}
