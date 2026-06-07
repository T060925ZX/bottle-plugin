import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './config.js'
import { PATHS } from './paths.js'
import {
    deleteBottle,
    deleteComment,
    getAdminStats,
    getBottleDetail,
    listBottles,
    listComments,
    updateBottle,
    updateComment
} from './admin.js'

const ROUTE_BASE = '/bottle'
const COOKIE_NAME = 'bottle_admin_session'
const stateKey = Symbol.for('bottle-plugin.web-state')

function getState() {
    globalThis[stateKey] ||= {
        registered: false
    }
    return globalThis[stateKey]
}

function sessionKey() {
    if (!fs.existsSync(PATHS.sessionKeyFile)) {
        fs.writeFileSync(PATHS.sessionKeyFile, crypto.randomBytes(32).toString('hex'), {
            encoding: 'utf8',
            mode: 0o600
        })
    }
    return fs.readFileSync(PATHS.sessionKeyFile, 'utf8').trim()
}

function parseCookies(req) {
    const cookies = {}
    for (const part of String(req.headers.cookie || '').split(';')) {
        const index = part.indexOf('=')
        if (index < 0) continue
        cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
    }
    return cookies
}

function sign(value) {
    return crypto.createHmac('sha256', sessionKey()).update(value).digest('base64url')
}

function passwordFingerprint() {
    return crypto.createHash('sha256')
        .update(String(loadConfig().web.password || ''))
        .digest('base64url')
}

function createSession() {
    const config = loadConfig()
    const maxAge = Math.max(1, Number(config.web.sessionDays) || 30) * 86400000
    const payload = Buffer.from(JSON.stringify({
        issuedAt: Date.now(),
        expiresAt: Date.now() + maxAge,
        passwordFingerprint: passwordFingerprint()
    })).toString('base64url')
    return { token: `${payload}.${sign(payload)}`, maxAge }
}

function currentSession(req) {
    const token = parseCookies(req)[COOKIE_NAME]
    if (!token) return null
    const [payload, signature] = token.split('.')
    if (!payload || !signature) return null
    const expected = sign(payload)
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (
        actualBuffer.length !== expectedBuffer.length
        || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) return null
    try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
        return (
            Number(session.expiresAt) > Date.now()
            && session.passwordFingerprint === passwordFingerprint()
        ) ? session : null
    } catch {
        return null
    }
}

function requireAdmin(req, res, next) {
    const session = currentSession(req)
    if (!session) {
        res.status(401).json({ ok: false, message: '管理会话已失效，请重新登录' })
        return
    }
    req.bottleAdmin = session
    next()
}

function asyncRoute(handler) {
    return async (req, res) => {
        try {
            await handler(req, res)
        } catch (error) {
            logger?.error?.(`[bottle-plugin] 管理接口失败: ${error}`)
            res.status(400).json({ ok: false, message: error.message || '操作失败' })
        }
    }
}

function audit(req, action, target, detail = '') {
    logger?.mark?.(
        `[bottle-plugin] 管理操作 user=${req.bottleAdmin?.userId || '-'} action=${action} target=${target}${detail ? ` ${detail}` : ''}`
    )
}

function pageFile() {
    return path.join(PATHS.root, 'resources', 'bottle', 'index.html')
}

export function bottleAdminUrl() {
    const configured = String(globalThis.Bot?.url || '').trim()
    if (configured) return `${configured.replace(/\/+$/, '')}${ROUTE_BASE}`
    const address = globalThis.Bot?.server?.address?.()
    const port = address?.port || 2536
    return `http://localhost:${port}${ROUTE_BASE}`
}

