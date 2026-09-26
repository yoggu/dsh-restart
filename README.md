# dsh-restart

Adds `/dsh-restart` to DSH Web. It schedules a restart of the current Harness process or its own systemd user service after a short delay, allowing the command response to reach the browser.

## Install from GitHub

```sh
dsh plugin --profile web add https://github.com/yoggu/dsh-restart.git
```

Restart DSH Web if necessary to load the command. No credentials are required, but the DSH process must be allowed to restart itself or schedule a systemd user timer.

To uninstall: `dsh plugin --profile web remove dsh-restart`.

## Usage

```text
/dsh-restart       # configured delay (default: 1 second)
/dsh-restart 10    # restart in 10 seconds
```

The **Plugins → Restart** page configures `mode` (`auto`, `unit`, `exec`), systemd `unit`, `delaySeconds` (1–60), and `execStdio`. `auto` uses its own systemd unit when detected, otherwise starts a successor process. The running turn is interrupted and the web page reconnects afterward. Only trusted users with access to the DSH command surface should be able to invoke it.

## License

MIT; see [LICENSE](LICENSE).
