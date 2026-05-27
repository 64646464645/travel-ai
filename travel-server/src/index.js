import 'dotenv/config'
import express from 'express';
import travelRouter from './routes/travel.js';
import cors from 'cors';

const app = express();
const port = process.env.PORT;

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))


app.get('/api/heartbeat', (req, res) => {
  res.json({
    message: '服务正常运行',
    timestamp: new Date().toISOString()
  })
})

app.use('/api/travel', travelRouter)

app.use((err, req, res, next) => {
  console.error('服务器错误', err)
  res.status(500).json({
    success: false,
    error: err.message,
    message: '服务器错误',
    timestamp: new Date().toISOString()
  })
})
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});