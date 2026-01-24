// src/components/Analytics.jsx
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { resolveServiceDisplay } from '../data/services';
import DetailedRevenueAnalytics from './DetailedRevenueAnalytics';
import DetailedCouponAnalytics from './DetailedCouponAnalytics';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const RU_MONTHS = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];

function rub(n) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n || 0);
}

export default function Analytics({ onBack }) {
  const now = new Date();
  const [period, setPeriod] = useState('month'); // 'month' or 'year'
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [showRegisteredUsers, setShowRegisteredUsers] = useState(false);
  const [registeredUsersList, setRegisteredUsersList] = useState([]);
  const [showRevenueAnalytics, setShowRevenueAnalytics] = useState(false);
  const [showCouponAnalytics, setShowCouponAnalytics] = useState(false);
  const [showAllClients, setShowAllClients] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientDetails, setClientDetails] = useState([]);
  const [loadingClientDetails, setLoadingClientDetails] = useState(false);
  const [showProductsList, setShowProductsList] = useState(false);
  const [hoveredProduct, setHoveredProduct] = useState(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    fetchAnalytics();
  }, [period, selectedMonth, selectedYear]);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showMonthPicker && !e.target.closest('.period-toggle')) {
        setShowMonthPicker(false);
      }
    };
    if (showMonthPicker) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showMonthPicker]);

  async function fetchClientDetails(clientName, clientPhone) {
    setLoadingClientDetails(true);
    try {
      const startDate = period === 'month' 
        ? new Date(selectedYear, selectedMonth, 1)
        : new Date(selectedYear, 0, 1);
      const endDate = period === 'month'
        ? new Date(selectedYear, selectedMonth + 1, 0)
        : new Date(selectedYear, 11, 31);
      
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const { data: bookings, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('name', clientName)
        .eq('phone', clientPhone)
        .gte('date', startStr)
        .lte('date', endStr)
        .neq('status', 'canceled')
        .order('date', { ascending: false })
        .order('time', { ascending: false });

      if (error) throw error;

      const details = (bookings || []).map(booking => {
        let services = booking.services;
        if (!Array.isArray(services)) {
          try { services = services ? JSON.parse(services) : []; } catch { services = []; }
        }
        const normalizedServices = (services || []).map(resolveServiceDisplay);
        const originalTotal = normalizedServices.reduce((s, it) => s + (it.price || 0), 0);
        const bookingTotal = booking.total || 0;
        const discount = originalTotal > 0 ? originalTotal - bookingTotal : 0;
        const hasCoupon = discount > 0;

        return {
          id: booking.id,
          date: booking.date,
          time: booking.time,
          services: normalizedServices,
          originalTotal,
          total: bookingTotal,
          discount,
          hasCoupon
        };
      });

      setClientDetails(details);
      setSelectedClient({ name: clientName, phone: clientPhone });
    } catch (e) {
      console.error('Error fetching client details:', e);
      setClientDetails([]);
    } finally {
      setLoadingClientDetails(false);
    }
  }

  async function fetchAnalytics() {
    setLoading(true);
    setError(null);
    try {
      const startDate = period === 'month' 
        ? new Date(selectedYear, selectedMonth, 1)
        : new Date(selectedYear, 0, 1);
      const endDate = period === 'month'
        ? new Date(selectedYear, selectedMonth + 1, 0)
        : new Date(selectedYear, 11, 31);
      
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // Fetch users
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id,username,login,created_at')
        .order('created_at', { ascending: false });
      if (usersError) throw usersError;

      // Fetch all bookings to get phone numbers for registered users
      const { data: allBookings, error: allBookingsError } = await supabase
        .from('bookings')
        .select('cabinet_id,phone')
        .not('cabinet_id', 'is', null);
      if (allBookingsError) throw allBookingsError;

      // Map users with their phone numbers from bookings
      const usersWithPhones = (users || []).map(user => {
        // Find first booking with matching cabinet_id to get phone
        const booking = (allBookings || []).find(b => b.cabinet_id === user.id);
        return {
          ...user,
          phone: booking?.phone || 'Не указан'
        };
      });
      
      // Store for modal display
      setRegisteredUsersList(usersWithPhones);

      // Fetch bookings
      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .gte('date', startStr)
        .lte('date', endStr)
        .neq('status', 'canceled');
      if (bookingsError) throw bookingsError;

      // Calculate statistics
      // Registered clients = from users table
      const registeredClients = users?.length || 0;
      
      // Unregistered clients = unique clients from bookings with cabinet_id IS NULL
      const unregisteredClientKeys = new Set();
      for (const booking of bookings || []) {
        if (!booking.cabinet_id) {
          const clientKey = `${booking.name} | ${booking.phone}`;
          unregisteredClientKeys.add(clientKey);
        }
      }
      const nonRegisteredClients = unregisteredClientKeys.size;
      
      // Total clients = registered + unregistered
      const totalClients = registeredClients + nonRegisteredClients;

      // Client payments
      const clientPayments = {};
      const productCounts = {};
      let totalRevenue = 0;
      let purchasesWithCoupon = 0;
      let purchasesWithoutCoupon = 0;
      let productsSoldWithoutCoupon = 0;
      let productsSoldWithCoupon = 0;
      let totalProductsSold = 0;

      for (const booking of bookings || []) {
        const clientKey = `${booking.name}|${booking.phone}`;
        const bookingTotal = booking.total || 0;
        totalRevenue += bookingTotal;

        // Client total payments
        if (!clientPayments[clientKey]) {
          clientPayments[clientKey] = { name: booking.name, phone: booking.phone, total: 0 };
        }
        clientPayments[clientKey].total += bookingTotal;

        // Parse services
        let services = booking.services;
        if (!Array.isArray(services)) {
          try { services = services ? JSON.parse(services) : []; } catch { services = []; }
        }
        
        const normalizedServices = (services || []).map(resolveServiceDisplay);
        const originalTotal = normalizedServices.reduce((s, it) => s + (it.price || 0), 0);
        
        // Check if coupon was used (total < original total)
        if (bookingTotal < originalTotal && originalTotal > 0) {
          purchasesWithCoupon++;
          productsSoldWithCoupon += normalizedServices.length;
        } else {
          purchasesWithoutCoupon++;
          productsSoldWithoutCoupon += normalizedServices.length;
        }

        // Count products
        const hasCoupon = bookingTotal < originalTotal && originalTotal > 0;
        for (const service of normalizedServices) {
          const productName = service.name;
          if (!productCounts[productName]) {
            productCounts[productName] = { 
              name: productName, 
              count: 0, 
              revenue: 0,
              withCoupon: 0,
              withoutCoupon: 0
            };
          }
          productCounts[productName].count += 1;
          productCounts[productName].revenue += service.price;
          totalProductsSold += 1;
          if (hasCoupon) {
            productCounts[productName].withCoupon += 1;
          } else {
            productCounts[productName].withoutCoupon += 1;
          }
        }
      }

      // Sort products by popularity
      const products = Object.values(productCounts).sort((a, b) => b.count - a.count);
      const mostPopular = products[0] || null;
      const leastPopular = products[products.length - 1] || null;
      
      // Calculate product shares
      const productsWithShare = products.map(p => ({
        ...p,
        share: totalProductsSold > 0 ? (p.count / totalProductsSold) * 100 : 0,
        price: p.count > 0 ? p.revenue / p.count : 0
      }));

      // Sort clients by total paid
      const clients = Object.values(clientPayments).sort((a, b) => b.total - a.total);

      setStats({
        totalClients,
        registeredClients,
        nonRegisteredClients,
        clients,
        mostPopular,
        leastPopular,
        purchasesWithCoupon,
        purchasesWithoutCoupon,
        productsSoldWithoutCoupon,
        productsSoldWithCoupon,
        totalRevenue,
        totalProductsSold,
        products: productsWithShare,
        period: period === 'month' 
          ? `${RU_MONTHS[selectedMonth]} ${selectedYear}`
          : `${selectedYear}`
      });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="analytics-view">
        <div className="analytics-header">
          <button className="btn ghost" onClick={onBack} style={{ marginRight: 12 }}>← Назад</button>
          <h2>Аналитика</h2>
        </div>
        <div className="loader">Загрузка...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="analytics-view">
        <div className="analytics-header">
          <button className="btn ghost" onClick={onBack} style={{ marginRight: 12 }}>← Назад</button>
          <h2>Аналитика</h2>
        </div>
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="analytics-view">
      <div className="analytics-header">
        <button className="btn ghost" onClick={onBack} style={{ marginRight: 12 }}>← Назад</button>
        <h2>Аналитика</h2>
        <div className="period-toggle" style={{ position: 'relative' }}>
          <button 
            type="button"
            className={`btn ${period === 'month' ? '' : 'ghost'}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPeriod('month');
              setShowMonthPicker(!showMonthPicker);
            }}
          >
            Месяц
          </button>
          <button 
            type="button"
            className={`btn ${period === 'year' ? '' : 'ghost'}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPeriod('year');
              setShowMonthPicker(!showMonthPicker);
            }}
          >
            Год
          </button>
          
          {showMonthPicker && period === 'month' && (
            <div className="month-picker-popup">
              <div className="month-picker-header">
                <button 
                  type="button"
                  className="month-picker-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedYear(selectedYear - 1);
                  }}
                >
                  ‹
                </button>
                <div className="month-picker-year">{selectedYear}</div>
                <button 
                  type="button"
                  className="month-picker-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedYear(selectedYear + 1);
                  }}
                >
                  ›
                </button>
              </div>
              <div className="month-picker-grid">
                {RU_MONTHS.map((month, idx) => {
                  const isCurrentMonth = now.getMonth() === idx && now.getFullYear() === selectedYear;
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`month-picker-month ${selectedMonth === idx ? 'active' : ''} ${isCurrentMonth ? 'current' : ''}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedMonth(idx);
                        setShowMonthPicker(false);
                      }}
                    >
                      <span>{month}</span>
                      {isCurrentMonth && <span className="current-month-label">текущий</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          
          {showMonthPicker && period === 'year' && (
            <div className="month-picker-popup" style={{ minWidth: '150px' }}>
              <div className="month-picker-header">
                <button 
                  type="button"
                  className="month-picker-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedYear(selectedYear - 1);
                  }}
                >
                  ‹
                </button>
                <div className="month-picker-year">{selectedYear}</div>
                <button 
                  type="button"
                  className="month-picker-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedYear(selectedYear + 1);
                  }}
                >
                  ›
                </button>
              </div>
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowMonthPicker(false);
                  }}
                  style={{ width: '100%' }}
                >
                  Применить
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="analytics-content">
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Всего клиентов</h3>
            <div className="stat-value">{stats.totalClients}</div>
          </div>

          <div className="stat-card clickable" onClick={() => setShowRegisteredUsers(true)} style={{ cursor: 'pointer' }}>
            <h3>Зарегистрированных</h3>
            <div className="stat-value">{stats.registeredClients}</div>
          </div>

          <div className="stat-card">
            <h3>Незарегистрированных</h3>
            <div className="stat-value">{stats.nonRegisteredClients}</div>
          </div>

          <div className="stat-card clickable" onClick={() => setShowRevenueAnalytics(true)} style={{ cursor: 'pointer' }}>
            <h3>Выручка за {stats.period}</h3>
            <div className="stat-value">{rub(stats.totalRevenue)}</div>
          </div>

          <div className="stat-card coupon-analytics-card clickable" onClick={() => setShowCouponAnalytics(true)} style={{ cursor: 'pointer' }}>
            <h3>Аналитика купона</h3>
            <div className="coupon-analytics-content">
              <div className="coupon-stat-item">
                <div className="coupon-stat-label">Товаров продано с купоном</div>
                <div className="coupon-stat-value">{stats.productsSoldWithCoupon}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="stat-section clickable-section" onClick={() => stats.products && stats.products.length > 0 && setShowProductsList(true)} style={stats.products && stats.products.length > 0 ? { cursor: 'pointer' } : {}}>
          <h3>Популярность продуктов</h3>
          <div className="products-comparison">
            <div>
              <h4 style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '12px', fontWeight: 600 }}>Самый популярный</h4>
              {stats.mostPopular ? (
                <div className="product-card">
                  <div className="product-name">{stats.mostPopular.name}</div>
                  <div className="product-stats">
                    <span>Продано: {stats.mostPopular.count}</span>
                    <span>Выручка: {rub(stats.mostPopular.revenue)}</span>
                  </div>
                </div>
              ) : (
                <div className="empty">Нет данных</div>
              )}
            </div>
            <div>
              <h4 style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '12px', fontWeight: 600 }}>Наименее популярный</h4>
              {stats.leastPopular ? (
                <div className="product-card">
                  <div className="product-name">{stats.leastPopular.name}</div>
                  <div className="product-stats">
                    <span>Продано: {stats.leastPopular.count}</span>
                    <span>Выручка: {rub(stats.leastPopular.revenue)}</span>
                  </div>
                </div>
              ) : (
                <div className="empty">Нет данных</div>
              )}
            </div>
          </div>
          {stats.products && stats.products.length > 0 && (
            <div className="show-more-indicator" style={{ marginTop: '12px' }}>
              Нажмите, чтобы увидеть все продукты ({stats.products.length} продуктов)
            </div>
          )}
        </div>

        <div className="stat-section clickable-section" onClick={() => stats.clients.length > 0 && setShowAllClients(true)} style={stats.clients.length > 0 ? { cursor: 'pointer' } : {}}>
          <h3>Платежи клиентов</h3>
          {stats.clients.length > 0 ? (
            <>
              <div className="clients-list">
                {stats.clients.slice(0, 5).map((client, idx) => (
                  <div key={idx} className="client-card">
                    <div className="client-info">
                      <div className="client-name">{client.name}</div>
                      <div className="client-phone">{client.phone}</div>
                    </div>
                    <div className="client-total">{rub(client.total)}</div>
                  </div>
                ))}
              </div>
              {stats.clients.length > 5 && (
                <div className="show-more-indicator">
                  Нажмите, чтобы увидеть все ({stats.clients.length} клиентов)
                </div>
              )}
            </>
          ) : (
            <div className="empty">Нет данных</div>
          )}
        </div>
      </div>

      {showRegisteredUsers && (
        <div className="modal-backdrop" onClick={() => setShowRegisteredUsers(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowRegisteredUsers(false)}>✕</button>
            <h3 style={{ marginBottom: 20 }}>Зарегистрированные пользователи</h3>
            {registeredUsersList.length > 0 ? (
              <div className="registered-users-list">
                {registeredUsersList.map((user) => (
                  <div key={user.id} className="registered-user-card">
                    <div className="registered-user-info">
                      <div className="registered-user-name">{user.username || user.login}</div>
                      <div className="registered-user-phone">{user.phone}</div>
                      <div className="registered-user-date">
                        Создан: {new Date(user.created_at).toLocaleDateString('ru-RU', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">Нет зарегистрированных пользователей</div>
            )}
          </div>
        </div>
      )}

      {showRevenueAnalytics && (
        <DetailedRevenueAnalytics period={period} onClose={() => setShowRevenueAnalytics(false)} />
      )}

      {showCouponAnalytics && (
        <DetailedCouponAnalytics period={period} onClose={() => setShowCouponAnalytics(false)} />
      )}

      {showAllClients && stats && (
        <div className="modal-backdrop" onClick={() => setShowAllClients(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAllClients(false)}>✕</button>
            <h3 style={{ marginBottom: 20 }}>Платежи клиентов ({stats.clients.length})</h3>
            <div className="clients-list" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {stats.clients.map((client, idx) => (
                <div 
                  key={idx} 
                  className="client-card clickable-client" 
                  onClick={() => fetchClientDetails(client.name, client.phone)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="client-info">
                    <div className="client-name">{client.name}</div>
                    <div className="client-phone">{client.phone}</div>
                  </div>
                  <div className="client-total">{rub(client.total)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedClient && (
        <div className="modal-backdrop" onClick={() => { setSelectedClient(null); setClientDetails([]); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setSelectedClient(null); setClientDetails([]); }}>✕</button>
            <h3 style={{ marginBottom: 16 }}>Детали покупок</h3>
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{selectedClient.name}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>{selectedClient.phone}</div>
            </div>
            
            {loadingClientDetails ? (
              <div className="loader">Загрузка...</div>
            ) : clientDetails.length === 0 ? (
              <div className="empty">Нет данных о покупках</div>
            ) : (
              <div className="client-details-list" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {clientDetails.map((detail, idx) => {
                  const totalItems = detail.services.length;
                  return (
                    <div key={detail.id || idx} className="client-detail-card" style={{ marginBottom: 16, padding: 16, border: '1px solid var(--line)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{detail.date} в {detail.time}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            Товаров: {totalItems} {detail.hasCoupon && <span style={{ color: '#0a7f2e' }}>• Купон применен</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--brand)' }}>{rub(detail.total)}</div>
                          {detail.hasCoupon && (
                            <div style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'line-through' }}>
                              {rub(detail.originalTotal)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                        {detail.services.map((service, sIdx) => (
                          <div key={sIdx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 14 }}>
                            <div>{service.name}</div>
                            <div style={{ fontWeight: 600 }}>{rub(service.price)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {showProductsList && stats && stats.products && (
        <div className="modal-backdrop" onClick={() => { setShowProductsList(false); setHoveredProduct(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '900px', maxHeight: '85vh' }}>
            <button className="modal-close" onClick={() => { setShowProductsList(false); setHoveredProduct(null); }}>✕</button>
            <h3 style={{ marginBottom: 20 }}>Рейтинг продуктов ({stats.products.length})</h3>
            <div 
              className="products-list" 
              style={{ maxHeight: '70vh', overflowY: 'auto' }}
              onMouseLeave={() => setHoveredProduct(null)}
            >
              {stats.products.map((product, idx) => {
                const rank = idx + 1;
                
                return (
                  <div
                    key={idx}
                    className="product-ranking-item"
                    style={{
                      padding: '16px',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      marginBottom: '12px',
                      backgroundColor: '#fafafa',
                      position: 'relative',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      setHoveredProduct(product);
                      const rect = e.currentTarget.getBoundingClientRect();
                      const windowWidth = window.innerWidth;
                      const windowHeight = window.innerHeight;
                      const tooltipWidth = 400;
                      const tooltipHeight = 450; // Approximate tooltip height
                      const spacing = 10;
                      
                      // Horizontal positioning
                      const tooltipX = rect.right + spacing + tooltipWidth > windowWidth 
                        ? rect.left - tooltipWidth - spacing 
                        : rect.right + spacing;
                      
                      // Vertical positioning - check if tooltip would go off bottom
                      let tooltipY = rect.top;
                      if (rect.top + tooltipHeight > windowHeight) {
                        // Position above the item if it would go off screen at bottom
                        tooltipY = rect.top - tooltipHeight - spacing;
                        // If that would go off top, position at top of viewport
                        if (tooltipY < 0) {
                          tooltipY = spacing;
                        }
                      }
                      
                      setHoverPosition({
                        x: Math.max(spacing, Math.min(tooltipX, windowWidth - tooltipWidth - spacing)),
                        y: Math.max(spacing, tooltipY)
                      });
                    }}
                    onMouseMove={(e) => {
                      if (hoveredProduct) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const windowWidth = window.innerWidth;
                        const windowHeight = window.innerHeight;
                        const tooltipWidth = 400;
                        const tooltipHeight = 450;
                        const spacing = 10;
                        
                        // Horizontal positioning
                        const tooltipX = rect.right + spacing + tooltipWidth > windowWidth 
                          ? rect.left - tooltipWidth - spacing 
                          : rect.right + spacing;
                        
                        // Vertical positioning
                        let tooltipY = rect.top;
                        if (rect.top + tooltipHeight > windowHeight) {
                          tooltipY = rect.top - tooltipHeight - spacing;
                          if (tooltipY < 0) {
                            tooltipY = spacing;
                          }
                        }
                        
                        setHoverPosition({
                          x: Math.max(spacing, Math.min(tooltipX, windowWidth - tooltipWidth - spacing)),
                          y: Math.max(spacing, tooltipY)
                        });
                      }
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        backgroundColor: rank === 1 ? '#8b7fb8' : rank === stats.products.length ? '#ccc' : '#a092d1',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '16px',
                        flexShrink: 0
                      }}>
                        {rank}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px', wordBreak: 'break-word' }}>
                          {product.name}
                        </div>
                        <div style={{ fontSize: '14px', color: 'var(--muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                          <span>Продано: {product.count}</span>
                          <span>Выручка: {rub(product.revenue)}</span>
                          <span>Цена: {rub(product.price)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {hoveredProduct && (
        <div
          style={{
            position: 'fixed',
            left: `${hoverPosition.x}px`,
            top: `${hoverPosition.y}px`,
            backgroundColor: '#fff',
            border: '1px solid #ccc',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            zIndex: 10000,
            minWidth: '320px',
            maxWidth: '400px',
            maxHeight: '90vh',
            overflowY: 'auto',
            pointerEvents: 'none'
          }}
          onMouseEnter={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 600, marginBottom: '16px', fontSize: '16px', wordBreak: 'break-word' }}>
            {hoveredProduct.name}
          </div>
          
          <div style={{ marginBottom: '16px' }}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'Доля продукта', value: hoveredProduct.share },
                    { name: 'Остальные', value: 100 - hoveredProduct.share }
                  ]}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  dataKey="value"
                  startAngle={90}
                  endAngle={-270}
                >
                  <Cell fill="#8b7fb8" />
                  <Cell fill="#e0e0e0" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '14px', fontWeight: 600, color: '#8b7fb8' }}>
              {hoveredProduct.share.toFixed(1)}% от всех продаж
            </div>
          </div>

          <div style={{ borderTop: '1px solid #eee', paddingTop: '12px' }}>
            <div style={{ fontSize: '14px', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600 }}>Стоимость товара: </span>
              <span>{rub(hoveredProduct.price)}</span>
            </div>
            <div style={{ fontSize: '14px', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600 }}>Количество покупок: </span>
              <span>{hoveredProduct.count}</span>
            </div>
            <div style={{ fontSize: '14px', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600 }}>С купоном: </span>
              <span>{hoveredProduct.withCoupon}</span>
            </div>
            <div style={{ fontSize: '14px' }}>
              <span style={{ fontWeight: 600 }}>Без купона: </span>
              <span>{hoveredProduct.withoutCoupon}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
