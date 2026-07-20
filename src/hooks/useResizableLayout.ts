import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const SIDEBAR_KEY = 'tesapi:layout:sidebar-width';
const RESPONSE_KEY = 'tesapi:layout:response-height';
const SIDEBAR_DEFAULT = 260;
const RESPONSE_DEFAULT = 280;
const SIDEBAR_MIN = 210;
const SIDEBAR_MAX = 440;
const RESPONSE_MIN = 150;
const MAIN_MIN = 620;
const REQUEST_MIN = 260;

export function clampPaneSize(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(min, max), Math.max(min, value)));
}

function savedSize(key: string, fallback: number): number {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function useResizableLayout() {
  const [sidebarWidth, setSidebarWidth] = useState(() => savedSize(SIDEBAR_KEY, SIDEBAR_DEFAULT));
  const [responseHeight, setResponseHeight] = useState(() => savedSize(RESPONSE_KEY, RESPONSE_DEFAULT));
  const stopDrag = useRef<(() => void) | null>(null);

  const fitSidebar = useCallback((value: number, width = window.innerWidth) => clampPaneSize(value, SIDEBAR_MIN, Math.min(SIDEBAR_MAX, width - MAIN_MIN)), []);
  const fitResponse = useCallback((value: number, height = window.innerHeight) => clampPaneSize(value, RESPONSE_MIN, height - REQUEST_MIN - 6), []);

  useEffect(() => { window.localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { window.localStorage.setItem(RESPONSE_KEY, String(responseHeight)); }, [responseHeight]);
  useEffect(() => {
    const fit = () => { setSidebarWidth((value) => fitSidebar(value)); setResponseHeight((value) => fitResponse(value)); };
    window.addEventListener('resize', fit);
    return () => { window.removeEventListener('resize', fit); stopDrag.current?.(); };
  }, [fitResponse, fitSidebar]);

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, axis: 'column' | 'row') => {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    stopDrag.current?.();
    document.body.classList.add('layout-resizing', `resize-${axis}`);
    const move = (pointer: PointerEvent) => {
      if (axis === 'column') setSidebarWidth(fitSidebar(pointer.clientX - bounds.left, bounds.width));
      else setResponseHeight(fitResponse(bounds.bottom - pointer.clientY, bounds.height));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.classList.remove('layout-resizing', `resize-${axis}`);
      stopDrag.current = null;
    };
    stopDrag.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, [fitResponse, fitSidebar]);

  return {
    sidebarWidth,
    responseHeight,
    startSidebarResize: (event: ReactPointerEvent<HTMLDivElement>) => beginDrag(event, 'column'),
    startResponseResize: (event: ReactPointerEvent<HTMLDivElement>) => beginDrag(event, 'row'),
    resizeSidebarBy: (delta: number) => setSidebarWidth((value) => fitSidebar(value + delta)),
    resizeResponseBy: (delta: number) => setResponseHeight((value) => fitResponse(value + delta)),
    resetSidebar: () => setSidebarWidth(fitSidebar(SIDEBAR_DEFAULT)),
    resetResponse: () => setResponseHeight(fitResponse(RESPONSE_DEFAULT)),
  };
}
