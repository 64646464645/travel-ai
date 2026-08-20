import 'dotenv/config'
import express, { type Request, type Response, type NextFunction } from 'express'
import travelRouter from './routes/travel.js'
import sessionsRouter from './routes/sessions.js'
import cors from 'cors'
import { initSchema } from './db/mysql.js'

const app = express()
const port = process.env.PORT

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.get('/api/heartbeat', (_req: Request, res: Response) => {
  res.json({
    message: '服务正常运行',
    timestamp: new Date().toISOString()
  })
})

app.use('/api/travel/sessions', sessionsRouter)
app.use('/api/travel', travelRouter)

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('服务器错误', err)
  res.status(500).json({
    success: false,
    error: err.message,
    message: '服务器错误',
    timestamp: new Date().toISOString()
  })
})

initSchema().catch((err) => {
  console.error('初始化数据库表失败', err)
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
