<template>
  <div class="profile-container">
    <van-nav-bar title="我的" :left-arrow="false" />

    <section class="user-info">
      <van-image v-if="auth.user?.avatarUrl" :src="auth.user.avatarUrl" round class="avatar" />
      <div v-else class="avatar avatar-fallback" aria-hidden="true">
        <van-icon name="user-o" />
      </div>
      <div class="user-details">
        <h1 class="user-name">{{ displayName }}</h1>
        <p class="user-account">{{ auth.user ? `账号：${auth.user.username}` : '游客' }}</p>
      </div>
    </section>

    <section class="menu-section">
      <h2 class="menu-title">我的服务</h2>
      <van-cell-group>
        <van-cell title="我的收藏" is-link icon="star-o" @click="showToast('功能开发中')" />
        <van-cell title="历史记录" is-link icon="history" @click="router.push('/sessions')" />
        <van-cell title="设置" is-link icon="setting-o" @click="showToast('功能开发中')" />
      </van-cell-group>
    </section>

    <section class="menu-section">
      <h2 class="menu-title">关于</h2>
      <van-cell-group>
        <van-cell title="关于我们" is-link @click="aboutDialogVisible = true" />
        <van-cell title="版本信息" value="v1.0.0" />
      </van-cell-group>
    </section>

    <div v-if="auth.isAuthenticated" class="logout-area">
      <van-button block plain type="danger" :loading="loggingOut" @click="handleLogout">
        退出登录
      </van-button>
    </div>

    <van-dialog v-model:show="aboutDialogVisible" title="关于我们" show-cancel-button>
      <div class="about-content">
        <p>智能旅游助手 v1.0.0</p>
        <p class="about-line">基于 AI 技术的智能旅游规划平台</p>
      </div>
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const aboutDialogVisible = ref(false)
const loggingOut = ref(false)
const displayName = computed(() => auth.user?.nickname || auth.user?.username || '游客')

async function handleLogout(): Promise<void> {
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号吗？' })
  } catch {
    return
  }

  loggingOut.value = true
  try {
    await auth.logout()
    await router.replace('/login')
  } catch {
    showToast('退出登录失败')
  } finally {
    loggingOut.value = false
  }
}
</script>

<style scoped>
.profile-container {
  min-height: 100vh;
  padding-bottom: 70px;
  background: #f5f6f7;
}

.user-info {
  display: flex;
  align-items: center;
  padding: 28px 20px;
  background: #1677ff;
  color: #fff;
}

.avatar {
  width: 72px;
  height: 72px;
  flex: 0 0 72px;
  border: 2px solid rgba(255, 255, 255, 0.55);
  box-sizing: border-box;
}

.avatar-fallback {
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  font-size: 34px;
}

.user-details {
  min-width: 0;
  margin-left: 16px;
  text-align: left;
}

.user-name {
  overflow: hidden;
  margin: 0;
  color: #fff;
  font-size: 21px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-account {
  overflow: hidden;
  margin-top: 5px;
  font-size: 13px;
  opacity: 0.88;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-section {
  margin-top: 12px;
  background: #fff;
}

.menu-title {
  margin: 0;
  padding: 12px 16px 8px;
  color: #646566;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  text-align: left;
  letter-spacing: 0;
}

.logout-area {
  padding: 20px 16px 0;
}

.logout-area :deep(.van-button) {
  height: 44px;
  border-radius: 8px;
}

.about-content {
  padding: 18px 20px 24px;
  color: #4b5563;
  text-align: center;
  line-height: 1.6;
}

.about-line {
  margin-top: 8px;
}
</style>
