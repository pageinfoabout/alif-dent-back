// src/App.jsx
import './App.css';
import { useState } from 'react';
import AdminCalendar from './components/AdminCalendar';
import Coupons from './components/Coupons';
import { supabase } from './lib/supabaseClient';
import { useEffect } from 'react';


export default function App() {
  const [authed, setAuthed] = useState(() => {
    try { return localStorage.getItem('auth') === '1'; } catch { return false; }
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [view, setView] = useState('calendar');
  
  const [showNotifications, setShowNotifications] = useState(false);
const [notificationsList, setNotificationsList] = useState([]);
async function fetchNotifications() {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('is_read', false) // добавьте эту строку
    .order('created_at', { ascending: false })
    .limit(10);
  if (!error && data) setNotificationsList(data);
}

async function markAsRead(id) {
  await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  fetchNotifications();
  fetchUnread();
}

  // добавить
  useEffect(() => {
    if (!authed) return;
    
    async function fetchUnread() {
      const { data, error } = await supabase
        .from('notifications')
        .select('id')
        .eq('is_read', false);
      if (!error && data) setUnreadCount(data.length);
    }
    
    fetchUnread();
    
    
    // Realtime subscription
    const ch = supabase
      .channel('notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, fetchUnread)
      .subscribe();
      
    return () => { supabase.removeChannel(ch); };
  }, [authed]);

  
  function onSubmit(e) {
    e.preventDefault();
    if (login.trim() === import.meta.env.VITE_ADMIN_LOGIN && password === import.meta.env.VITE_ADMIN_PASSWORD) {
      setAuthed(true);
      try { localStorage.setItem('auth', '1'); } catch {}
    } else {
      setError('Неверный логин или пароль');
    }
  }

  function logout() {
    if (window.confirm('Выйти из системы?')) {
      try { localStorage.removeItem('auth'); } catch {}
      setAuthed(false);
    }
  }

  if (!authed) {
    return (
      <main className="page">
        <form className="auth-card" onSubmit={onSubmit}>
          <h2>Вход</h2>
          <label className="field">
            <span>Логин</span>
            <input value={login} onChange={(e) => setLogin(e.target.value)} required />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn" type="submit">Войти</button>
        </form>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="top-bar">
        <div className="notifications-icon" onClick={() => { setShowNotifications(true); fetchNotifications(); }} title={`${unreadCount} непрочитанных уведомлений`}>
          🔔 {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
        </div>
        <div className="tabs">
          <button className={`tab ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>Календарь</button>
          <button className={`tab ${view === 'coupons' ? 'active' : ''}`} onClick={() => setView('coupons')}>Купоны</button>
        </div>
      </div>
      {view === 'calendar' ? <AdminCalendar /> : <Coupons onBack={() => setView('calendar')} />}
      <button className="btn logout-btn" onClick={logout}>Выйти</button>
      
      {showNotifications && (
        <div className="notifications-modal" onClick={() => setShowNotifications(false)}>
          <div className="notifications-content" onClick={e => e.stopPropagation()}>
            <h3>Уведомления</h3>
            {notificationsList.map(n => (
              <div key={n.id} className="notification-item">
              <div>
                <p>{n.message}</p>
                <small>{new Date(n.created_at).toLocaleString('ru-RU')}</small>
              </div>
              <button className="icon-btn eye-btn" onClick={() => markAsRead(n.id)} title="Удалить уведомление">👁️</button>
            </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
