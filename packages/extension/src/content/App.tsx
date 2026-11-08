import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackInput } from '../data/curation';
import { CHANGED_MESSAGE, send, type WidgetState } from '../shared/messages';
import { SoundCloudTrackSource, type NowPlaying } from './soundcloud';
import { Widget } from './widget/Widget';

const DEFAULT_POSITION = { right: 16, bottom: 64 };
const UI_KEY = 'widgetUi';

interface UiPrefs {
  collapsed: boolean;
  position: { right: number; bottom: number };
}

function toInput(track: NowPlaying): TrackInput {
  return {
    title: track.title,
    artist: track.artist,
    url: track.url,
    urn: track.urn,
    artworkUrl: track.artworkUrl,
    source: track.source,
  };
}

const EMPTY: WidgetState = {
  researches: [],
  categories: [],
  activeResearchId: null,
  track: { trackId: null, provisional: false, decision: null, categoryIds: [] },
};

/** Controlador do widget: liga a faixa detectada ao armazenamento (via service worker). */
export function App() {
  const [track, setTrack] = useState<NowPlaying | null>(null);
  const [state, setState] = useState<WidgetState>(EMPTY);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ui, setUi] = useState<UiPrefs>({ collapsed: false, position: DEFAULT_POSITION });
  const trackRef = useRef<NowPlaying | null>(null);
  trackRef.current = track;

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const r = await fn();
      setMessage(null);
      return r;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }, []);

  const refresh = useCallback(async () => {
    const current = trackRef.current;
    const next = await run(() =>
      send<WidgetState>({ type: 'widget:getState', track: current ? toInput(current) : null }),
    );
    if (next && trackRef.current === current) setState(next);
  }, [run]);

  // Preferências visuais (posição, recolhido)
  useEffect(() => {
    chrome.storage.local
      .get(UI_KEY)
      .then((r) => {
        const saved = r[UI_KEY] as UiPrefs | undefined;
        if (saved) setUi(saved);
      })
      .catch(() => undefined);
  }, []);
  const updateUi = (next: Partial<UiPrefs>) => setUi((prev) => ({ ...prev, ...next }));
  const loadedUi = useRef(false);
  useEffect(() => {
    if (!loadedUi.current) {
      loadedUi.current = true;
      return;
    }
    // Grava com atraso para não escrever a cada movimento do arraste.
    const id = setTimeout(() => {
      void chrome.storage.local.set({ [UI_KEY]: ui }).catch(() => undefined);
    }, 300);
    return () => clearTimeout(id);
  }, [ui]);

  useEffect(() => new SoundCloudTrackSource().start(setTrack), []);

  useEffect(() => {
    setPickerOpen(false);
  }, [track?.url, track?.title, track?.artist]);

  useEffect(() => {
    void refresh();
  }, [track?.url, track?.urn, track?.title, track?.artist, refresh]);

  useEffect(() => {
    const onMessage = (msg: { type?: string }) => {
      if (msg?.type === CHANGED_MESSAGE) void refresh();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const decide = async (value: boolean) => {
    if (!track) return;
    // Atualização otimista: a interface responde na hora (PRD §16, baixa latência).
    setState((s) => ({ ...s, track: { ...s.track, decision: value } }));
    setPickerOpen(value);
    const next = await run(() =>
      send<WidgetState>({ type: 'widget:decide', track: toInput(track), value }),
    );
    if (next) setState(next);
    else void refresh();
  };

  const toggleCategory = async (categoryId: string) => {
    if (!track) return;
    const on = !state.track.categoryIds.includes(categoryId);
    setState((s) => ({
      ...s,
      track: {
        ...s.track,
        categoryIds: on
          ? [...s.track.categoryIds, categoryId]
          : s.track.categoryIds.filter((c) => c !== categoryId),
      },
    }));
    const next = await run(() =>
      send<WidgetState>({ type: 'widget:setCategory', track: toInput(track), categoryId, on }),
    );
    if (next) setState(next);
  };

  return (
    <Widget
      track={track}
      researches={state.researches}
      activeResearchId={state.activeResearchId}
      onSelectResearch={(id) =>
        void run(async () => {
          await send({ type: 'widget:setActiveResearch', researchId: id || null });
          await refresh();
        })
      }
      onCreateResearch={(name) =>
        void run(async () => {
          await send({ type: 'widget:createResearch', name });
          await refresh();
        })
      }
      decision={state.track.decision}
      onApprove={() => void decide(true)}
      onReject={() => void decide(false)}
      categories={state.categories}
      assignedCategoryIds={state.track.categoryIds}
      pickerOpen={pickerOpen}
      onToggleCategory={(id) => void toggleCategory(id)}
      onCreateCategory={(name) =>
        void run(async () => {
          const next = await send<WidgetState>({
            type: 'widget:createCategory',
            track: track ? toInput(track) : null,
            name,
          });
          setState(next);
        })
      }
      onOpenPicker={() => setPickerOpen(true)}
      onClosePicker={() => setPickerOpen(false)}
      onOpenLibrary={() => void run(() => send({ type: 'openLibrary' }))}
      message={message}
      collapsed={ui.collapsed}
      onCollapsedChange={(collapsed) => updateUi({ collapsed })}
      position={ui.position}
      onPositionChange={(position) => updateUi({ position })}
    />
  );
}
