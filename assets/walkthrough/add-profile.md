# Add your proxy

A profile holds what VS Code needs to reach the internet through a proxy:

- **Proxy URL**, with its port, such as `http://proxy.example.com:8080` or
  `socks5://proxy.example.com:1080`
- **Name**, which starts as the proxy's host
- **Strict SSL** and a **bypass list** of hosts VS Code reaches directly, which **Edit Profile…**
  changes later

Profiles hold no user name or password. When a proxy asks you to sign in, VS Code shows its own
sign-in dialog.

After saving, **Test Connection** sends one request through the proxy to check that it works.
