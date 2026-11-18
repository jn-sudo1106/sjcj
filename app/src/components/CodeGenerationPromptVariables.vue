<script setup lang="ts">
import { CODE_GENERATION_PROMPT_VARIABLES as variables } from '@/utils/codeGenerationPromptVariables'
const token = (name: string) => '{{' + name + '}}'
</script>

<template>
  <details class="code-prompt-variables" data-testid="code-generation-prompt-variables">
    <summary>代码生成常用变量</summary>
    <p>可放入系统或用户提示词，执行时填入实际值。目标 URL、文件名和保存要求也会在请求开头单独列出。</p>
    <dl><template v-for="[name, description] in variables" :key="name"><dt><code>{{ token(name) }}</code></dt><dd>{{ description }}</dd></template></dl>
    <p v-pre>例如：主脚本命名为 {{file_name}}，保存到 {{code_file_path}}。{{code_save_requirement}}</p>
    <p v-pre>代理取自“节点配置 → 使用代理”的已保存设置，生成时替换。例如：是否启用代理 {{use_proxy}}，代理地址 {{proxy_url}}。</p>
  </details>
</template>

<style scoped>
.code-prompt-variables{font-size:12px;color:var(--el-text-color-secondary);margin:8px 0;overflow-wrap:anywhere}.code-prompt-variables summary{cursor:pointer;color:var(--el-color-primary)}.code-prompt-variables p{margin:8px 0}.code-prompt-variables dl{display:grid;grid-template-columns:minmax(130px,auto) minmax(0,1fr);gap:6px 12px}.code-prompt-variables dd{margin:0}.code-prompt-variables code{color:var(--el-text-color-regular)}
</style>
