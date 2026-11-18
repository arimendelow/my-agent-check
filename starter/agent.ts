// agent.ts: a tiny agent, built by hand to see how agents work. Run it with `node agent.ts`.
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import OpenAI from 'openai'

// Reach the model with your GitHub Copilot access, through the gh CLI you're signed in with.
const gh = (args: string) => execSync(`gh ${args}`, { encoding: 'utf8' }).trim()
const client = new OpenAI({
  apiKey: gh('auth token'),
  baseURL: gh('api /copilot_internal/user --jq .endpoints.api'),
})

// The tools, described the way the model reads them: a name, what it does, and what it needs.
const tool = (name: string, description: string, params: Record<string, string>) => ({
  type: 'function' as const,
  function: {
    name,
    description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(Object.entries(params).map(([key, about]) => [key, { type: 'string', description: about }])),
      required: Object.keys(params),
    },
  },
})
const onWindows = process.platform === 'win32'
const tools = [
  tool('read_file', 'Read a text file.', { path: 'The file to read.' }),
  tool('write_file', 'Write a text file, replacing anything already in it.', { path: 'The file to write.', content: 'What to put in it.' }),
  tool('shell', `Run a command in ${onWindows ? 'PowerShell' : 'the shell'} and get back what it printed.`, { command: 'The command to run.' }),
]

// Actually do what the model asked for, and return what happened as text for the model to read.
function runTool(name: string, args: any): string {
  try {
    if (name === 'read_file') return readFileSync(args.path, 'utf8')
    if (name === 'write_file') {
      writeFileSync(args.path, args.content)
      return `Wrote ${args.content.length} characters to ${args.path}.`
    }
    if (name === 'shell') {
      // Same kind of shell you're using. A slow command is stopped after 30 seconds.
      const [shell, flag] = onWindows ? ['pwsh', '-Command'] : [process.env.SHELL || 'sh', '-c']
      const run = spawnSync(shell, [flag, args.command], { encoding: 'utf8', timeout: 30_000 })
      const output = `${run.stdout}${run.stderr}${run.error ? run.error.message : ''}`
      return output.length > 20_000 ? `${output.slice(0, 20_000)}\n[output cut at 20,000 characters]` : output
    }
    return `There's no tool called ${name}.`
  } catch (error) {
    return `Error: ${(error as Error).message}`
  }
}

// The conversation is everything the model sees. The model remembers nothing between calls,
// so we send all of it every time, and save it to a file so it survives a restart.
const file = 'what-the-model-sees.json'
const conversation = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
  model: 'claude-opus-5.5',
  reasoning_effort: 'max', // think as hard as it can, so there's plenty of thinking to watch
  max_tokens: 128_000, // the most this model may write in one reply, thinking included
  stream: true, // send the reply as it's written, so we can watch it think
  messages: [],
}
conversation.tools = tools
const save = () => writeFileSync(file, JSON.stringify(conversation, null, 2))

// Ask the model for its next move. Print its thinking (dimmed) and its words as they arrive.
async function ask() {
  const reply: any = { role: 'assistant', content: '' }
  const calls: any[] = []
  for await (const chunk of await client.chat.completions.create(conversation)) {
    const delta: any = chunk.choices[0]?.delta ?? {}
    if (delta.reasoning_text) process.stdout.write(`\x1b[2m${delta.reasoning_text}\x1b[22m`)
    if (delta.content && !reply.content) process.stdout.write('\n')
    if (delta.content) process.stdout.write(delta.content)
    // Keep the thinking too, including the sealed copy only the model can read. Never strip it.
    for (const key of ['content', 'reasoning_text', 'reasoning_opaque']) {
      if (delta[key]) reply[key] = (reply[key] ?? '') + delta[key]
    }
    // A tool request arrives in pieces; put each one back together.
    for (const piece of delta.tool_calls ?? []) {
      const call = (calls[piece.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } })
      call.id += piece.id ?? ''
      call.function.name += piece.function?.name ?? ''
      call.function.arguments += piece.function?.arguments ?? ''
    }
  }
  process.stdout.write('\n')
  if (calls.length) reply.tool_calls = calls.filter(Boolean)
  return reply
}

// The loop: send the conversation, run any tools the model asks for, hand back the results,
// and go again, until it answers without asking for anything.
async function loop() {
  for (let round = 1; round <= 20; round++) {
    const reply = await ask()
    conversation.messages.push(reply)
    save()
    if (!reply.tool_calls) return
    for (const call of reply.tool_calls) {
      console.log(`[${call.function.name}] ${call.function.arguments.slice(0, 100)}`)
      const result = runTool(call.function.name, JSON.parse(call.function.arguments || '{}'))
      conversation.messages.push({ role: 'tool', tool_call_id: call.id, content: result })
      save()
    }
  }
  console.log('Stopped after 20 rounds, so it can\'t run away.')
}

// Chat in the terminal. Ctrl+D or Ctrl+C quits.
const terminal = createInterface({ input: process.stdin, output: process.stdout })
terminal.on('close', () => process.exit(0))
while (true) {
  const line = await terminal.question('You: ')
  if (!line.trim()) continue
  conversation.messages.push({ role: 'user', content: line })
  await loop()
}
