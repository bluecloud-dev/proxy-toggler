# Use the proxy in terminals

With **Apply To Terminals** on, new integrated terminals and tasks get the proxy VS Code uses:

| Variable                    | Value                                                     |
| --------------------------- | --------------------------------------------------------- |
| `http_proxy`, `https_proxy` | The proxy URL, without a user name or password            |
| `no_proxy`                  | `localhost`, `127.0.0.1` and `::1`, then your bypass list |

The same names in upper case get the same values. Turning the proxy off removes them.

- **User settings only:** a repository's settings cannot turn it on.
- **Open terminals** keep their environment. Relaunch them to pick up a change.
- **Certificate checks stay on**, whatever the profile's strict SSL choice.
- **Your shell wins:** a proxy that your shell's startup files export replaces these values.
- **The Source Control view** runs Git outside a terminal. Set Git's own `http.proxy` for it.
