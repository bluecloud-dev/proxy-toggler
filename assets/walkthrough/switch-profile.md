# Switch profiles

Click the gear next to the toggle, or run **Proxy Toggler: Switch Profile…**. The switcher lists
your profiles with the current one checked. Picking one turns it on.

Below the profiles, the switcher can:

- **Turn Proxy On** or **Turn Proxy Off**
- **Add Profile…**, **Edit Profile…** and **Delete Profile…**
- Set this project's default, under **This Project**

**Edit Profile…** also offers **Test Connection…**, which sends one request through the
profile's proxy to a URL you pick and says whether it got through.

To switch with a key, run **Preferences: Open Keyboard Shortcuts (JSON)** and pass a profile's
name:

```json
{ "key": "ctrl+alt+w", "command": "proxyToggler.switchProfile", "args": "Work" }
```
