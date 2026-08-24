import 'dotenv/config'
import express, { type Request, type Response, type NextFunction } from 'express'
import travelRouter from './routes/travel.js'
import sessionsRouter from './routes/sessions.js'
import authRouter from './routes/auth.js'
import statsRouter from './routes/stats.js'
import cors from 'cors'
import { initSchema } from './db/mysql.js'
import swaggerUi from 'swagger-ui-express'
import { buildOpenApiDocument } from './swagger.js'

const app = express()
const port = Number(process.env.PORT) || 3300

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

if (process.env.NODE_ENV !== 'production') {
  const openApiDocument = buildOpenApiDocument()
  app.get('/api-docs.json', (_req: Request, res: Response) => {
    res.json(openApiDocument)
  })
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))
}

app.get('/api/heartbeat', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      message: '服务正常运行',
      timestamp: new Date().toISOString(),
    },
  })
})

app.use('/api/stats', statsRouter)

app.use('/api/travel/sessions', sessionsRouter)
app.use('/api/travel', travelRouter)
app.use('/api/auth', authRouter)

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('服务器错误', err)
  res.status(500).json({
    success: false,
    message: '服务器错误',
    timestamp: new Date().toISOString()
  })
})

async function startServer(): Promise<void> {
  try {
    await initSchema()
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`)
    })
  } catch (error) {
    console.error('初始化数据库表失败', error)
    process.exitCode = 1
  }
}

void startServer()
