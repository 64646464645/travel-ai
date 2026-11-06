<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getWebViewMetrics } from '@/utils/webviewMetrics'

const route = useRoute()
const showTabbar = computed(() => !route.meta.hideTabbar)

onMounted(async () => {
  try {
    const metrics = await getWebViewMetrics()
    if (metrics) console.info('[WebViewMetrics]', metrics)
  } catch (error) {
    console.warn('[WebViewMetrics] 采集失败', error)
  }
})
</script>

<template>
  <div class="app-container">
    <router-view />
    <van-tabbar v-if="showTabbar" route>
      <van-tabbar-item to="/" icon="home-o">首页</van-tabbar-item>
      <van-tabbar-item to="/chat" icon="chat-o">对话</van-tabbar-item>
      <van-tabbar-item to="/profile" icon="user-o">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>
