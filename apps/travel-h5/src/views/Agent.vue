<template>
  <div class="page-container agent-page">
    <div class="page-header">
      <van-nav-bar title="智能行程 Agent" left-text="返回" left-arrow @click-left="router.back()">
        <template #right>
          <span v-if="running" class="nav-action danger" @click="stop">停止</span>
          <span v-else-if="turns.length" class="nav-action" @click="reset">清空</span>
        </template>
      </van-nav-bar>
    </div>

    <div ref="scrollRef" class="agent-container">
      <div v-if="turns.length === 0" class="agent-empty">
        <van-empty description="告诉我目的地、天数和预算，我来查真实地点后生成行程" />
        <div class="quick-questions">
          <div class="quick-title">试试这样问</div>
          <van-tag
            v-for="question in quickQuestions"
            :key="question"
            class="quick-tag"
            size="large"
            mark
            plain
            color="#1e88e5"
            @click="send(question)"
          >
            {{ question }}
          </van-tag>
        </div>
      </div>

      <div v-else class="turn-list">
        <div v-for="turn in turns" :key="turn.id" class="turn">
          <div class="user-bubble">{{ turn.message }}</div>

          <AgentTrace
            v-if="turn.nodes.length || turn.tools.length"
            :nodes="turn.nodes"
            :tools="turn.tools"
            :running="turn.running"
          />

          <div v-if="turn.text" class="agent-bubble">
            <MarkdownContent :content="turn.text" />
          </div>

          <AgentPlanCard
            v-if="turn.plan"
            :plan="turn.plan"
            :issues="turn.issues"
            show-save
            :saving="turn.saving"
            :saved="Boolean(turn.savedId)"
            @save="savePlan(turn)"
            @open="turn.savedId && router.push(`/itineraries/${turn.savedId}`)"
          />

          <div v-if="turn.error" class="agent-error">
            <van-icon name="warning-o" />
            <span>{{ turn.error }}</span>
          </div>

          <div v-if="turn.running && !turn.text && !turn.plan" class="agent-pending">
            <van-loading type="spinner" size="16px" />
            <span>{{ pendingHint(turn) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="agent-input-area">
      <van-field
        v-model="input"
        placeholder="例如：成都三天，预算 3000，不吃辣"
        :disabled="running"
        @keyup.enter="send(input)"
      >
        <template #button>
          <van-button
            type="primary"
            size="small"
            :disabled="!input.trim() || running"
            @click="send(input)"
          >
            发送
          </van-button>
        </template>
      </van-field>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import type { AgentEvent, AgentPlan, AgentValidationIssue } from '@travel/shared'
import AgentTrace from '@/components/AgentTrace.vue'
import AgentPlanCard from '@/components/AgentPlanCard.vue'
import MarkdownContent from '@/components/MarkdownContent.vue'
import {
  cancelAgentRun,
  confirmItineraryApi,
  fetchAgentStream,
  getLatestItineraryApi,
  saveItineraryApi,
} from '@/utils/request'
import { useSmartScroll } from '@/composables/useSmartScroll'
import {
  NODE_LABELS,
  type AgentNodeTrace,
  type AgentToolTrace,
} from '@/types/agent'

interface AgentTurn {
  id: number
  message: string
  runId?: string
  nodes: AgentNodeTrace[]
  tools: AgentToolTrace[]
  text: string
  plan?: AgentPlan
  issues: AgentValidationIssue[]
  error?: string
  running: boolean
  saving?: boolean
  /** 服务端自动落库的草稿 id，点「保存」时转为正式收藏 */
  draftId?: string
  savedId?: string
  /** 从历史恢复出来的轮次，不再展示执行时间线 */
  restored?: boolean
}

const SESSION_KEY = 'travel_ai_agent_session_id'

const router = useRouter()
const scrollRef = ref<HTMLElement | null>(null)
const { scrollToBottom, throttledScrollToBottom, resetAutoScroll } = useSmartScroll(scrollRef)

const turns = ref<AgentTurn[]>([])
const input = ref('')
const running = ref(false)
const sessionId = ref('')
let controller: AbortController | null = null

const quickQuestions = [
  '成都三天，预算 3000，不吃辣',
  '杭州两天，预算 2000，喜欢安静',
  '西安三日游，预算 4000',
]

function createTurn(message: string): AgentTurn {
  return { id: Date.now(), message, nodes: [], tools: [], text: '', issues: [], running: true }
}

function persistSession(id: string): void {
  sessionId.value = id
  try {
    localStorage.setItem(SESSION_KEY, id)
  } catch {
    // 隐私模式下 localStorage 可能不可用，内存里的 sessionId 仍然有效
  }
}

/** 当前正在执行的阶段，用于把工具调用缩进到对应节点下 */
function currentSeq(turn: AgentTurn): number | undefined {
  for (let index = turn.nodes.length - 1; index >= 0; index -= 1) {
    if (turn.nodes[index].status === 'running') return turn.nodes[index].seq
  }
  return turn.nodes.length ? turn.nodes[turn.nodes.length - 1].seq : undefined
}

function handleEvent(turn: AgentTurn, event: AgentEvent): void {
  switch (event.type) {
    case 'run_started':
      turn.runId = event.runId
      persistSession(event.sessionId)
      break
    case 'node_started':
      turn.nodes.push({ seq: event.seq, node: event.node, status: 'running' })
      break
    case 'node_finished': {
      const node = turn.nodes.find((item) => item.seq === event.seq)
      if (node) {
        node.status = event.status
        node.latencyMs = event.latencyMs
      }
      break
    }
    case 'tool_call':
      turn.tools.push({
        callId: event.callId,
        name: event.name,
        args: event.args,
        status: 'running',
        nodeSeq: currentSeq(turn),
      })
      break
    case 'tool_result': {
      const tool = turn.tools.find((item) => item.callId === event.callId)
      if (tool) {
        tool.status = event.ok ? 'ok' : 'failed'
        tool.summary = event.summary
        tool.latencyMs = event.latencyMs
      }
      break
    }
    case 'message_delta':
      turn.text += event.content
      break
    case 'plan':
      turn.plan = event.plan
      break
    case 'validation':
      turn.issues = event.issues
      break
    case 'error':
      turn.error = event.message
      break
    case 'done':
      turn.running = false
      if (event.itineraryId) turn.draftId = event.itineraryId
      break
    case 'heartbeat':
      break
  }
}

function pendingHint(turn: AgentTurn): string {
  const running = [...turn.nodes].reverse().find((node) => node.status === 'running')
  return running ? `${NODE_LABELS[running.node]}…` : '准备中…'
}

async function send(raw: string): Promise<void> {
  const message = raw.trim()
  if (!message || running.value) return

  input.value = ''
  turns.value.push(createTurn(message))
  const turn = turns.value[turns.value.length - 1]
  running.value = true
  controller = new AbortController()
  resetAutoScroll()

  try {
    await fetchAgentStream(
      { message, sessionId: sessionId.value || undefined },
      {
        signal: controller.signal,
        onEvent: (event) => {
          handleEvent(turn, event)
          throttledScrollToBottom()
        },
      },
    )
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      turn.error = (error as Error).message || '运行失败'
    }
  } finally {
    turn.running = false
    running.value = false
    controller = null
    scrollToBottom()
  }
}

async function savePlan(turn: AgentTurn): Promise<void> {
  if (!turn.plan || turn.saving || turn.savedId) return
  turn.saving = true
  try {
    // 正常路径下服务端已经存了草稿，这里只是把它转正；
    // 草稿落库失败（或被清理）时退回完整提交，保证按钮不会失效
    const res = turn.draftId
      ? await confirmItineraryApi(turn.draftId)
      : await saveItineraryApi({
          runId: turn.runId,
          sessionId: sessionId.value || undefined,
          plan: turn.plan,
          issues: turn.issues,
        })
    turn.savedId = res.data.id
    turn.draftId = undefined
    showToast('已保存到我的行程')
  } catch (error) {
    showToast((error as Error).message || '保存失败')
  } finally {
    turn.saving = false
  }
}

/** 刷新后恢复：把最近一条行程（草稿或已保存）还原成一轮对话 */
async function restoreLast(): Promise<void> {
  try {
    const stored = localStorage.getItem(SESSION_KEY) ?? undefined
    const res = await getLatestItineraryApi(stored)
    const detail = res.data
    if (detail.sessionId) persistSession(detail.sessionId)

    turns.value = [
      {
        id: Date.now(),
        message: detail.sourceMessage || `${detail.city} ${detail.days} 天行程`,
        runId: detail.runId ?? undefined,
        nodes: [],
        tools: [],
        text:
          detail.status === 'draft'
            ? '这是上一次生成、还没保存的行程，已经自动为你留着。'
            : '这是你上次保存的行程。',
        plan: detail.plan,
        issues: detail.issues,
        running: false,
        savedId: detail.status === 'saved' ? detail.id : undefined,
        draftId: detail.status === 'draft' ? detail.id : undefined,
        restored: true,
      },
    ]
  } catch {
    // 没有历史行程是正常情况，不打扰用户
  }
}

async function stop(): Promise<void> {
  const turn = turns.value[turns.value.length - 1]
  if (turn?.runId) {
    await cancelAgentRun(turn.runId).catch(() => undefined)
  }
  controller?.abort()
  showToast('已停止')
}

function reset(): void {
  turns.value = []
  sessionId.value = ''
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // 忽略：内存状态已经清空
  }
}

