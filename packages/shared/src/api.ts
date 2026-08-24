/** 有数据的成功响应 */
export interface ApiSuccess<T> {
  success: true
  data: T
}

/** 无数据的成功响应（如 logout、delete） */
export interface ApiSuccessEmpty {
  success: true
}

/** 业务错误响应（4xx / 5xx） */
export interface ApiError {
  success: false
  message: string
  timestamp: string
}

/** 通用 JSON 接口响应 */
export type ApiResponse<T> = ApiSuccess<T> | ApiSuccessEmpty | ApiError
