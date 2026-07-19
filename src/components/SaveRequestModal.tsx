import { useEffect, useMemo, useState } from 'react';
import { Check, Folder, FolderPlus, Plus, X } from 'lucide-react';
import type { TesApiRequest, RequestOrigin } from '../types';
import { requestName, type FlatNode } from '../lib/collections';
import { useCollectionStore } from '../store/collectionStore';
import { methodColor } from '../lib/methods';

interface Props {
  request: TesApiRequest;
  open: boolean;
  onCancel: () => void;
  onSaved: (origin: RequestOrigin, name: string) => void;
  onError?: (message: string) => void;
}

interface Location {
  collectionId: string;
  parentId: string | null;
  name: string;
  label: string;
  depth: number;
  type: 'collection' | 'folder';
}

interface NewLocation {
  type: 'collection' | 'folder';
  value: string;
}

const locationKey = (location: Pick<Location, 'collectionId' | 'parentId'>) => `${location.collectionId}|${location.parentId ?? ''}`;

export function SaveRequestModal({ request, open, onCancel, onSaved, onError }: Props) {
  const { summaries, collectionsById, loadAll, createCollection, createFolder, saveRequest } = useCollectionStore();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [newLocation, setNewLocation] = useState<NewLocation | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locations = useMemo(() => {
    const result: Location[] = [];
    const visit = (collectionId: string, node: FlatNode, depth: number, path: string[]) => {
      if (node.type !== 'folder') return;
      const nextPath = [...path, node.name];
      result.push({ collectionId, parentId: node.id, name: node.name, label: nextPath.join(' / '), depth, type: 'folder' });
      const collection = collectionsById[collectionId];
      for (const childId of collection?.childIdsByParent[node.id] ?? []) {
        const child = collection.nodesById[childId];
        if (child) visit(collectionId, child, depth + 1, nextPath);
      }
    };
    for (const summary of summaries) {
      result.push({ collectionId: summary.id, parentId: null, name: summary.name, label: summary.name, depth: 0, type: 'collection' });
      const collection = collectionsById[summary.id];
      for (const id of collection?.childIdsByParent.__root__ ?? []) {
        const node = collection.nodesById[id];
        if (node) visit(summary.id, node, 1, [summary.name]);
      }
    }
    return result;
  }, [collectionsById, summaries]);

  const selected = locations.find((item) => locationKey(item) === location);

  useEffect(() => {
    if (!open) return;
    setName(requestName(request));
    setNewLocation(null);
    setSaving(false);
    setCreatingLocation(false);
    setError(null);
    void loadAll();
  }, [loadAll, open, request]);

  useEffect(() => {
    if (!open) return;
    if (!locations.some((item) => locationKey(item) === location)) setLocation(locations[0] ? locationKey(locations[0]) : '');
  }, [location, locations, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (newLocation) setNewLocation(null);
      else if (!saving && !creatingLocation) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [creatingLocation, newLocation, onCancel, open, saving]);

  if (!open) return null;

  const startCreating = (type: NewLocation['type']) => {
    setError(null);
    setNewLocation({ type, value: '' });
  };

  const createLocation = async () => {
    if (!newLocation || !newLocation.value.trim() || (newLocation.type === 'folder' && !selected)) return;
    setCreatingLocation(true);
    setError(null);
    try {
      if (newLocation.type === 'collection') {
        const collectionId = await createCollection(newLocation.value);
        setLocation(`${collectionId}|`);
      } else {
        const folderId = await createFolder(selected!.collectionId, selected!.parentId, newLocation.value);
        setLocation(`${selected!.collectionId}|${folderId}`);
      }
      setNewLocation(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setCreatingLocation(false);
    }
  };

  const save = async () => {
    if (!selected || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const nodeId = await saveRequest(selected.collectionId, selected.parentId, name, request);
      onSaved({ collectionId: selected.collectionId, nodeId }, name.trim());
    } catch (cause) {
      const message = String(cause);
      setError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  };

  const createDepth = newLocation?.type === 'folder' ? (selected?.depth ?? 0) + 1 : 0;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving && !creatingLocation) onCancel(); }}>
      <section className="save-location-modal save-request-modal" role="dialog" aria-modal="true" aria-labelledby="save-request-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="save-modal-header">
          <div>
            <h2 id="save-request-title">Save request</h2>
            <div className="save-request-source"><span className="save-method" style={{ color: methodColor(request.method) }}>{request.method}</span><code title={request.url || 'No URL'}>{request.url || 'No URL'}</code></div>
          </div>
          <button className="modal-close" aria-label="Close save dialog" disabled={saving || creatingLocation} onClick={onCancel}><X size={14} /></button>
        </div>

        <div className="save-modal-body">
          <label className="save-name-field">
            <span>Request name</span>
            <input autoFocus value={name} placeholder="Untitled request" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void save(); }} />
          </label>

          <section className="save-destination" aria-labelledby="save-destination-title">
            <div className="save-destination-header">
              <div><h3 id="save-destination-title">Save to</h3><p>{selected?.label ?? 'Choose a collection or folder'}</p></div>
              <div className="save-destination-actions">
                <button type="button" className="save-destination-action" onClick={() => startCreating('collection')}><Plus size={13} /> Collection</button>
                <button type="button" className="save-destination-action" disabled={!selected} onClick={() => startCreating('folder')}><FolderPlus size={13} /> Folder</button>
              </div>
            </div>

            <div className="save-location-list" role="listbox" aria-label="Save location">
              {locations.map((item) => {
                const active = locationKey(item) === location;
                return <button type="button" role="option" aria-selected={active} className={`save-location-row${active ? ' selected' : ''}`} style={{ paddingLeft: 10 + item.depth * 18 }} key={locationKey(item)} onClick={() => { setLocation(locationKey(item)); setError(null); }}><Folder size={14} /><span>{item.name}</span>{item.type === 'collection' && <small>Collection</small>}{active && <Check className="save-location-check" size={14} />}</button>;
              })}
              {!locations.length && !newLocation && <div className="save-location-empty"><FolderPlus size={18} /><span>No collections yet</span><button type="button" onClick={() => startCreating('collection')}>Create collection</button></div>}
              {newLocation && <div className="save-create-location" style={{ paddingLeft: 10 + createDepth * 18 }}><FolderPlus size={14} /><input autoFocus placeholder={newLocation.type === 'collection' ? 'Collection name' : 'Folder name'} value={newLocation.value} onChange={(event) => setNewLocation({ ...newLocation, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void createLocation(); if (event.key === 'Escape') setNewLocation(null); }} /><button type="button" aria-label="Create location" disabled={!newLocation.value.trim() || creatingLocation} onClick={() => void createLocation()}>{creatingLocation ? <span className="spinner" /> : <Check size={14} />}</button><button type="button" aria-label="Cancel new location" disabled={creatingLocation} onClick={() => setNewLocation(null)}><X size={14} /></button></div>}
            </div>
          </section>

          {error && <p className="save-modal-error" role="alert">Could not save: {error}</p>}
        </div>

        <div className="save-modal-actions">
          <div className="save-modal-location"><Folder size={13} /><span>{selected?.label ?? 'No destination selected'}</span></div>
          <div className="save-modal-buttons"><button className="modal-cancel" disabled={saving || creatingLocation} onClick={onCancel}>Cancel</button><button className="modal-save" disabled={!selected || !name.trim() || saving || creatingLocation} onClick={() => void save()}><Check size={14} /> {saving ? 'Saving…' : 'Save request'}</button></div>
        </div>
      </section>
    </div>
  );
}
