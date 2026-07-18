import { useState } from 'react';
import { JsonView, collapseAllNested } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { ClockAlert, Copy, RotateCw, SendHorizontal } from 'lucide-react';
import { useRequestStore } from '../../store/requestStore';
import { StatusBadge } from './StatusBadge';
import { HeadersTable } from './HeadersTable';
import { formatBytes } from '../../lib/http';

type Tab = 'body' | 'headers';

const jsonStyles = {
  container: 'json-tree', basicChildStyle: 'json-child', childFieldsContainer: 'json-children',
  label: 'json-key', clickableLabel: 'json-key', nullValue: 'json-literal', undefinedValue: 'json-literal',
  stringValue: 'json-string', booleanValue: 'json-literal', numberValue: 'json-number', otherValue: 'json-string',
  punctuation: 'json-punctuation', collapseIcon: 'json-collapse', expandIcon: 'json-expand', collapsedContent: 'json-collapsed',
};

export function ResponseViewer({ onRetry }: { onRetry: () => void }) {
  const { response, error, loading } = useRequestStore();
  const [tab, setTab] = useState<Tab>('body');
  const [raw, setRaw] = useState(false);

  if (loading && !response) {
    return (
      <div className="response">
        <div className="loading-bar"><span className="spinner accent-spinner" />Sending request…</div>
        <div className="response-skeleton">
          {[180, 320, 260, 300, 150, 340, 220, 280, 200].map((width) => <i key={width} style={{ width }} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="response">
        <div className="empty-state response-error">
          <span className="error-icon"><ClockAlert size={26} /></span>
          <strong>{error.includes('timed out') ? 'Request timed out' : 'Request failed'}</strong>
          <p>{error.includes('timed out') ? 'No response after 30s. The server may be slow or unreachable — check the URL and try again.' : error}</p>
          <button className="outlined-btn" onClick={onRetry}><RotateCw size={13} /> Retry</button>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="response">
        <div className="empty-state">
          <SendHorizontal size={34} />
          <strong>Hit Send to see the response</strong>
          <span>or press <kbd>⌘ Enter</kbd></span>
        </div>
      </div>
    );
  }

  let parsed: unknown = null;
  const ct = response.headers['content-type'] ?? '';
  const looksJson = ct.includes('json') || response.body.trim().startsWith('{') || response.body.trim().startsWith('[');
  if (looksJson) {
    try {
      parsed = JSON.parse(response.body);
    } catch {
      parsed = null;
    }
  }

  const copy = () => navigator.clipboard.writeText(response.body);

  return (
    <div className="response">
      <div className="resp-summary">
        <StatusBadge status={response.status} statusText={response.statusText} />
        <span className="resp-meta">
          <b>{response.timeMs}</b> ms
        </span>
        <span className="resp-meta">
          <b>{formatBytes(response.sizeBytes)}</b>
        </span>
      </div>

      <div className="response-tabs">
        <div className="tabs borderless">
          <button className={`tab${tab === 'body' ? ' active' : ''}`} onClick={() => setTab('body')}>Body</button>
          <button className={`tab${tab === 'headers' ? ' active' : ''}`} onClick={() => setTab('headers')}>
            Headers<span className="count"> · {Object.keys(response.headers).length}</span>
          </button>
        </div>
        <div className="resp-actions">
          {tab === 'body' && parsed != null && <div className="segmented compact"><button className={!raw ? 'active' : ''} onClick={() => setRaw(false)}>Pretty</button><button className={raw ? 'active' : ''} onClick={() => setRaw(true)}>Raw</button></div>}
          {tab === 'body' && (
            <button className="copy-button" onClick={copy} title="Copy response">
              <Copy size={13} /> Copy
            </button>
          )}
        </div>
      </div>

      <div className="pane-body">
        {tab === 'headers' ? (
          <HeadersTable headers={response.headers} />
        ) : parsed != null && !raw ? (
          <div className="json-wrap">
            <JsonView data={parsed as object} style={jsonStyles} shouldExpandNode={collapseAllNested} />
          </div>
        ) : (
          <pre className="raw-body">{response.body || '(empty body)'}</pre>
        )}
      </div>
    </div>
  );
}
