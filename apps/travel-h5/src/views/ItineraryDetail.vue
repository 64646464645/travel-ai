<template>
  <div class="page-container">
    <div class="page-header">
      <van-nav-bar :title="detail?.title ?? '行程详情'" left-text="返回" left-arrow @click-left="router.back()">
        <template #right>
          <span v-if="detail" class="nav-action danger" @click="remove">删除</span>
        </template>
      </van-nav-bar>
    </div>

    <div class="page-content">
      <van-loading v-if="loading" class="loading" type="spinner">加载中…</van-loading>

      <van-empty v-else-if="!detail" description="行程不存在或已被删除">
        <van-button size="small" round type="primary" @click="router.replace('/itineraries')">
          返回列表
        </van-button>
      </van-empty>

      <template v-else>
        <div class="detail-meta">
          <span>保存于 {{ formatTime(detail.createdAt) }}</span>
          <span v-if="detail.schemaVersion > 1">v{{ detail.schemaVersion }}</span>
        </div>
        <AgentPlanCard :plan="detail.plan" :issues="detail.issues" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import type { ItineraryDetail } from '@travel/shared'
import AgentPlanCard from '@/components/AgentPlanCard.vue'
import { deleteItineraryApi, getItineraryApi } from '@/utils/request'

const route = useRoute()
const router = useRouter()
const detail = ref<ItineraryDetail | null>(null)
const loading = ref(true)

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function load(): Promise<void> {
  const id = String(route.params.id ?? '')
  if (!id) {
    loading.value = false
    return
  }
  try {
    const res = await getItineraryApi(id)
    detail.value = res.data
  } catch (error) {
    showToast((error as Error).message || '加载行程失败')
  } finally {
    loading.value = false
  }
}

async function remove(): Promise<void> {
  if (!detail.value) return
  try {
    await showConfirmDialog({ title: '删除行程', message: '删除后无法恢复，确定继续吗？' })
  } catch {
    return
  }

  try {
    await deleteItineraryApi(detail.value.id)
    showToast('已删除')
    router.replace('/itineraries')
  } catch (error) {
    showToast((error as Error).message || '删除失败')
  }
}

onMounted(load)
</script>

<style scoped>
.nav-action {
  font-size: 14px;
}

.nav-action.danger {
  color: #ee0a24;
}

.loading {
  padding-top: 48px;
  text-align: center;
}

.detail-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #969799;
  margin-bottom: 8px;
}
</style>
