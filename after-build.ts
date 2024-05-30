import { copyFileSync } from 'fs'

const sourcePath = new URL('src/bootstrap.js', import.meta.url)
const destPath = new URL('dist/bootstrap.js', import.meta.url)
copyFileSync(sourcePath, destPath)
