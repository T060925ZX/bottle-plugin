import { loadConfig } from '../lib/config.js'
import { commonButtons } from '../lib/buttons.js'
import { bottleCounts, safeSnippet, statusText } from '../lib/bottle.js'
import {
    generateBottleId,
    getDailyApprovedBottleCount,
    getDb,
    setBottleModeration,
    setCommentModeration
} from '../lib/database.js'
import { checkContentSafety } from '../lib/moderation.js'
import { codeBlock, document, fields, formatTime, heading, status } from '../lib/markdown.js'
import { sendReply } from '../lib/reply.js'

const cooldowns = new Map()

function userIdOf(e) {
    return String(e.user_id)
}

function userNameOf(e) {
    return e.sender?.card || e.sender?.nickname || userIdOf(e)
}

function cooldownRemaining(key, seconds) {
    const remaining = Math.ceil(((cooldowns.get(key) || 0) + seconds * 1000 - Date.now()) / 1000)
    return Math.max(0, remaining)
}

function moderationMessage(result) {
    if (result.status === 'approved') return '内容已通过审核'
    if (result.status === 'pending') return result.reason
    // return `内容未通过审核：${result.reason}`
    return `内容未通过审核：${result.reason}`
}

export class DriftBottle extends plugin {
    constructor() {
        super({
            name: '漂流瓶',
            dsc: '支持内容审核、Markdown 和按钮的漂流瓶',
            event: 'message',
            priority: -100,
            rule: [
                { reg: '^#?(漂流瓶|瓶子)(状态|统计)$', fnc: 'bottleStatus' },
                { reg: '^#?(扔漂流瓶|扔瓶子)\\s*(.*)$', fnc: 'throwBottle' },
                { reg: '^#?(捡漂流瓶|捡瓶子)$', fnc: 'pickupBottle' },
                { reg: '^#?(评论漂流瓶|评论瓶子)\\s*(\\d{6})\\s*(.+)$', fnc: 'commentBottle' },
                { reg: '^#?(我的漂流瓶|我的瓶子)$', fnc: 'myBottles' },
                { reg: '^#?(查看评论|漂流瓶评论)\\s*(\\d{6})$', fnc: 'viewComments' },
                { reg: '^#?(捡回漂流瓶|捡回瓶子)\\s*(\\d{6})$', fnc: 'reclaimBottle' },
                { reg: '^#?(重新扔漂流瓶|重新扔瓶子)\\s*(\\d{6})$', fnc: 'rethrowBottle' },
                { reg: '^#?(漂流瓶帮助|瓶子帮助|漂流瓶|瓶子)$', fnc: 'showHelp' }
            ]
        })
    }

