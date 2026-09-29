# dsh-restart

Adds `/dsh-restart` to DSH Web. It schedules a restart of the current Harness process or its own systemd user service after a short delay, allowing the command response to reach the browser.

## Install

Install the latest source from the existing default branch (older tags may not contain English command responses):

```sh
dsh plugin --profile web add 'https://github.com/yoggu/dsh-restart.git#main'
```

Or download the source and link the local checkout:

```sh
git clone https://github.com/yoggu/dsh-restart.git
cd dsh-restart
dsh plugin --profile web add "link:$(pwd)"
```

Keep a linked checkout in place while the plugin is installed. Use the profile you actually run if it is not `web`.

Restart DSH Web if necessary to load the command. No credentials are required, but the DSH process must be allowed to restart itself or schedule a systemd user timer.

To uninstall: `dsh plugin --profile web remove dsh-restart`.

## Usage

```text
/dsh-restart       # configured delay (default: 1 second)
/dsh-restart 10    # restart in 10 seconds
```

The **Plugins → Restart** page configures `mode` (`auto`, `unit`, `exec`), systemd `unit`, `delaySeconds` (1–60), and `execStdio`. `auto` uses its own systemd unit when detected, otherwise starts a successor process. The running turn is interrupted and the web page reconnects afterward. Only trusted users with access to the DSH command surface should be able to invoke it.

## Language and tests

Settings are in English. Command descriptions and responses default to **English**; set the plugin's **Command language** to **Deutsch** (`language: de`) to preserve the previous German command wording. This setting is independent of the Harness global UI language; unset or unsupported values fall back to English. Responses read the live setting; the menu description is selected when the command mounts.

Run `npm test` after installing peer dependencies. Tests mock process spawning, cgroup reads, and exit timers; they never call systemd or restart a process.

## License

MIT; see [LICENSE](<LICENSE>).
