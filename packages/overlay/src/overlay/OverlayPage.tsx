import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { OverlaySource } from '@streaming/shared';
import { identify, startDemo, stopDemo, useLive } from '../lib/store.js';
import { containerStyle } from './style.js';
import { ChatWidget } from './widgets/ChatWidget.js';
import { AlertsWidget } from './widgets/AlertsWidget.js';
import { TtsWidget } from './widgets/TtsWidget.js';
import { SlideshowWidget } from './widgets/SlideshowWidget.js';
import {
  CounterWidget,
  CustomWidget,
  GoalWidget,
  LeaderboardWidget,
  TickerWidget,
} from './widgets/SimpleWidgets.js';
import '../styles/overlay.css';

function Widget({ overlay }: { overlay: OverlaySource }): JSX.Element {
  const settings = overlay.settings;
  switch (settings.type) {
    case 'chat':
      return <ChatWidget settings={settings.chat} />;
    case 'alerts':
      return <AlertsWidget settings={settings.alerts} />;
    case 'tts':
      return <TtsWidget settings={settings.tts} />;
    case 'goal':
      return <GoalWidget settings={settings.goal} />;
    case 'ticker':
      return <TickerWidget settings={settings.ticker} />;
    case 'leaderboard':
      return <LeaderboardWidget settings={settings.leaderboard} />;
    case 'counter':
      return <CounterWidget settings={settings.counter} />;
    case 'slideshow':
      return <SlideshowWidget settings={settings.slideshow} />;
    case 'custom':
      return <CustomWidget settings={settings.custom} />;
  }
}

/**
 * One browser-source page. Add `/overlay/<id>` to OBS as a Browser Source at
 * the width and height shown in the dashboard.
 */
export function OverlayPage(): JSX.Element {
  const { overlayId = '' } = useParams();
  const [params] = useSearchParams();
  // `?demo=1` renders the source against invented data, for the gallery in the
  // dashboard. It deliberately never connects: a preview that identified as a
  // TTS source would be handed real clips and mute OBS.
  const demo = params.get('demo') === '1';
  const { config, socketConnected } = useLive();
  const overlay = config?.overlays.find((item) => item.id === overlayId);

  // Only a TTS source registers as an audio listener; the server sends each
  // clip to exactly one of them.
  const isListener = overlay?.type === 'tts';

  useEffect(() => {
    if (demo) {
      startDemo();
      return () => stopDemo();
    }
    identify({ role: 'overlay', overlayId, listener: isListener });
    return undefined;
  }, [overlayId, isListener, demo]);

  // Browser sources must be transparent so the stream shows through.
  useEffect(() => {
    document.body.classList.add('overlay-body');
    return () => document.body.classList.remove('overlay-body');
  }, []);

  if (!config) {
    return (
      <div className="overlay-status">
        {socketConnected ? 'Loading…' : 'Connecting to the stream server…'}
      </div>
    );
  }

  if (!overlay) {
    return (
      <div className="overlay-status">
        No overlay called “{overlayId}”. Check the source list in the dashboard.
      </div>
    );
  }

  if (!overlay.enabled) {
    return <div className="overlay-status">“{overlay.name}” is disabled.</div>;
  }

  return (
    <div className="overlay-root" style={containerStyle(overlay)}>
      {overlay.style.customCss ? <style>{overlay.style.customCss}</style> : null}
      <Widget overlay={overlay} />
    </div>
  );
}
