import { useCallback, useEffect, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { RequestBuilder } from './components/request/RequestBuilder';
import { ResponseViewer } from './components/response/ResponseViewer';
import { useRequestStore } from './store/requestStore';
import { sendRequest, friendlyError } from './lib/http';

function validUrl(url: string): boolean {
  try {
    const u = new URL(url.includes('://') ? url : `http://${url}`);
    return !!u.hostname;
  } catch {
    return false;
  }
}

export default function App() {
  const { request, loading, setLoading, setResponse, setError } = useRequestStore();
  // Track the in-flight request id so a stale/cancelled result is ignored.
  const inflight = useRef<string | null>(null);

  const onSend = useCallback(async () => {
    const url = request.url.trim();
    if (!validUrl(url)) {
      setResponse(null);
      setError('Invalid URL — check the address and try again.');
      return;
    }
    const normalized = url.includes('://') ? url : `https://${url}`;
    const token = Math.random().toString(36);
    inflight.current = token;
    setError(null);
    setResponse(null);
    setLoading(true);
    try {
      const res = await sendRequest({ ...request, url: normalized });
      if (inflight.current === token) setResponse(res);
    } catch (e) {
      if (inflight.current === token) setError(friendlyError(e));
    } finally {
      if (inflight.current === token) setLoading(false);
    }
  }, [request, setLoading, setResponse, setError]);

  const onCancel = useCallback(() => {
    // ponytail: ignore the stale result rather than aborting the reqwest task; upgrade to a
    // real cancel channel if long uploads matter.
    inflight.current = null;
    setLoading(false);
  }, [setLoading]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!loading) onSend();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSend, loading]);

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <RequestBuilder onSend={onSend} onCancel={onCancel} />
        <ResponseViewer onRetry={onSend} />
      </main>
    </div>
  );
}
