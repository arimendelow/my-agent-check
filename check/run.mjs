// Runs agent.ts the way a reader does, against the fake model, and checks the loop and tools worked.
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
const agent = spawn(process.execPath, ['agent.ts'], { stdio: ['pipe', 'pipe', 'inherit'], shell: false })
let out = ''
agent.stdout.on('data', (d) => { out += d; process.stdout.write(d) })
agent.stdin.write('write hello.txt, then show it with the shell\n')
const deadline = Date.now() + 60_000
while (!/shell said:[\s\S]*You:/.test(out) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
agent.stdin.end()
await new Promise((r) => agent.on('exit', r))
const fail = (why) => { console.error(`\nFAIL: ${why}`); process.exit(1) }
if (!/shell said: hello from the loop/.test(out)) fail('the shell tool did not run, or its output never reached the model')
if (process.platform === 'win32' && !/Core/.test(out)) fail('on Windows the shell tool should run PowerShell 7 (pwsh)')
if (readFileSync('hello.txt', 'utf8') !== 'hello from the loop') fail('write_file did not write the file')
if (!existsSync('what-the-model-sees.json')) fail('the conversation was not saved')
const saved = JSON.parse(readFileSync('what-the-model-sees.json', 'utf8'))
if (!saved.messages.some((m) => m.reasoning_opaque === 'sealed')) fail('the sealed reasoning was stripped')
console.log('\nPASS')
