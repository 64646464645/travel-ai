import mysql, { type RowDataPacket } from 'mysql2/promise'

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD ?? '',
  database: process.env.MYSQL_DATABASE ?? 'travel_ai',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT) || 10,
})

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [tableName],
  )
  return rows.length > 0
}

/** 将旧表 `chat_messages` 迁移为 `messages`（保留原数据） */
async function migrateChatMessagesToMessages(): Promise<void> {
  const hasLegacy = await tableExists('chat_messages')
  if (!hasLegacy) return

  const hasMessages = await tableExists('messages')
  if (!hasMessages) {
    await pool.query('RENAME TABLE chat_messages TO messages')
  }
}

/** 从 `messages` 中回填 `sessions`（title 取该会话首条 user 消息截断） */
async function backfillSessions(): Promise<void> {
  await pool.query(`
    INSERT IGNORE INTO sessions (session_id, title, summary, created_at, updated_at)
    SELECT
      m.session_id,
      LEFT(COALESCE((
        SELECT u.content FROM messages u
        WHERE u.session_id = m.session_id AND u.role = 'user'
        ORDER BY u.id ASC LIMIT 1
      ), '未命名会话'), 30),
      '',
      MIN(m.created_at),
      MAX(m.created_at)
    FROM messages m
    GROUP BY m.session_id
  `)
}

export async function initSchema(): Promise<void> {
  await migrateChatMessagesToMessages()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(36) NOT NULL,
      role VARCHAR(16) NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_session_id (session_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id VARCHAR(36) NOT NULL PRIMARY KEY,
      title VARCHAR(64) NOT NULL DEFAULT '',
      summary TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await backfillSessions()
}
