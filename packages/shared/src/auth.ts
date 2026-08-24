import { z } from 'zod'

export const UsernameSchema = z
  .string()
  .trim()
  .min(3, '用户名至少需要3位')
  .max(64, '用户名不能超过64位')
  .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线')

export const PasswordSchema = z.string().min(8, '密码至少需要8位')

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  nickname: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const RegisterRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  nickname: z.string().trim().min(1).max(64).optional(),
})

export const LoginRequestSchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1, '请输入密码'),
})

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1, '缺少 refresh token'),
})

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: UserSchema,
})

export type User = z.infer<typeof UserSchema>
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>
export type LoginRequest = z.infer<typeof LoginRequestSchema>
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>
export type AuthResponse = z.infer<typeof AuthResponseSchema>
