<template>
    <div class="page-container">
    <div class="page-header">
      <van-nav-bar title="智能旅游助手" />
    </div>
    <div class="page-content">
      <van-notice-bar
        left-icon="info-o"
        text="基于 AI 的智能景点介绍与行程规划系统"
        style="margin-bottom: 16px"
      />
      <div class="card search-card">
        <div class="section-title">
          规划你的旅程
        </div>
          <van-cell-group inset>
            <van-field is-link readonly v-model="formData.city" label="目的地" placeholder="请选择城市" @click="showCityPicker = true" style="background: #f7f8fa; border-radius: 8px; margin-bottom: 12px;"/>
            <van-field type="number" is-link v-model="formData.budget" label="预算（元）" placeholder="请输入预算金额" style="background: #f7f8fa; border-radius: 8px; margin-bottom: 12px;"/>
            <van-field type="digit" is-link v-model="formData.days" label="天数" placeholder="请输入天数" style="background: #f7f8fa; border-radius: 8px; margin-bottom: 12px;"/>
            <van-button type="primary" size="large" round :loading="isLoading" @click="handleSubmit">开始规划</van-button>
          </van-cell-group>
      </div>
      <div class="card"></div>
      <div class="card"></div>
    </div>
    <van-popup
      round
      v-model:show="showCityPicker"
      position="bottom"
    >
      <van-picker
      title="请选择目的地"
      :columns="cityColumns"
      @confirm="handleCityConfirm"
      @cancel="showCityPicker = false"
      >
      </van-picker>
    </van-popup>
  </div>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router'
import { showToast } from 'vant'

const router = useRouter()

interface FormData {
  city: string
  budget: number | undefined
  days: number | undefined
}

const formData = reactive<FormData>({
  city: '',
  budget: undefined,
  days: undefined
})
const showCityPicker = ref(false)
const isLoading = ref(false)
const allCities = [
  '北京', '上海', '广州', '深圳', '成都', '杭州', '西安', '重庆',
  '南京', '武汉', '苏州', '长沙', '天津', '郑州', '济南', '青岛',
  '大连', '沈阳', '哈尔滨', '长春', '福州', '厦门', '南昌', '合肥',
  '昆明', '贵阳', '南宁', '桂林', '海口', '三亚', '丽江', '大理',
  '西安', '兰州', '乌鲁木齐', '拉萨', '呼和浩特', '太原', '石家庄'
]
const cityColumns = allCities.map(city => ({ text: city, value: city }))

const handleCityConfirm = ({ selectedOptions }: { selectedOptions: { value: string }[] }) => {
  formData.city = selectedOptions[0]?.value ?? ''
  showCityPicker.value = false
}
const handleFormData = () => { 
  return {
    city: formData.city,
    budget: formData.budget,
    days: formData.days
  }
}
const handleSubmit = () => {
  isLoading.value = true
  // 判断目的地是否为空
  if (!formData.city) {
    showToast('请选择目的地')
    isLoading.value = false
    return
  }
  // 判断预算
  if (!formData.budget || formData.budget < 100) {
    showToast('预算不能低于100元')
    isLoading.value = false
    return
  }
  // 判断天数
  if (!formData.days || formData.days < 1 || formData.days > 30) {
    showToast('天数必须在1到30天之间')
    isLoading.value = false
    return
  } 
  router.push({
    path: '/detail',
    query: handleFormData()
  })

}

</script>

<style scoped>
.search-card {
  margin-bottom: 16px;
}
</style>