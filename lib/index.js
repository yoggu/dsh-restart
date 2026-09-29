/**
 * dsh-restart — `/dsh-restart` startet den Harness neu, in dem man gerade
 * arbeitet.
 *
 * Zwei Betriebsarten, weil ein Harness auf zwei Weisen läuft:
 *
 * - **Unit** (systemd): der Prozess liegt in einer Unit. Der Befehl setzt einen
 *   transienten Timer ab (`systemd-run --user --on-active`), der die Unit
 *   später neu startet. Der Timer liegt beim User-Manager und überlebt damit
 *   genau den Prozess, den er beendet.
 * - **Prozess** (Terminal, tmux, nohup): es gibt keine Unit zum Neustarten.
 *   Der Befehl startet einen Nachfolger mit derselben Kommandozeile, der
 *   wartet, bis dieser Prozess verschwunden ist — sonst kollidieren beide am
 *   Port — und beendet sich danach selbst. `execve` gibt es in Node nicht,
 *   deshalb ist der Nachfolger ein abgesetzter Prozess und kein Ersatz an Ort
 *   und Stelle.
 *
 * Welche der beiden gilt, leitet `mode: auto` aus der eigenen Cgroup ab: eine
 * `*.service`-Unit ist der Regelfall, ein `*.scope` (Terminal, Sitzung) der
 * Prozessfall.
 *
 * ```yaml
 * - insert:
 *     - id: dsh-restart
 *       name: 'dsh-restart'
 *       config:
 *         mode: auto          # auto | unit | exec
 *         delaySeconds: 1
 * ```
 *
 * @module dsh-restart
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-restart'
export const inject = ['commands']

export const Config = Schema.object({
  /**
   * `auto` leitet die Betriebsart aus der eigenen Cgroup ab, `unit` erzwingt
   * den systemd-Weg, `exec` den Prozess-Weg.
   */
  language: Schema.union(['en', 'de']).default('en').description('Command language: English (default) or German.').volatile(),
  mode: Schema.union(['auto', 'unit', 'exec']).default('auto').description('Restart mode: detect automatically, restart a systemd unit, or start a successor process.').volatile(),
  /**
   * Die Unit für den systemd-Weg. Leer heißt: den eigenen Cgroup-Pfad lesen.
   * Ein fester Wert schaltet `auto` dauerhaft auf den Unit-Weg — auch für einen
   * Prozess, der gar nicht in dieser Unit läuft.
   */
  unit: Schema.string().default('').description('Systemd unit name. Leave empty to detect the current process unit.').volatile(),
  /**
   * Vorlauf in Sekunden, bevor der Neustart greift. Er ist die Zeit, die der
   * Antwort bleibt, den Browser zu erreichen: sie geht als RPC-Antwort von
   * `commands/execute` zurück, und der Handler kehrt vor ihrem Flush zurück.
   * Der eigentliche Bedarf liegt auf localhost im Millisekundenbereich — die
   * Sekunde ist die Reserve dafür, keine Wartezeit, die systemd bräuchte.
   */
  delaySeconds: Schema.number().min(1).max(60).step(1).default(1).description('Response delivery delay in seconds (1–60).').volatile(),

  /**
   * Ein-/Ausgabe des Nachfolgers im Prozess-Weg: `inherit` lässt die Logs dort
   * weiterlaufen, wo sie waren (Terminal, umgeleitete Datei), `ignore` hängt
   * sie los, wenn der Vorgänger sie nicht mehr halten kann.
   */
  execStdio: Schema.union(['inherit', 'ignore']).default('inherit').description('Successor process output: inherit existing output or discard it.').volatile(),
})

/** Wie lange auf das Ende dieses Prozesses gewartet wird, in 0,2-s-Schritten. */
const WAIT_STEPS = 75

/**
 * Das Shell-Programm, das den Nachfolger startet.
 *
 * Es wartet, bis der Vorgänger-PID verschwunden ist: zwei Instanzen am selben
 * Port wären ein `EADDRINUSE`, und der Nachfolger soll den frei werdenden Port
 * erben, nicht gegen ihn verlieren. Die Wartezeit ist begrenzt, damit ein
 * Vorgänger, der sich nicht beenden lässt, den Nachfolger nicht dauerhaft
 * blockiert — ein Zombie hat seinen Port bereits freigegeben.
 */
