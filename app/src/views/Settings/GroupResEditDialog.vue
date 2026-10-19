<script setup lang="ts">
// 系统设置 → 数据权限设置 → 新建 / 编辑规则（短表单，居中弹窗）。
//
// 用户组 ID 是规则的归属：新建时留空由用户自己填（不必先在列表查询组），编辑时跟着原规则走且不可改。
//
// 枚举全部来自 /group-res/meta（文档 §6：前端不要硬编码 resType / action / condType，也不要自拼列名）。
// condType 只放 ID 与 SQL：STRUCT 需要前端拼 condJson，文档未给 condJson 的字段结构，接了会瞎猜
// （后端还允许不填 resCond，猜错就直接落错条件），等后端补契约再接。
//
// 保存前强制调 /group-res/preview 试算（文档 §7 的建议）：试算失败时 success 仍是 true，
// 错误在 data.error；命中 0 条时二次确认——配错最常见就是条件把数据全放开或完全不生效。
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  addGroupRes,
  GROUP_ID_FLOOR,
  idCondError,
  modifyGroupRes,
  previewGroupRes,
  sqlCondError,
  type GroupResMeta,
  type GroupResRule,
} from '@/api/groupRes'

const props = defineProps<{ meta: GroupResMeta | null }>()
const emit = defineEmits<{ saved: [] }>()

const SUPPORTED_COND_TYPES = new Set(['ID', 'SQL'])

const visible = ref(false)
const saving = ref(false)
const editing = ref<GroupResRule | null>(null)
const form = reactive({ groupId: '', action: '', resType: '', condType: 'ID', resCond: '', remarks: '' })

const condTypes = computed(() => (props.meta?.condTypes ?? []).filter((o) => SUPPORTED_COND_TYPES.has(o.key)))
const currentType = computed(() => props.meta?.resTypes.find((t) => t.key === form.resType) ?? null)
/** ID 模式下 resCond 填的就是这一列的值，提示出来省得配错列 */
const hint = computed(() => {
  if (!currentType.value) return '选择内容类型后可填写条件'
  if (form.condType === 'ID') return `命中列 ${currentType.value.idColumn}：填逗号分隔的 ID，如 430001300,430001301`
  return `命中列 ${currentType.value.idColumn}：填 where 之后的条件片段，如 ${currentType.value.idColumn} > 430001300（原样落库，不做转换）`
})

/** 外部调用：传 rule = 编辑（组 ID 跟着规则走，不可改），不传 = 新建（组 ID 留空由用户填） */
function open(rule?: GroupResRule) {
  // STRUCT 规则的条件由 condJson 编译，本轮前端不接（见文件头）：打开编辑会把 condType 改成 ID/SQL，
  // 保存就会覆盖掉后端编译出来的条件，所以直接拒绝，只能在详情抽屉里查看。
  if (rule && !SUPPORTED_COND_TYPES.has(rule.condType)) {
    ElMessage.warning(`条件类型为 ${rule.condType} 的规则暂不支持在此编辑，只能在详情中查看`)
    return
  }
  editing.value = rule ?? null
  Object.assign(form, {
    groupId: rule ? String(rule.groupId) : '',
    action: rule?.action ?? props.meta?.actions[0]?.key ?? '',
    // 默认取 meta 的第一个 resType（少一次下拉选择；枚举仍以 meta 为准，可改）
    resType: rule?.resType ?? props.meta?.resTypes[0]?.key ?? '',
    condType: rule?.condType ?? (condTypes.value[0]?.key ?? 'ID'),
    resCond: rule?.resCond ?? '',
    remarks: rule?.remarks ?? '',
  })
  visible.value = true
}
defineExpose({ open })

/** 提交用的条件内容：ID 模式去掉空格，SQL 模式去首尾空白 */
function normalizedCond(): string {
  return form.condType === 'ID' ? form.resCond.replace(/\s+/g, '') : form.resCond.trim()
}