export function registerBottleRoutes() {
    const app = globalThis.Bot?.express
    const state = getState()
    if (!app || state.registered) return false
    state.registered = true

    if (Array.isArray(app.skip_auth) && !app.skip_auth.includes(ROUTE_BASE)) {
        app.skip_auth.push(ROUTE_BASE)
    }
    if (Array.isArray(app.quiet) && !app.quiet.includes(ROUTE_BASE)) {
        app.quiet.push(ROUTE_BASE)
    }

    app.use(ROUTE_BASE, (req, res, next) => {
        res.set({
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
        })
        next()
    })

    app.get(ROUTE_BASE, (req, res) => {
        res.sendFile(pageFile())
    })

    app.get(`${ROUTE_BASE}/assets/vue.global.prod.js`, (req, res) => {
        res.sendFile(path.join(PATHS.root, 'node_modules', 'vue', 'dist', 'vue.global.prod.js'))
    })
    app.get(`${ROUTE_BASE}/assets/:file`, (req, res) => {
        const allowed = new Set(['app.js', 'style.css'])
        if (!allowed.has(req.params.file)) {
            res.status(404).end()
            return
        }
        res.sendFile(path.join(PATHS.root, 'resources', 'bottle', req.params.file))
    })

    app.get(`${ROUTE_BASE}/api/public-config`, (req, res) => {
        const config = loadConfig()
        res.json({
            ok: true,
            data: {
                passwordConfigured: Boolean(config.web.password),
                sessionDays: config.web.sessionDays,
                pageSize: config.web.pageSize
            }
        })
    })

    app.post(`${ROUTE_BASE}/api/login`, asyncRoute(async (req, res) => {
        const configured = String(loadConfig().web.password || '')
        if (!configured) {
            res.status(503).json({ ok: false, message: '请先在配置中设置 web.password' })
            return
        }
        const supplied = String(req.body?.password || '')
        const left = crypto.createHash('sha256').update(supplied).digest()
        const right = crypto.createHash('sha256').update(configured).digest()
        if (!crypto.timingSafeEqual(left, right)) {
            res.status(401).json({ ok: false, message: '管理密码错误' })
            return
        }
        const session = createSession()
        res.cookie(COOKIE_NAME, session.token, {
            httpOnly: true,
            sameSite: 'strict',
            secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
            maxAge: session.maxAge,
            path: ROUTE_BASE
        })
        res.json({ ok: true })
    }))

    app.post(`${ROUTE_BASE}/api/logout`, requireAdmin, (req, res) => {
        res.clearCookie(COOKIE_NAME, { path: ROUTE_BASE })
        res.json({ ok: true })
    })

    app.get(`${ROUTE_BASE}/api/session`, requireAdmin, (req, res) => {
        res.json({ ok: true, data: { expiresAt: req.bottleAdmin.expiresAt } })
    })

    app.get(`${ROUTE_BASE}/api/stats`, requireAdmin, asyncRoute(async (req, res) => {
        res.json({ ok: true, data: await getAdminStats() })
    }))

    app.get(`${ROUTE_BASE}/api/bottles`, requireAdmin, asyncRoute(async (req, res) => {
        res.json({ ok: true, data: await listBottles(req.query) })
    }))

    app.get(`${ROUTE_BASE}/api/comments`, requireAdmin, asyncRoute(async (req, res) => {
        res.json({ ok: true, data: await listComments(req.query) })
    }))

    app.get(`${ROUTE_BASE}/api/bottles/:id`, requireAdmin, asyncRoute(async (req, res) => {
        const data = await getBottleDetail(req.params.id)
        if (!data) {
            res.status(404).json({ ok: false, message: '漂流瓶不存在' })
            return
        }
        res.json({ ok: true, data })
    }))

    app.patch(`${ROUTE_BASE}/api/bottles/:id`, requireAdmin, asyncRoute(async (req, res) => {
        const data = await updateBottle(req.params.id, req.body)
        audit(req, 'update-bottle', req.params.id, JSON.stringify(req.body))
        res.json({ ok: true, data })
    }))

    app.delete(`${ROUTE_BASE}/api/bottles/:id`, requireAdmin, asyncRoute(async (req, res) => {
        await deleteBottle(req.params.id)
        audit(req, 'delete-bottle', req.params.id)
        res.json({ ok: true })
    }))

    app.patch(`${ROUTE_BASE}/api/comments/:id`, requireAdmin, asyncRoute(async (req, res) => {
        await updateComment(req.params.id, req.body.status, req.body.reason)
        audit(req, 'update-comment', req.params.id, JSON.stringify(req.body))
        res.json({ ok: true })
    }))

    app.delete(`${ROUTE_BASE}/api/comments/:id`, requireAdmin, asyncRoute(async (req, res) => {
        await deleteComment(req.params.id)
        audit(req, 'delete-comment', req.params.id)
        res.json({ ok: true })
    }))

    logger?.info?.('[bottle-plugin] 漂流瓶管理页面已挂载: /bottle')
    return true
}