    async throwBottle(e) {
        const config = loadConfig()
        const content = e.msg.replace(/^#?(扔漂流瓶|扔瓶子)\s*/, '').trim()
        const userId = userIdOf(e)

        if (!content) {
            await sendReply(e, status('请输入漂流瓶内容', '示例：#扔漂流瓶 今天天气真好'), [
                commonButtons.throw()
            ])
            return true
        }
        if (content.length > config.limits.maxBottleLength) {
            await sendReply(e, status('内容过长', `请控制在 ${config.limits.maxBottleLength} 字以内`))
            return true
        }

        const db = await getDb()
        const approvedToday = await getDailyApprovedBottleCount(userId)
        if (
            config.limits.dailyApprovedBottles > 0
            && approvedToday >= config.limits.dailyApprovedBottles
        ) {
            await sendReply(e, status(
                '今日漂流瓶额度已用完',
                `每天最多通过 ${config.limits.dailyApprovedBottles} 个漂流瓶，未通过的不计入额度`
            ), [commonButtons.mine()])
            return true
        }

        const count = await db.get(
            "SELECT COUNT(*) count FROM bottles WHERE thrower = ? AND location = 'sea'",
            userId
        )
        if (count.count >= config.limits.maxBottlesPerUser) {
            await sendReply(e, status('无法继续扔瓶子', `你已有 ${count.count} 个漂流瓶在海里`), [
                commonButtons.mine()
            ])
            return true
        }

        const bottleId = await generateBottleId()
        const now = new Date().toISOString()
        await db.run(`
            INSERT INTO bottles
                (id, content, thrower, throwerName, throwTime, pickupCount, status, location)
            VALUES (?, ?, ?, ?, ?, 0, 'pending', 'sea')
        `, [bottleId, content, userId, userNameOf(e), now])

        await sendReply(e, status('正在审核', '漂流瓶已保存，正在检查内容', [['瓶子 ID', bottleId]]), [
            commonButtons.pickup(),
            commonButtons.status()
        ])

        const result = await checkContentSafety(content)
        try {
            await setBottleModeration(
                bottleId,
                result.status,
                result.reason,
                { dailyLimit: config.limits.dailyApprovedBottles }
            )
        } catch (error) {
            result.safe = false
            result.status = 'rejected'
            result.reason = error.message
            await setBottleModeration(bottleId, 'rejected', result.reason)
        }

        const title = result.status === 'approved'
            ? '漂流瓶已扔进海里'
            : result.status === 'pending'
                ? '漂流瓶等待人工审核'
                : '漂流瓶未通过审核'

        // 根据审核状态决定是否显示原文
        let contentDisplay = ''
        if (result.status === 'approved') {
            contentDisplay = codeBlock(content)
        } else if (result.status === 'pending') {
            contentDisplay = '> 内容正在审核中，通过后才会显示'
        } else {
            contentDisplay = '> 内容未通过审核，已被屏蔽'
        }

        await sendReply(e, document(
            heading(title),
            fields([
                ['瓶子 ID', bottleId],
                ['审核结果', moderationMessage(result)]
            ]),
            contentDisplay
        ), [
            commonButtons.throw(),
            commonButtons.pickup(),
            commonButtons.mine()
        ])
        return true
    }

    async pickupBottle(e) {
        const config = loadConfig()
        const userId = userIdOf(e)
        const key = `pickup:${userId}`
        const remaining = cooldownRemaining(key, config.cooldowns.pickupSeconds)
        if (remaining > 0) {
            await sendReply(e, status('捡瓶子冷却中', `请 ${remaining} 秒后再试`))
            return true
        }

        const db = await getDb()
        const bottle = await db.get(`
            SELECT * FROM bottles
            WHERE thrower != ? AND status = 'approved' AND location = 'sea'
            ORDER BY RANDOM()
            LIMIT 1
        `, userId)

        if (!bottle) {
            await sendReply(e, status('海里暂时没有可捡的漂流瓶', '过一会儿再来看看'), [
                commonButtons.throw(),
                commonButtons.status()
            ])
            return true
        }

        const time = new Date().toISOString()
        await db.run('UPDATE bottles SET pickupCount = pickupCount + 1 WHERE id = ?', bottle.id)
        await db.run(`
            INSERT INTO pickup_records (bottleId, userId, userName, time)
            VALUES (?, ?, ?, ?)
        `, [bottle.id, userId, userNameOf(e), time])
        cooldowns.set(key, Date.now())

        const commentCount = await db.get(
            "SELECT COUNT(*) count FROM comments WHERE bottleId = ? AND status = 'approved'",
            bottle.id
        )

        await sendReply(e, document(
            heading('你捡到一个漂流瓶'),
            codeBlock(bottle.content),
            fields([
                ['瓶子 ID', bottle.id],
                ['扔出时间', formatTime(bottle.throwTime)],
                ['评论数', commentCount.count],
                ['被捡次数', bottle.pickupCount + 1]
            ])
        ), [
            commonButtons.comment(bottle.id),
            commonButtons.comments(bottle.id),
            commonButtons.pickup(),
            commonButtons.throw()
        ])
        return true
    }

    async commentBottle(e) {
        const match = e.msg.match(/^#?(评论漂流瓶|评论瓶子)\s*(\d{6})\s*(.+)$/)
        if (!match) {
            await sendReply(e, status('评论格式错误', '示例：#评论漂流瓶 000001 写得真不错'))
            return true
        }

        const config = loadConfig()
        const bottleId = match[2]
        const content = match[3].trim()
        if (content.length > config.limits.maxCommentLength) {
            await sendReply(e, status('评论过长', `请控制在 ${config.limits.maxCommentLength} 字以内`))
            return true
        }

        const db = await getDb()
        const bottle = await db.get('SELECT * FROM bottles WHERE id = ?', bottleId)
        if (!bottle) {
            await sendReply(e, status('找不到漂流瓶', '请检查瓶子 ID'))
            return true
        }
        if (bottle.location !== 'sea' || bottle.status !== 'approved') {
            await sendReply(e, status('暂时无法评论', `漂流瓶当前状态：${statusText(bottle.status)}`))
            return true
        }

        const count = await db.get('SELECT COUNT(*) count FROM comments WHERE bottleId = ?', bottleId)
        if (count.count >= config.limits.maxCommentsPerBottle) {
            await sendReply(e, status('评论已达上限', '这个漂流瓶不能再添加评论了'))
            return true
        }

        const time = new Date().toISOString()
        const insert = await db.run(`
            INSERT INTO comments (bottleId, userId, userName, content, time, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `, [bottleId, userIdOf(e), userNameOf(e), content, time])

        await sendReply(e, status('正在审核评论', '评论已保存，请稍候', [['漂流瓶 ID', bottleId]]))
        const result = await checkContentSafety(content)
        await setCommentModeration(insert.lastID, result.status, result.reason)

        const title = result.status === 'approved'
            ? '评论已添加'
            : result.status === 'pending'
                ? '评论等待人工审核'
                : '评论未通过审核'

        // 根据审核状态决定是否显示评论原文
        let contentDisplay = ''
        if (result.status === 'approved') {
            contentDisplay = codeBlock(content)
        } else if (result.status === 'pending') {
            contentDisplay = '> 评论正在审核中，通过后才会显示'
        } else {
            contentDisplay = '> 评论未通过审核，已被屏蔽'
        }

        await sendReply(e, document(
            heading(title),
            fields([
                ['漂流瓶 ID', bottleId],
                ['审核结果', moderationMessage(result)]
            ]),
            contentDisplay
        ), [
            commonButtons.comments(bottleId),
            commonButtons.comment(bottleId),
            commonButtons.pickup()
        ])
        return true
    }

    async viewComments(e) {
        const bottleId = e.msg.match(/^#?(查看评论|漂流瓶评论)\s*(\d{6})$/)?.[2]
        if (!bottleId) return false

        const config = loadConfig()
        const db = await getDb()
        const bottle = await db.get('SELECT * FROM bottles WHERE id = ?', bottleId)
        if (!bottle) {
            await sendReply(e, status('找不到漂流瓶', '请检查瓶子 ID'))
            return true
        }
        if (bottle.location !== 'sea' || bottle.status !== 'approved') {
            await sendReply(e, status('评论不可查看', '漂流瓶已收回或尚未通过审核'))
            return true
        }

        const comments = await db.all(`
            SELECT * FROM comments
            WHERE bottleId = ?
            ORDER BY time DESC
            LIMIT ?
        `, [bottleId, config.limits.maxCommentsDisplay])

        if (!comments.length) {
            await sendReply(e, status('暂无评论', '来留下第一条评论吧'), [
                commonButtons.comment(bottleId)
            ])
            return true
        }

        const count = await db.get('SELECT COUNT(*) count FROM comments WHERE bottleId = ?', bottleId)
        const list = comments.map((comment, index) => {
            const content = comment.status === 'approved'
                ? comment.content
                : comment.status === 'pending'
                    ? '内容正在审核...'
                    : '内容未过审...'
            return `${index + 1}. ${content}\n   > ${formatTime(comment.time)} · ${statusText(comment.status)}`
        }).join('\n\n')

        await sendReply(e, document(
            heading(`漂流瓶 ${bottleId} 的评论`),
            list,
            fields([
                ['总评论数', count.count],
                ['当前显示', comments.length],
                ['漂流瓶内容', safeSnippet(bottle, 25)]
            ])
        ), [
            commonButtons.comment(bottleId),
            commonButtons.pickup(),
            commonButtons.throw()
        ])
        return true
    }

    async myBottles(e) {
        const db = await getDb()
        const bottles = await db.all(
            'SELECT * FROM bottles WHERE thrower = ? ORDER BY throwTime DESC',
            userIdOf(e)
        )
        if (!bottles.length) {
            await sendReply(e, status('你还没有扔过漂流瓶', '现在扔一个试试吧'), [
                commonButtons.throw()
            ])
            return true
        }

        const rows = await Promise.all(bottles.map(async bottle => {
            const comments = await db.get(
                'SELECT COUNT(*) count FROM comments WHERE bottleId = ?',
                bottle.id
            )
            const location = bottle.location === 'sea' ? '在海里' : '已捡回'
            return [
                `${bottle.id} · ${location} · ${statusText(bottle.status)}`,
                `内容：${safeSnippet(bottle)}`,
                `时间：${formatTime(bottle.throwTime)}`,
                `被捡：${bottle.pickupCount} 次 · 评论：${comments.count} 条`
            ].join('\n')
        }))
        const seaCount = bottles.filter(item => item.location === 'sea').length

        await sendReply(e, document(
            heading('我的漂流瓶'),
            codeBlock(rows.join('\n--------------------\n'), 'text'),
            fields([
                ['总数', bottles.length],
                ['在海里', seaCount],
                ['已捡回', bottles.length - seaCount]
            ])
        ), [
            commonButtons.throw(),
            commonButtons.pickup(),
            commonButtons.status()
        ])
        return true
    }

    async reclaimBottle(e) {
        const bottleId = e.msg.match(/^#?(捡回漂流瓶|捡回瓶子)\s*(\d{6})$/)?.[2]
        if (!bottleId) return false

        const config = loadConfig()
        const userId = userIdOf(e)
        const key = `reclaim:${userId}`
        const remaining = cooldownRemaining(key, config.cooldowns.reclaimSeconds)
        if (remaining > 0) {
            await sendReply(e, status('捡回冷却中', `请 ${remaining} 秒后再试`))
            return true
        }

        const db = await getDb()
        const bottle = await db.get('SELECT * FROM bottles WHERE id = ?', bottleId)
        if (!bottle) {
            await sendReply(e, status('找不到漂流瓶', '请检查瓶子 ID'))
            return true
        }
        if (bottle.thrower !== userId) {
            await sendReply(e, status('无法捡回', '只能捡回自己扔出的漂流瓶'))
            return true
        }
        if (bottle.location === 'home') {
            await sendReply(e, status('无需重复捡回', '这个漂流瓶已经在家了'))
            return true
        }

        await db.run("UPDATE bottles SET location = 'home' WHERE id = ?", bottleId)
        cooldowns.set(key, Date.now())
        await sendReply(e, document(
            heading('漂流瓶已捡回'),
            fields([
                ['瓶子 ID', bottleId],
                ['审核状态', statusText(bottle.status)],
                ['内容', safeSnippet(bottle)]
            ])
        ), [
            commonButtons.rethrow(bottleId),
            commonButtons.mine()
        ])
        return true
    }

    async rethrowBottle(e) {
        const bottleId = e.msg.match(/^#?(重新扔漂流瓶|重新扔瓶子)\s*(\d{6})$/)?.[2]
        if (!bottleId) return false

        const config = loadConfig()
        const userId = userIdOf(e)
        const db = await getDb()
        const bottle = await db.get('SELECT * FROM bottles WHERE id = ?', bottleId)
        if (!bottle) {
            await sendReply(e, status('找不到漂流瓶', '请检查瓶子 ID'))
            return true
        }
        if (bottle.thrower !== userId) {
            await sendReply(e, status('无法重新扔出', '只能操作自己的漂流瓶'))
            return true
        }
        if (bottle.location !== 'home') {
            await sendReply(e, status('无需重新扔出', '这个漂流瓶还在海里'))
            return true
        }

        const count = await db.get(
            "SELECT COUNT(*) count FROM bottles WHERE thrower = ? AND location = 'sea'",
            userId
        )
        if (count.count >= config.limits.maxBottlesPerUser) {
            await sendReply(e, status('无法重新扔出', `你已有 ${count.count} 个漂流瓶在海里`))
            return true
        }

        await db.run("UPDATE bottles SET location = 'sea' WHERE id = ?", bottleId)
        await sendReply(e, document(
            heading('漂流瓶已重新扔出'),
            fields([
                ['瓶子 ID', bottleId],
                ['审核状态', statusText(bottle.status)],
                ['内容', safeSnippet(bottle)]
            ])
        ), [
            commonButtons.pickup(),
            commonButtons.mine()
        ])
        return true
    }

    async bottleStatus(e) {
        const counts = await bottleCounts()
        await sendReply(e, document(
            heading('漂流瓶统计'),
            fields([
                ['总漂流瓶数', counts.total],
                ['在海里', counts.sea],
                ['已捡回', counts.home],
                ['已过审', counts.approved],
                ['审核中', counts.pending],
                ['未过审', counts.rejected],
                ['总评论数', counts.comments],
                ['总被捡次数', counts.pickups],
                ['活跃用户数', counts.users]
            ])
        ), [
            commonButtons.throw(),
            commonButtons.pickup(),
            commonButtons.mine()
        ])
        return true
    }

    async showHelp(e) {
        await sendReply(e, document(
            heading('漂流瓶使用帮助'),
            fields([
                ['扔漂流瓶', '#扔漂流瓶 内容'],
                ['捡漂流瓶', '#捡漂流瓶'],
                ['评论漂流瓶', '#评论漂流瓶ID内容（空格可选）'],
                ['查看评论', '#查看评论ID（空格可选）'],
                ['我的漂流瓶', '#我的漂流瓶'],
                ['捡回漂流瓶', '#捡回漂流瓶 ID'],
                ['重新扔漂流瓶', '#重新扔漂流瓶 ID'],
                ['查看统计', '#漂流瓶状态'],
                ['管理配置', '#漂流瓶配置帮助']
            ]),
            '> 命令中的 ID 为 6 位数字。'
        ), [
            commonButtons.throw(),
            commonButtons.pickup(),
            commonButtons.mine(),
            commonButtons.status()
        ])
        return true
    }
}