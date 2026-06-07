import { loadConfig, saveConfig, setConfigValue } from './lib/config.js'

const schemas = [
    {
        label: '内容审核',
        component: 'SOFT_GROUP_BEGIN'
    },
    {
        field: 'moderation.enabled',
        label: '启用内容审核',
        bottomHelpMessage: '关闭后漂流瓶和评论会直接通过审核，请谨慎使用。',
        component: 'Switch'
    },
    {
        field: 'moderation.provider',
        label: '审核服务',
        bottomHelpMessage: '选择 Gemini 原生接口或 OpenAI 兼容接口。',
        component: 'Select',
        required: true,
        componentProps: {
            options: [
                { label: 'Gemini', value: 'gemini' },
                { label: 'OpenAI 兼容接口', value: 'openai' }
            ]
        }
    },
    {
        field: 'moderation.failPolicy',
        label: '审核异常策略',
        bottomHelpMessage: 'pending 会保留内容等待人工审核；reject 会直接拒绝。',
        component: 'Select',
        required: true,
        componentProps: {
            options: [
                { label: '等待人工审核', value: 'pending' },
                { label: '直接拒绝', value: 'reject' }
            ]
        }
    },
    {
        field: 'moderation.timeout',
        label: '审核超时',
        bottomHelpMessage: '调用审核接口的超时时间，单位为毫秒。',
        component: 'InputNumber',
        required: true,
        componentProps: {
            min: 1000,
            max: 120000,
            step: 1000
        }
    },
    {
        label: 'OpenAI 兼容接口',
        component: 'SOFT_GROUP_BEGIN'
    },
    {
        field: 'moderation.openai.apiKey',
        label: 'OpenAI API Key',
        bottomHelpMessage: '支持 OpenAI 及实现 /chat/completions 的兼容服务。',
        component: 'InputPassword',
        componentProps: {
            placeholder: 'sk-...',
            autocomplete: 'new-password'
        }
    },
    {
        field: 'moderation.openai.baseUrl',
        label: 'OpenAI 接口地址',
        bottomHelpMessage: '填写到版本路径，例如 https://api.openai.com/v1。',
        component: 'Input',
        required: true,
        componentProps: {
            placeholder: 'https://api.openai.com/v1'
        }
    },
    {
        field: 'moderation.openai.model',
        label: 'OpenAI 模型',
        component: 'Input',
        required: true,
        componentProps: {
            placeholder: 'gpt-4.1-mini'
        }
    },
    {
        label: 'Gemini 接口',
        component: 'SOFT_GROUP_BEGIN'
    },
    {
        field: 'moderation.gemini.apiKey',
        label: 'Gemini API Key',
        component: 'InputPassword',
        componentProps: {
            placeholder: 'AIza...',
            autocomplete: 'new-password'
        }
    },
    {
        field: 'moderation.gemini.baseUrl',
        label: 'Gemini 接口地址',
        bottomHelpMessage: '填写到 API 版本路径。',
        component: 'Input',
        required: true,
        componentProps: {
            placeholder: 'https://generativelanguage.googleapis.com/v1beta'
        }
    },
    {
        field: 'moderation.gemini.model',
        label: 'Gemini 模型',
        component: 'Input',
        required: true,
        componentProps: {
            placeholder: 'gemini-2.0-flash'
        }
    },
    {
        label: '数量与长度限制',
        component: 'SOFT_GROUP_BEGIN'
    },
    {
        field: 'limits.maxBottlesPerUser',
        label: '每人海中瓶子上限',
        component: 'InputNumber',
        required: true,
        componentProps: { min: 1, max: 10000 }
    },
    {
        field: 'limits.maxCommentsPerBottle',
        label: '单瓶评论上限',
        component: 'InputNumber',
        required: true,
        componentProps: { min: 0, max: 10000 }
    },
    {
        field: 'limits.maxCommentsDisplay',
        label: '评论显示条数',
        bottomHelpMessage: '查看评论时最多显示的最新评论数量。',
        component: 'InputNumber',
        required: true,
        componentProps: { min: 1, max: 100 }
    },
    {
        field: 'limits.maxBottleLength',
        label: '漂流瓶字数上限',
        component: 'InputNumber',
        required: true,
        componentProps: { min: 1, max: 10000 }
    },
    {
        field: 'limits.maxCommentLength',
        label: '评论字数上限',
        component: 'InputNumber',
        required: true,
        componentProps: { min: 1, max: 5000 }
    },
    {
        label: '冷却时间',
        component: 'SOFT_GROUP_BEGIN'
    },
    {
        field: 'cooldowns.pickupSeconds',
        label: '捡瓶冷却',
        bottomHelpMessage: '单位为秒，设为 0 表示不限制。',
        component: 'InputNumber',
        required: true,
        componentProps: { min: 0, max: 86400 }
    },
    {
        field: 'cooldowns.reclaimSeconds',
        label: '捡回冷却',
        bottomHelpMessage: '单位为秒，设为 0 表示不限制。',
        component: 'InputNumber',
        required: true,
        componentProps: { min: 0, max: 86400 }
    },
    {
        label: '消息输出',
        component: 'SOFT_GROUP_BEGIN'
    },
    {
        field: 'output.markdown',
        label: 'Markdown 输出',
        bottomHelpMessage: '关闭后会移除常见 Markdown 标记后发送。',
        component: 'Switch'
    },
    {
        field: 'output.buttons',
        label: '按钮输出',
        bottomHelpMessage: '平台不支持按钮时，插件仍会自动回退为文字命令。',
        component: 'Switch'
    }
]

