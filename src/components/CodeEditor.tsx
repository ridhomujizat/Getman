import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { bracketMatching, foldGutter, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

type Language = 'json' | 'text';

interface Props {
  value: string;
  onChange?: (value: string) => void;
  language?: Language;
  readOnly?: boolean;
  placeholderText?: string;
  ariaLabel: string;
  className?: string;
}

const getmanHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#8AB4F8' },
  { tag: tags.string, color: '#7EC699' },
  { tag: tags.number, color: '#F0A030' },
  { tag: [tags.bool, tags.null], color: '#B98AF0' },
  { tag: tags.punctuation, color: '#9A9CA3' },
  { tag: tags.comment, color: '#5E6167' },
]);

const getmanTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#9A9CA3' },
  '.cm-scroller': { overflow: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: '12.5px', lineHeight: '1.45' },
  '.cm-content': { minHeight: '100%', padding: '12px 0', caretColor: '#6E9BFF' },
  '.cm-line': { padding: '0 16px' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 0, color: '#5E6167' },
  '.cm-gutterElement': { padding: '0 10px 0 16px' },
  '.cm-activeLine': { backgroundColor: '#17181B' },
  '.cm-activeLineGutter': { backgroundColor: '#1D1F23' },
  '.cm-selectionBackground, ::selection': { backgroundColor: '#6E9BFF33' },
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
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
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
        highlightActiveLine(),
        highlightActiveLineGutter(),
        getmanTheme,
        syntaxHighlighting(getmanHighlight),
        ...(language === 'json' ? [json()] : []),
        ...(placeholderText ? [placeholder(placeholderText)] : []),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
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

  return <div ref={hostRef} className={`code-editor ${className}`} aria-label={ariaLabel} />;
}
