<script setup lang="ts">
const variables = [
  ['url', '当前源的目标列表 URL'],
  ['file_name', '本次生成的主代码文件名，按当前文件命名方式确定'],
  ['code_dir', '实际生成服务器的代码保存目录（Agent）'],
  ['code_file_path', '主代码文件的完整保存路径（Agent）'],
  ['code_save_requirement', '本次文件命名、保存目录和返回结果要求'],
  ['prj_dir', '本次生成工作空间（Agent）'],
  ['input_file_dir', '本次输入目录（Agent）'],
  ['output_file_dir', '本次输出目录（Agent）'],
  ['config_id', '节点配置 ID'], ['queue_name', '节点 MQ 主题'], ['task_id', '本次生成任务 ID'],
] as const
const token = (name: string) => '{{' + name + '}}'
</script>

<template>
  <details class="code-prompt-variables" data-testid="code-generation-prompt-variables">
    <summary>代码生成常用变量</summary>
    <p>可放入系统或用户提示词，执行时填入实际值。目标 URL、文件名和保存要求也会在请求开头单独列出。</p>
    <dl><template v-for="[name, description] in variables" :key="name"><dt><code>{{ token(name) }}</code></dt><dd>{{ description }}</dd></template></dl>
    <p v-pre>例如：主脚本命名为 {{file_name}}，保存到 {{code_file_path}}。{{code_save_requirement}}</p>
  </details>
</template>

<style scoped>
.code-prompt-variables{font-size:12px;color:var(--el-text-color-secondary);margin:8px 0;overflow-wrap:anywhere}.code-prompt-variables summary{cursor:pointer;color:var(--el-color-primary)}.code-prompt-variables p{margin:8px 0}.code-prompt-variables dl{display:grid;grid-template-columns:minmax(130px,auto) minmax(0,1fr);gap:6px 12px}.code-prompt-variables dd{margin:0}.code-prompt-variables code{color:var(--el-text-color-regular)}
</style>
