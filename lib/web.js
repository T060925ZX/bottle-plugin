import crypto from 'node:crypto'
import path from 'node:path'
import { PATHS } from './paths.js'
import {
    deleteBottle,
    deleteComment,
    getAdminStats,
    getBottleDetail,
    listBottles,
    updateBottle,
    updateComment
} from './admin.js'

const ROUTE_BASE = '/bottle'
const LOGIN_TTL = 5 * 60 * 1000
const SESSION_TTL = 12 * 60 * 60 * 1000
const COOKIE_NAME = 'bottle_admin_session'
const stateKey = Symbol.for('bottle-plugin.web-state')

function getState() {
    globalThis[stateKey] ||= {
        registered: false,
        loginTokens: new Map(),
        sessions: new Map()
    }
    return globalThis[stateKey]
}

function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url')
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

function cleanExpired() {
    const now = Date.now()
    const state = getState()
    for (const [token, item] of state.loginTokens) {
        if (item.expiresAt <= now) state.loginTokens.delete(token)
    }
    for (const [token, item] of state.sessions) {
        if (item.expiresAt <= now) state.sessions.delete(token)
    }
}

function currentSession(req) {
    cleanExpired()
    const token = parseCookies(req)[COOKIE_NAME]
    if (!token) return null
    const session = getState().sessions.get(token)
    if (!session) return null
    session.expiresAt = Date.now() + SESSION_TTL
    return session
}

function requireAdmin(req, res, next) {
    const session = currentSession(req)
    if (!session) {
        res.status(401).json({ ok: false, message: '管理会话已失效，请重新生成登录链接' })
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

function publicBaseUrl() {
    const configured = String(globalThis.Bot?.url || '').trim()
    if (configured) return configured.replace(/\/+$/, '')
    const address = globalThis.Bot?.server?.address?.()
    const port = address?.port || 2536
    return `http://localhost:${port}`
}

export function createBottleAdminLink(userId) {
    cleanExpired()
    const token = randomToken()
    getState().loginTokens.set(token, {
        userId: String(userId),
        expiresAt: Date.now() + LOGIN_TTL
    })
    return `${publicBaseUrl()}${ROUTE_BASE}?token=${encodeURIComponent(token)}`
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
            'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
        })
        next()
    })

    app.get(ROUTE_BASE, (req, res) => {
        const token = String(req.query.token || '')
        if (token) {
            cleanExpired()
            const login = state.loginTokens.get(token)
            state.loginTokens.delete(token)
            if (!login || login.expiresAt <= Date.now()) {
                res.status(401).send('登录链接无效或已过期，请重新发送 #漂流瓶管理')
                return
            }
            const sessionToken = randomToken()
            state.sessions.set(sessionToken, {
                userId: login.userId,
                createdAt: Date.now(),
                expiresAt: Date.now() + SESSION_TTL
            })
            res.cookie(COOKIE_NAME, sessionToken, {
                httpOnly: true,
                sameSite: 'strict',
                secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
                maxAge: SESSION_TTL,
                path: ROUTE_BASE
            })
            res.redirect(ROUTE_BASE)
            return
        }
        res.sendFile(pageFile())
    })

    app.post(`${ROUTE_BASE}/api/logout`, requireAdmin, (req, res) => {
        const token = parseCookies(req)[COOKIE_NAME]
        if (token) state.sessions.delete(token)
        res.clearCookie(COOKIE_NAME, { path: ROUTE_BASE })
        res.json({ ok: true })
    })

    app.get(`${ROUTE_BASE}/api/session`, requireAdmin, (req, res) => {
        res.json({ ok: true, userId: req.bottleAdmin.userId })
    })

    app.get(`${ROUTE_BASE}/api/stats`, requireAdmin, asyncRoute(async (req, res) => {
        res.json({ ok: true, data: await getAdminStats() })
    }))

    app.get(`${ROUTE_BASE}/api/bottles`, requireAdmin, asyncRoute(async (req, res) => {
        res.json({ ok: true, data: await listBottles(req.query) })
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
        await updateComment(req.params.id, req.body.status)
        audit(req, 'update-comment', req.params.id, `status=${req.body.status}`)
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
