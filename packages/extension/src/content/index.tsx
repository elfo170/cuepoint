import { useEffect, useState } from 'react';
import { SoundCloudTrackSource, type NowPlaying } from './soundcloud';
import { mountInShadow } from './widget/mount';
import { Widget } from './widget/Widget';

const DEFAULT_POSITION = { right: 16, bottom: 64 };

/** Sprint 1: widget com estado em memória (persistência entra na Sprint 3). */
function App() {
  const [track, setTrack] = useState<NowPlaying | null>(null);
  const [decision, setDecision] = useState<boolean | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState(DEFAULT_POSITION);

  useEffect(() => new SoundCloudTrackSource().start(setTrack), []);
  useEffect(() => {
    setDecision(null);
    setPickerOpen(false);
  }, [track?.url, track?.title]);

  return (
    <Widget
      track={track}
      researches={[{ id: 'session', name: 'Sessão atual' }]}
      activeResearchId="session"
      onSelectResearch={() => undefined}
      decision={decision}
      onApprove={() => {
        setDecision(true);
        setPickerOpen(true);
      }}
      onReject={() => {
        setDecision(false);
        setPickerOpen(false);
      }}
      categories={[]}
      assignedCategoryIds={[]}
      pickerOpen={pickerOpen}
      onToggleCategory={() => undefined}
      onCreateCategory={() => undefined}
      onOpenPicker={() => setPickerOpen(true)}
      onClosePicker={() => setPickerOpen(false)}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      position={position}
      onPositionChange={setPosition}
    />
  );
}

if (!window.top || window.top === window) {
  mountInShadow(<App />);
}
