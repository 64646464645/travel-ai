<template>
  <div class="plan-card">
    <div class="plan-head">
      <div>
        <div class="plan-city">{{ plan.city }}</div>
        <div class="plan-meta">{{ plan.days }} 天 · {{ activityCount }} 个活动 · {{ verifiedCount }} 个已核实</div>
      </div>
      <div class="plan-budget">
        <span class="budget-label">预算</span>
        <span class="budget-value">¥{{ plan.totalBudget }}</span>
      </div>
    </div>

    <div v-if="plan.rationale" class="plan-rationale">{{ plan.rationale }}</div>

    <div v-if="errors.length" class="plan-alert">
      <van-icon name="warning-o" />
      <span>有 {{ errors.length }} 项硬性约束未通过，建议调整后再出行</span>
    </div>

    <van-collapse v-model="activeDays">
      <van-collapse-item
        v-for="day in plan.dailyItinerary"
        :key="day.day"
        :name="day.day"
      >
        <template #title>
          <span class="day-title">第 {{ day.day }} 天</span>
          <span class="day-date">{{ day.date }}</span>
        </template>

        <div v-for="slot in slotsOf(day)" :key="slot.key" class="slot">
          <div class="slot-head">
            <span class="slot-tag">{{ slot.label }}</span>
            <span class="slot-spot">{{ slot.activity.spot }}</span>
            <van-icon v-if="slot.activity.source" name="passed" class="slot-verified" />
          </div>
          <div class="slot-meta">
            <span v-if="slot.activity.duration">{{ slot.activity.duration }}</span>
            <span v-if="slot.activity.ticket">{{ slot.activity.ticket }}</span>
            <span v-if="slot.activity.travelFromPrevious" class="slot-travel">
              <van-icon name="guide-o" />
              {{ travelText(slot.activity.travelFromPrevious) }}
            </span>
          </div>
          <div v-if="slot.activity.description" class="slot-desc">{{ slot.activity.description }}</div>
        </div>
      </van-collapse-item>
    </van-collapse>

    <div class="plan-section">
      <div class="section-heading">预算明细</div>
      <BudgetTable :data="plan.budgetBreakdown" :total-budget="plan.totalBudget" />
    </div>

    <div v-if="plan.tips.length" class="plan-section">
      <div class="section-heading">实用提示</div>
      <div v-for="(tip, index) in plan.tips" :key="index" class="tip-item">· {{ tip }}</div>
    </div>

    <div v-if="plan.warnings.length" class="plan-section">
      <div class="section-heading">注意事项</div>
      <div v-for="(warning, index) in plan.warnings" :key="index" class="warn-item">· {{ warning }}</div>
    </div>

    <div v-if="errors.length" class="plan-section">
      <div class="section-heading">未通过校验</div>
      <div v-for="issue in errors" :key="issue.path + issue.ruleId" class="error-item">
        · [{{ issue.ruleId }}] {{ issue.message }}
        <div v-if="issue.suggestion" class="issue-suggestion">建议：{{ issue.suggestion }}</div>
      </div>
    </div>

    <div v-if="warnings.length" class="plan-section">
      <div class="section-heading">校验提示</div>
      <div v-for="issue in warnings" :key="issue.path + issue.ruleId" class="warn-item">
        · [{{ issue.ruleId }}] {{ issue.message }}
      </div>
    </div>

    <van-collapse v-if="plan.unverified.length" v-model="showUnverified" class="unverified">
      <van-collapse-item :name="1">
        <template #title>
          <span class="unverified-title">有 {{ plan.unverified.length }} 项信息未能核实</span>
        </template>
        <div v-for="(item, index) in plan.unverified" :key="index" class="unverified-item">· {{ item }}</div>
      </van-collapse-item>
    </van-collapse>

    <div v-if="showSave" class="plan-actions">
      <van-button
        v-if="!saved"
        size="small"
        type="primary"
        plain
        :loading="saving"
        @click="emit('save')"
      >
        保存行程
      </van-button>
      <span v-else class="saved-link" @click="emit('open')">
        <van-icon name="passed" />
        已保存到我的行程
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  AgentActivity,
  AgentDailyItinerary,
  AgentPlan,
  AgentValidationIssue,
} from '@travel/shared'
import BudgetTable from './BudgetTable.vue'

