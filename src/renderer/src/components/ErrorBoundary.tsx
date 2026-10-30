import { Component, type ErrorInfo, type ReactNode } from "react";

const log = (text: string) => window.distopic?.logError?.(text);

/** Errors outside React (handlers, promises) only get logged. */
window.addEventListener("error", (e) => log(`error: ${e.error instanceof Error ? e.error.stack : e.message}`));
window.addEventListener("unhandledrejection", (e) => log(`unhandled rejection: ${e.reason instanceof Error ? e.reason.stack : String(e.reason)}`));

const RETRY_MS = 1500;
const MAX_QUICK_RETRIES = 2;

/**
 * Without this, one error while drawing removes the whole interface and leaves
 * an empty window. Most of those come from data that was briefly incomplete
 * (e.g. right after reconnecting), so it draws again on its own a couple of
 * times; if it keeps failing, it shows the error and a way out.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; retrying: boolean }> {
  state = { error: null as Error | null, retrying: false };
  private retries = 0;
  private lastError = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  // Plain screen first; componentDidCatch decides between retrying and the message.
  static getDerivedStateFromError(error: Error) {
    return { error, retrying: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log(`render: ${error.stack ?? error.message}\n${info.componentStack ?? ""}`);
    // An error long after the last one starts the count over.
    if (Date.now() - this.lastError > 30_000) this.retries = 0;
    this.lastError = Date.now();
    if (this.retries < MAX_QUICK_RETRIES) {
      this.retries++;
      this.timer = setTimeout(this.retry, RETRY_MS);
    } else this.setState({ retrying: false });
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  retry = () => this.setState({ error: null, retrying: false });

  render() {
    const { error, retrying } = this.state;
    if (!error) return this.props.children;
    if (retrying) return <div className="crash-screen" />;
    return (
      <div className="crash-screen" role="alert">
        <h1>Algo deu errado nesta tela</h1>
        <p className="muted">Suas contas e conversas estão salvas. O erro foi registrado no arquivo errors.log, na pasta de dados do Annoy.</p>
        <code>{error.message}</code>
        <div className="crash-actions">
          <button className="btn" onClick={this.retry}>Tentar de novo</button>
          <button className="btn btn-ghost" onClick={() => location.reload()}>Recarregar o Annoy</button>
        </div>
      </div>
    );
  }
}
