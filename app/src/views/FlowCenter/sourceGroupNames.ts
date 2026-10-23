/**
 * 流程中心两个关联源弹窗（已关联 / 添加关联）的「所属来源组」列共用（1021-04）：
 * 拉一次 `sourceGroupApi.list` 建 id→组名索引；失败不阻塞，退回「组 #ID」。
 * 点组名跳源管理「我的分组」并选中该组（与源列表点组名同一个入口）。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { sourceGroupApi } from '@/api'

export function useSourceGroupNames() {
  const router = useRouter()
  const names = ref(new Map<string, string>())

  async function loadGroupNames() {
    try {
      const groups = await sourceGroupApi.list()
      names.value = new Map(groups.map((g) => [g.sourceGroupId, g.sourceGroupName]))
    } catch {
      names.value = new Map()
    }
  }
  function groupNameOf(sourceGroupId: string | null | undefined): string {
    if (!sourceGroupId) return ''
    return names.value.get(sourceGroupId) || `组 #${sourceGroupId}`
  }
  function openSourceGroup(sourceGroupId: string) {
    void router.push({ path: '/collect', query: { tab: 'personal', group: sourceGroupId } })
  }

  return { loadGroupNames, groupNameOf, openSourceGroup }
}
