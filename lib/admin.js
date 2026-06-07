import { getDb } from './database.js'

const BOTTLE_STATUSES = new Set(['pending', 'approved', 'rejected'])
const LOCATIONS = new Set(['sea', 'home'])
const COMMENT_STATUSES = new Set(['pending', 'approved', 'rejected'])

function clampInteger(value, fallback, min, max) {
    const number = Number.parseInt(value, 10)
    if (!Number.isFinite(number)) return fallback
    return Math.min(max, Math.max(min, number))
}

export async function getAdminStats() {
    const db = await getDb()
    const rows = await db.all(`
        SELECT status, location, COUNT(*) count
        FROM bottles
        GROUP BY status, location
    `)
    const comments = await db.all(`
        SELECT status, COUNT(*) count
        FROM comments
        GROUP BY status
    `)
    const stats = {
        bottles: {
            total: 0,
            pending: 0,
            approved: 0,
            rejected: 0,
            sea: 0,
            home: 0
        },
        comments: {
            total: 0,
            pending: 0,
            approved: 0,
            rejected: 0
        }
    }
    for (const row of rows) {
        const count = Number(row.count)
        stats.bottles.total += count
        if (row.status in stats.bottles) stats.bottles[row.status] += count
        if (row.location in stats.bottles) stats.bottles[row.location] += count
    }
    for (const row of comments) {
        const count = Number(row.count)
        stats.comments.total += count
        if (row.status in stats.comments) stats.comments[row.status] += count
    }
    return stats
}

export async function listBottles(options = {}) {
    const db = await getDb()
    const page = clampInteger(options.page, 1, 1, 1000000)
    const pageSize = clampInteger(options.pageSize, 20, 1, 100)
    const where = []
    const params = []

    if (BOTTLE_STATUSES.has(options.status)) {
        where.push('b.status = ?')
        params.push(options.status)
    }
    if (LOCATIONS.has(options.location)) {
        where.push('b.location = ?')
        params.push(options.location)
    }
    if (options.keyword) {
        const keyword = `%${String(options.keyword).slice(0, 100)}%`
        where.push('(b.id LIKE ? OR b.content LIKE ? OR b.thrower LIKE ? OR b.throwerName LIKE ?)')
        params.push(keyword, keyword, keyword, keyword)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = await db.get(`
        SELECT COUNT(*) count
        FROM bottles b
        ${whereSql}
    `, params)
    const rows = await db.all(`
        SELECT
            b.*,
            (SELECT COUNT(*) FROM comments c WHERE c.bottleId = b.id) commentCount,
            (SELECT COUNT(*) FROM comments c WHERE c.bottleId = b.id AND c.status = 'pending') pendingCommentCount
        FROM bottles b
        ${whereSql}
        ORDER BY
            CASE b.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
            b.throwTime DESC
        LIMIT ? OFFSET ?
    `, [...params, pageSize, (page - 1) * pageSize])

    return {
        rows,
        total: Number(total.count),
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(Number(total.count) / pageSize))
    }
}

export async function getBottleDetail(bottleId) {
    const db = await getDb()
    const bottle = await db.get('SELECT * FROM bottles WHERE id = ?', bottleId)
    if (!bottle) return null
    const [comments, pickupRecords] = await Promise.all([
        db.all('SELECT * FROM comments WHERE bottleId = ? ORDER BY time DESC', bottleId),
        db.all('SELECT * FROM pickup_records WHERE bottleId = ? ORDER BY time DESC LIMIT 200', bottleId)
    ])
    return { ...bottle, comments, pickupRecords }
}

export async function updateBottle(bottleId, changes = {}) {
    const updates = []
    const params = []
    if (BOTTLE_STATUSES.has(changes.status)) {
        updates.push('status = ?')
        params.push(changes.status)
    }
    if (LOCATIONS.has(changes.location)) {
        updates.push('location = ?')
        params.push(changes.location)
    }
    if (!updates.length) throw new Error('没有可更新的字段')
    params.push(bottleId)
    const db = await getDb()
    const result = await db.run(
        `UPDATE bottles SET ${updates.join(', ')} WHERE id = ?`,
        params
    )
    if (!Number(result.changes)) throw new Error('漂流瓶不存在')
    return getBottleDetail(bottleId)
}

export async function deleteBottle(bottleId) {
    const db = await getDb()
    const result = await db.run('DELETE FROM bottles WHERE id = ?', bottleId)
    if (!Number(result.changes)) throw new Error('漂流瓶不存在')
    return true
}

export async function updateComment(commentId, status) {
    if (!COMMENT_STATUSES.has(status)) throw new Error('评论状态无效')
    const db = await getDb()
    const result = await db.run('UPDATE comments SET status = ? WHERE id = ?', [
        status,
        clampInteger(commentId, 0, 1, Number.MAX_SAFE_INTEGER)
    ])
    if (!Number(result.changes)) throw new Error('评论不存在')
    return true
}

export async function deleteComment(commentId) {
    const db = await getDb()
    const result = await db.run(
        'DELETE FROM comments WHERE id = ?',
        clampInteger(commentId, 0, 1, Number.MAX_SAFE_INTEGER)
    )
    if (!Number(result.changes)) throw new Error('评论不存在')
    return true
}
