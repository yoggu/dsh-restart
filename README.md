# dsh-restart

Ein `/dsh-restart`-Befehl für das DSH-Eingabefeld: startet den Harness neu, in
dem man gerade arbeitet — ohne Terminal.

```
/dsh-restart        # Neustart nach der konfigurierten Vorlaufzeit
/dsh-restart 10     # Neustart in 10 Sekunden
```

## Zwei Betriebsarten

Ein Harness läuft entweder in einer systemd-Unit oder als gewöhnlicher Prozess.
Beides wird unterstützt; `mode: auto` entscheidet anhand der eigenen Cgroup.

| Lage | Cgroup | Weg |
| --- | --- | --- |
| systemd-Dienst | `…/app.slice/dsh-web.service` | transienter Timer beim User-Manager startet die Unit neu |
| Terminal, tmux, nohup | `…/app.slice/app-….scope`, `…/session-N.scope` | Nachfolger mit derselben Kommandozeile, wartet auf das Ende dieses Prozesses |

**Unit-Weg.** Der Befehl setzt `systemd-run --user --on-active=<n> systemctl
--user restart <unit>` ab. Der transiente Timer liegt beim User-Manager und
überlebt damit genau den Prozess, den er beendet; die Vorlaufzeit gibt der
Antwort Zeit, den Browser zu erreichen. Ein direktes `systemctl` im selben
Prozess hätte die eigene Antwort abgeschnitten, und ein bloß abgespaltener
Kindprozess stürbe mit der Cgroup der Unit.

**Prozess-Weg.** Es gibt keine Unit, also startet der Befehl einen Nachfolger
(`process.execPath` mit `process.argv.slice(1)`, gleiches Arbeitsverzeichnis) und
beendet sich selbst. Der Nachfolger wartet zuerst darauf, dass der alte PID
verschwunden ist — zwei Instanzen am selben Port wären ein `EADDRINUSE`. Node
kennt kein `execve`, deshalb ist das ein abgesetzter Prozess und kein Ersatz an
Ort und Stelle. Beendet wird zuerst höflich per `SIGTERM` (der Harness fährt
herunter und gibt den Port frei), mit einem harten `exit` als Notausgang.

## Nebenwirkungen

- **Der laufende Turn endet.** Ein Neustart mitten in einer Antwort bricht sie
  ab; die Vorlaufzeit ist genau dafür da, die Antwort noch zuzustellen.
- Das Browser-Fenster verliert die Verbindung und verbindet sich nach dem
  Neustart neu.
- Im Prozess-Weg hängen die Logs je nach `execStdio` am selben Ort (`inherit`,
  Vorgabe) oder werden verworfen (`ignore`).
- Ein Neustart ist nur für Änderungen nötig, die beim **Laden** greifen (neue
  Bundle-Zeilen, `package.json`). `settings.yaml` ist hot-reloaded,
  `patchReload: live` gilt für Patch-Ebenen, und HMR lädt Plugins aus dem
  Plugin-Wurzelverzeichnis im laufenden Prozess neu.

## Konfiguration

```yaml
- insert:
    - id: dsh-restart
      name: 'dsh-restart'
      config:
        mode: auto            # auto | unit | exec
        unit: ''              # leer = aus der eigenen Cgroup ableiten
        delaySeconds: 2       # 1–60
        execStdio: inherit    # inherit | ignore (nur Prozess-Weg)
```

Eine spätere Patch-Ebene (das Profil-`cordis.patch.yml`) ersetzt die `config`
vollständig. Ein Argument am Befehl (`/dsh-restart 10`) überstimmt
`delaySeconds` für diesen einen Aufruf.

`mode: unit` erzwingt den systemd-Weg; ohne `unit` und ohne erkennbaren
Cgroup-Pfad endet der Befehl dann mit einem Fehler statt still den Prozess-Weg
zu nehmen. `mode: exec` erzwingt den Prozess-Weg — sinnvoll nur, wenn der
Prozess wirklich ohne Unit läuft, denn ein abgesetzter Nachfolger lebt dann
außerhalb der Unit, die systemd für beendet hält.

## Fehlerfälle

| Ergebnis | Bedeutung |
| --- | --- |
| `Neustart von <unit> konnte nicht abgesetzt werden` | `systemd-run` ist gescheitert; die Ausgabe darunter nennt den Grund (kein User-Manager, unbekannte Unit, kein `systemd-run` im PATH). |
| `mode "unit" ist erzwungen, aber …` | `mode: unit` ohne `unit` und ohne `*.service` in der eigenen Cgroup. |
| `Der Vorlauf muss zwischen 1 und 60 Sekunden liegen` | Das Argument am Befehl war keine Zahl im erlaubten Bereich. |
