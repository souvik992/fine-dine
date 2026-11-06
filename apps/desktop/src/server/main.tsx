// The DinePOS Server window (server.html, `DinePOS.exe --server`): the server's state and controls through the preload
// bridge (window.dineposServer). See electron/server-mode.ts.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { ServerPanel } from './ServerPanel.js';

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    {window.dineposServer ? <ServerPanel bridge={window.dineposServer} /> : <p style={{ padding: 24 }}>Open this with the DinePOS Server shortcut.</p>}
  </StrictMode>,
);
