<template>
  <div class="agent-trace">
    <div class="trace-header" @click="expanded = !expanded">
      <span class="trace-title">
        {{ running ? '正在执行' : '执行过程' }}
        <span class="trace-count">{{ nodes.length }} 个阶段 · {{ tools.length }} 次工具调用</span>
      </span>
      <van-icon :name="expanded ? 'arrow-up' : 'arrow-down'" size="14" />
    </div>

    <div v-if="expanded" class="trace-body">
      <div v-for="node in nodes" :key="node.seq" class="trace-node">
        <div class="node-line">
          <span class="node-dot" :class="node.status"></span>
          <span class="node-name">{{ label(node.node) }}</span>
          <span v-if="node.status === 'running'" class="node-state running">进行中</span>
          <span v-else-if="node.status === 'failed'" class="node-state failed">失败</span>
          <span v-else class="node-state">{{ formatLatency(node.latencyMs) }}</span>
        </div>

        <div v-for="tool in toolsOf(node)" :key="tool.callId" class="trace-tool">
          <span class="tool-dot" :class="tool.status"></span>
          <span class="tool-name">{{ toolLabel(tool.name) }}</span>
          <span class="tool-summary" :class="{ error: tool.status === 'failed' }">{{ tool.summary ?? '调用中…' }}</span>
        </div>
      </div>

      <div v-if="orphanTools.length" class="trace-node">
        <div class="node-line">
          <span class="node-dot done"></span>
          <span class="node-name">其他调用</span>
        </div>
        <div v-for="tool in orphanTools" :key="tool.callId" class="trace-tool">
          <span class="tool-dot" :class="tool.status"></span>
          <span class="tool-name">{{ toolLabel(tool.name) }}</span>
          <span class="tool-summary" :class="{ error: tool.status === 'failed' }">{{ tool.summary ?? '调用中…' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NODE_LABELS,
  TOOL_LABELS,
  formatLatency,
  type AgentNodeTrace,
  type AgentToolTrace,
} from '@/types/agent'

const props = defineProps<{
  nodes: AgentNodeTrace[]
  tools: AgentToolTrace[]
  running: boolean
}>()

const expanded = ref(true)

/** 工具事件由 Agent.vue 在收到 tool_call 时打上当时正在执行的阶段序号 */
function toolsOf(node: AgentNodeTrace): AgentToolTrace[] {
  return props.tools.filter((tool) => tool.nodeSeq === node.seq)
}

const orphanTools = computed(() =>
  props.tools.filter((tool) => !props.nodes.some((node) => node.seq === tool.nodeSeq)),
)

const label = (node: AgentNodeTrace['node']) => NODE_LABELS[node] ?? node
const toolLabel = (name: string) => TOOL_LABELS[name] ?? name
</script>

<style scoped>
.agent-trace {
  background: #f7f8fa;
  border-radius: 10px;
  padding: 10px 12px;
  margin: 8px 0;
}

.trace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.trace-title {
  font-size: 13px;
  color: #323233;
  font-weight: 500;
}

.trace-count {
  margin-left: 6px;
  font-weight: 400;
  color: #969799;
}

.trace-body {
  margin-top: 10px;
  border-left: 1px dashed #dcdee0;
  padding-left: 12px;
}

.trace-node {
  position: relative;
  padding-bottom: 8px;
}

.node-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #323233;
}

.node-dot {
  position: absolute;
  left: -17px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c8c9cc;
}

.node-dot.running {
  background: #1989fa;
  box-shadow: 0 0 0 3px rgba(25, 137, 250, 0.15);
}

.node-dot.done {
  background: #07c160;
}

.node-dot.failed {
  background: #ee0a24;
}

.node-state {
  font-size: 12px;
  color: #969799;
}

.node-state.running {
  color: #1989fa;
}

.node-state.failed {
  color: #ee0a24;
}

.trace-tool {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  color: #646566;
  padding: 2px 0 2px 12px;
}

.tool-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #c8c9cc;
  flex: none;
}

.tool-dot.ok {
  background: #07c160;
}

.tool-dot.failed {
  background: #ee0a24;
}

.tool-dot.running {
  background: #1989fa;
}

.tool-name {
  flex: none;
  color: #323233;
}

.tool-summary {
  color: #969799;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-summary.error {
  color: #ee0a24;
}
</style>