const RESPAWN_SCRIPT = `i=0
while kill -0 "$1" 2>/dev/null && [ "$i" -lt ${WAIT_STEPS} ]; do
  sleep 0.2
  i=$((i + 1))
done
shift
exec "$@"`

/**
 * Die eigene systemd-Unit aus der Cgroup ableiten.
 *
 * Ein Dienst liegt unter `…/app.slice/<name>.service`, ein Terminal oder eine
 * Sitzung unter einem `…scope`, und der User-Manager selbst
 * (`user@1000.service`) ist nie das Neustartziel dieses Prozesses.
 *
 * @param cgroupText - der Inhalt von `/proc/self/cgroup`.
 * @returns der Unit-Name, oder undefined wenn dieser Prozess in keiner Unit liegt.
 */
export function detectOwnUnit(cgroupText) {
  for (const line of cgroupText.split('\n')) {
    const path = line.slice(line.indexOf(':') + 1)
    const last = path.split('/').filter((part) => part.length > 0).pop()
    if (last === undefined || !last.endsWith('.service') || last.startsWith('user@')) continue
    return last
  }
  return undefined
}

/** Die eigene Cgroup lesen; außerhalb von Linux gibt es keine. */
function readOwnCgroup() {
  try {
    return readFileSync('/proc/self/cgroup', 'utf8')
  } catch {
    return ''
  }
}

/**
 * Einen Neustart beim User-Manager absetzen.
 *
 * Auf den Abschluss von `systemd-run` wird gewartet: es richtet den Timer ein
 * und beendet sich sofort, sein Exit-Code ist damit das ehrliche Ergebnis.
 * Erst der Neustart selbst läuft später und ohne diesen Prozess.
 *
 * @param unit - die Unit, die neu gestartet wird.
 * @param delaySeconds - Vorlauf, bevor systemd den Auftrag ausführt.
 * @returns ob der Timer eingerichtet wurde, plus die Ausgabe von `systemd-run` für den Fehlerfall.
 */
