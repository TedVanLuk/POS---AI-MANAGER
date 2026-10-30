import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks';
import { ATTR_LABELS, EmployeeCard, type CardData } from '../components/EmployeeCard';

export default function Performance() {
  const [days, setDays] = useState(30);
  const cards = useApi<CardData[]>(`/api/stats/cards?days=${days}`);
  const nav = useNavigate();
  return (
    <>
      <div className="page-head">
        <h1>Employee cards</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
      </div>
      <p className="muted small">
        {Object.entries(ATTR_LABELS).map(([k, v]) => `${k} = ${v}`).join(' · ')}. Ratings 1–99 compare each person to the team median (SPD/HUS/SAL come from order slips, so only servers have them). Add a photo on each employee's page.
        Tiers: Legend ≥ 90 · Gold ≥ 80 · Silver ≥ 65 · Bronze.
      </p>
      {cards.error && <div className="error">{cards.error}</div>}
      <div className="cards-grid">
        {cards.data?.map((c) => <EmployeeCard key={c.employeeId} card={c} onClick={() => nav(`/admin/employees/${c.employeeId}`)} />)}
      </div>
    </>
  );
}
