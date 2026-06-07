import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const files = ['index.js', 'guoba.support.js']
for (const dir of ['apps', 'lib']) {
    for (const file of fs.readdirSync(path.join(root, dir))) {
        if (file.endsWith('.js')) files.push(path.join(dir, file))
    }
}

let failed = false
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
        cwd: root,
        stdio: 'inherit'
    })
    if (result.status !== 0) failed = true
}

if (failed) process.exit(1)
console.log(`Syntax check passed: ${files.length} files`)