function validateConfig(config) {
    if (!['gemini', 'openai'].includes(config.moderation.provider)) {
        return '审核服务只能选择 gemini 或 openai'
    }
    if (!['pending', 'reject'].includes(config.moderation.failPolicy)) {
        return '审核异常策略只能选择 pending 或 reject'
    }
    if (!Number.isFinite(config.moderation.timeout) || config.moderation.timeout < 1000) {
        return '审核超时不能小于 1000 毫秒'
    }

    const positiveKeys = [
        'maxBottlesPerUser',
        'maxCommentsDisplay',
        'maxBottleLength',
        'maxCommentLength'
    ]
    for (const key of positiveKeys) {
        if (!Number.isFinite(config.limits[key]) || config.limits[key] < 1) {
            return `${key} 必须大于等于 1`
        }
    }
    if (!Number.isFinite(config.limits.maxCommentsPerBottle) || config.limits.maxCommentsPerBottle < 0) {
        return 'maxCommentsPerBottle 必须大于等于 0'
    }
    for (const value of Object.values(config.cooldowns)) {
        if (!Number.isFinite(value) || value < 0) return '冷却时间必须大于等于 0'
    }
    return ''
}

export function supportGuoba() {
    return {
        pluginInfo: {
            name: 'bottle-plugin',
            title: '漂流瓶插件',
            description: '支持 OpenAI/Gemini 内容审核、Markdown 和按钮的漂流瓶插件',
            author: 'bottle-plugin',
            isV3: true,
            isV2: false,
            showInMenu: 'auto',
            icon: 'mdi:bottle-soda-classic-outline',
            iconColor: '#2f8fce'
        },
        configInfo: {
            schemas,
            getConfigData() {
                return loadConfig()
            },
            setConfigData(data, { Result }) {
                try {
                    const config = JSON.parse(JSON.stringify(loadConfig()))
                    for (const [keyPath, value] of Object.entries(data || {})) {
                        setConfigValue(config, keyPath, value)
                    }

                    const error = validateConfig(config)
                    if (error) return Result.error(error)

                    saveConfig(config)
                    return Result.ok({}, '保存成功，配置已生效')
                } catch (error) {
                    logger?.error?.(`[bottle-plugin] 锅巴保存配置失败: ${error}`)
                    return Result.error(`保存失败：${error.message}`)
                }
            }
        }
    }
}
