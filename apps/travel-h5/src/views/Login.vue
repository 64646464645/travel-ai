<template>
  <main class="auth-page">
    <section class="auth-panel">
      <div class="brand-mark" aria-hidden="true">
        <van-icon name="guide-o" />
      </div>
      <h1>智能旅游助手</h1>
      <p class="auth-subtitle">登录你的账号</p>

      <van-form class="auth-form" @submit="handleSubmit">
        <van-cell-group inset>
          <van-field
            v-model="username"
            name="username"
            label="账号"
            placeholder="请输入账号"
            autocomplete="username"
            clearable
            :rules="[{ required: true, message: '请输入账号' }]"
          />
          <van-field
            v-model="password"
            name="password"
            label="密码"
            type="password"
            placeholder="请输入密码"
            autocomplete="current-password"
            clearable
            :rules="[{ required: true, message: '请输入密码' }]"
          />
        </van-cell-group>

        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <van-button block type="primary" native-type="submit" :loading="submitting">
          登录
        </van-button>
      </van-form>

      <p class="auth-switch">
        还没有账号？
        <router-link :to="{ name: 'register', query: route.query }">注册账号</router-link>
      </p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const username = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')

function targetPath(): string {
  const redirect = route.query.redirect
  return typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/'
}

async function handleSubmit(): Promise<void> {
  submitting.value = true
  errorMessage.value = ''
  try {
    await auth.login(username.value.trim(), password.value)
    await router.replace(targetPath())
  } catch (error) {
    const response = (error as { response?: { data?: { message?: string } } }).response
    errorMessage.value = response?.data?.message ?? '登录失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.auth-page {
  min-height: 100svh;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 32px 20px;
  background: #f4f7f8;
}

.auth-panel {
  width: min(100%, 420px);
}

.brand-mark {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  margin: 0 auto 18px;
  border-radius: 8px;
  background: #1677ff;
  color: #fff;
  font-size: 30px;
}

h1 {
  margin: 0;
  color: #1f2937;
  font-size: 28px;
  font-weight: 650;
  line-height: 1.3;
  text-align: center;
  letter-spacing: 0;
}

.auth-subtitle {
  margin-top: 8px;
  color: #6b7280;
  font-size: 15px;
  text-align: center;
}

.auth-form {
  margin-top: 28px;
}

.auth-form :deep(.van-cell-group--inset) {
  margin: 0 0 18px;
  border-radius: 8px;
  overflow: hidden;
}

.auth-form :deep(.van-button) {
  height: 46px;
  border-radius: 8px;
}

.form-error {
  margin: -6px 2px 14px;
  color: #d93025;
  font-size: 13px;
  text-align: left;
}

.auth-switch {
  margin-top: 22px;
  color: #6b7280;
  font-size: 14px;
  text-align: center;
}

.auth-switch a {
  color: #1677ff;
  text-decoration: none;
}
</style>

