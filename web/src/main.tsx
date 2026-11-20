import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { Navigate, Route, Routes } from 'react-router-dom';
import App from './App';
import CrmApp from './crm/CrmApp';
import { DEMO } from './api';
import { AuthProvider } from './auth';
import './styles.css';
import { applySavedTheme } from './theme';

applySavedTheme();

// The artifact demo runs inside a framed viewer, so it routes in memory instead of the URL.
const Router = DEMO ? MemoryRouter : BrowserRouter;
/** VITE_APP=crm builds the AI Marketing CRM on its own (no HR, payroll or kiosk screens). */
const CRM_ONLY = import.meta.env.VITE_APP === 'crm';
const DemoBar = lazy(() => import('./demo/DemoBar').then((m) => ({ default: m.DemoBar })));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router {...(DEMO && CRM_ONLY ? { initialEntries: ['/crm/login'] } : {})}>
      <AuthProvider>
        {DEMO && <Suspense fallback={null}><DemoBar crm={CRM_ONLY} /></Suspense>}
        {CRM_ONLY
          ? <Routes><Route path="/crm/*" element={<CrmApp standalone />} /><Route path="*" element={<Navigate to="/crm" replace />} /></Routes>
          : <App />}
      </AuthProvider>
    </Router>
  </React.StrictMode>,
);
