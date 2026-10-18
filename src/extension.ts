import * as vscode from 'vscode';

import { createProxyToggler, type ProxyTogglerApi } from './proxy-toggler';

export function activate(context: vscode.ExtensionContext): ProxyTogglerApi {
  return createProxyToggler(vscode, context);
}
