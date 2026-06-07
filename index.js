import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBottleRoutes } from './lib/web.js'

const PLUGIN_NAME = 'bottle-plugin'
const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url))

for (const dir of ['apps', 'config', 'data', 'lib']) {
    fs.mkdirSync(path.join(PLUGIN_ROOT, dir), { recursive: true })
}

registerBottleRoutes()

const files = fs.readdirSync(path.join(PLUGIN_ROOT, 'apps'))
    .filter(file => file.endsWith('.js'))

const loaded = await Promise.allSettled(
    files.map(file => import(`./apps/${file}`))
)

const apps = {}
for (let i = 0; i < files.length; i += 1) {
    const name = files[i].replace(/\.js$/, '')
    if (loaded[i].status !== 'fulfilled') {
        logger.error(`[${PLUGIN_NAME}] 加载 ${name}.js 失败`)
        logger.error(loaded[i].reason)
        continue
    }
    apps[name] = loaded[i].value[Object.keys(loaded[i].value)[0]]
}

logger.info(`[${PLUGIN_NAME}] 漂流瓶插件 v1.0.0 已加载`)

export { apps }
