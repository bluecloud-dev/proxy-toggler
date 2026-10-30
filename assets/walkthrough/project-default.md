# Give a project its own proxy

VS Code has one proxy for all its windows. A project can name its default profile, and VS Code's
proxy follows the window you work in. For a work project behind a proxy and personal projects
without one:

```jsonc
// User settings: no proxy for every project that names none
"proxyToggler.defaultProfile": false

// The work project's .vscode/settings.json
"proxyToggler.defaultProfile": "Work"
```

The switcher's **This Project** entries write the project's setting for you.

- **Names only:** a project never holds a proxy URL. If you have no profile by its name, the proxy
  stays as it is and Proxy Toggler offers to add one.
- **Your changes win in their window:** a switch made in a window lasts until it closes or reloads.
- **Untrusted folders:** in Restricted Mode, VS Code uses your value, not the folder's.
