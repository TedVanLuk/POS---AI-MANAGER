import { fmtTime, todayIso } from '../api';

export interface WeekDay { date: string; weekday: number; dayType: string; present: boolean; absent: boolean; firstIn: string | null; lastOut: string | null; lateMinutes: number; workedMinutes: number; missingOut: boolean }
export interface Week { from: string; to: string; days: WeekDay[]; daysWorked: number; lateCount: number; lateMinutes: number; workedHours: number }

const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 7-day strip: worked / late / absent / rest — status uses icon + text, never color alone. */
export function WeekStrip({ week }: { week: Week }) {
  const today = todayIso();
  return (
    <div>
      <div className="week">
        {week.days.map((d) => {
          const onShift = !!d.firstIn && !d.lastOut && !d.present;
          const cls = d.absent ? 'absent' : d.lateMinutes > 0 ? 'late' : d.present || onShift ? 'present' : '';
          const mark = d.absent ? '✕' : d.lateMinutes > 0 ? '⏱' : d.present ? '✓' : onShift ? '●' : d.dayType.includes('rest') ? '–' : d.dayType.includes('holiday') || d.dayType.includes('special') ? '★' : '·';
          const label = d.absent ? 'Absent' : d.lateMinutes > 0 ? `Late ${d.lateMinutes}m` : d.present ? 'Worked' : onShift ? 'On shift' : d.dayType.includes('rest') ? 'Rest day' : d.dayType !== 'ordinary' ? 'Holiday' : '';
          return (
            <div key={d.date} className={`day ${cls} ${d.date === today ? 'today' : ''}`} title={label}>
              <div className="dname">{NAMES[d.weekday - 1]} {d.date.slice(8)}</div>
              <div className="dmark" aria-hidden>{mark}</div>
              <div className="dtime">{d.firstIn ? fmtTime(d.firstIn) : ' '}</div>
              <div className="dtime">{label || ' '}</div>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: '.6rem', gap: '1.25rem' }}>
        <span><b>{week.daysWorked}</b> days worked</span>
        <span><b>{week.lateCount}</b> lates ({week.lateMinutes} min)</span>
        <span><b>{week.workedHours}</b> hours</span>
      </div>
    </div>
  );
}
