# Proxy Toggler

Proxy Toggler switches VS Code's own proxy settings between proxy profiles and off, from the
status bar. It never changes the operating system's proxy.

## Language

### Profiles

**Profile**:
A named set of proxy values the user can switch to: a proxy URL, a strict SSL choice and a bypass
list. It holds no credentials, and its name identifies it.
_Avoid_: configuration, saved proxy, setup, VS Code Profile (VS Code's own feature; say "proxy
profile" wherever the two could be confused)

**Current profile**:
The one profile the toggle turns on. It exists whenever at least one profile exists, and it
survives reloads.
_Avoid_: last-used profile, active profile, selected profile, default profile

**Strict SSL**:
A profile's value for VS Code's strict SSL setting. Only VS Code's command line and some built-in
extensions honor it; the desktop app verifies certificates whatever it says.
_Avoid_: SSL verification, certificate checking

**Bypass list**:
A profile's list of hosts that VS Code should reach directly instead of through the proxy.
_Avoid_: no-proxy list, exclusions, exceptions

**Bypass pattern**:
One entry of a bypass list: a host name, a domain prefixed with `.` or `*.`, or an IP address. Apart
from loopback addresses, which always go direct, the VS Code window and extensions agree only on exact
host names and on subdomains of a `.` domain.
_Avoid_: no-proxy entry, exclusion rule

### Proxy state

**Match**:
VS Code's proxy settings match a profile when they carry the same proxy URL after parsing (the
same scheme, host and port, with an omitted port counting as the scheme's default, ignoring any
user name and password, letter case and a trailing slash), the same strict SSL choice (VS Code's
default counts as on) and the same set of bypass patterns, in any order and ignoring letter case.
_Avoid_: equal, applied (for this relation)

**Record**:
What Proxy Toggler remembers about one set of proxy settings: on or off, and the current profile.
The local settings and each remote machine's own settings have a record of their own.
_Avoid_: state, toggle state

**On**:
Proxy Toggler's record that the current profile is in use: it applied the profile, or found VS
Code's proxy settings matching it. Drift leaves the record unchanged.
_Avoid_: enabled, active

**Off**:
Proxy Toggler's record that no profile is in use: it cleared VS Code's proxy settings, or found
them cleared. Drift leaves the record unchanged.
_Avoid_: disabled, inactive, direct

**Not configured**:
No profile exists.
_Avoid_: unconfigured, empty, no configuration

**Drift**:
While at least one profile exists, VS Code's proxy settings carry a proxy that matches no profile.
_Avoid_: mismatch, out of sync, conflict

**Outside change**:
A change to VS Code's proxy settings or to the profile list that the window seeing it did not
make: a hand edit, Settings Sync, another window or another tool.
_Avoid_: external edit, foreign change

**Proxy change**:
A change Proxy Toggler makes to the profiles, the record or VS Code's proxy settings because the
user asked for it in this window.
_Avoid_: own change, user action

### Remote

**Remote window**:
A VS Code window connected to another machine through SSH, WSL, a Dev Container or a Tunnel. Its
remote side uses either the remote machine's own proxy settings or the local ones.
_Avoid_: remote session, remote host

**Remote side**:
The part of a remote window that runs on the remote machine: its extensions and their network
requests.
_Avoid_: remote host, server side

### Interface

**Switcher**:
The list of profiles and proxy actions behind the status bar gear, also opened by the Switch
Profile command.
_Avoid_: quick switcher, menu, gear menu, status bar menu

### Checks

**Test connection**:
A one-off request through a profile's proxy to a URL the user picks, to see whether the proxy
works. It is advisory: a failed test never stops a profile from being saved.
_Avoid_: health check (a separate, on-demand check), ping, connectivity check
