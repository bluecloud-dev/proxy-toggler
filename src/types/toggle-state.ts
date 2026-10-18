/**
 * Stored toggle state for the extension.
 */
export type ToggleState = {
  /** Whether the proxy is currently enabled in VS Code settings. */
  isEnabled: boolean;
  /** Whether a proxy configuration has been saved. */
  hasConfiguration: boolean;
};
