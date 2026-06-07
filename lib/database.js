import { PATHS } from './paths.js'

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
                `无法加载 SQLite。Node 22.5+ 可直接使用；旧版本请安装 sqlite 和 sqlite3。`
                + ` built-in=${builtInError.message}; fallback=${fallbackError.message}`
            )
        }
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
            location TEXT NOT NULL DEFAULT 'sea'
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bottleId TEXT NOT NULL,
            userId TEXT NOT NULL,
            userName TEXT NOT NULL,
            content TEXT NOT NULL,
            time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
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
