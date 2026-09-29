import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
function view({ status = 'ready', writable = true, mutate = async () => true } = {}) {
  let plugin
  let component
  let cursor = 0
  const states = []
  const form = { getSnapshot: () => ({ status, writable, revision: 4, value: {} }), mutate }
  const React = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type(props ?? {}) : ({ type, props: props ?? {}, children }),
    useState: value => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof value === 'function' ? value() : value
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useEffect: () => {},
  }
  runInNewContext(source, { window: { __ModuleLoader__: { load: value => { plugin = value.factory(() => React) } } } })
  plugin.apply({ configForms: { get: () => form }, slots: { inject: (_name, fn) => fn(), register: (_entry, render) => { component = render } } })
  return { states, render: (mode = 'config') => { cursor = 0; return component({ view: mode }) } }
}
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [] }
function text(tree) { return typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? tree.children.map(text).join(' ') : '' }

test('restart summary, settings labels, states, and command-language selector remain English', () => {
  const ready = view()
  assert.match(ready.render('summary'), /Configure how the Harness restarts/)
  const tree = ready.render()
  const copy = text(tree)
  for (const expected of ['Command language', 'English', 'Deutsch', 'Mode', 'Systemd unit', 'Response delivery delay', 'Successor process output', 'Save settings']) assert.ok(copy.includes(expected), expected)
  assert.equal(nodes(tree).find(node => node.type === 'select').props.value, 'en')
  assert.match(text(view({ status: 'loading' }).render()), /Loading restart settings/)
  assert.match(text(view({ status: 'unavailable' }).render()), /settings are unavailable/)
  assert.match(text(view({ writable: false }).render()), /settings read-only/)
})

test('saving German command-language preference uses existing form without running a restart', async () => {
  const calls = []
  const ready = view({ mutate: async (...args) => { calls.push(JSON.parse(JSON.stringify(args))); return true } })
  nodes(ready.render()).find(node => node.type === 'select').props.onChange({ target: { value: 'de' } })
  await ready.render().props.onSubmit({ preventDefault() {} })
  assert.deepEqual(calls[0][0][0], { op: 'set', path: ['language'], value: 'de' })
  assert.equal(calls[0][1], 4)
  assert.match(text(ready.render()), /Settings saved/)
})

test('validation and host rejection errors are English and do not mutate invalid values', async () => {
  let mutations = 0
  const ready = view({ mutate: async () => { mutations++; return false } })
  ready.render()
  ready.states[1].delaySeconds = '0'
  await ready.render().props.onSubmit({ preventDefault() {} })
  assert.match(text(ready.render()), /Delay must be a whole number/)
  assert.equal(mutations, 0)
  ready.states[1].delaySeconds = '1'
  await ready.render().props.onSubmit({ preventDefault() {} })
  assert.match(text(ready.render()), /Host rejected these settings/)
  assert.equal(mutations, 1)
})
