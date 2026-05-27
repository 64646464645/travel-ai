<template>
  <div class="page-container chat-page">
    <div class="page-header">
      <van-nav-bar
        title="AI 旅游助手"
        left-text="返回"
        left-arrow
        @click="router.back()"
>
      </van-nav-bar>
    </div>
    <div ref="chatContainer" class="chat-container">
      <div v-if="messages.length === 0" class="chat-empty">
        <van-empty
          description="开始和AI助手对话吧"
        />
        <div class="quick-questions">
                    <div class="quick-title">常见问题</div>
                    <van-tag @click="handleClickTag(question)" v-for="question in quickQuestions" :key="question" size="large"  mark  color="#1e88e5" plain class="quick-tag">
                        {{ question }}
                    </van-tag>
        </div>
      </div>
      <div v-else class="message-list">
        <ChatBubble v-for="msg in messages" :key="msg.id" :message="msg" />
        <div class="streaming-indicator" v-if="isStreaming">
          <van-loading type="spinner" size="20px"/>
          <span>AI正在思考中...</span>
        </div>
      </div>
    </div>
    <div class="chat-input-area">
      <van-field
        v-model="inputMessage"
        placeholder="输入您的问题..."
        :disabled="isStreaming"
        @keyup.enter="sendMessage"
      >
      <template #button>
        <van-button
          type="primary"
          size="small"
          @click="sendMessage"
          :disabled="!inputMessage.trim() || isStreaming"
        >
          发送
        </van-button>
      </template>
    </van-field>
    </div>
  </div>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router';
import { ref, onMounted } from 'vue';
import { fetchStream } from '../utils/request';
import { showToast } from 'vant';
import ChatBubble from '../components/ChatBubble.vue'
import { useSmartScroll } from '../composables/useSmartScroll'

const router = useRouter();
const messages = ref([]);
const quickQuestions = ref([
  '北京有哪些必去的景点？',
  '上海美食推荐',
  '成都三日游攻略',
  '如何选择旅行保险？'
])
const chatContainer = ref(null);
const { throttledScrollToBottom, resetAutoScroll, scrollToBottom } = useSmartScroll(chatContainer)
const handleClickTag = (question) => {
  inputMessage.value = question
  sendMessage()
}
const inputMessage = ref('');
const isStreaming = ref(false);
const sendMessage = () => { 
  const msg = inputMessage.value.trim();
  if (!msg) {
    return
  }
  addUserMessage(msg)
  inputMessage.value = ''
  fetchAIResponse(msg)
}
const fetchAIResponse = (userMsg) => { 
  isStreaming.value = true
  messages.value.push({
    id: Date.now() + 1,
    role: 'ai',
    content: '',
    timestamp: new Date().toISOString(),
  })

  let fullResponse = ''

  fetchStream('chat', { message: userMsg }, (chunk) => {
      fullResponse += chunk ?? ''
      const lastMsg = messages.value[messages.value.length - 1]

      if (lastMsg && lastMsg.role === 'ai') {
        lastMsg.content = fullResponse
      }
      throttledScrollToBottom()
    }, () => {
      isStreaming.value = false
      scrollToBottom()
    }, (errMsg) => {
      const lastMsg = messages.value[messages.value.length - 1]
      if (lastMsg && lastMsg.role === 'ai') {
        lastMsg.content = `抱歉，AI发生错误：${errMsg}`
      }
      isStreaming.value = false
      showToast('AI回复失败!')
      scrollToBottom()
    }
  )
}
const addUserMessage = (content) => { 
  messages.value.push({
    id: Date.now(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  })
  resetAutoScroll()
}

const route = useRoute()
onMounted(() => { 
  if(route.query.scene === 'detail' && route.query.city){
    inputMessage.value = `我想了解一下${route.query.city}的旅游景点`
 }
})
</script>

<style scoped>
.page-header{
  height:46px;
}

.chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding-bottom: 0px !important;
}

.chat-container {
  /* flex: 1; */
  height: 750px;
  overflow-y: auto;
  padding: 16px;
  padding-bottom: 130px;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.quick-questions {
  margin-top: 32px;
  text-align: center;
}

.quick-title {
  font-size: 14px;
  color: #999;
  margin-bottom: 16px;
}

.quick-tag {
  margin: 8px;
  cursor: pointer;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  color: #999;
  font-size: 14px;
}

.chat-input-area {
  position: fixed;
  bottom: 50px;
  left: 0;
  right: 0;
  background: #fff;
  padding: 8px 16px;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
  max-width: 750px;
  margin: 0 auto;
}

.chat-input-area :deep(.van-field) {
  background: #f7f8fa;
  border-radius: 20px;
  padding: 8px 16px;
}
</style>
