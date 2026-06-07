import fs from 'node:fs'
import { PATHS } from './paths.js'

export const DEFAULT_CONFIG = {
    moderation: {
        enabled: true,
        provider: 'gemini',
        failPolicy: 'pending',
        timeout: 15000,
        openai: {
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4.1-mini'
        },
        gemini: {
            apiKey: '',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            model: 'gemini-2.0-flash'
        }
    },
    limits: {
        maxBottlesPerUser: 100,
        maxCommentsPerBottle: 50,
        maxCommentsDisplay: 10,
        maxBottleLength: 500,
        maxCommentLength: 200
    },
    cooldowns: {
        pickupSeconds: 1,
        reclaimSeconds: 60
    },
    output: {
        markdown: true,
        buttons: true
    }
}

let cache = null
let cacheMtime = 0

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function deepMerge(target, source) {
    const output = { ...target }
    for (const [key, value] of Object.entries(source || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            output[key] = deepMerge(target[key] || {}, value)
        } else {
            output[key] = value
        }
    }
    return output
}

export function loadConfig() {
    try {
        if (!fs.existsSync(PATHS.configFile)) {
            fs.writeFileSync(PATHS.configFile, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8')
        }
        const stat = fs.statSync(PATHS.configFile)
        if (cache && cacheMtime === stat.mtimeMs) return cache
        const raw = JSON.parse(fs.readFileSync(PATHS.configFile, 'utf8'))
        cache = deepMerge(DEFAULT_CONFIG, raw)
        cacheMtime = stat.mtimeMs
        return cache
    } catch (error) {
        logger?.error?.(`[bottle-plugin] 读取配置失败: ${error}`)
        return clone(DEFAULT_CONFIG)
    }
}

export function saveConfig(config) {
    fs.writeFileSync(PATHS.configFile, JSON.stringify(config, null, 2), 'utf8')
    cache = config
    cacheMtime = fs.statSync(PATHS.configFile).mtimeMs
    return true
}

export function getConfigValue(config, dottedKey) {
    return dottedKey.split('.').reduce((value, key) => value?.[key], config)
}

export function setConfigValue(config, dottedKey, value) {
    const keys = dottedKey.split('.')
    let target = config
    for (const key of keys.slice(0, -1)) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {}
        target = target[key]
    }
    target[keys.at(-1)] = value
}

loadConfig()
