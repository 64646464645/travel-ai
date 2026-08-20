<template>
  <div class="think-block">
    <button class="think-block__toggle" type="button" @click="expanded = !expanded">
      <van-icon :name="expanded ? 'arrow-down' : 'arrow'" />
      <span>{{ expanded ? '收起思考过程' : '展开思考过程' }}</span>
    </button>
    <div v-show="expanded" class="think-block__content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const expanded = ref(false)
</script>

<style scoped>
.think-block {
  margin: 8px 0;
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: hidden;
}

.think-block__toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: #f7f8fa;
  color: #969799;
  font-size: 13px;
  cursor: pointer;
}

.think-block__content {
  padding: 8px 12px;
  color: #969799;
  font-size: 13px;
  border-top: 1px solid #eee;
}
</style>
