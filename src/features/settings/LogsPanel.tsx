import type { AppLog } from "../../shared/types";

export function LogsPanel({ logs }: { logs: AppLog[] }) {
  return (
    <section className="panel logs-panel">
      <h2>Logs</h2>
      <div className="logs-list">
        {logs.length === 0 ? <p className="muted">Событий пока нет.</p> : null}
        {logs.map((log) => (
          <article className={`log-row log-row--${log.level}`} key={log.id}>
            <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
            <span>{log.message}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
