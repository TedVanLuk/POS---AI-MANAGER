import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { setUnauthorizedHandler } from './api';
import { isStaff, useAuth } from './auth';
import Login from './Login';
import AdminLayout from './admin/Layout';
import Dashboard from './admin/Dashboard';
import Employees from './admin/Employees';
import EmployeeDetail from './admin/EmployeeDetail';
import Attendance from './admin/Attendance';
import PayrollRuns from './admin/PayrollRuns';
import PayrollRun from './admin/PayrollRun';
import PaySheet from './admin/PaySheet';
import ServerEfficiency from './admin/ServersTracker';
import Performance from './admin/Performance';
import EmployeePerformance from './admin/EmployeePerformance';
import Schedules from './admin/Schedules';
import AIChat from './admin/AIChat';
import Settings from './admin/Settings';
import Kiosk from './kiosk/Kiosk';
import MePage from './me/MePage';

function Home() {
  const { me, loading } = useAuth();
  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={isStaff(me.role) ? '/admin' : '/me'} replace />;
}

function RequireStaff({ children }: { children: JSX.Element }) {
  const { me, loading } = useAuth();
  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (!isStaff(me.role)) return <Navigate to="/me" replace />;
  return children;
}

export default function App() {
  const nav = useNavigate();
  useEffect(() => { setUnauthorizedHandler(() => nav('/login')); }, [nav]);
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/kiosk" element={<Kiosk />} />
      <Route path="/me" element={<MePage />} />
      <Route path="/admin" element={<RequireStaff><AdminLayout /></RequireStaff>}>
        <Route index element={<Dashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="employees/:id" element={<EmployeeDetail />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="payroll" element={<PayrollRuns />} />
        <Route path="payroll/sheets/:id" element={<PaySheet />} />
        <Route path="payroll/:id" element={<PayrollRun />} />
        <Route path="penalties" element={<Navigate to="/admin/payroll?tab=penalties" replace />} />
        <Route path="efficiency" element={<ServerEfficiency />} />
        <Route path="performance" element={<Performance />} />
        <Route path="performance/:id" element={<EmployeePerformance />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="ai" element={<AIChat />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
