import { getConfigValue, loadConfig, saveConfig, setConfigValue } from '../lib/config.js'
import { commonButtons } from '../lib/buttons.js'
import { document, fields, heading, status } from '../lib/markdown.js'
import { sendReply } from '../lib/reply.js'

const EDITABLE_KEYS = new Set([
    'moderation.enabled',
    'moderation.provider',
    'moderation.failPolicy',
    'moderation.timeout',
    'moderation.openai.apiKey',
    'moderation.openai.baseUrl',
    'moderation.openai.model',
    'moderation.gemini.apiKey',
    'moderation.gemini.baseUrl',
    'moderation.gemini.model',
    'limits.maxBottlesPerUser',
    'limits.maxCommentsPerBottle',
    'limits.maxCommentsDisplay',
    'limits.maxBottleLength',
    'limits.maxCommentLength',
    'cooldowns.pickupSeconds',
    'cooldowns.reclaimSeconds',
    'output.markdown',
    'output.buttons'
])

function parseValue(raw) {
    if (raw === 'true') return true
    if (raw === 'false') return false
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
    return raw
}

function maskSecret(value) {
    if (!value) return '未配置'
    if (value.length <= 8) return '已配置'
    return `${value.slice(0, 3)}***${value.slice(-4)}`
}

function validate(key, value) {
    if (key === 'moderation.provider' && !['openai', 'gemini'].includes(value)) {
        return 'moderation.provider 只能是 openai 或 gemini'
    }
    if (key === 'moderation.failPolicy' && !['pending', 'reject'].includes(value)) {
        return 'moderation.failPolicy 只能是 pending 或 reject'
    }
    if ((key.endsWith('.enabled') || key.startsWith('output.')) && typeof value !== 'boolean') {
        return `${key} 必须是 true 或 false`
    }
    if (
        (key.startsWith('limits.') || key.startsWith('cooldowns.') || key === 'moderation.timeout')
        && (!Number.isFinite(value) || value < 0)
    ) {
        return `${key} 必须是大于等于 0 的数字`
    }
    return ''
}

export class BottleConfig extends plugin {
    constructor() {
        super({
            name: '漂流瓶-配置管理',
            dsc: '查看和修改漂流瓶插件配置',
            event: 'message',
            priority: 99,
            rule: [
                { reg: '^#?(漂流瓶配置|瓶子配置)$', fnc: 'showConfig', permission: 'master' },
                { reg: '^#?(漂流瓶配置|瓶子配置)\\s+设置\\s+(\\S+)\\s+(.+)$', fnc: 'setConfig', permission: 'master' },
                { reg: '^#?(漂流瓶配置帮助|瓶子配置帮助)$', fnc: 'showHelp', permission: 'master' }
            ]
        })
    }

    async showConfig(e) {
        const config = loadConfig()
        await sendReply(e, document(
            heading('漂流瓶配置'),
            fields([
                ['审核开关', config.moderation.enabled],
                ['审核提供商', config.moderation.provider],
                ['审核失败策略', config.moderation.failPolicy],
                ['审核超时', `${config.moderation.timeout} ms`],
                ['OpenAI API Key', maskSecret(config.moderation.openai.apiKey)],
                ['OpenAI 地址', config.moderation.openai.baseUrl],
                ['OpenAI 模型', config.moderation.openai.model],
                ['Gemini API Key', maskSecret(config.moderation.gemini.apiKey)],
                ['Gemini 地址', config.moderation.gemini.baseUrl],
                ['Gemini 模型', config.moderation.gemini.model],
                ['每人海中瓶子上限', config.limits.maxBottlesPerUser],
                ['单瓶评论上限', config.limits.maxCommentsPerBottle],
                ['Markdown 输出', config.output.markdown],
                ['按钮输出', config.output.buttons]
            ])
        ), [commonButtons.help()])
        return true
    }

    async setConfig(e) {
        const match = e.msg.match(/^#?(漂流瓶配置|瓶子配置)\s+设置\s+(\S+)\s+(.+)$/)
        if (!match) return false

        const key = match[2]
        if (!EDITABLE_KEYS.has(key)) {
            await sendReply(e, status('配置失败', `不支持的配置项：${key}`))
            return true
        }

        const value = parseValue(match[3].trim())
        const error = validate(key, value)
        if (error) {
            await sendReply(e, status('配置失败', error))
            return true
        }

        const config = loadConfig()
        setConfigValue(config, key, value)
        saveConfig(config)
        const displayed = key.endsWith('.apiKey') ? maskSecret(String(value)) : value
        await sendReply(e, status('配置已更新', '', [[key, displayed]]))
        return true
    }

    async showHelp(e) {
        const keys = [...EDITABLE_KEYS]
        const config = loadConfig()
        await sendReply(e, document(
            heading('漂流瓶配置帮助'),
            '使用 `#漂流瓶配置 设置 <配置项> <值>` 修改配置。',
            heading('可配置项', 3),
            keys.map(key => {
                const value = getConfigValue(config, key)
                return `- \`${key}\`：${key.endsWith('.apiKey') ? maskSecret(String(value || '')) : value ?? ''}`
            }).join('\n'),
            heading('示例', 3),
            [
                '`#漂流瓶配置 设置 moderation.provider openai`',
                '`#漂流瓶配置 设置 moderation.openai.apiKey sk-xxx`',
                '`#漂流瓶配置 设置 moderation.gemini.apiKey AIza-xxx`',
                '`#漂流瓶配置 设置 output.buttons true`'
            ].join('\n')
        ))
        return true
    }
}
