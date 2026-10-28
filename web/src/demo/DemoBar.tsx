import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { session } from '../api';
import { useAuth } from '../auth';
import { ConfirmDialog } from '../components/Modal';
import { resetDemo } from './backend';

/** Thin strip on top of the demo: jump between the three access levels and reset sample data. */
export function DemoBar() {
  const { login, logout } = useAuth();
  const nav = useNavigate();
  const [resetting, setResetting] = useState(false);
  const go = async (who: 'admin' | 'employee' | 'kiosk') => {
    if (who === 'kiosk') { nav('/kiosk'); return; }
    logout();
    await login(who === 'admin' ? 'admin@demo.ph' : 'juan@demo.ph', who === 'admin' ? 'Admin123!' : 'Employee123!');
    nav(who === 'admin' ? '/admin' : '/me');
  };
  return (
    <div className="demo-bar">
      <span className="demo-tag">Demo</span>
      <span className="demo-text">Sample restaurant data, saved only in this browser.</span>
      <div className="demo-actions">
        <span className="demo-text">Open as:</span>
        <button onClick={() => go('admin')}>Admin</button>
        <button onClick={() => go('employee')}>Employee</button>
        <button onClick={() => go('kiosk')}>Time clock</button>
        <button onClick={() => setResetting(true)}>Reset data</button>
      </div>
      {resetting && (
        <ConfirmDialog title="Reset demo data" danger confirmLabel="Reset" message="All changes you made in this demo (punches, payroll edits, notes) are replaced with fresh sample data."
          onClose={() => setResetting(false)}
          onConfirm={async () => { resetDemo(); session.setDeviceToken(null); logout(); nav('/login'); }} />
      )}
    </div>
  );
}
