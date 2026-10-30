import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import App from './App';
import { DEMO } from './api';
import { AuthProvider } from './auth';
import './styles.css';
import { applySavedTheme } from './theme';

applySavedTheme();

// The artifact demo runs inside a framed viewer, so it routes in memory instead of the URL.
const Router = DEMO ? MemoryRouter : BrowserRouter;
const DemoBar = lazy(() => import('./demo/DemoBar').then((m) => ({ default: m.DemoBar })));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        {DEMO && <Suspense fallback={null}><DemoBar /></Suspense>}
        <App />
      </AuthProvider>
    </Router>
  </React.StrictMode>,
);
