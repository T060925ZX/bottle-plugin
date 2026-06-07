import { loadConfig } from './config.js'
import { escapeMarkdown } from './markdown.js'

function fallbackButtons(buttons) {
    if (!buttons?.length) return ''
    return buttons
        .map(button => `- **${escapeMarkdown(button.text)}：** \`${escapeMarkdown(button.callback || button.input || button.link || '')}\``)
        .join('\n')
}

export async function sendReply(e, markdown, buttons = []) {
    const config = loadConfig()
    const content = String(markdown ?? '').trim()
    const useMarkdown = config.output.markdown !== false
    const body = useMarkdown ? content : content.replace(/[#*`>|_-]/g, '')

    if (config.output.buttons !== false && buttons.length && globalThis.segment?.button) {
        try {
            return await e.reply([body, globalThis.segment.button(buttons)])
        } catch (error) {
            logger?.warn?.(`[bottle-plugin] 按钮发送失败，回退为文字: ${error}`)
        }
    }

    const fallback = fallbackButtons(buttons)
    return e.reply(fallback ? `${body}\n\n${fallback}` : body)
}
