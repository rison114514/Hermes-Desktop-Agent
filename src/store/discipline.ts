// 自律打卡模组类型定义

export type SlotStatus = 'pending' | 'completed' | 'missed'

export type DayType = 'weekday' | 'weekend' | 'custom'

export type SummaryColor = 'green' | 'orange' | 'red'

// 0=周日,1=周一...6=周六
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface ScheduleSlot {
  timeSlot: string        // "08:00-09:00"
  title: string
  status: SlotStatus
  description: string
}

export interface DailyGoal {
  title: string
  status: SlotStatus
  description: string
}

export interface AISummary {
  score: number           // 0-100
  color: SummaryColor
  text: string
  createdAt: number
}

export interface DailyPlan {
  date: string            // "2026-06-09"
  dayType: DayType
  schedule: ScheduleSlot[]
  dailyGoals: DailyGoal[]
  aiSummary: AISummary | null
  aiSummaryRequested: boolean
}

export interface DayTemplate {
  id: string              // "weekday" | "weekend" | custom id
  name: string
  schedule: Array<{ timeSlot: string; title: string }>
  dailyGoals: Array<{ title: string }>
  weekdayTargets: Weekday[]  // 该模板应被应用到哪些星期
}

export interface DisciplineData {
  plans: DailyPlan[]
  templates: DayTemplate[]
}
