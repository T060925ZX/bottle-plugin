import { getDb } from './database.js'

export function statusText(status) {
    if (status === 'approved') return '已过审'
    if (status === 'pending') return '审核中'
    return '未过审'
}

export function safeSnippet(bottle, maxLength = 30) {
    if (!bottle?.content) return '无内容'
    if (bottle.status === 'pending') return '内容正在审核...'
    if (bottle.status === 'rejected') return '内容未过审...'
    return bottle.content.length > maxLength
        ? `${bottle.content.slice(0, maxLength)}...`
        : bottle.content
}

export async function bottleCounts() {
    const db = await getDb()
    const [
        total,
        sea,
        home,
        approved,
        pending,
        rejected,
        comments,
        pickups,
        users
    ] = await Promise.all([
        db.get('SELECT COUNT(*) count FROM bottles'),
        db.get("SELECT COUNT(*) count FROM bottles WHERE location = 'sea'"),
        db.get("SELECT COUNT(*) count FROM bottles WHERE location = 'home'"),
        db.get("SELECT COUNT(*) count FROM bottles WHERE location = 'sea' AND status = 'approved'"),
        db.get("SELECT COUNT(*) count FROM bottles WHERE location = 'sea' AND status = 'pending'"),
        db.get("SELECT COUNT(*) count FROM bottles WHERE location = 'sea' AND status = 'rejected'"),
        db.get('SELECT COUNT(*) count FROM comments'),
        db.get('SELECT COALESCE(SUM(pickupCount), 0) count FROM bottles'),
        db.get(`
            SELECT COUNT(DISTINCT user) count FROM (
                SELECT thrower user FROM bottles
                UNION SELECT userId user FROM pickup_records
                UNION SELECT userId user FROM comments
            )
        `)
    ])
    return {
        total: total.count,
        sea: sea.count,
        home: home.count,
        approved: approved.count,
        pending: pending.count,
        rejected: rejected.count,
        comments: comments.count,
        pickups: pickups.count,
        users: users.count
    }
}
