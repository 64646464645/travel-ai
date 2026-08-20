<template>
  <div class="sessions-page">
    <van-nav-bar
      title="历史会话"
      left-text="返回"
      left-arrow
      @click-left="router.back()"
      right-text="新建"
      @click-right="handleCreate"
    />

    <div v-if="loading" class="sessions-loading">
      <van-loading size="24px">加载中...</van-loading>
    </div>

    <van-empty v-else-if="sessions.length === 0" description="暂无历史会话" />

    <div v-else class="session-list">
      <van-swipe-cell v-for="item in sessions" :key="item.sessionId">
        <van-cell
          :title="item.title || '未命名会话'"
          :value="formatTime(item.updatedAt)"
          is-link
          @click="handleOpen(item)"
        />
        <template #right>
          <van-button square type="primary" text="重命名" @click="openRename(item)" />
          <van-button square type="danger" text="删除" @click="handleDelete(item)" />
        </template>
      </van-swipe-cell>
    </div>

    <van-dialog
      v-model:show="renameVisible"
      title="重命名会话"
      show-cancel-button
      @confirm="confirmRename"
    >
      <div class="rename-field">
        <van-field v-model="renameTitle" placeholder="请输入新标题" maxlength="64" />
      </div>
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import { get, post, patch, del } from '../utils/request'
import type { SessionSummary, SessionListResponse, SessionResponse } from '../types'

const router = useRouter()
const sessions = ref<SessionSummary[]>([])
const loading = ref(false)
const renameVisible = ref(false)
const renameTitle = ref('')
let renamingId = ''

const loadSessions = async () => {
  loading.value = true
  try {
    const res = await get<SessionListResponse>('sessions')
    sessions.value = res.data
  } catch {
    showToast('加载会话失败')
  } finally {
    loading.value = false
  }
}

const handleCreate = async () => {
  try {
    const res = await post<SessionResponse>('sessions')
    router.push({ path: '/chat', query: { sessionId: res.data.sessionId } })
  } catch {
    showToast('新建会话失败')
  }
}

const handleOpen = (item: SessionSummary) => {
  router.push({ path: '/chat', query: { sessionId: item.sessionId } })
}

const openRename = (item: SessionSummary) => {
  renamingId = item.sessionId
  renameTitle.value = item.title
  renameVisible.value = true
}

const confirmRename = async () => {
  const title = renameTitle.value.trim()
  if (!title) {
    showToast('标题不能为空')
    return
  }
  try {
    await patch<SessionResponse>(`sessions/${renamingId}`, { title })
    showToast('重命名成功')
    loadSessions()
  } catch {
    showToast('重命名失败')
  }
}

const handleDelete = (item: SessionSummary) => {
  showConfirmDialog({
    title: '删除会话',
    message: `确定删除「${item.title || '未命名会话'}」及其全部消息吗？`,
  })
    .then(async () => {
      try {
        await del(`sessions/${item.sessionId}`)
        showToast('删除成功')
        loadSessions()
      } catch {
        showToast('删除失败')
      }
    })
    .catch(() => {})
}

const formatTime = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === now.toDateString()) return hm
  return `${d.getMonth() + 1}-${d.getDate()} ${hm}`
}

onMounted(loadSessions)
</script>

<style scoped>
.sessions-page {
  min-height: 100vh;
  background: #f7f8fa;
  padding-bottom: 50px;
}

.sessions-loading {
  padding: 40px 0;
  text-align: center;
}

.session-list {
  margin-top: 8px;
}

.rename-field {
  padding: 16px;
}
</style>
