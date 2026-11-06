<script setup lang="ts">
// 系统设置 → 数据权限设置 → 新建 / 编辑规则（短表单，居中弹窗）。
//
// 用户组 ID 是规则的归属：新建时留空由用户自己填（不必先在列表查询组），编辑时跟着原规则走且不可改。
//
// 枚举全部来自 /group-res/meta（文档 §6：前端不要硬编码 resType / action / condType，也不要自拼列名）。
// condType 只放 ID 与 STRUCT（2026-10-28 定档 D2②：SQL 档下线）——存量 SQL 规则只能在详情里查看，
// 要改就新建 ID/STRUCT 规则替代；STRUCT 契约见接口文档 §2.2，提交只传 condJson，resCond 由后端编译。
//
// 保存前强制调 /group-res/preview 试算（文档 §7 的建议）：试算失败时 success 仍是 true，
// 错误在 data.error；命中 0 条时二次确认——配错最常见就是条件把数据全放开或完全不生效。
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOpened } from '@element-plus/icons-vue'
import {
  addGroupRes,
  condItemsError,
  GROUP_ID_FLOOR,
  idCondError,
  modifyGroupRes,
  parseCondJson,
  previewGroupRes,
  stringifyCondJson,
  type GroupResCondItem,
  type GroupResMeta,
  type GroupResRule,
} from '@/api/groupRes'
import { getSysUserGroupOptions, type SysUserGroupOption } from '@/api/sysUser'
import StructCondEditor from './groupRes/StructCondEditor.vue'
import CondValueInput from './groupRes/CondValueInput.vue'

const props = defineProps<{ meta: GroupResMeta | null }>()
const emit = defineEmits<{ saved: [] }>()

const SUPPORTED_COND_TYPES = new Set(['ID', 'STRUCT'])

const visible = ref(false)
const saving = ref(false)
const editing = ref<GroupResRule | null>(null)
const form = reactive({ groupId: '', action: '', resType: '', condType: 'ID', resCond: '', remarks: '' })
/** STRUCT 模式的条件行（condJson 的编辑态）；其他模式不用 */
const condItems = ref<GroupResCondItem[]>([])
const groupOptions = ref<SysUserGroupOption[]>([])

async function loadGroupOptions() {
  try {
    const list = await getSysUserGroupOptions()
    groupOptions.value = list.filter((g) => g.id > GROUP_ID_FLOOR)
  } catch {
    // 忽略
  }
}

const condTypes = computed(() => (props.meta?.condTypes ?? []).filter((o) => SUPPORTED_COND_TYPES.has(o.key)))
const currentType = computed(() => props.meta?.resTypes.find((t) => t.key === form.resType) ?? null)
/** 当前 resType 的字段白名单（STRUCT 编辑器与校验共用） */
const currentFields = computed(() => currentType.value?.fields ?? [])
/** ID 模式下 resCond 填的就是这一列的值，提示出来省得配错列 */
const hint = computed(() => {
  if (!currentType.value) return '选择内容类型后可填写条件'
  if (form.condType === 'ID') return `命中列 ${currentType.value.idColumn}：填逗号分隔的 ID，如 430001300,430001301`
  return `条件行之间是 AND 关系；保存时由后端编译成 where 片段（试算结果里可以看到编译产物）`
})

