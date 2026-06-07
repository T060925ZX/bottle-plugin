import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLUGIN_NAME = 'bottle-plugin'
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const PATHS = {
    root: ROOT,
    apps: path.join(ROOT, 'apps'),
    config: path.join(ROOT, 'config'),
    defaultConfig: path.join(ROOT, 'default_config'),
    data: path.join(ROOT, 'data'),
    configFile: path.join(ROOT, 'config', 'config.json'),
    defaultConfigFile: path.join(ROOT, 'default_config', 'config.json'),
    sessionKeyFile: path.join(ROOT, 'data', 'admin-session.key'),
    database: path.join(ROOT, 'data', 'bottles.db')
}

export function ensureDirs() {
    for (const key of ['root', 'apps', 'config', 'defaultConfig', 'data']) {
        fs.mkdirSync(PATHS[key], { recursive: true })
    }
}

ensureDirs()
