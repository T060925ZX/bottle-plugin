function plain(value) {
    return String(value ?? '')
}

export function escapeMarkdown(value) {
    return plain(value)
        .replace(/\\/g, '\\\\')
        .replace(/([`*_[\]<>|#])/g, '\\$1')
}

export function codeBlock(value, language = '') {
    return `\`\`\`${language}\n${plain(value).replace(/```/g, '`\u200b``')}\n\`\`\``
}

export function heading(value, level = 2) {
    return `${'#'.repeat(Math.min(6, Math.max(1, level)))} ${escapeMarkdown(value)}`
}

export function fields(items) {
    return items
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `- **${escapeMarkdown(key)}：** ${escapeMarkdown(value)}`)
        .join('\n')
}

export function document(...sections) {
    return sections
        .flat()
        .filter(section => section !== undefined && section !== null && String(section).trim())
        .map(section => String(section).trim())
        .join('\n\n')
}

export function status(title, message = '', details = []) {
    return document(
        heading(title),
        message ? escapeMarkdown(message) : '',
        details.length ? fields(details) : ''
    )
}

export function formatTime(value) {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
