#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const path = require('node:path')

const script = path.join(__dirname, 'app', 'scripts', 'deploy-docker.cjs')

execFileSync(process.execPath, [script, ...process.argv.slice(2)], {
  cwd: __dirname,
  stdio: 'inherit',
  env: process.env,
})
