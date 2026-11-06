<template>
  <div class="page-container">
    <div class="page-header">
      <van-nav-bar title="我的行程" left-text="返回" left-arrow @click-left="router.back()" />
    </div>

    <div class="page-content">
      <van-loading v-if="loading" class="loading" type="spinner">加载中…</van-loading>

      <van-empty v-else-if="items.length === 0" description="还没有保存的行程">
        <van-button type="primary" size="small" round @click="router.push('/agent')">
          去做一份行程
        </van-button>
      </van-empty>

      <template v-else>
        <div v-for="item in items" :key="item.id" class="itinerary-card" @click="open(item.id)">
          <div class="card-head">
            <span class="card-title">{{ item.title }}</span>
            <van-icon name="arrow" color="#c8c9cc" />
          </div>
          <div class="card-meta">
            <span>{{ item.days }} 天</span>
            <span>{{ item.activityCount }} 个活动</span>
            <span class="card-budget">¥{{ item.totalBudget }}</span>
          </div>
          <div class="card-foot">
            <span>{{ formatDate(item.createdAt) }} 保存</span>
            <van-tag v-if="item.unverifiedCount" type="warning" plain>
              {{ item.unverifiedCount }} 项待核实
            </van-tag>
          </div>
        </div>

        <div v-if="!finished" class="load-more">
          <van-button size="small" plain :loading="loadingMore" @click="loadMore">加载更多</van-button>
        </div>
        <div v-else-if="items.length > PAGE_SIZE" class="list-end">没有更多了</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import type { ItinerarySummary } from '@travel/shared'
import { listItinerariesApi } from '@/utils/request'

const PAGE_SIZE = 20

const router = useRouter()
const items = ref<ItinerarySummary[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const finished = ref(false)

function formatDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function fetchPage(): Promise<void> {
  try {
    // 草稿只在 Agent 页恢复展示，列表页只看用户主动保存过的
    const res = await listItinerariesApi({ limit: PAGE_SIZE, offset: items.value.length, status: 'saved' })
    items.value = [...items.value, ...res.data.items]
    finished.value = items.value.length >= res.data.total || res.data.items.length === 0
  } catch (error) {
    showToast((error as Error).message || '加载行程失败')
    finished.value = true
  }
}

async function loadMore(): Promise<void> {
  loadingMore.value = true
  await fetchPage()
  loadingMore.value = false
}

function open(id: string): void {
  router.push(`/itineraries/${id}`)
}

onMounted(async () => {
  await fetchPage()
  loading.value = false
})
</script>

<style scoped>
.loading {
  padding-top: 48px;
  text-align: center;
}

.itinerary-card {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #ebedf0;
  padding: 12px 14px;
  margin-bottom: 12px;
  cursor: pointer;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #323233;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  font-size: 13px;
  color: #646566;
}

.card-budget {
  color: #ee0a24;
  font-weight: 600;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: #969799;
}

.load-more,
.list-end {
  padding: 12px 0 24px;
  text-align: center;
  font-size: 13px;
  color: #969799;
}
</style>
