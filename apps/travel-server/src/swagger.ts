import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  AuthResponseSchema,
  ChatRequestSchema,
  LoginRequestSchema,
  RecommendRequestSchema,
  RefreshTokenRequestSchema,
  RegisterRequestSchema,
  RenameSessionRequestSchema,
  SessionMessageSchema,
  SessionSummarySchema,
  TravelPlanSchema,
  UserSchema,
} from '@travel/shared'

extendZodWithOpenApi(z)

const registry = new OpenAPIRegistry()

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  timestamp: z.string(),
})

const EmptySuccessSchema = z.object({
  success: z.literal(true),
})

const HeartbeatDataSchema = z.object({
  message: z.string(),
  timestamp: z.string(),
})

const SessionMessagesDataSchema = z.object({
  sessionId: z.string(),
  messages: z.array(SessionMessageSchema),
})

const MetricsSnapshotSchema = z.object({
  counters: z.record(z.string(), z.number()),
  histograms: z.record(z.string(), z.object({
    labels: z.array(z.string()),
    counts: z.array(z.number()),
    total: z.number(),
    avg: z.number().nullable(),
  })),
  retrieval: z.object({ hitRate: z.number().nullable() }),
  queue: z.object({ pending: z.number() }),
})

const apiResponse = <T extends z.ZodType>(data: T) => z.object({
  success: z.literal(true),
  data,
})

const ErrorResponse = registry.register('ErrorResponse', ErrorResponseSchema)
const EmptySuccess = registry.register('EmptySuccess', EmptySuccessSchema)
const ApiResponseAuth = registry.register('ApiResponseAuth', apiResponse(AuthResponseSchema))
const ApiResponseUser = registry.register('ApiResponseUser', apiResponse(UserSchema))
const ApiResponseSession = registry.register('ApiResponseSession', apiResponse(SessionSummarySchema))
const ApiResponseSessionList = registry.register(
  'ApiResponseSessionList',
  apiResponse(z.array(SessionSummarySchema)),
)
const ApiResponseMessages = registry.register(
  'ApiResponseMessages',
  apiResponse(SessionMessagesDataSchema),
)
const ApiResponseTravelPlan = registry.register(
  'ApiResponseTravelPlan',
  apiResponse(TravelPlanSchema),
)
const ApiResponseHeartbeat = registry.register(
  'ApiResponseHeartbeat',
  apiResponse(HeartbeatDataSchema),
)
const MetricsSnapshot = registry.register('MetricsSnapshot', MetricsSnapshotSchema)

registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
})

const jsonResponse = (schema: z.ZodType, description = '成功') => ({
  description,
  content: { 'application/json': { schema } },
})

const errorResponse = (description: string) => jsonResponse(ErrorResponse, description)

const authSecurity = [{ BearerAuth: [] }]

registry.registerPath({
  method: 'post',
  path: '/api/auth/register',
  operationId: 'register',
  summary: '注册用户',
  request: { body: { content: { 'application/json': { schema: RegisterRequestSchema } } } },
  responses: {
    201: jsonResponse(ApiResponseAuth),
    400: errorResponse('参数校验失败'),
    409: errorResponse('用户名已存在'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  operationId: 'login',
  summary: '用户登录',
  request: { body: { content: { 'application/json': { schema: LoginRequestSchema } } } },
  responses: {
    200: jsonResponse(ApiResponseAuth),
    400: errorResponse('参数校验失败'),
    401: errorResponse('凭据错误'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  operationId: 'refreshToken',
  summary: '刷新访问令牌',
  request: { body: { content: { 'application/json': { schema: RefreshTokenRequestSchema } } } },
  responses: {
    200: jsonResponse(ApiResponseAuth),
    400: errorResponse('参数校验失败'),
    401: errorResponse('令牌无效'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  operationId: 'logout',
  summary: '退出登录',
  request: { body: { content: { 'application/json': { schema: RefreshTokenRequestSchema } } } },
  responses: {
    200: jsonResponse(EmptySuccess),
    400: errorResponse('参数校验失败'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  operationId: 'getMe',
  summary: '获取当前登录用户',
  security: authSecurity,
  responses: {
    200: jsonResponse(ApiResponseUser),
    401: errorResponse('未登录或令牌失效'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/travel/sessions',
  operationId: 'createSession',
  summary: '创建会话',
  security: authSecurity,
  responses: {
    200: jsonResponse(ApiResponseSession),
    401: errorResponse('未登录'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/travel/sessions',
  operationId: 'listSessions',
  summary: '获取会话列表',
  security: authSecurity,
  responses: {
    200: jsonResponse(ApiResponseSessionList),
    401: errorResponse('未登录'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/travel/sessions/{sessionId}/messages',
  operationId: 'getSessionMessages',
  summary: '获取会话消息',
  security: authSecurity,
  request: { params: z.object({ sessionId: z.string() }) },
  responses: {
    200: jsonResponse(ApiResponseMessages),
    401: errorResponse('未登录'),
    404: errorResponse('会话不存在'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'patch',
  path: '/api/travel/sessions/{sessionId}',
  operationId: 'renameSession',
  summary: '重命名会话',
  security: authSecurity,
  request: {
    params: z.object({ sessionId: z.string() }),
    body: { content: { 'application/json': { schema: RenameSessionRequestSchema } } },
  },
  responses: {
    200: jsonResponse(ApiResponseSession),
    400: errorResponse('参数校验失败'),
    401: errorResponse('未登录'),
    404: errorResponse('会话不存在'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'delete',
  path: '/api/travel/sessions/{sessionId}',
  operationId: 'deleteSession',
  summary: '删除会话',
  security: authSecurity,
  request: { params: z.object({ sessionId: z.string() }) },
  responses: {
    200: jsonResponse(EmptySuccess),
    401: errorResponse('未登录'),
    404: errorResponse('会话不存在'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/travel/recommend',
  operationId: 'recommendTravel',
  summary: '生成旅行推荐',
  security: authSecurity,
  request: { body: { content: { 'application/json': { schema: RecommendRequestSchema } } } },
  responses: {
    200: jsonResponse(ApiResponseTravelPlan),
    400: errorResponse('参数校验失败'),
    401: errorResponse('未登录'),
    502: errorResponse('AI 服务失败'),
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/travel/chat',
  operationId: 'chat',
  summary: '流式聊天',
  security: authSecurity,
  request: { body: { content: { 'application/json': { schema: ChatRequestSchema } } } },
  responses: {
    200: { description: 'SSE 事件流', content: { 'text/event-stream': {} } },
    400: errorResponse('参数校验失败'),
    401: errorResponse('未登录'),
    404: errorResponse('会话不存在'),
    500: errorResponse('服务异常'),
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/heartbeat',
  operationId: 'heartbeat',
  summary: '服务心跳',
  responses: { 200: jsonResponse(ApiResponseHeartbeat) },
})

registry.registerPath({
  method: 'get',
  path: '/api/stats',
  operationId: 'getStats',
  summary: '获取内部运行指标',
  responses: { 200: jsonResponse(apiResponse(MetricsSnapshot)) },
})

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: { title: 'travel-server API', version: '1.0.0' },
  })
}
