// A stand-in for the Copilot API: it streams the same shapes the real one does, and asks for
// write_file, then shell, then answers with what the shell printed. No credentials needed.
import http from 'node:http'
const sse = (res, deltas, finish) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const delta of deltas) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`)
  res.end()
}
const call = (id, name, args) => ({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const { messages, tools } = JSON.parse(body)
    const names = (tools ?? []).map((t) => t.function.name).sort().join(',')
    const results = messages.filter((m) => m.role === 'tool')
    if (results.length === 0) return sse(res, [{ reasoning_text: 'I should write the file first.' }, { reasoning_opaque: 'sealed' }, call('a', 'write_file', { path: 'hello.txt', content: 'hello from the loop' })], 'tool_calls')
    if (results.length === 1) return sse(res, [call('b', 'shell', { command: process.platform === 'win32' ? 'Get-Content hello.txt; $PSVersionTable.PSEdition' : 'cat hello.txt; echo $0' })], 'tool_calls')
    return sse(res, [{ content: `tools=${names} shell said: ${results[1].content.trim().replace(/\s+/g, ' ')}` }], 'stop')
  })
}).listen(Number(process.env.FAKE_PORT || 8765))