const props = defineProps<{
  plan: AgentPlan
  issues?: AgentValidationIssue[]
  /** 详情页展示已保存的计划时不需要再给保存按钮 */
  showSave?: boolean
  saving?: boolean
  saved?: boolean
}>()

const emit = defineEmits<{ save: []; open: [] }>()

const activeDays = ref<number[]>([1])
const showUnverified = ref<number[]>([])

const SLOTS: Array<{ key: 'morning' | 'afternoon' | 'evening'; label: string }> = [
  { key: 'morning', label: '上午' },
  { key: 'afternoon', label: '下午' },
  { key: 'evening', label: '晚上' },
]

function slotsOf(day: AgentDailyItinerary): Array<{ key: string; label: string; activity: AgentActivity }> {
  return SLOTS.map((slot) => ({ key: `${day.day}-${slot.key}`, label: slot.label, activity: day[slot.key] }))
}

const activityCount = computed(() => props.plan.dailyItinerary.length * 3)

const verifiedCount = computed(() => {
  let total = 0
  for (const day of props.plan.dailyItinerary) {
    for (const slot of SLOTS) {
      if (day[slot.key].source) total += 1
    }
  }
  return total
})

const errors = computed(() => (props.issues ?? []).filter((issue) => issue.severity === 'error'))
const warnings = computed(() => (props.issues ?? []).filter((issue) => issue.severity === 'warning'))

function travelText(leg: NonNullable<AgentActivity['travelFromPrevious']>): string {
  const mode = leg.mode === 'walking' ? '步行' : leg.mode === 'transit' ? '公交' : '驾车'
  return `距上一站${mode} ${leg.durationMin} 分钟 / ${leg.distanceKm}km${leg.estimated ? '（估算）' : ''}`
}
</script>

<style scoped>
.plan-card {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #ebedf0;
  padding: 12px;
  margin: 8px 0 16px;
}

.plan-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.plan-city {
  font-size: 17px;
  font-weight: 600;
  color: #323233;
}

.plan-meta {
  font-size: 12px;
  color: #969799;
  margin-top: 4px;
}

.plan-budget {
  text-align: right;
  flex: none;
}

.budget-label {
  display: block;
  font-size: 11px;
  color: #969799;
}

.budget-value {
  font-size: 18px;
  font-weight: 600;
  color: #ee0a24;
}

.plan-rationale {
  margin-top: 10px;
  padding: 8px 10px;
  background: #f7f8fa;
  border-radius: 8px;
  font-size: 13px;
  color: #646566;
  line-height: 1.6;
}

.day-title {
  font-size: 14px;
  font-weight: 500;
  color: #323233;
}

.day-date {
  margin-left: 8px;
  font-size: 12px;
  color: #969799;
}

.slot {
  padding: 8px 0;
  border-bottom: 1px dashed #f2f3f5;
}

.slot:last-child {
  border-bottom: none;
}

.slot-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.slot-tag {
  font-size: 11px;
  color: #1989fa;
  background: rgba(25, 137, 250, 0.1);
  border-radius: 4px;
  padding: 1px 6px;
  flex: none;
}

.slot-spot {
  font-size: 14px;
  color: #323233;
  font-weight: 500;
}

.slot-verified {
  color: #07c160;
  font-size: 13px;
}

.slot-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
  font-size: 12px;
  color: #969799;
}

.slot-travel {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.slot-desc {
  margin-top: 4px;
  font-size: 13px;
  color: #646566;
  line-height: 1.5;
}

.plan-section {
  margin-top: 16px;
}

.section-heading {
  font-size: 13px;
  font-weight: 600;
  color: #323233;
  margin-bottom: 6px;
}

.tip-item,
.warn-item,
.unverified-item {
  font-size: 13px;
  color: #646566;
  line-height: 1.7;
}

.warn-item {
  color: #ff976a;
}

.plan-alert {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(238, 10, 36, 0.08);
  color: #ee0a24;
  font-size: 13px;
}

.error-item {
  font-size: 13px;
  color: #ee0a24;
  line-height: 1.7;
}

.issue-suggestion {
  color: #969799;
  font-size: 12px;
  padding-left: 10px;
}

.unverified {
  margin-top: 12px;
}

.unverified-title {
  font-size: 13px;
  color: #969799;
}

.plan-actions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.saved-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #07c160;
  cursor: pointer;
}
</style>
