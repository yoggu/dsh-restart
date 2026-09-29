import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock, test } from 'node:test'

// Mock before importing: no systemd, shell, cgroup, or exit operation is real.
let cgroup = ''
let spawnResult = 'success'
const spawned = []
mock.module('node:fs', { namedExports: { readFileSync: () => cgroup } })
mock.module('node:child_process', { namedExports: { spawn: (...args) => {
  spawned.push(args)
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 999
  child.unref = () => {}
  queueMicrotask(() => {
    if (spawnResult === 'error') child.emit('error', new Error('mock failure'))
    else {
      if (spawnResult === 'failure') child.stderr.emit('data', 'mock rejected')
      child.emit('close', spawnResult === 'failure' ? 1 : 0)
    }
  })
  return child
} } })
const { apply, Config } = await import('./index.js')

function command(config = {}) {
  let registered
  apply({ commands: { register(value) { registered = value } } }, config)
  assert.equal(registered.name, 'dsh-restart')
  assert.equal(registered.recordInput, false)
  return registered
}

test('settings have English help and default to English without changing restart defaults', () => {
  assert.equal(Config.dict.language.meta.default, 'en')
  for (const field of Object.values(Config.dict)) assert.ok(field.meta.description)
  assert.equal(Config.dict.mode.meta.default, 'auto')
  assert.equal(Config.dict.delaySeconds.meta.default, 1)
  assert.equal(Config.dict.unit.meta.default, '')
  const resolved = Config({})
  assert.equal(resolved.language.get(), 'en')
  assert.equal(resolved.mode.get(), 'auto')
  assert.equal(resolved.delaySeconds.get(), 1)
})

test('command menu and safe validation errors support English and preserved German', async () => {
  for (const language of [undefined, 'en', 'fr', 'de']) {
    const registered = command({ language })
    assert.equal(registered.input.hint, language === 'de' ? '[Sekunden]' : '[seconds]')
    assert.match(registered.description, language === 'de' ? /Harness neu starten/ : /Restart the Harness/)
    for (const rawInput of ['0', '61', 'oops']) {
      const result = await registered.handler({ rawInput })
      assert.equal(result.kind, 'error')
      assert.match(result.text, language === 'de' ? /Der Vorlauf/ : /The delay/)
    }
  }
  assert.equal(spawned.length, 0)
})

test('missing unit, systemd success/failure, and successor messages use live language refs', async t => {
  const timers = []
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => { timers.push(ms); return 0 })
  let language = 'en'
  const languageRef = { get: () => language }
  const unitCommand = command({ mode: 'unit', language: languageRef })
  for (language of ['en', 'de', 'unsupported']) {
    cgroup = ''
    const missing = await unitCommand.handler({})
    assert.equal(missing.kind, 'error')
    assert.match(missing.text, language === 'de' ? /ist erzwungen/ : /no unit is configured/)
    cgroup = '0::/user.slice/app.slice/dsh-test.service'
    for (spawnResult of ['success', 'failure', 'error']) {
      const result = await unitCommand.handler({ rawInput: '10' })
      assert.equal(result.kind, spawnResult === 'success' ? 'success' : 'error')
      assert.match(result.text, language === 'de'
        ? (spawnResult === 'success' ? /startet in 10 s neu/ : /konnte nicht abgesetzt/)
        : (spawnResult === 'success' ? /will restart in 10 s/ : /Could not schedule/))
      assert.equal(spawned.at(-1)[0], 'systemd-run')
      assert.equal(spawned.at(-1)[1].at(-1), 'dsh-test.service')
    }
    spawnResult = 'success'
    const successor = await command({ mode: 'exec', language: languageRef }).handler({ rawInput: '5' })
    assert.equal(successor.kind, 'success')
    assert.match(successor.text, language === 'de' ? /übergibt in 5 s/ : /hand over in 5 s/)
    assert.equal(spawned.at(-1)[0], '/bin/sh')
  }
  assert.deepEqual(timers, [5000, 10000, 5000, 10000, 5000, 10000])
})
