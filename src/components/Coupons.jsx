// src/components/Coupons.jsx
// src/components/Coupons.jsx
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Coupons({ onBack }) {
  const [name, setName] = useState('');
  const [discount, setDiscount] = useState(0);
  const [notice, setNotice] = useState(null);
  const [coupons, setCoupons] = useState([]);

  async function fetchCoupons() {
    try {
      const { data, error } = await supabase
        .from('cupons')
        .select('id,cupon_name,discount_percent,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setCoupons(data || []);
    } catch (e) {
      console.error(e.message || String(e));
    }
  }
  async function deleteCoupon(id, name) {
    if (!window.confirm(`Удалить купон "${name}"?`)) return;
    try {
      const { error } = await supabase.from('cupons').delete().eq('id', id);
      if (error) throw error;
      setNotice({ type: 'success', message: `Купон "${name}" удалён` });
      setTimeout(() => setNotice(null), 2500);
      fetchCoupons();
    } catch (e) {
      setNotice({ type: 'error', message: e.message || String(e) });
      setTimeout(() => setNotice(null), 3500);
    }
  }
  async function resetAllStatus() {
    if (!window.confirm('Сбросить статус купонов у всех пользователей на "not_used"? Это действие нельзя отменить.')) return;
    try {
      const { error } = await supabase
        .from('users')
        .update({ cupon_status: 'not_used' })
        .neq('cupon_status', 'not_used');
      if (error) throw error;
      
      setNotice({ type: 'success', message: 'Статус купонов у всех пользователей сброшен на "not_used"' });
      setTimeout(() => setNotice(null), 3500);
    } catch (e) {
      setNotice({ type: 'error', message: e.message || String(e) });
      setTimeout(() => setNotice(null), 3500);
    }
  }

  useEffect(() => { fetchCoupons(); }, []);

  async function onSubmit(e) {
  e.preventDefault();
  const cupon_name = name.trim();
  const discount_percent = Number(discount);
  
  if (coupons.length >= 1) {
    setNotice({ type: 'error', message: 'Можно создать только один купон. Сначала удалите существующий.' });
    setTimeout(() => setNotice(null), 3500);
    return;
  }
  
  if (!cupon_name || discount_percent <= 0 || discount_percent > 100) {
    setNotice({ type: 'error', message: 'Имя и скидка 1–100% обязательны' });
    setTimeout(() => setNotice(null), 3000);
    return;
  }

  try {
    const { data, error } = await supabase
      .from('cupons')
      .insert({ cupon_name, discount_percent })
      .select('id,created_at,cupon_name,discount_percent')
      .single();
    if (error) throw error;
    
    setNotice({ type: 'success', message: `Купон "${cupon_name}" создан` });
    setTimeout(() => setNotice(null), 2500);
    setTimeout(() => { setName(''); setDiscount(0); }, 2500);
    fetchCoupons(); // reload list
  } catch (e) {
    setNotice({ type: 'error', message: e.message || String(e) });
    setTimeout(() => setNotice(null), 3500);
  }
}


  return (
    
    <div className="coupons-view">
      {notice && <Notice type={notice.type} onClose={() => setNotice(null)}>{notice.message}</Notice>}
      <div className="coupons-header">
        <button className="btn ghost" onClick={onBack} style={{ marginRight: 12 }}>← Календарь</button>
        <h2>Купоны</h2>
      </div>
      <button type="button" className="btn reset-all-btn " onClick={resetAllStatus}>
  ↻ Сбросить для всех пользователей
</button>
      <div className="coupons-layout">
        <form className="coupon-form" onSubmit={onSubmit}>
          <label className="field">
            <span>Название купона</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Скидка (%)</span>
            <input type="number" min="1" max="100" value={discount} onChange={(e) => setDiscount(e.target.value)} required />
          </label>
          <button type="submit" className="btn">Создать купон</button>
        </form>
        
        <div className="coupons-list">
          <h3>Список купонов</h3>
          {coupons.length === 0 && <div className="empty">Нет купонов</div>}
          {coupons.map(c => (
  <div key={c.id} className="coupon-card">
    <div>
      <div className="coupon-name">{c.cupon_name}</div>
      <div className="coupon-discount">{c.discount_percent}%</div>
    </div>
    <button className="icon-btn danger" onClick={() => deleteCoupon(c.id, c.cupon_name)} title="Удалить">✕</button>
  </div>
))}
        </div>
      </div>
    </div>
  );
}

function Notice({ children, type, onClose }) {
  return <div className={`notice ${type}`} onClick={onClose}>{children}</div>;
}

