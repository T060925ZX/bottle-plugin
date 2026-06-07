import { PATHS } from './paths.js'

let moderationQueue = Promise.resolve()

function normalizeParams(args) {
    return args.length === 1 && Array.isArray(args[0]) ? args[0] : args
}

async function openDatabase() {
    try {
        const { DatabaseSync } = await import('node:sqlite')
        const database = new DatabaseSync(PATHS.database)
        return {
            exec(sql) {
                database.exec(sql)
            },
            run(sql, ...args) {
                const result = database.prepare(sql).run(...normalizeParams(args))
                return {
                    ...result,
                    changes: Number(result.changes || 0),
                    lastID: result.lastInsertRowid === undefined
                        ? undefined
                        : Number(result.lastInsertRowid)
                }
            },
            get(sql, ...args) {
                return database.prepare(sql).get(...normalizeParams(args))
            },
            all(sql, ...args) {
                return database.prepare(sql).all(...normalizeParams(args))
            }
        }
    } catch (builtInError) {
        try {
            const [{ open }, sqlite3Module] = await Promise.all([
                import('sqlite'),
                import('sqlite3')
            ])
            return open({
                filename: PATHS.database,
                driver: sqlite3Module.default.Database
            })
        } catch (fallbackError) {
            throw new Error(
                '无法加载 SQLite。Node 22.5+ 可直接使用；旧版本请安装 sqlite 和 sqlite3。'
                + ` built-in=${builtInError.message}; fallback=${fallbackError.message}`
            )
        }
    }
}

async function ensureColumn(database, table, column, definition) {
    const columns = await database.all(`PRAGMA table_info(${table})`)
    if (!columns.some(item => item.name === column)) {
        await database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
}

const dbPromise = openDatabase().then(async database => {
    await database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS bottles (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            thrower TEXT NOT NULL,
            throwerName TEXT NOT NULL,
            throwTime TEXT NOT NULL,
            pickupCount INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            location TEXT NOT NULL DEFAULT 'sea',
            moderationReason TEXT NOT NULL DEFAULT '',
            reviewedAt TEXT
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bottleId TEXT NOT NULL,
            userId TEXT NOT NULL,
            userName TEXT NOT NULL,
            content TEXT NOT NULL,
            time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            moderationReason TEXT NOT NULL DEFAULT '',
            reviewedAt TEXT,
            FOREIGN KEY (bottleId) REFERENCES bottles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pickup_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bottleId TEXT NOT NULL,
            userId TEXT NOT NULL,
            userName TEXT NOT NULL,
            time TEXT NOT NULL,
            FOREIGN KEY (bottleId) REFERENCES bottles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS counters (
            name TEXT PRIMARY KEY,
            value INTEGER NOT NULL DEFAULT 0
        );

        INSERT OR IGNORE INTO counters (name, value) VALUES ('bottle', 0);
    `)

    await ensureColumn(database, 'bottles', 'moderationReason', "TEXT NOT NULL DEFAULT ''")
    await ensureColumn(database, 'bottles', 'reviewedAt', 'TEXT')
    await ensureColumn(database, 'comments', 'moderationReason', "TEXT NOT NULL DEFAULT ''")
    await ensureColumn(database, 'comments', 'reviewedAt', 'TEXT')

    await database.exec(`
        CREATE INDEX IF NOT EXISTS idx_bottles_thrower_time_status
        ON bottles(thrower, throwTime, status);
        CREATE INDEX IF NOT EXISTS idx_bottles_status_time
        ON bottles(status, throwTime);
        CREATE INDEX IF NOT EXISTS idx_comments_status_time
        ON comments(status, time);
    `)
    return database
})

export function getDb() {
    return dbPromise
}

export async function generateBottleId() {
    const db = await getDb()
    const row = await db.get(`
        UPDATE counters
        SET value = value + 1
        WHERE name = ?
        RETURNING value
    `, 'bottle')
    return String(row.value).padStart(6, '0')
}

export function chinaDayRange(now = new Date()) {
    const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const start = Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate()
    ) - 8 * 60 * 60 * 1000
    return {
        start: new Date(start).toISOString(),
        end: new Date(start + 24 * 60 * 60 * 1000).toISOString()
    }
}

export async function getDailyApprovedBottleCount(userId, now = new Date()) {
    const db = await getDb()
    const range = chinaDayRange(now)
    const row = await db.get(`
        SELECT COUNT(*) count
        FROM bottles
        WHERE thrower = ?
          AND status = 'approved'
          AND throwTime >= ?
          AND throwTime < ?
    `, [String(userId), range.start, range.end])
    return Number(row.count)
}

export function setBottleModeration(bottleId, status, reason = '', options = {}) {
    const operation = moderationQueue.then(async () => {
        const allowed = new Set(['pending', 'approved', 'rejected'])
        if (!allowed.has(status)) throw new Error('漂流瓶审核状态无效')

        const db = await getDb()
        const bottle = await db.get('SELECT * FROM bottles WHERE id = ?', bottleId)
        if (!bottle) throw new Error('漂流瓶不存在')

        if (status === 'approved' && bottle.status !== 'approved') {
            const limit = Number(options.dailyLimit || 0)
            if (limit > 0) {
                const count = await getDailyApprovedBottleCount(bottle.thrower)
                if (count >= limit) {
                    throw new Error(`该用户今日已通过 ${limit} 个漂流瓶`)
                }
            }
        }

        const reviewedAt = status === 'pending' ? null : new Date().toISOString()
        await db.run(`
            UPDATE bottles
            SET status = ?, moderationReason = ?, reviewedAt = ?
            WHERE id = ?
        `, [status, String(reason || ''), reviewedAt, bottleId])
        return db.get('SELECT * FROM bottles WHERE id = ?', bottleId)
    })
    moderationQueue = operation.catch(() => {})
    return operation
}

export async function setCommentModeration(commentId, status, reason = '') {
    const allowed = new Set(['pending', 'approved', 'rejected'])
    if (!allowed.has(status)) throw new Error('评论审核状态无效')
    const db = await getDb()
    const reviewedAt = status === 'pending' ? null : new Date().toISOString()
    const result = await db.run(`
        UPDATE comments
        SET status = ?, moderationReason = ?, reviewedAt = ?
        WHERE id = ?
    `, [status, String(reason || ''), reviewedAt, Number(commentId)])
    if (!result.changes) throw new Error('评论不存在')
    return true
}