/** 规则归属的用户组：纯数字且大于 90000（与后端同口径），非法时返回 0 */
const parsedGroupId = computed(() => {
  const text = form.groupId.trim()
  if (!/^\d+$/.test(text)) return 0
  const value = Number(text)
  return value > GROUP_ID_FLOOR ? value : 0
})

function validate(): string | null {
  if (!parsedGroupId.value) return `请输入用户组 ID（必须大于 ${GROUP_ID_FLOOR}）`
  if (!form.action) return '请选择行为（入选 / 排除）'
  if (!form.resType) return '请选择内容类型'
  if (!form.condType) return '请选择条件类型'
  return form.condType === 'ID' ? idCondError(form.resCond) : sqlCondError(form.resCond)
}

async function save() {
  const invalid = validate()
  if (invalid) {
    ElMessage.warning(invalid)
    return
  }
  const resCond = normalizedCond()
  saving.value = true
  try {
    // 试算：success=true 也不代表通过，data.error 才是结论
    const check = await previewGroupRes({ resType: form.resType, condType: form.condType, resCond })
    if (check.error) {
      ElMessage.error(`条件试算未通过：${check.error}`)
      return
    }
    if (check.count === 0) {
      try {
        await ElMessageBox.confirm('该条件当前未命中任何数据，保存后这一组可能看不到相关内容。仍要保存吗？', '提示', {
          confirmButtonText: '仍要保存',
          cancelButtonText: '返回修改',
          type: 'warning',
        })
      } catch {
        return
      }
    }
    const payload = {
      groupId: parsedGroupId.value,
      action: form.action,
      resType: form.resType,
      condType: form.condType,
      resCond,
      remarks: form.remarks.trim() || undefined,
    }
    const isEdit = !!editing.value
    if (isEdit) await modifyGroupRes({ ...payload, id: editing.value!.id })
    else await addGroupRes(payload)
    ElMessage.success(`${isEdit ? '修改' : '新增'}成功，该组权限已立即生效`)
    visible.value = false
    emit('saved')
  } catch (e) {
    ElMessage.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="editing ? `编辑数据权限规则 · ${editing.id}` : '新建数据权限规则'" width="520px" append-to-body destroy-on-close>
    <el-form label-width="96px" size="default" @submit.prevent>
      <el-form-item label="用户组 ID" required>
        <el-input
          v-model="form.groupId"
          :disabled="!!editing"
          placeholder="如 100001"
          data-testid="group-res-rule-group-id"
        />
        <div class="gr-hint">{{ editing ? '规则归属的用户组不可改；要给别的组配规则请关闭后新建' : `规则挂在该用户组下，ID 必须大于 ${GROUP_ID_FLOOR}（内置组不走本表）` }}</div>
      </el-form-item>
      <el-form-item label="行为" required>
        <el-radio-group v-model="form.action" data-testid="group-res-action">
          <el-radio v-for="a in meta?.actions ?? []" :key="a.key" :value="a.key">{{ a.name }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="内容类型" required>
        <el-select v-model="form.resType" placeholder="请选择" data-testid="group-res-restype">
          <el-option v-for="t in meta?.resTypes ?? []" :key="t.key" :label="`${t.name}（${t.key}）`" :value="t.key" />
        </el-select>
      </el-form-item>
      <el-form-item label="条件类型" required>
        <el-radio-group v-model="form.condType" data-testid="group-res-condtype">
          <el-radio v-for="c in condTypes" :key="c.key" :value="c.key">{{ c.name }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="条件内容" required>
        <el-input
          v-model="form.resCond"
          :type="form.condType === 'SQL' ? 'textarea' : 'input'"
          :rows="3"
          data-testid="group-res-rescond"
          :placeholder="form.condType === 'ID' ? '430001300,430001301' : 'CATEGORY_ID IN (9009387,9009388)'"
        />
        <div class="gr-hint">{{ hint }}</div>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remarks" type="textarea" :rows="2" maxlength="200" placeholder="可不填" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" data-testid="group-res-save" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.gr-hint { font-size: 12px; color: var(--rc-muted); line-height: 1.6; }
</style>
