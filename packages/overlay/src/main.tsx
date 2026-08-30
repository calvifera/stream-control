import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Dashboard } from './dashboard/Dashboard.js';
import { LoginGate } from './dashboard/LoginGate.js';
import { OverlayPage } from './overlay/OverlayPage.js';
import { ChatPanelPage } from './dashboard/ChatPanelPage.js';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element in index.html');

/*
 * Mark the see-through surfaces before React mounts.
 *
 * These classes are what make the page transparent, and the components that
 * own them add them in an effect — which runs after the first paint. For a
 * browser source that meant the opening frame was the dashboard's opaque
 * background and its corner gradients, captured on stream every time the
 * source reloaded. Reading the path here costs nothing and there is no frame
 * to catch.
 */
if (location.pathname.startsWith('/overlay/')) {
  document.body.classList.add('overlay-body');
} else if (location.pathname.startsWith('/panel/')) {
  document.body.classList.add('panel-root');
  document.documentElement.classList.add('panel-root');
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Only the dashboard is gated — a browser source cannot log in. */}
        <Route
          path="/"
          element={
            <LoginGate>
              <Dashboard />
            </LoginGate>
          }
        />
        <Route path="/overlay/:overlayId" element={<OverlayPage />} />
        {/* The desktop panel. Ungated like an overlay — the native shell has
            no way to present a login form — but it registers as a
            non-listener, so it can never take TTS audio off the stream. */}
        <Route path="/panel/chat" element={<ChatPanelPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
