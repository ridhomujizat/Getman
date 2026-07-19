import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, History, Layers3, Search } from 'lucide-react';
import { useRequestStore } from '../../store/requestStore';
import { methodColor } from '../../lib/methods';
import { parseCurl } from '../../lib/curl';
import { uid } from '../../lib/id';
import type { Method } from '../../types';

const groups = [
  { name: 'Payments API', open: true, requests: [
    ['GET', 'List transactions', "curl 'https://httpbin.org/get?limit=25&status=active'"],
    ['GET', 'Retrieve transaction detail', "curl 'https://httpbin.org/get?id=txn_01J8ZKQ2M4'"],
    ['POST', 'Upload receipt', "curl -X POST 'https://httpbin.org/post' -F 'description=Taxi receipt — July 2026' -F 'attachments=@receipt-july.png' -F 'attachments=@invoice.pdf'"],
    ['POST', 'Refund charge', "curl -X POST 'https://httpbin.org/post' --data-raw 'transaction=txn_01J8ZKQ2M4'"],
    ['PATCH', 'Update charge metadata', "curl -X PATCH 'https://httpbin.org/patch' -H 'Content-Type: application/json' --data-raw '{\"order_id\":\"1284\"}'"],
    ['DELETE', 'Delete charge', "curl -X DELETE 'https://httpbin.org/delete'"],
  ] },
  { name: 'Users', open: true, requests: [
    ['GET', 'List users', "curl 'https://jsonplaceholder.typicode.com/users'"],
    ['POST', 'Create user', "curl -X POST 'https://httpbin.org/post' -H 'Content-Type: application/json' --data-raw '{\"name\":\"Ada\"}'"],
    ['PUT', 'Update user profile', "curl -X PUT 'https://httpbin.org/put' -H 'Content-Type: application/json' --data-raw '{\"name\":\"Ada Lovelace\"}'"],
  ] },
  { name: 'Webhooks', open: false, requests: [] },
] as const;

export function Sidebar() {
  const { request, replaceRequest } = useRequestStore();
  const [view, setView] = useState<'collections' | 'history' | 'environments'>('collections');
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => groups.map((group) => ({
    ...group,
    requests: group.requests.filter(([, name]) => name.toLowerCase().includes(query.toLowerCase())),
  })), [query]);

  const load = (curl: string, name: string) => {
    const next = parseCurl(curl);
    if (!next) return;
    if (name === 'Upload receipt') {
      const rows = next.body.formData ?? [];
      next.body.formData = [
        ...rows.filter((row) => row.key).map((row) => row.key === 'description' ? { ...row, description: 'Multipart text field' } : row),
        { id: uid(), key: 'supporting_file', value: '', enabled: true, valueType: 'file', files: [], description: 'Select one file' },
        rows.find((row) => !row.key) ?? { id: uid(), key: '', value: '', enabled: true },
      ];
    }
    replaceRequest({ ...next, name });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button className={`icon-button${view === 'collections' ? ' active' : ''}`} title="Collections" onClick={() => setView('collections')}>
          <Folder size={15} />
        </button>
        <button className={`icon-button${view === 'history' ? ' active' : ''}`} title="History" onClick={() => setView('history')}>
          <History size={15} />
        </button>
        <button className={`icon-button${view === 'environments' ? ' active' : ''}`} title="Environments" onClick={() => setView('environments')}>
          <Layers3 size={15} />
        </button>
      </div>
      <div className="sidebar-search">
        <div className="search-box">
          <Search size={13} color="var(--text-muted)" />
          <input placeholder="Search requests" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />
          <kbd>⌘K</kbd>
        </div>
      </div>
      <div className="tree">
        <div className="tree-group label-caps">{view}</div>
        {view === 'collections' && filtered.map((group) => (
          <div className="collection" key={group.name}>
            <div className="folder-row">{group.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Folder size={13} /><span>{group.name}</span></div>
            {group.open && group.requests.map(([method, name, curl]) => (
              <button className={`tree-row${request.name === name ? ' selected' : ''}`} key={name} onClick={() => load(curl, name)}>
                <span className="tree-method" style={{ color: methodColor(method as Method) }}>{method}</span><span>{name}</span>
              </button>
            ))}
          </div>
        ))}
        {view === 'history' && [
          ['GET', 'httpbin.org/get', '2 min ago'], ['POST', 'httpbin.org/post', 'Yesterday'], ['GET', 'jsonplaceholder…/users', 'Jul 16'],
        ].map(([method, name, when]) => <div className="history-row" key={`${name}-${when}`}><span className="tree-method" style={{ color: methodColor(method as Method) }}>{method}</span><span>{name}</span><time>{when}</time></div>)}
        {view === 'environments' && ['Local', 'Staging', 'Production'].map((name, i) => <div className="environment-row" key={name}><i className={i === 0 ? 'online' : ''} /><span>{name}</span><small>{i === 0 ? 'Active' : `${i + 2} variables`}</small></div>)}
      </div>
    </aside>
  );
}
