# dsh-restart

A `/dsh-restart` command for the DSH input field: restarts the Harness you are
currently working in—without a terminal.

```
/dsh-restart        # Restart after the configured lead time
/dsh-restart 10     # Restart in 10 seconds
```

## Two operating modes

A Harness runs either in a systemd unit or as an ordinary process.
Both are supported; `mode: auto` decides based on its own cgroup.

| Situation | Cgroup | Method |
| --- | --- | --- |
| systemd service | `…/app.slice/dsh-web.service` | A transient timer at the user manager restarts the unit |
| Terminal, tmux, nohup | `…/app.slice/app-….scope`, `…/session-N.scope` | Successor with the same command line waits for this process to exit |

**Unit path.** The command schedules
`systemd-run --user --on-active=<n> systemctl --user restart <unit>`.
The transient timer is held by the user manager and therefore outlives exactly
the process it terminates; the lead time gives the response time to reach the
browser. A direct `systemctl` in the same process would truncate its own
response, and a merely detached child process would die with the unit's cgroup.

**Process path.** There is no unit, so the command starts a successor
(`process.execPath` with `process.argv.slice(1)`, same working directory) and
exits itself. The successor first waits for the old PID to disappear—two
instances on the same port would cause `EADDRINUSE`. Node has no `execve`, so
this is a detached process rather than an in-place replacement. Termination is
first attempted politely with `SIGTERM` (the Harness shuts down and frees the
port), with a hard `exit` as an emergency fallback.

## Side effects

- **The current turn ends.** A restart in the middle of a response aborts it;
  the lead time exists precisely to give the response time to be delivered.
- The browser window loses its connection and reconnects after the restart.
- In process mode, the logs remain in the same place depending on `execStdio`
  (`inherit`, the default) or are discarded (`ignore`).
- A restart is only needed for changes that take effect when **loading** (new
  bundle lines, `package.json`). `settings.yaml` is hot-reloaded,
  `patchReload: live` applies to patch layers, and HMR reloads plugins from the
  plugin root directory in the running process.

## Configuration

```yaml
- insert:
    - id: dsh-restart
      name: 'dsh-restart'
      config:
        mode: auto            # auto | unit | exec
        unit: ''              # empty = derive from the own cgroup
        delaySeconds: 1       # 1–60
        execStdio: inherit    # inherit | ignore (process path only)
```

A later patch layer (the profile's `cordis.patch.yml`) completely replaces the
`config`. An argument to the command (`/dsh-restart 10`) overrides
`delaySeconds` for that one invocation.

The default of one second is a **delivery buffer**, not a systemd requirement:
the command result is returned as an RPC response from `commands/execute`, and
the handler returns before its flush—with no lead time, the restart would race
its own response. On localhost, delivery takes milliseconds; the transient
timer itself would also work with zero lead time. Use a higher value only if the
machine is sluggish.

`mode: unit` forces the systemd path; without `unit` and without a recognizable
cgroup path, the command ends with an error instead of silently taking the
process path. `mode: exec` forces the process path—useful only when the process
really runs without a unit, because a detached successor would then live outside
the unit that systemd considers terminated.

## Error cases

| Result | Meaning |
| --- | --- |
| `Could not schedule restart of <unit>` | `systemd-run` failed; the output below gives the reason (no user manager, unknown unit, or no `systemd-run` in `PATH`). |
| `mode "unit" is forced, but …` | `mode: unit` without `unit` and without `*.service` in the own cgroup. |
| `The lead time must be between 1 and 60 seconds` | The argument to the command was not a number in the permitted range. |