function scheduleUnitRestart(unit, delaySeconds) {
  return new Promise((resolve) => {
    const child = spawn(
      'systemd-run',
      ['--user', `--on-active=${delaySeconds}`, '--collect', 'systemctl', '--user', 'restart', unit],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.once('error', (error) => resolve({ ok: false, output: String(error?.message ?? error) }))
    child.once('close', (code) => resolve({ ok: code === 0, output: output.trim() }))
  })
}

/**
 * Den Nachfolger abstellen, der auf das Ende dieses Prozesses wartet.
 *
 * `detached` und `unref` lösen ihn von diesem Prozess: er soll weiterlaufen,
 * wenn hier nichts mehr läuft. Ob seine Ausgabe am selben Ort bleibt,
 * entscheidet `stdio`.
 *
 * @param options - Kommandozeile des Nachfolgers, Arbeitsverzeichnis, Ein-/Ausgabe und der PID, auf dessen Ende er wartet.
 * @returns der PID des Zwischenprozesses, der den Nachfolger startet.
 */
export function startSuccessor({ execPath, args, cwd, stdio, waitForPid }) {
  const child = spawn('/bin/sh', ['-c', RESPAWN_SCRIPT, 'sh', String(waitForPid), execPath, ...args], {
    cwd,
    detached: true,
    stdio,
  })
  child.unref()
  return child.pid
}

/**
 * Diesen Prozess beenden, nachdem die Antwort zugestellt ist.
 *
 * Zuerst höflich per SIGTERM, damit der Harness herunterfährt und den Port
 * freigibt — genau das, was ein `systemctl stop` auch täte. Der zweite Timer ist
 * ein Notausgang: ein Vorgänger, der auf SIGTERM nicht reagiert, würde den
 * Nachfolger sonst bis zum Ablauf der Wartezeit blockieren.
 *
 * @param delaySeconds - wie lange die Antwort Zeit hat, den Browser zu erreichen.
 */
function scheduleSelfExit(delaySeconds) {
  setTimeout(() => {
    try {
      process.kill(process.pid, 'SIGTERM')
    } catch {
      /* Der Prozess ist bereits weg. */
    }
  }, delaySeconds * 1000)
  setTimeout(() => process.exit(0), (delaySeconds + 5) * 1000)
}

/**
 * Das Plugin mounten.
 * @param ctx - der Cordis-Kontext der Zeile.
 * @param config - die aufgelöste Zeilenkonfiguration.
 */
export function apply(ctx, config) {
  // Volatile settings are stable references: read their latest values for each
  // command so a save from the Plugins page takes effect without remounting.
  const setting = (field, fallback) => {
    const value = config[field]
    return value !== null && typeof value === 'object' && typeof value.get === 'function'
      ? value.get()
      : value ?? fallback
  }

  // Read live language refs; unknown/unset languages fall back to English.
  const t = (de, en) => setting('language', 'en') === 'de' ? de : en
  ctx.commands.register({
    name: 'dsh-restart',
    description: t('Harness neu starten (systemd-Unit oder eigener Prozess)', 'Restart the Harness (systemd unit or successor process)'),
    input: { hint: t('[Sekunden]', '[seconds]') },
    // Der Neustart steht im Log der Unit beziehungsweise in der Ausgabe des
    // Nachfolgers, nicht in der Sitzung; das Kommando hat keinen Inhalt, den
    // die Historie aufbewahren müsste.
    recordInput: false,
    handler: async ({ rawInput }) => {
      const requested = String(rawInput ?? '').trim()
      const delaySeconds = requested.length === 0 ? setting('delaySeconds', 1) : Number(requested)
      if (!Number.isFinite(delaySeconds) || delaySeconds < 1 || delaySeconds > 60) {
        return { kind: 'error', text: t(`Der Vorlauf muss zwischen 1 und 60 Sekunden liegen, nicht "${requested}".`, `The delay must be between 1 and 60 seconds, not "${requested}".`) }
      }

      const configured = setting('unit', '').trim()
      const unit = configured.length > 0 ? configured : detectOwnUnit(readOwnCgroup())
      const configuredMode = setting('mode', 'auto')
      const mode = configuredMode === 'auto' ? (unit === undefined ? 'exec' : 'unit') : configuredMode

      if (mode === 'unit') {
        if (unit === undefined) {
          return {
            kind: 'error',
            text: t(
              'mode "unit" ist erzwungen, aber es gibt weder eine konfigurierte Unit noch einen ' +
              'Cgroup-Pfad, der eine nennt. Setze `unit` oder nutze `mode: auto`.',
              'Mode "unit" is required, but no unit is configured or detected in the cgroup path. ' +
              'Set `unit` or use `mode: auto`.',
            ),
          }
        }
        const { ok, output } = await scheduleUnitRestart(unit, delaySeconds)
        if (!ok) {
          return { kind: 'error', text: t(`Neustart von ${unit} konnte nicht abgesetzt werden:\n${output}`, `Could not schedule the restart of ${unit}:\n${output}`) }
        }
        return {
          kind: 'success',
          text: t(
            `systemd-Unit ${unit} startet in ${delaySeconds} s neu. ` +
            'Der laufende Turn endet damit; dieses Fenster verbindet sich danach neu.',
            `Systemd unit ${unit} will restart in ${delaySeconds} s. ` +
            'The running turn will end; this window will reconnect afterward.',
          ),
        }
      }

      startSuccessor({
        execPath: process.execPath,
        args: process.argv.slice(1),
        cwd: process.cwd(),
        stdio: setting('execStdio', 'inherit') === 'ignore' ? 'ignore' : 'inherit',
        waitForPid: process.pid,
      })
      scheduleSelfExit(delaySeconds)
      return {
        kind: 'success',
        text: t(
          `Dieser Prozess (PID ${process.pid}) übergibt in ${delaySeconds} s an einen neuen mit derselben ` +
          'Kommandozeile. Der laufende Turn endet damit; dieses Fenster verbindet sich danach neu.',
          `This process (PID ${process.pid}) will hand over in ${delaySeconds} s to a successor with the same ` +
          'command line. The running turn will end; this window will reconnect afterward.',
        ),
      }
    },
  })
}