/** 外部调用：传 rule = 编辑（组 ID 跟着规则走，不可改），不传 = 新建（组 ID 留空由用户填） */
function open(rule?: GroupResRule) {
  // SQL 档已下线（存量规则的条件是手写 where 片段，没有结构化编辑态）：拒绝编辑，只能详情查看后新建替代。
  if (rule && !SUPPORTED_COND_TYPES.has(rule.condType)) {
    ElMessage.warning(`条件类型为 ${rule.condType} 的规则已停止编辑，请在详情中查看后新建 ID / 结构化条件规则替代`)
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
  // STRUCT 回显走 condJson；解析失败（历史脏数据）回空数组，由用户重配而不是带着坏值提交
  condItems.value = rule?.condType === 'STRUCT' ? parseCondJson(rule.condJson) : []
  visible.value = true
  if (!rule) {
    void loadGroupOptions()
  }
}
defineExpose({ open })

/** 提交用的条件内容：ID 模式去掉空格（STRUCT 不用 resCond，由后端编译） */
function normalizedCond(): string {
  return form.resCond.replace(/\s+/g, '')
}

/** 规则归属的用户组：纯数字且大于 90000（与后端同口径），非法时返回 0 */
const parsedGroupId = computed(() => {
  const text = form.groupId.trim()
  if (!/^\d+$/.test(text)) return 0
  const value = Number(text)
  return value > GROUP_ID_FLOOR ? value : 0
})

// ---- ID 模式的辅助选择器（D3②：默认手输，选择器只是辅助入口）----
/** idColumn 对应的字段 meta；PARAM 的 PARAM_ID 等不在白名单里的类型没有 picker，按钮隐藏 */
const idFieldMeta = computed(() => currentFields.value.find((f) => f.field === currentType.value?.idColumn) ?? null)

const idPickerVisible = ref(false)
const idPickerValues = ref<string[]>([])

function openIdPicker() {
  // 每次打开都从当前 resCond 拆出已填 ID 回显（逗号串按空白/空项容错拆分）
  idPickerValues.value = form.resCond.split(/[,\s]+/).filter((part) => /^\d+$/.test(part))
  idPickerVisible.value = true
}

/** 确认：选择结果与已手输的 ID 合并去重（追加语义，不覆盖用户已填内容） */
function applyIdPicker() {
  const existing = form.resCond.split(/[,\s]+/).filter((part) => /^\d+$/.test(part))
  form.resCond = [...new Set([...existing, ...idPickerValues.value])].join(',')
  idPickerVisible.value = false
}

function validate(): string | null {
  if (!parsedGroupId.value) return `请输入用户组 ID（必须大于 ${GROUP_ID_FLOOR}）`
  if (!form.action) return '请选择行为（入选 / 排除）'
  if (!form.resType) return '请选择内容类型'
  if (!form.condType) return '请选择条件类型'
  return form.condType === 'ID' ? idCondError(form.resCond) : condItemsError(condItems.value, currentFields.value)
}

async function save() {
  const invalid = validate()
  if (invalid) {
    ElMessage.warning(invalid)
    return
  }
  const isStruct = form.condType === 'STRUCT'
  const resCond = isStruct ? '' : normalizedCond()
  const condJson = isStruct ? stringifyCondJson(condItems.value) : undefined
  saving.value = true
  try {
    // 试算：success=true 也不代表通过，data.error 才是结论
    const check = await previewGroupRes({ resType: form.resType, condType: form.condType, resCond, condJson })
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
      // STRUCT 的 resCond 传空串由后端编译覆盖；condJson 仅 STRUCT 时携带
      ...(isStruct ? { resCond, condJson } : { resCond }),
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
  <el-dialog v-model="visible" :title="editing ? `编辑数据权限规则 · ${editing.id}` : '新建数据权限规则'" width="680px" append-to-body destroy-on-close>
    <el-form label-width="96px" size="default" @submit.prevent>
      <el-form-item label="用户组 ID" required>
        <div style="width: 100%;">
          <el-select
            v-if="!editing && groupOptions.length > 0"
            v-model="form.groupId"
            filterable
            placeholder="快捷选择已配置用户组"
            style="width: 100%; margin-bottom: 6px;"
            data-testid="group-res-group-select"
          >
            <el-option
              v-for="g in groupOptions"
              :key="g.id"
              :label="`${g.label}（${g.code ? g.code + ' · ' : ''}${g.id}）`"
              :value="String(g.id)"
            />
          </el-select>
          <el-input
            v-model="form.groupId"
            :disabled="!!editing"
            placeholder="如 100001"
            data-testid="group-res-rule-group-id"
          />
        </div>
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
        <div v-if="form.condType === 'ID'" class="gr-id-row">
          <el-input
            v-model="form.resCond"
            data-testid="group-res-rescond"
            placeholder="430001300,430001301"
          />
          <el-popover v-if="idFieldMeta" :visible="idPickerVisible" placement="bottom-end" :width="420" trigger="click">
            <template #reference>
              <el-button :icon="FolderOpened" data-testid="group-res-id-pick" @click="openIdPicker">选择</el-button>
            </template>
            <div class="gr-id-picker">
              <CondValueInput v-model="idPickerValues" :field="idFieldMeta" multiple />
              <div class="gr-id-picker-actions">
                <el-button size="small" @click="idPickerVisible = false">取消</el-button>
                <el-button size="small" type="primary" data-testid="group-res-id-pick-confirm" @click="applyIdPicker">填入 ID</el-button>
              </div>
            </div>
          </el-popover>
        </div>
        <StructCondEditor v-else v-model="condItems" :fields="currentFields" />
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
.gr-id-row { display: flex; gap: 6px; width: 100%; }
.gr-id-picker-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
</style>
