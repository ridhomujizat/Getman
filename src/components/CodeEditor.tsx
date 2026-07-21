import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { bracketMatching, foldGutter, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { VarStatus } from '../lib/variables';
import { splitVarSpans } from '../lib/variables';
import { VariablePopover, type AnchorBox } from './VariablePopover';
import { variableHighlight } from './editor/varHighlight';

type Language = 'json' | 'text';

interface Props {
  value: string;
  onChange?: (value: string) => void;
  language?: Language;
  readOnly?: boolean;
  placeholderText?: string;
  ariaLabel: string;
  className?: string;
  variableStatuses?: ReadonlyMap<string, VarStatus>;
}

const tesapiHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#8AB4F8' },
  { tag: tags.string, color: '#7EC699' },
  { tag: tags.number, color: '#F0A030' },
  { tag: [tags.bool, tags.null], color: '#B98AF0' },
  { tag: tags.punctuation, color: '#9A9CA3' },
  { tag: tags.comment, color: '#5E6167' },
]);

const tesapiTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#9A9CA3' },
  '.cm-scroller': { overflow: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: '12.5px', lineHeight: '1.45' },
  '.cm-content': { minHeight: '100%', padding: '12px 0', caretColor: '#6E9BFF' },
  '.cm-line': { padding: '0 16px' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 0, color: '#5E6167' },
  '.cm-gutterElement': { padding: '0 10px 0 16px' },
  '.cm-selectionBackground': { backgroundColor: '#6E9BFF4D' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: '#6E9BFF66' },
  '.cm-content ::selection': { backgroundColor: '#6E9BFF66' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#6E9BFF' },
  '.cm-foldPlaceholder': { border: 0, backgroundColor: '#1D1F23', color: '#5E6167' },
  '.cm-placeholder': { color: '#5E6167' },
}, { dark: true });

export function CodeEditor({
  value,
  onChange,
  language = 'text',
  readOnly = false,
  placeholderText,
  ariaLabel,
  className = '',
  variableStatuses,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const variableCompartment = useRef(new Compartment());
  const hoverTimer = useRef(0);
  const closeTimer = useRef(0);
  const [open, setOpen] = useState<{ name: string; anchor: AnchorBox; pinned: boolean } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      doc: value,
      extensions: [
        highlightSpecialChars(),
        history(),
        drawSelection(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        lineNumbers(),
        foldGutter(),
        bracketMatching(),
        tesapiTheme,
        syntaxHighlighting(tesapiHighlight),
        variableCompartment.current.of(variableStatuses ? variableHighlight(variableStatuses) : []),
        ...(language === 'json' ? [json()] : []),
        ...(placeholderText ? [placeholder(placeholderText)] : []),
        EditorState.readOnly.of(readOnly),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
      parent: hostRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [ariaLabel, language, placeholderText, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: variableCompartment.current.reconfigure(variableStatuses ? variableHighlight(variableStatuses) : []) });
  }, [variableStatuses]);

  const tokenFromEvent = (event: ReactMouseEvent<HTMLDivElement>) => {
    const token = (event.target as HTMLElement).closest<HTMLElement>('.cm-var-token');
    if (!token) return null;
    const rect = token.getBoundingClientRect();
    return {
      name: token.dataset.varName ?? '',
      anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    };
  };

  const scheduleClose = () => {
    window.clearTimeout(hoverTimer.current);
    if (open?.pinned) return;
    closeTimer.current = window.setTimeout(() => setOpen(null), 140);
  };

  return (
    <div
      ref={hostRef}
      className={`code-editor ${className}`}
      aria-label={ariaLabel}
      onMouseMove={(event) => {
        const token = tokenFromEvent(event);
        if (!token || open?.pinned || open?.name === token.name) return;
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setOpen({ ...token, pinned: false }), 200);
      }}
      onMouseLeave={scheduleClose}
      onClick={(event) => {
        const token = tokenFromEvent(event);
        if (token) setOpen({ ...token, pinned: true });
      }}
      onKeyDown={(event) => {
        if (!variableStatuses || !((event.metaKey || event.ctrlKey) && event.key === '.')) return;
        const view = viewRef.current;
        if (!view) return;
        const caret = view.state.selection.main.head;
        const span = splitVarSpans(view.state.doc.toString()).find((item) => 'varName' in item && caret >= item.start && caret <= item.end);
        if (!span || !('varName' in span)) return;
        const coords = view.coordsAtPos(span.start);
        if (!coords) return;
        event.preventDefault();
        setOpen({ name: span.varName, pinned: true, anchor: { left: coords.left, right: coords.right, top: coords.top, bottom: coords.bottom } });
      }}
    >
      {open && variableStatuses?.get(open.name) && (
        <VariablePopover
          status={variableStatuses.get(open.name)!}
          anchor={open.anchor}
          onClose={() => setOpen(null)}
          onMouseEnter={() => window.clearTimeout(closeTimer.current)}
          onMouseLeave={scheduleClose}
        />
      )}
    </div>
  );
}