onMounted(() => {
  void restoreLast()
})

onUnmounted(() => {
  controller?.abort()
})
</script>

<style scoped>
.nav-action {
  font-size: 14px;
  color: #1989fa;
}

.nav-action.danger {
  color: #ee0a24;
}

.agent-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  padding-bottom: 0 !important;
}

.agent-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  padding-bottom: calc(130px + var(--app-safe-bottom));
}

.agent-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.quick-questions {
  margin-top: 24px;
  text-align: center;
}

.quick-title {
  font-size: 14px;
  color: #999;
  margin-bottom: 12px;
}

.quick-tag {
  margin: 8px;
  cursor: pointer;
}

.turn-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.user-bubble {
  align-self: flex-end;
  max-width: 78%;
  margin-left: auto;
  background: #1989fa;
  color: #fff;
  padding: 8px 12px;
  border-radius: 12px 12px 4px 12px;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
}

.agent-bubble {
  background: #f7f8fa;
  border-radius: 12px 12px 12px 4px;
  padding: 10px 12px;
  font-size: 14px;
  color: #323233;
}

.agent-error {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #ee0a24;
  font-size: 13px;
  padding: 6px 2px;
}

.agent-pending {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #969799;
  font-size: 13px;
  padding: 4px 2px;
}

.agent-input-area {
  position: fixed;
  bottom: 50px;
  bottom: calc(50px + var(--app-safe-bottom));
  left: 0;
  right: 0;
  background: #fff;
  padding: 8px 16px;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
  max-width: 750px;
  margin: 0 auto;
}

.agent-input-area :deep(.van-field) {
  background: #f7f8fa;
  border-radius: 20px;
  padding: 8px 16px;
}
</style>
