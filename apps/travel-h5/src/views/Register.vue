<template>
  <main class="auth-page">
    <section class="auth-panel">
      <van-nav-bar title="注册账号" left-arrow @click-left="router.back()" />

      <div class="register-heading">
        <h1>创建账号</h1>
        <p>开始保存你的旅行会话</p>
      </div>

      <van-form class="auth-form" @submit="handleSubmit">
        <van-cell-group inset>
          <van-field
            v-model="username"
            name="username"
            label="账号"
            placeholder="3-64位字母、数字或下划线"
            autocomplete="username"
            maxlength="64"
            clearable
            :rules="usernameRules"
          />
          <van-field
            v-model="nickname"
            name="nickname"
            label="昵称"
            placeholder="选填"
            maxlength="64"
            clearable
          />
          <van-field
            v-model="password"
            name="password"
            label="密码"
            type="password"
            placeholder="至少8位"
            autocomplete="new-password"
            clearable
            :rules="[{ validator: validatePassword, message: '密码至少需要8位' }]"
          />
          <van-field
            v-model="confirmPassword"
            name="confirmPassword"
            label="确认密码"
            type="password"
            placeholder="再次输入密码"
            autocomplete="new-password"
            clearable
            :rules="[{ validator: validateConfirmation, message: '两次输入的密码不一致' }]"
          />
        </van-cell-group>

        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <van-button block type="primary" native-type="submit" :loading="submitting">
          注册并登录
        </van-button>
      </van-form>

      <p class="auth-switch">
        已有账号？
        <router-link :to="{ name: 'login', query: route.query }">返回登录</router-link>
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
const nickname = ref('')
const password = ref('')
const confirmPassword = ref('')
const submitting = ref(false)
const errorMessage = ref('')

const usernameRules = [
  { required: true, message: '请输入账号' },
  { pattern: /^[a-zA-Z0-9_]{3,64}$/, message: '账号格式不正确' },
]

const validatePassword = (value: string) => value.length >= 8
const validateConfirmation = (value: string) => Boolean(value) && value === password.value

function targetPath(): string {
  const redirect = route.query.redirect
  return typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/'
}

async function handleSubmit(): Promise<void> {
  submitting.value = true
  errorMessage.value = ''
  try {
    await auth.register(username.value.trim(), password.value, nickname.value.trim() || undefined)
    await router.replace(targetPath())
  } catch (error) {
    const response = (error as { response?: { data?: { message?: string } } }).response
    errorMessage.value = response?.data?.message ?? '注册失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.auth-page {
  min-height: 100svh;
  box-sizing: border-box;
  padding-bottom: 32px;
  background: #f4f7f8;
}

.auth-panel {
  width: min(100%, 420px);
  margin: 0 auto;
}

.register-heading {
  padding: 30px 20px 22px;
  text-align: left;
}

h1 {
  margin: 0;
  color: #1f2937;
  font-size: 26px;
  font-weight: 650;
  line-height: 1.3;
  letter-spacing: 0;
}

.register-heading p {
  margin-top: 7px;
  color: #6b7280;
  font-size: 14px;
}

.auth-form :deep(.van-cell-group--inset) {
  margin: 0 16px 18px;
  border-radius: 8px;
  overflow: hidden;
}

.auth-form > :deep(.van-button) {
  width: calc(100% - 32px);
  height: 46px;
  margin: 0 16px;
  border-radius: 8px;
}

.form-error {
  margin: -6px 18px 14px;
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

