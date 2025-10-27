// /Users/ivangorskiy03/development/projects/AD-backend/src/components/AdminCalendar.jsx
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { resolveServiceDisplay } from '../data/services';


const RU_MONTHS = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];
const RU_DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfCalendarGrid(d) {
  const first = startOfMonth(d);
  const day = (first.getDay() + 6) % 7; // Mon=0
  const s = new Date(first);
  s.setDate(first.getDate() - day);
  return s;
}
function endOfCalendarGrid(d) {
  const last = endOfMonth(d);
  const day = (last.getDay() + 6) % 7; // Mon=0
  const e = new Date(last);
  e.setDate(last.getDate() + (6 - day));
  return e;
}
function rub(n) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n || 0);
}

export default function AdminCalendar() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [byDate, setByDate] = useState({}); // { 'YYYY-MM-DD': Booking[] }
  const [selectedDate, setSelectedDate] = useState(null);
  const [notice, setNotice] = useState(null); // { message, type: 'success'|'error' }

  const grid = useMemo(() => {
    const start = startOfCalendarGrid(cursor);
    const end = endOfCalendarGrid(cursor);
    const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }
    return days;
  }, [cursor]);

  async function fetchMonth() {
    setLoading(true);
    setError(null);
    try {
      const start = ymd(startOfMonth(cursor));
      const end = ymd(endOfMonth(cursor));
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true })
        .order('time', { ascending: true });

      if (error) throw error;

      const grouped = {};
      for (const row of data || []) {
        const key = typeof row.date === 'string' ? row.date : ymd(new Date(row.date));
        // Hide canceled records from the UI
        const status = (row.status || '').toString().toLowerCase();
        if (status === 'canceled' || status === 'cancelled') continue;
        if (!grouped[key]) grouped[key] = [];
        // Normalize services JSON
        let services = row.services;
        if (!Array.isArray(services)) {
          try { services = services ? JSON.parse(services) : []; } catch { services = []; }
        }
        const normalizedServices = (services || []).map(resolveServiceDisplay);
        const total = row.total || normalizedServices.reduce((s, it) => s + (it.price || 0), 0);
        grouped[key].push({
          id: row.id,
          name: row.name,
          phone: row.phone,
          date: key,
          time: row.time,
          services: normalizedServices,
          total,
          status: row.status || 'new',
        });
      }
      setByDate(grouped);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchMonth(); /* eslint-disable-next-line */ }, [cursor]);

  // Live updates if Realtime is enabled for table
  useEffect(() => {
    const chan = supabase
      .channel('public:bookings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, fetchMonth)
      .subscribe();
    return () => { supabase.removeChannel(chan); };
  }, []);

  const monthLabel = `${RU_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  const todayYmd = ymd(new Date());

  async function setBookingStatus(bookingId, dateKey, nextStatus) {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .update({ status: nextStatus })
        .eq('id', bookingId)
        .select('id,status'); // returns an array
      if (error) throw error;
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error('No rows updated. Check RLS policies/permissions for table "bookings" or that the id exists.');
      }

      // Optimistic UI update
      setByDate(prev => {
        const copy = { ...prev };
        const list = (copy[dateKey] || []).slice();
        if (nextStatus.toLowerCase() === 'canceled' || nextStatus.toLowerCase() === 'cancelled') {
          copy[dateKey] = list.filter(it => it.id !== bookingId);
        } else {
          copy[dateKey] = list.map(it => it.id === bookingId ? { ...it, status: nextStatus } : it);
        }
        return copy;
      });

      if (nextStatus === 'succeeded') {
        setNotice({ type: 'success', message: 'The service was completed successfully.' });
      } else if (nextStatus.toLowerCase() === 'canceled' || nextStatus.toLowerCase() === 'cancelled') {
        setNotice({ type: 'success', message: 'Appointment canceled.' });
      }

      // Auto hide notice
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setNotice({ type: 'error', message: e.message || String(e) });
      setTimeout(() => setNotice(null), 3500);
    }
  }
  async function deleteBooking(bookingId, dateKey) {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', bookingId)
        .select('id'); // array
      if (error) throw error;
      if (!Array.isArray(data) || data.length !== 1) throw new Error('No rows deleted.');
  
      setByDate(prev => {
        const copy = { ...prev };
        copy[dateKey] = (copy[dateKey] || []).filter(it => it.id !== bookingId);
        return copy;
      });
  
      setNotice({ type: 'success', message: 'Запись удалена.' });
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setNotice({ type: 'error', message: e.message || String(e) });
      setTimeout(() => setNotice(null), 3500);
    }
  }

  return (
    <div className="admin-wrap">
      {notice && <Notice type={notice.type} onClose={() => setNotice(null)}>{notice.message}</Notice>}
      <header className="admin-header">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-text">ALIF DENT — Админ-панель</div>
        </div>
        <div className="month-nav">
          <button className="btn ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>←</button>
          <div className="month-title">{monthLabel}</div>
          <button className="btn ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>→</button>
          <button className="btn" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Сегодня</button>
        </div>
      </header>

      <section className="calendar">
        <div className="calendar-head">
          {RU_DAYS.map(d => <div key={d} className="dow">{d}</div>)}
        </div>

        <div className="calendar-grid">
          {grid.map((d) => {
            const key = ymd(d);
            const inMonth = d.getMonth() === cursor.getMonth();
            const items = byDate[key] || [];
            const isToday = key === todayYmd;
            const count = items.length;
            const preview = items.slice(0, 3);
            const sum = items.reduce((s, it) => s + it.total, 0);
             // Mon-first
            const dayLabel = `${d.getDate()}`; // e.g., "Вт-23"

            return (
              <button
                key={key}
                className={[
                  'day',
                  inMonth ? '' : 'muted',
                  isToday ? 'today' : '',
                  count ? 'busy' : '',
                ].join(' ').trim()}
                onClick={() => count && setSelectedDate(key)}
                title={count ? `Записей: ${count} · Сумма: ${rub(sum)}` : undefined}
                style={{ position: 'relative' }}
              >
                <div className="day-date">{dayLabel}</div>
                // ... more code ...

                <div className="day-top">
                  {count > 0 && <span className="pill">{count}</span>}
                </div>
                <div className="day-body">
                  {preview.map(b => (
                    <div key={b.id} className="appt">
                      <span className="time">{b.time}</span>
                      <span className="name">{b.name}</span>
                    </div>
                  ))}
                  {count > 3 && <div className="more">+{count - 3} ещё</div>}
                </div>
                {count > 0 && <div className="day-total">{rub(sum)}</div>}
              </button>
            );
          })}
        </div>

        {loading && <div className="loader">Загрузка…</div>}
        {error && <div className="error">{error}</div>}
      </section>

      {selectedDate && (
        <Modal onClose={() => setSelectedDate(null)}>
          <DayDetails
            date={selectedDate}
            items={(byDate[selectedDate] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''))}
            onSucceed={(id) => setBookingStatus(id, selectedDate, 'succeeded')}
            onCancel={(id) => deleteBooking(id, selectedDate)}
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        {children}
      </div>
    </div>
  );
}

function DayDetails({ date, items, onSucceed, onCancel }) {
  const total = items.reduce((s, it) => s + (it.total || 0), 0);
  const d = new Date(date + 'T00:00:00');
  const confirmThen = (fn) => { if (window.confirm('Are you sure you want to perform this action?')) fn(); };

  return (
    <div className="details">
      <h3>{d.toLocaleDateString('ru-RU', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</h3>
      <div className="details-total">Итого за день: <strong>{rub(total)}</strong></div>

      {items.length === 0 && <div className="empty">Нет записей</div>}

      <div className="list">
        {items.map(b => (
          <div key={b.id} className="row">
            <div className="row-main">
              <div className="row-time">{b.time}</div>
              <div className="row-name">{b.name}</div>
              <div className="row-phone">{b.phone}</div>
            </div>
            <div className="row-services">
              {b.services.map((s, i) => (
                <div key={i} className="service">
                  <span className="service-name">{s.name}</span>
                  <span className="service-price">{rub(s.price)}</span>
                </div>
              ))}
            </div>
            <div className="row-total">
  {rub(b.total)}
  {b.services.reduce((s, it) => s + (it.price || 0), 0) !== b.total && (
    <span className="coupon-badge" title="Купон активирован">🎫</span>
  )}
</div>
            <div className="row-actions">
              {((b.status || '').toLowerCase() === 'succeeded') ? (
                <button className="icon-btn done" title="Выполнено" disabled>✓</button>
              ) : (
                <>
                  <button className="icon-btn success" title="Отметить выполненной" onClick={() => confirmThen(() => onSucceed && onSucceed(b.id))}>✓</button>
                  <button className="icon-btn danger" title="Отменить запись" onClick={() => confirmThen(() => onCancel && onCancel(b.id))}>✕</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Notice({ children, type = 'success', onClose }) {
  return (
    <div className={["notice", type].join(' ')} onClick={onClose}>
      {children}
    </div>
  );
}