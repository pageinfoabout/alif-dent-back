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
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [selectedRegisteredUser, setSelectedRegisteredUser] = useState(null);
  const [registeredUserDetails, setRegisteredUserDetails] = useState([]);
  const [loadingRegisteredUserDetails, setLoadingRegisteredUserDetails] = useState(false);
  const [showUnregisteredUsers, setShowUnregisteredUsers] = useState(false);
  const [unregisteredUsersList, setUnregisteredUsersList] = useState([]);
  const [unregisteredUserSearchQuery, setUnregisteredUserSearchQuery] = useState('');
  const [showAllClientsAllTime, setShowAllClientsAllTime] = useState(false);
  const [allClientsAllTime, setAllClientsAllTime] = useState([]);
  const [loadingAllClientsAllTime, setLoadingAllClientsAllTime] = useState(false);
  const [allClientsAllTimeSearchQuery, setAllClientsAllTimeSearchQuery] = useState('');
  const [allClientsStats, setAllClientsStats] = useState({ total: 0, registered: 0, unregistered: 0 });
  const [showAllClientsFilter, setShowAllClientsFilter] = useState(false);
  const [allClientsFilter, setAllClientsFilter] = useState('all'); // 'all', 'registered', 'unregistered'

  useEffect(() => {
    fetchAnalytics();
  }, [period, selectedMonth, selectedYear]);

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showAllClientsFilter && !e.target.closest('[data-filter-container]')) {
        setShowAllClientsFilter(false);
      }
    };
    if (showAllClientsFilter) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showAllClientsFilter]);

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

  async function fetchAllClientsAllTime() {
    setLoadingAllClientsAllTime(true);
    try {
      // Fetch all bookings (no date filter)
      const { data: allBookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .neq('status', 'canceled')
        .order('date', { ascending: false });
      if (bookingsError) throw bookingsError;

      // Fetch all registered users
      const { data: allUsers, error: usersError } = await supabase
        .from('users')
        .select('id,username,login,name,last_name,middle_name,number,age,created_at');
      if (usersError) throw usersError;

      // Create a map of all clients (both registered and unregistered)
      const allClientsMap = new Map();

      // Process all bookings to get client payments
      for (const booking of allBookings || []) {
        const clientKey = `${booking.name}|${booking.phone}`;
        const bookingTotal = booking.total || 0;

        if (!allClientsMap.has(clientKey)) {
          // Check if this client is registered
          const isRegistered = booking.cabinet_id && allUsers?.some(u => u.id === booking.cabinet_id);
          const registeredUser = isRegistered ? allUsers.find(u => u.id === booking.cabinet_id) : null;

          allClientsMap.set(clientKey, {
            name: booking.name,
            phone: booking.phone,
            total: 0,
            isRegistered: isRegistered,
            registeredUser: registeredUser,
            cabinet_id: booking.cabinet_id,
            // Use registered user data if available, otherwise use booking data
            displayName: registeredUser 
              ? [registeredUser.last_name, registeredUser.name, registeredUser.middle_name]
                  .filter(Boolean)
                  .join(' ') || registeredUser.username || registeredUser.login || booking.name
              : booking.name,
            firstName: registeredUser?.name || null,
            lastName: registeredUser?.last_name || null,
            middleName: registeredUser?.middle_name || null,
            username: registeredUser?.username || null,
            phoneNumber: registeredUser?.number || booking.phone,
            registrationDate: registeredUser?.created_at || null
          });
        }

        allClientsMap.get(clientKey).total += bookingTotal;
      }

      // Convert map to array and sort by total
      const allClients = Array.from(allClientsMap.values())
        .sort((a, b) => b.total - a.total);

      // Calculate statistics
      const totalClients = allClients.length;
      const registeredClients = allClients.filter(c => c.isRegistered).length;
      const unregisteredClients = totalClients - registeredClients;

      setAllClientsAllTime(allClients);
      setAllClientsStats({
        total: totalClients,
        registered: registeredClients,
        unregistered: unregisteredClients
      });
    } catch (e) {
      console.error('Error fetching all clients:', e);
      setAllClientsAllTime([]);
    } finally {
      setLoadingAllClientsAllTime(false);
    }
  }

  async function fetchRegisteredUserDetails(user) {
    setLoadingRegisteredUserDetails(true);
    try {
      // Fetch all bookings for this user by cabinet_id or phone number (all time, not just selected period)
      let allBookings = [];
      
      // Try to find bookings by cabinet_id first (if user.id exists)
      if (user.id) {
        const { data: byCabinet, error: err1 } = await supabase
          .from('bookings')
          .select('*')
          .eq('cabinet_id', user.id)
          .neq('status', 'canceled')
          .order('date', { ascending: false })
          .order('time', { ascending: false });
        
        if (err1) throw err1;
        if (byCabinet) allBookings.push(...byCabinet);
      }
      
      // Also search by phone number if available
      if (user.number) {
        const { data: byPhone, error: err2 } = await supabase
          .from('bookings')
          .select('*')
          .eq('phone', user.number)
          .neq('status', 'canceled')
          .order('date', { ascending: false })
          .order('time', { ascending: false });
        
        if (err2) throw err2;
        if (byPhone) allBookings.push(...byPhone);
      }
      
      // Deduplicate by id (in case same booking matches both conditions)
      const uniqueBookings = Array.from(
        new Map(allBookings.map(b => [b.id, b])).values()
      );
      
      // Sort by date and time
      uniqueBookings.sort((a, b) => {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        return (b.time || '').localeCompare(a.time || '');
      });

      const details = uniqueBookings.map(booking => {
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

      setRegisteredUserDetails(details);
      setSelectedRegisteredUser(user);
    } catch (e) {
      console.error('Error fetching registered user details:', e);
      setRegisteredUserDetails([]);
    } finally {
      setLoadingRegisteredUserDetails(false);
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
      
      // For created_at filtering, use the start of the first day and end of the last day
      const startDateISO = startDate.toISOString();
      // End date should be the end of the last day (23:59:59.999)
      const endDateForFilter = new Date(endDate);
      endDateForFilter.setHours(23, 59, 59, 999);
      const endDateISO = endDateForFilter.toISOString();

      // Fetch bookings first to get users who made purchases in the selected period
      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .gte('date', startStr)
        .lte('date', endStr)
        .neq('status', 'canceled');
      if (bookingsError) throw bookingsError;

      // Get unique cabinet_ids from bookings in the selected period
      const userIdsWithPurchases = new Set();
      for (const booking of bookings || []) {
        if (booking.cabinet_id) {
          userIdsWithPurchases.add(booking.cabinet_id);
        }
      }

      // Fetch users who either:
      // 1. Registered during the selected period (created_at within period), OR
      // 2. Made purchases during the selected period (cabinet_id in bookings)
      const { data: usersRegisteredInPeriod, error: usersError1 } = await supabase
        .from('users')
        .select('id,username,login,name,last_name,middle_name,number,age,created_at')
        .gte('created_at', startDateISO)
        .lte('created_at', endDateISO)
        .order('created_at', { ascending: false });
      if (usersError1) throw usersError1;

      // Fetch users who made purchases (even if registered earlier)
      let usersWithPurchases = [];
      if (userIdsWithPurchases.size > 0) {
        const { data: usersPurchased, error: usersError2 } = await supabase
          .from('users')
          .select('id,username,login,name,last_name,middle_name,number,age,created_at')
          .in('id', Array.from(userIdsWithPurchases));
        if (usersError2) throw usersError2;
        usersWithPurchases = usersPurchased || [];
      }

      // Combine and deduplicate users
      const allRelevantUsers = new Map();
      for (const user of usersRegisteredInPeriod || []) {
        allRelevantUsers.set(user.id, user);
      }
      for (const user of usersWithPurchases || []) {
        allRelevantUsers.set(user.id, user);
      }
      const usersWithData = Array.from(allRelevantUsers.values());

      // Get phone numbers from bookings if not in users table
      if (usersWithData.length > 0) {
        const userIds = usersWithData.map(u => u.id);
        const { data: allBookings, error: allBookingsError } = await supabase
          .from('bookings')
          .select('cabinet_id,phone')
          .in('cabinet_id', userIds);
        if (!allBookingsError && allBookings) {
          for (let i = 0; i < usersWithData.length; i++) {
            const user = usersWithData[i];
            if (!user.number) {
              const booking = allBookings.find(b => b.cabinet_id === user.id);
              if (booking) {
                usersWithData[i] = { ...user, number: user.number || booking?.phone || null };
              }
            }
          }
        }
      }
      
      // Store for modal display
      setRegisteredUsersList(usersWithData);

      // Calculate statistics
      // Registered clients = users who registered in period OR made purchases in period
      const registeredClients = usersWithData.length;
      
      // Unregistered clients = unique clients from bookings with cabinet_id IS NULL
      const unregisteredClientKeys = new Set();
      const unregisteredUsersMap = new Map(); // Store full user data
      for (const booking of bookings || []) {
        if (!booking.cabinet_id) {
          const clientKey = `${booking.name}|${booking.phone}`;
          unregisteredClientKeys.add(clientKey);
          
          // Store user data if not already stored
          if (!unregisteredUsersMap.has(clientKey)) {
            unregisteredUsersMap.set(clientKey, {
              name: booking.name,
              phone: booking.phone,
              key: clientKey
            });
          }
        }
      }
      const nonRegisteredClients = unregisteredClientKeys.size;
      
      // Store unregistered users list for modal
      setUnregisteredUsersList(Array.from(unregisteredUsersMap.values()));
      
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

          <div className="stat-card clickable" onClick={() => setShowUnregisteredUsers(true)} style={{ cursor: 'pointer' }}>
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

        <div className="stat-section">
          <h3>Платежи клиентов</h3>
          {stats.clients.length > 0 ? (
            <>
              <div className="clients-list clickable-section" onClick={() => stats.clients.length > 0 && setShowAllClients(true)} style={stats.clients.length > 0 ? { cursor: 'pointer' } : {}}>
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
                <div className="show-more-indicator" onClick={() => stats.clients.length > 0 && setShowAllClients(true)} style={{ cursor: 'pointer' }}>
                  Нажмите, чтобы увидеть все ({stats.clients.length} клиентов)
                </div>
              )}
              <div 
                className="show-more-indicator" 
                onClick={() => { fetchAllClientsAllTime(); setShowAllClientsAllTime(true); }} 
                style={{ 
                  cursor: 'pointer', 
                  marginTop: '12px', 
                  backgroundColor: 'var(--brand)', 
                  color: '#fff', 
                  fontWeight: 600,
                  padding: '12px 16px',
                  borderRadius: '8px',
                  textAlign: 'center',
                  fontSize: '15px',
                  transition: 'opacity 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.opacity = '0.9'}
                onMouseLeave={(e) => e.target.style.opacity = '1'}
              >
                Все клиенты за всё время
              </div>
            </>
          ) : (
            <>
              <div className="empty">Нет данных</div>
              <div 
                className="show-more-indicator" 
                onClick={() => { fetchAllClientsAllTime(); setShowAllClientsAllTime(true); }} 
                style={{ 
                  cursor: 'pointer', 
                  marginTop: '12px', 
                  backgroundColor: 'var(--brand)', 
                  color: '#fff', 
                  fontWeight: 600,
                  padding: '12px 16px',
                  borderRadius: '8px',
                  textAlign: 'center',
                  fontSize: '15px',
                  transition: 'opacity 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.opacity = '0.9'}
                onMouseLeave={(e) => e.target.style.opacity = '1'}
              >
                Все клиенты за всё время
              </div>
            </>
          )}
        </div>
      </div>

      {showRegisteredUsers && (
        <div className="modal-backdrop" onClick={() => { setShowRegisteredUsers(false); setUserSearchQuery(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setShowRegisteredUsers(false); setUserSearchQuery(''); }}>✕</button>
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 12 }}>Зарегистрированные пользователи</h3>
              <input
                type="text"
                placeholder="Поиск по имени, фамилии, username или телефону..."
                value={userSearchQuery || ''}
                onChange={(e) => {
                  try {
                    setUserSearchQuery(e.target.value || '');
                  } catch (error) {
                    console.error('Error setting search query:', error);
                    setUserSearchQuery('');
                  }
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            {registeredUsersList.length > 0 ? (
              <div className="registered-users-list">
                {(() => {
                  if (!registeredUsersList || registeredUsersList.length === 0) {
                    return <div className="empty">Нет зарегистрированных пользователей</div>;
                  }
                  
                  const filteredUsers = userSearchQuery.trim()
                    ? registeredUsersList.filter(user => {
                        if (!user) return false;
                        try {
                          const searchLower = (userSearchQuery || '').toLowerCase();
                          const nameParts = [
                            user.last_name,
                            user.name,
                            user.middle_name
                          ].filter(part => part != null && part !== '');
                          const fullName = nameParts.length > 0 
                            ? nameParts.join(' ').toLowerCase() 
                            : '';
                          
                          return (
                            (fullName && fullName.includes(searchLower)) ||
                            (user.name && String(user.name || '').toLowerCase().includes(searchLower)) ||
                            (user.last_name && String(user.last_name || '').toLowerCase().includes(searchLower)) ||
                            (user.middle_name && String(user.middle_name || '').toLowerCase().includes(searchLower)) ||
                            (user.username && String(user.username || '').toLowerCase().includes(searchLower)) ||
                            (user.login && String(user.login || '').toLowerCase().includes(searchLower)) ||
                            (user.number && String(user.number || '').includes(String(userSearchQuery || '')))
                          );
                        } catch (e) {
                          console.error('Error filtering user:', e, user);
                          return false;
                        }
                      })
                    : registeredUsersList;
                  
                  if (filteredUsers.length === 0) {
                    return <div className="empty">Пользователи не найдены</div>;
                  }
                  
                  return (
                    <>
                      {userSearchQuery.trim() && (
                        <div style={{ 
                          marginBottom: 12, 
                          fontSize: '14px', 
                          color: 'var(--muted)',
                          padding: '8px 0'
                        }}>
                          Найдено: {filteredUsers.length} из {registeredUsersList.length}
                        </div>
                      )}
                      {filteredUsers.map((user) => {
                        if (!user) return null;
                        // Format full name: last_name name middle_name
                        const fullName = [user.last_name, user.name, user.middle_name]
                          .filter(part => part != null && part !== '')
                          .join(' ') || user.username || user.login || 'Без имени';
                        
                        return (
                          <div 
                            key={user.id} 
                            className="registered-user-card clickable-client"
                            onClick={() => fetchRegisteredUserDetails(user)}
                            style={{ cursor: 'pointer' }}
                          >
                            <div className="registered-user-info">
                              <div className="registered-user-name" style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
                                {fullName}
                              </div>
                              {user.username && (
                                <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                                  <strong>Username:</strong> {user.username}
                                </div>
                              )}
                              {user.login && !user.username && (
                                <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                                  <strong>Login:</strong> {user.login}
                                </div>
                              )}
                              {user.number && (
                                <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                                  <strong>Номер:</strong> {user.number}
                                </div>
                              )}
                              {user.age && (
                                <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                                  <strong>Возраст:</strong> {user.age} лет
                                </div>
                              )}
                              <div className="registered-user-date" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--line)' }}>
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
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="empty">Нет зарегистрированных пользователей</div>
            )}
          </div>
        </div>
      )}

      {showRevenueAnalytics && (
        <DetailedRevenueAnalytics 
          period={period} 
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          onClose={() => setShowRevenueAnalytics(false)} 
        />
      )}

      {showCouponAnalytics && (
        <DetailedCouponAnalytics 
          period={period} 
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          onClose={() => setShowCouponAnalytics(false)} 
        />
      )}

      {showAllClients && stats && (
        <div className="modal-backdrop" onClick={() => { setShowAllClients(false); setClientSearchQuery(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setShowAllClients(false); setClientSearchQuery(''); }}>✕</button>
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 12 }}>Платежи клиентов</h3>
              <input
                type="text"
                placeholder="Поиск по имени или телефону..."
                value={clientSearchQuery}
                onChange={(e) => setClientSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            
            <div className="clients-list" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {(() => {
                const filteredClients = clientSearchQuery.trim() 
                  ? stats.clients.filter(client => 
                      client.name.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                      client.phone.includes(clientSearchQuery)
                    )
                  : stats.clients;
                
                if (filteredClients.length === 0) {
                  return <div className="empty">Клиенты не найдены</div>;
                }
                
                return (
                  <>
                    {clientSearchQuery.trim() && (
                      <div style={{ 
                        marginBottom: 12, 
                        fontSize: '14px', 
                        color: 'var(--muted)',
                        padding: '8px 0'
                      }}>
                        Найдено: {filteredClients.length} из {stats.clients.length}
                      </div>
                    )}
                    {filteredClients.map((client, idx) => (
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
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {selectedClient && (
        <div className="modal-backdrop" onClick={() => { setSelectedClient(null); setClientDetails([]); }} style={{ zIndex: 4000 }}>
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

      {selectedRegisteredUser && (
        <div className="modal-backdrop" onClick={() => { setSelectedRegisteredUser(null); setRegisteredUserDetails([]); }} style={{ zIndex: 4000 }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setSelectedRegisteredUser(null); setRegisteredUserDetails([]); }}>✕</button>
            <h3 style={{ marginBottom: 16 }}>История покупок</h3>
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                {[selectedRegisteredUser.last_name, selectedRegisteredUser.name, selectedRegisteredUser.middle_name]
                  .filter(Boolean)
                  .join(' ') || selectedRegisteredUser.username || selectedRegisteredUser.login || 'Без имени'}
              </div>
              {selectedRegisteredUser.number && (
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>Телефон: {selectedRegisteredUser.number}</div>
              )}
              {selectedRegisteredUser.username && (
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>Username: {selectedRegisteredUser.username}</div>
              )}
            </div>
            
            {loadingRegisteredUserDetails ? (
              <div className="loader">Загрузка...</div>
            ) : registeredUserDetails.length === 0 ? (
              <div className="empty">Нет данных о покупках</div>
            ) : (
              <div className="client-details-list" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {registeredUserDetails.map((detail, idx) => {
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

      {showUnregisteredUsers && (
        <div className="modal-backdrop" onClick={() => { setShowUnregisteredUsers(false); setUnregisteredUserSearchQuery(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setShowUnregisteredUsers(false); setUnregisteredUserSearchQuery(''); }}>✕</button>
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 12 }}>Незарегистрированные пользователи</h3>
              <input
                type="text"
                placeholder="Поиск по имени или телефону..."
                value={unregisteredUserSearchQuery}
                onChange={(e) => setUnregisteredUserSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            
            <div className="registered-users-list" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {(() => {
                if (!unregisteredUsersList || unregisteredUsersList.length === 0) {
                  return <div className="empty">Нет незарегистрированных пользователей</div>;
                }
                
                const filteredUsers = unregisteredUserSearchQuery.trim()
                  ? unregisteredUsersList.filter(user => {
                      if (!user) return false;
                      const searchLower = (unregisteredUserSearchQuery || '').toLowerCase();
                      return (
                        (user.name && String(user.name || '').toLowerCase().includes(searchLower)) ||
                        (user.phone && String(user.phone || '').includes(String(unregisteredUserSearchQuery || '')))
                      );
                    })
                  : unregisteredUsersList;
                
                if (filteredUsers.length === 0) {
                  return <div className="empty">Пользователи не найдены</div>;
                }
                
                return (
                  <>
                    {unregisteredUserSearchQuery.trim() && (
                      <div style={{
                        marginBottom: 12,
                        fontSize: '14px',
                        color: 'var(--muted)',
                        padding: '8px 0'
                      }}>
                        Найдено: {filteredUsers.length} из {unregisteredUsersList.length}
                      </div>
                    )}
                    {filteredUsers.map((user, idx) => {
                      if (!user) return null;
                      return (
                        <div 
                          key={user.key || idx} 
                          className="registered-user-card clickable-client"
                          onClick={() => fetchClientDetails(user.name, user.phone)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="registered-user-info">
                            <div className="registered-user-name" style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
                              {user.name || 'Без имени'}
                            </div>
                            {user.phone && (
                              <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                                <strong>Номер:</strong> {user.phone}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {showAllClientsAllTime && (
        <div className="modal-backdrop" onClick={(e) => { 
          if (e.target === e.currentTarget && !selectedClient && !selectedRegisteredUser) {
            setShowAllClientsAllTime(false); 
            setAllClientsAllTimeSearchQuery(''); 
            setShowAllClientsFilter(false);
            setAllClientsFilter('all');
          }
        }} style={{ zIndex: 3000 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ 
            maxWidth: '100vw', 
            maxHeight: '100vh', 
            width: '100vw', 
            height: '100vh',
            borderRadius: '0',
            padding: '20px'
          }}>
            <button className="modal-close" onClick={() => { 
              setShowAllClientsAllTime(false); 
              setAllClientsAllTimeSearchQuery(''); 
              setShowAllClientsFilter(false);
              setAllClientsFilter('all');
            }}>✕</button>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Все клиенты за всё время</h3>
                <div style={{ position: 'relative' }} data-filter-container>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAllClientsFilter(!showAllClientsFilter); }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '14px',
                      color: 'var(--text)'
                    }}
                  >
                    <span>🔍</span>
                    <span>Фильтр</span>
                  </button>
                  {showAllClientsFilter && (
                    <div 
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '8px',
                        background: '#fff',
                        border: '1px solid var(--line)',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        padding: '8px',
                        minWidth: '200px',
                        zIndex: 10
                      }}
                    >
                      <div
                        onClick={() => { setAllClientsFilter('all'); setShowAllClientsFilter(false); }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          backgroundColor: allClientsFilter === 'all' ? 'var(--brand-100)' : 'transparent',
                          color: allClientsFilter === 'all' ? 'var(--brand)' : 'var(--text)',
                          fontWeight: allClientsFilter === 'all' ? 600 : 400
                        }}
                      >
                        Все клиенты
                      </div>
                      <div
                        onClick={() => { setAllClientsFilter('registered'); setShowAllClientsFilter(false); }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          backgroundColor: allClientsFilter === 'registered' ? 'var(--brand-100)' : 'transparent',
                          color: allClientsFilter === 'registered' ? '#0a7f2e' : 'var(--text)',
                          fontWeight: allClientsFilter === 'registered' ? 600 : 400
                        }}
                      >
                        Зарегистрированные
                      </div>
                      <div
                        onClick={() => { setAllClientsFilter('unregistered'); setShowAllClientsFilter(false); }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          backgroundColor: allClientsFilter === 'unregistered' ? 'var(--brand-100)' : 'transparent',
                          color: allClientsFilter === 'unregistered' ? 'var(--muted)' : 'var(--text)',
                          fontWeight: allClientsFilter === 'unregistered' ? 600 : 400
                        }}
                      >
                        Незарегистрированные
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ 
                display: 'flex', 
                gap: '20px', 
                marginBottom: '16px',
                padding: '12px',
                backgroundColor: 'var(--brand-100)',
                borderRadius: '8px',
                flexWrap: 'wrap'
              }}>
                <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                  <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Всего клиентов:</strong>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--brand)' }}>{allClientsStats.total}</span>
                </div>
                <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                  <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Зарегистрированных:</strong>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: '#0a7f2e' }}>{allClientsStats.registered}</span>
                </div>
                <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                  <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Незарегистрированных:</strong>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--muted)' }}>{allClientsStats.unregistered}</span>
                </div>
              </div>
              <input
                type="text"
                placeholder="Поиск по имени или телефону..."
                value={allClientsAllTimeSearchQuery}
                onChange={(e) => setAllClientsAllTimeSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            
            <div className="clients-list" style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
              {loadingAllClientsAllTime ? (
                <div className="loader">Загрузка...</div>
              ) : (() => {
                // Apply search filter
                let filteredClients = allClientsAllTimeSearchQuery.trim()
                  ? allClientsAllTime.filter(client => {
                      const searchLower = allClientsAllTimeSearchQuery.toLowerCase();
                      return (
                        client.name.toLowerCase().includes(searchLower) ||
                        client.displayName.toLowerCase().includes(searchLower) ||
                        client.phoneNumber.includes(allClientsAllTimeSearchQuery) ||
                        (client.firstName && client.firstName.toLowerCase().includes(searchLower)) ||
                        (client.lastName && client.lastName.toLowerCase().includes(searchLower)) ||
                        (client.username && client.username.toLowerCase().includes(searchLower))
                      );
                    })
                  : allClientsAllTime;
                
                // Apply registration status filter
                if (allClientsFilter === 'registered') {
                  filteredClients = filteredClients.filter(client => client.isRegistered);
                } else if (allClientsFilter === 'unregistered') {
                  filteredClients = filteredClients.filter(client => !client.isRegistered);
                }
                
                if (filteredClients.length === 0) {
                  return <div className="empty">Клиенты не найдены</div>;
                }
                
                return (
                  <>
                    {allClientsAllTimeSearchQuery.trim() && (
                      <div style={{
                        marginBottom: 12,
                        fontSize: '14px',
                        color: 'var(--muted)',
                        padding: '8px 0'
                      }}>
                        Найдено: {filteredClients.length} из {allClientsAllTime.length}
                      </div>
                    )}
                    {filteredClients.map((client, idx) => {
                      const handleClick = () => {
                        if (client.isRegistered && client.registeredUser) {
                          fetchRegisteredUserDetails(client.registeredUser);
                        } else {
                          fetchClientDetails(client.name, client.phoneNumber);
                        }
                      };

                      return (
                        <div
                          key={idx}
                          className="client-card clickable-client"
                          onClick={handleClick}
                          style={{ cursor: 'pointer' }}
                        >
                          {client.isRegistered && client.registeredUser ? (
                            <div className="client-info" style={{ width: '100%' }}>
                              <div className="client-name" style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
                                {client.displayName}
                                <span style={{ 
                                  marginLeft: '8px', 
                                  fontSize: '12px', 
                                  color: '#0a7f2e',
                                  fontWeight: 600 
                                }}>
                                  (Зарегистрирован)
                                </span>
                              </div>
                              {client.firstName && (
                                <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                                  <strong>Имя:</strong> {client.firstName}
                                </div>
                              )}
                              {client.lastName && (
                                <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                                  <strong>Фамилия:</strong> {client.lastName}
                                </div>
                              )}
                              {client.username && (
                                <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                                  <strong>Username:</strong> {client.username}
                                </div>
                              )}
                              {client.phoneNumber && (
                                <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                                  <strong>Телефон:</strong> {client.phoneNumber}
                                </div>
                              )}
                              {client.registrationDate && (
                                <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                                  <strong>Дата регистрации:</strong> {new Date(client.registrationDate).toLocaleDateString('ru-RU', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="client-info">
                              <div className="client-name">{client.name}</div>
                              <div className="client-phone">{client.phoneNumber}</div>
                            </div>
                          )}
                          <div className="client-total" style={{ fontSize: '18px', fontWeight: 700 }}>{rub(client.total)}</div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
