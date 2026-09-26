/** Browser settings page for the dsh-restart bundle. */
window.__ModuleLoader__.load({
  id: 'dsh-restart',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const PLUGIN_ID = 'dsh-restart'
    const DESCRIPTION = 'Configure how the Harness restarts after /dsh-restart.'

    function RestartConfig({ view, form }) {
      if (view === 'summary') return DESCRIPTION
      return h(RestartForm, { form })
    }

    function RestartForm({ form }) {
      const [snapshot, setSnapshot] = useState(form.getSnapshot())
      const [draft, setDraft] = useState({ mode: 'auto', unit: '', delaySeconds: '1', execStdio: 'inherit' })
      const [dirty, setDirty] = useState(false)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')

      useEffect(() => {
        const update = () => setSnapshot(form.getSnapshot())
        const unsubscribe = form.subscribe(update)
        update()
        return unsubscribe
      }, [form])

      useEffect(() => {
        if (snapshot.status !== 'ready' || dirty) return
        const value = snapshot.value ?? {}
        setDraft({
          mode: value.mode ?? 'auto',
          unit: value.unit ?? '',
          delaySeconds: String(value.delaySeconds ?? 1),
          execStdio: value.execStdio ?? 'inherit',
        })
      }, [snapshot, dirty])

      const edit = (field, value) => {
        setDraft((current) => ({ ...current, [field]: value }))
        setDirty(true)
        setError('')
        setNotice('')
      }
      const save = async (event) => {
        event.preventDefault()
        const delay = Number(draft.delaySeconds)
        if (!Number.isInteger(delay) || delay < 1 || delay > 60) {
          setError('Delay must be a whole number from 1 to 60 seconds.')
          return
        }
        if (!['auto', 'unit', 'exec'].includes(draft.mode)) {
          setError('Choose a valid restart mode.')
          return
        }
        if (!['inherit', 'ignore'].includes(draft.execStdio)) {
          setError('Choose a valid process output mode.')
          return
        }
        setSaving(true)
        setError('')
        setNotice('')
        try {
          const accepted = await form.mutate([
            { op: 'set', path: ['mode'], value: draft.mode },
            { op: 'set', path: ['unit'], value: draft.unit.trim() },
            { op: 'set', path: ['delaySeconds'], value: delay },
            { op: 'set', path: ['execStdio'], value: draft.execStdio },
          ], snapshot.revision)
          if (!accepted) {
            setError('The Host rejected these settings. Review the values and try again.')
          } else {
            setDirty(false)
            setNotice('Settings saved.')
          }
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setSaving(false)
        }
      }

      const disabled = snapshot.status !== 'ready' || !snapshot.writable || saving
      if (snapshot.status === 'loading') return h('p', { role: 'status' }, 'Loading restart settings…')
      if (snapshot.status === 'unavailable') return h('p', { role: 'status' }, 'Restart settings are unavailable because this bundle configuration is not exposed by the Host.')

      const labelStyle = { display: 'grid', gap: 6, margin: '0 0 16px', color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 500, lineHeight: 1.5 }
      const inputStyle = { boxSizing: 'border-box', width: '100%', maxWidth: 420, height: 34, padding: '0 12px', border: '.5px solid var(--dsw-alias-border-l4)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13, lineHeight: 1.5 }
      const hintStyle = { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.5 }
      return h('form', { onSubmit: save, style: { maxWidth: 640, padding: '8px 0 24px', color: 'var(--dsw-alias-label-primary)', fontSize: 13, lineHeight: 1.5 } },
        h('label', { style: labelStyle }, 'Mode',
          h('select', { value: draft.mode, disabled, onChange: (event) => edit('mode', event.target.value), style: inputStyle },
            h('option', { value: 'auto' }, 'Auto — detect systemd unit or process'),
            h('option', { value: 'unit' }, 'Systemd unit'),
            h('option', { value: 'exec' }, 'Successor process'),
          ),
          h('p', { style: hintStyle }, 'Auto uses systemd when the Harness runs in a service; otherwise it starts a successor process.'),
        ),
        h('label', { style: labelStyle }, 'Systemd unit',
          h('input', { type: 'text', value: draft.unit, disabled, onChange: (event) => edit('unit', event.target.value), placeholder: 'Empty: detect from cgroup', style: inputStyle }),
          h('p', { style: hintStyle }, 'Optional. Set a unit name to restart that service explicitly.'),
        ),
        h('label', { style: labelStyle }, 'Response delivery delay (seconds)',
          h('input', { type: 'number', min: 1, max: 60, step: 1, value: draft.delaySeconds, disabled, onChange: (event) => edit('delaySeconds', event.target.value), style: inputStyle }),
          h('p', { style: hintStyle }, 'Whole number from 1 to 60. The /dsh-restart command may override this value.'),
        ),
        h('label', { style: labelStyle }, 'Successor process output',
          h('select', { value: draft.execStdio, disabled, onChange: (event) => edit('execStdio', event.target.value), style: inputStyle },
            h('option', { value: 'inherit' }, 'Inherit output'),
            h('option', { value: 'ignore' }, 'Discard output'),
          ),
        ),
        snapshot.writable ? null : h('p', { role: 'status', style: hintStyle }, 'This deployment stores settings read-only.'),
        error ? h('p', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)' } }, error) : null,
        notice ? h('p', { role: 'status', style: { color: 'var(--dsw-alias-state-success-primary)' } }, notice) : null,
        h('button', { type: 'submit', disabled: disabled || !dirty, style: { padding: '8px 14px', border: 0, borderRadius: 8, background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)', font: 'inherit', cursor: disabled || !dirty ? 'not-allowed' : 'pointer', opacity: disabled || !dirty ? 0.55 : 1 } }, saving ? 'Saving…' : 'Save settings'),
      )
    }

    const inject = ['slots', 'configForms']
    function apply(ctx) {
      const form = ctx.configForms.get('dsh-restart')
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PLUGIN_ID,
      }, (props) => h(RestartConfig, { ...props, form })))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
