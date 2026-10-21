# Profiles hold no proxy credentials

Profiles store no username or password. When a proxy answers 407, VS Code's own login dialog asks
for credentials and can remember them
([VS Code docs](https://code.visualstudio.com/docs/setup/network#_authenticated-proxies)).
Applying stored credentials would mean writing them into settings, as `user:pass@` in `http.proxy`
or as `http.proxyAuthorization`, which breaks the rule that secrets never reach settings; 0.1.x
stored credentials but never applied them. Since VS Code 1.92 (v0.2.0 requires 1.97), the same
dialog also answers Basic challenges on extensions' tunnels
([proxyResolver.ts](https://github.com/microsoft/vscode/blob/1.92.0/src/vs/workbench/api/node/proxyResolver.ts#L199-L235)).

## Consequences

- Every activation deletes the 0.1.x secrets `proxyToggler.credentials.username` and
  `proxyToggler.credentials.password` if they exist, in whichever window finds them. Only when one
  was found does the user get a one-time notice that VS Code will ask instead, shown in the next
  focused window of that VS Code Profile. A failed delete never blocks migration; it is retried at
  the next activation.
- An `http.proxy` that holds `user:pass@` still matches a profile with the same URL. Proxy Toggler
  strips the credentials from everything it shows or remembers, and says once, before it first
  overwrites or clears them, that they will be removed. VS Code's login dialog then answers for VS
  Code's own requests and for extensions' HTTPS requests. Extensions' plain `http://` requests
  through a proxy that asks for Basic sign-in fail, because VS Code never asks for those.
- The README explains how proxy sign-in works.
- The test connection cannot sign in, so it reports a 407 as a warning, not a failure.
