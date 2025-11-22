// src/components/DetailedCouponAnalytics.jsx
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { resolveServiceDisplay } from '../data/services';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const RU_MONTHS = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];

const COLORS = ['#8b7fb8', '#a092d1', '#b5a7ea', '#c8bcf0', '#dbd1f5'];

function rub(n) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n || 0);
}

export default function DetailedCouponAnalytics({ period, selectedMonth, selectedYear, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [selectedCouponName, setSelectedCouponName] = useState(null); // null = all coupons
  const [allCoupons, setAllCoupons] = useState([]);

  useEffect(() => {
    fetchCouponAnalytics();
  }, [period, selectedCouponName, selectedMonth, selectedYear]);

  async function fetchCouponAnalytics() {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const currentMonth = selectedMonth !== undefined ? selectedMonth : now.getMonth();
      const currentYear = selectedYear !== undefined ? selectedYear : now.getFullYear();
      
      const startDate = period === 'month' 
        ? new Date(currentYear, currentMonth, 1)
        : new Date(currentYear, 0, 1);
      const endDate = period === 'month'
        ? new Date(currentYear, currentMonth + 1, 0)
        : new Date(currentYear, 11, 31);
      
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // Fetch all coupons (not just active ones) for the selector
      const { data: allCouponsData, error: allCouponsError } = await supabase
        .from('cupons')
        .select('*')
        .order('created_at', { ascending: false });
      if (allCouponsError) throw allCouponsError;
      setAllCoupons(allCouponsData || []);

      // Fetch active coupon for display (if no specific coupon selected)
      const { data: coupons, error: couponsError } = await supabase
        .from('cupons')
        .select('*')
        .eq('status', 'working')
        .order('created_at', { ascending: false });
      if (couponsError) throw couponsError;

      // Fetch bookings for current period
      let bookingsQuery = supabase
        .from('bookings')
        .select('*')
        .gte('date', startStr)
        .lte('date', endStr)
        .neq('status', 'canceled');
      
      // Filter by selected coupon if specified
      if (selectedCouponName) {
        bookingsQuery = bookingsQuery.eq('cupon_name', selectedCouponName);
      }
      
      const { data: bookings, error: bookingsError } = await bookingsQuery
        .order('date', { ascending: true });
      if (bookingsError) throw bookingsError;

      // Analyze bookings with coupons
      let totalRevenueWithCoupon = 0;
      let totalDiscountAmount = 0;
      let ordersWithCoupon = 0;
      let totalItemsWithCoupon = 0;
      let totalOriginalRevenue = 0; // Original price before discount

      const couponUsageByDate = {};
      const couponUsageByWeekday = {};
      const couponClients = new Set();
      const couponProducts = {};
      const couponClientStats = {};
      const registeredUsers = new Set();
      const guestUsers = new Set();
      const newClientsWithCoupon = new Set();
      const repeatClientsWithCoupon = new Set();

      // Get all previous bookings to identify new clients
      const { data: allPrevBookings } = await supabase
        .from('bookings')
        .select('name,phone')
        .lt('date', startStr)
        .neq('status', 'canceled');

      const existingClients = new Set();
      for (const booking of allPrevBookings || []) {
        const clientKey = `${booking.name}|${booking.phone}`;
        existingClients.add(clientKey);
      }

      const clientOrderCounts = {};

      for (const booking of bookings || []) {
        const clientKey = `${booking.name}|${booking.phone}`;
        const bookingTotal = booking.total || 0;

        // Parse services
        let services = booking.services;
        if (!Array.isArray(services)) {
          try { services = services ? JSON.parse(services) : []; } catch { services = []; }
        }
        
        const normalizedServices = (services || []).map(resolveServiceDisplay);
        const originalTotal = normalizedServices.reduce((s, it) => s + (it.price || 0), 0);
        
        // Check if coupon was used
        // If a specific coupon is selected, only process bookings with that coupon name
        // Otherwise, check if discount was applied (total < original total OR cupon_name exists)
        const hasCoupon = booking.cupon_name && booking.cupon_name !== null;
        const discount = originalTotal > 0 ? originalTotal - bookingTotal : 0;
        const isCouponBooking = selectedCouponName 
          ? (hasCoupon && booking.cupon_name === selectedCouponName)
          : (hasCoupon || discount > 0);
        
        if (isCouponBooking) {
          ordersWithCoupon++;
          totalRevenueWithCoupon += bookingTotal;
          totalDiscountAmount += discount;
          totalOriginalRevenue += originalTotal;
          totalItemsWithCoupon += normalizedServices.length;

          // Track clients
          couponClients.add(clientKey);
          if (booking.cabinet_id) {
            registeredUsers.add(clientKey);
          } else {
            guestUsers.add(clientKey);
          }

          // Check if new client
          if (!existingClients.has(clientKey)) {
            newClientsWithCoupon.add(clientKey);
          }

          // Track repeat clients
          if (!clientOrderCounts[clientKey]) {
            clientOrderCounts[clientKey] = 0;
          }
          clientOrderCounts[clientKey]++;
          if (clientOrderCounts[clientKey] > 1) {
            repeatClientsWithCoupon.add(clientKey);
          }

          // Client statistics
          if (!couponClientStats[clientKey]) {
            couponClientStats[clientKey] = {
              name: booking.name,
              phone: booking.phone,
              totalRevenue: 0,
              orderCount: 0,
              itemsPurchased: 0,
              isRegistered: !!booking.cabinet_id
            };
          }
          couponClientStats[clientKey].totalRevenue += bookingTotal;
          couponClientStats[clientKey].orderCount++;
          couponClientStats[clientKey].itemsPurchased += normalizedServices.length;

          // Product statistics
          for (const service of normalizedServices) {
            const productName = service.name;
            if (!couponProducts[productName]) {
              couponProducts[productName] = {
                name: productName,
                quantity: 0,
                revenue: 0,
                orders: new Set()
              };
            }
            couponProducts[productName].quantity += 1;
            couponProducts[productName].revenue += service.price;
            couponProducts[productName].orders.add(booking.id);
          }

          // Daily usage
          const date = booking.date;
          if (!couponUsageByDate[date]) {
            couponUsageByDate[date] = { date, orders: 0, revenue: 0, discount: 0 };
          }
          couponUsageByDate[date].orders++;
          couponUsageByDate[date].revenue += bookingTotal;
          couponUsageByDate[date].discount += discount;

          // Weekly usage
          const dateObj = new Date(date);
          const dayOfWeek = dateObj.getDay();
          const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
          const weekday = dayNames[dayOfWeek];
          if (!couponUsageByWeekday[weekday]) {
            couponUsageByWeekday[weekday] = { day: weekday, orders: 0, revenue: 0 };
          }
          couponUsageByWeekday[weekday].orders++;
          couponUsageByWeekday[weekday].revenue += bookingTotal;
        }
      }

      // Calculate metrics for bookings without coupon
      // Only calculate "without coupon" if we're not filtering by a specific coupon
      let totalRevenueWithoutCoupon = 0;
      let ordersWithoutCoupon = 0;
      if (!selectedCouponName) {
        // Fetch all bookings for comparison (not just coupon bookings)
        const { data: allBookings, error: allBookingsError } = await supabase
          .from('bookings')
          .select('*')
          .gte('date', startStr)
          .lte('date', endStr)
          .neq('status', 'canceled')
          .order('date', { ascending: true });
        if (allBookingsError) throw allBookingsError;
        
        for (const booking of allBookings || []) {
        const bookingTotal = booking.total || 0;
        let services = booking.services;
        if (!Array.isArray(services)) {
          try { services = services ? JSON.parse(services) : []; } catch { services = []; }
        }
        const normalizedServices = (services || []).map(resolveServiceDisplay);
        const originalTotal = normalizedServices.reduce((s, it) => s + (it.price || 0), 0);
        const discount = originalTotal > 0 ? originalTotal - bookingTotal : 0;
          const hasCoupon = booking.cupon_name && booking.cupon_name !== null;
        
          if (!hasCoupon && discount === 0) {
          ordersWithoutCoupon++;
          totalRevenueWithoutCoupon += bookingTotal;
          }
        }
      }

      // Calculate total revenue
      const totalRevenue = totalRevenueWithCoupon + totalRevenueWithoutCoupon;
      const totalOrders = ordersWithCoupon + ordersWithoutCoupon;

      // Process daily usage data
      const dailyChartData = Object.keys(couponUsageByDate)
        .sort()
        .map(date => couponUsageByDate[date]);

      // Process weekly usage data
      const weekOrder = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
      const weeklyChartData = weekOrder
        .filter(day => couponUsageByWeekday[day])
        .map(day => couponUsageByWeekday[day] || { day, orders: 0, revenue: 0 });

      // Process product statistics
      const productList = Object.values(couponProducts).map(p => ({
        ...p,
        orders: p.orders.size
      })).sort((a, b) => b.quantity - a.quantity);

      // Process client statistics
      const clientList = Object.values(couponClientStats).sort((a, b) => b.totalRevenue - a.totalRevenue);

      // Get active coupon info - use selected coupon if specified, otherwise use first active coupon
      let activeCoupon = null;
      if (selectedCouponName) {
        activeCoupon = allCouponsData?.find(c => c.cupon_name === selectedCouponName) || null;
      } else {
        activeCoupon = coupons && coupons.length > 0 ? coupons[0] : null;
      }

      setMetrics({
        // General coupon info
        activeCoupon,
        selectedCouponName,
        couponType: 'percentage', // Assuming percentage discount
        discountPercent: activeCoupon?.discount_percent || 0,
        
        // Financial analytics
        totalRevenueWithCoupon,
        ordersWithCoupon,
        totalDiscountAmount,
        averageOrderValueWithCoupon: ordersWithCoupon > 0 ? totalRevenueWithCoupon / ordersWithCoupon : 0,
        averageOrderValueWithoutCoupon: ordersWithoutCoupon > 0 ? totalRevenueWithoutCoupon / ordersWithoutCoupon : 0,
        discountCost: totalDiscountAmount,
        
        // Efficiency
        couponShareOfSales: totalRevenue > 0 ? (totalRevenueWithCoupon / totalRevenue) * 100 : 0,
        
        // Client analytics
        uniqueClientsWithCoupon: couponClients.size,
        newClientsWithCoupon: newClientsWithCoupon.size,
        repeatClientsWithCoupon: repeatClientsWithCoupon.size,
        averageRevenuePerClient: couponClients.size > 0 ? totalRevenueWithCoupon / couponClients.size : 0,
        registeredClientsCount: registeredUsers.size,
        guestClientsCount: guestUsers.size,
        registeredPercentage: couponClients.size > 0 ? (registeredUsers.size / couponClients.size) * 100 : 0,
        
        // Product analytics
        productList,
        topProducts: productList.slice(0, 10),
        averageDiscountPerItem: totalItemsWithCoupon > 0 ? totalDiscountAmount / totalItemsWithCoupon : 0,
        totalItemsWithCoupon,
        
        // Time-based analytics
        dailyChartData,
        weeklyChartData,
        peakActivity: weeklyChartData.length > 0 
          ? weeklyChartData.reduce((max, day) => day.orders > max.orders ? day : max, weeklyChartData[0])
          : null,
        
        // Client and product lists
        clientList,
        
        // Comparison data
        totalRevenue,
        totalOrders,
        ordersWithoutCoupon
      });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal revenue-modal" onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={onClose}>✕</button>
          <div className="loader">Загрузка аналитики купонов...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal revenue-modal" onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={onClose}>✕</button>
          <div className="error">{error}</div>
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  const periodLabel = period === 'month' 
    ? `${RU_MONTHS[selectedMonth !== undefined ? selectedMonth : new Date().getMonth()]} ${selectedYear !== undefined ? selectedYear : new Date().getFullYear()}`
    : `${selectedYear !== undefined ? selectedYear : new Date().getFullYear()}`;

  // Prepare chart data
  const couponVsNoCouponData = [
    { name: 'С купоном', value: metrics.ordersWithCoupon },
    { name: 'Без купона', value: metrics.ordersWithoutCoupon }
  ];

  const topProductsChart = metrics.topProducts.map(p => ({
    name: p.name.length > 20 ? p.name.substring(0, 20) + '...' : p.name,
    fullName: p.name, // Keep full name for tooltip
    quantity: p.quantity,
    revenue: p.revenue,
    price: p.quantity > 0 ? p.revenue / p.quantity : 0 // Average price per unit
  }));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal revenue-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        
        <div className="revenue-analytics-header">
          <h2>Детальная аналитика купонов</h2>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 600 }}>
                Выберите купон:
              </label>
              <select
                value={selectedCouponName || ''}
                onChange={(e) => setSelectedCouponName(e.target.value || null)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  fontSize: '14px',
                  backgroundColor: '#fff',
                  cursor: 'pointer',
                  minWidth: '200px'
                }}
              >
                <option value="">Все купоны</option>
                {allCoupons.map((coupon) => (
                  <option key={coupon.id} value={coupon.cupon_name}>
                    {coupon.cupon_name} ({coupon.discount_percent}%)
                    {coupon.status === 'deleted' ? ' [Удален]' : ''}
                  </option>
                ))}
              </select>
            </div>
          <div className="period-badge">{periodLabel}</div>
          </div>
        </div>

        <div className="revenue-analytics-content">
          {/* General Coupon Info - Only show when a specific coupon is selected */}
          {metrics.activeCoupon && selectedCouponName && (
            <section className="analytics-section">
              <h3>Общая информация о купоне</h3>
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-label">Название купона</div>
                  <div className="metric-value-small">{metrics.activeCoupon.cupon_name}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Тип скидки</div>
                  <div className="metric-value-small">Процентная скидка</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Размер скидки</div>
                  <div className="metric-value-small">-{metrics.discountPercent}%</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Дата создания</div>
                  <div className="metric-value-small">
                    {new Date(metrics.activeCoupon.created_at).toLocaleDateString('ru-RU')}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Статус</div>
                  <div className="metric-value-small" style={{ 
                    color: metrics.activeCoupon.status === 'working' ? '#0a7f2e' : '#9b1426' 
                  }}>
                    {metrics.activeCoupon.status === 'working' ? 'Активен' : 'Удален'}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Financial Analytics */}
          <section className="analytics-section">
            <h3>Финансовая аналитика</h3>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">
                  {selectedCouponName ? 'Общая сумма заказов с этим купоном' : 'Общая сумма заказов с купоном'}
                </div>
                <div className="metric-value">{rub(metrics.totalRevenueWithCoupon)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">
                  {selectedCouponName ? 'Количество заказов с этим купоном' : 'Количество заказов с купоном'}
                </div>
                <div className="metric-value">{metrics.ordersWithCoupon}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Общая сумма скидок</div>
                <div className="metric-value">{rub(metrics.totalDiscountAmount)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">
                  {selectedCouponName ? 'Средний чек с этим купоном' : 'Средний чек с купоном'}
                </div>
                <div className="metric-value">{rub(metrics.averageOrderValueWithCoupon)}</div>
              </div>
              {!selectedCouponName && (
              <div className="metric-card">
                <div className="metric-label">Средний чек без купона</div>
                <div className="metric-value">{rub(metrics.averageOrderValueWithoutCoupon)}</div>
              </div>
              )}
              <div className="metric-card">
                <div className="metric-label">Стоимость купона (скидки)</div>
                <div className="metric-value">{rub(metrics.discountCost)}</div>
              </div>
            </div>
          </section>

          {/* Efficiency */}
          <section className="analytics-section">
            <h3>Эффективность купона</h3>
            <div className="metrics-grid">
              {selectedCouponName ? (
                <>
                  <div className="metric-card">
                    <div className="metric-label">Заказов с этим купоном</div>
                    <div className="metric-value">{metrics.ordersWithCoupon}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Общая выручка с этим купоном</div>
                    <div className="metric-value">{rub(metrics.totalRevenueWithCoupon)}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Общая сумма скидок</div>
                    <div className="metric-value">{rub(metrics.totalDiscountAmount)}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Средний размер скидки на товар</div>
                    <div className="metric-value">{rub(metrics.averageDiscountPerItem)}</div>
                  </div>
                </>
              ) : (
                <>
              <div className="metric-card">
                <div className="metric-label">Доля продаж с купоном</div>
                <div className="metric-value">{metrics.couponShareOfSales.toFixed(1)}%</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Средний размер скидки на товар</div>
                <div className="metric-value">{rub(metrics.averageDiscountPerItem)}</div>
              </div>
                </>
              )}
            </div>

            {!selectedCouponName && (
            <div className="chart-container">
              <h4>Заказы: с купоном vs без купона</h4>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={couponVsNoCouponData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {couponVsNoCouponData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            )}
          </section>

          {/* Client Analytics */}
          <section className="analytics-section">
            <h3> Аналитика по клиентам</h3>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">Уникальных клиентов</div>
                <div className="metric-value">{metrics.uniqueClientsWithCoupon}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Новых клиентов</div>
                <div className="metric-value">{metrics.newClientsWithCoupon}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Повторных клиентов</div>
                <div className="metric-value">{metrics.repeatClientsWithCoupon}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Средняя выручка на клиента</div>
                <div className="metric-value">{rub(metrics.averageRevenuePerClient)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">% Зарегистрированных</div>
                <div className="metric-value">{metrics.registeredPercentage.toFixed(1)}%</div>
              </div>
            </div>

            {metrics.clientList.length > 0 && (
              <div className="chart-container">
                <h4>Клиенты, использовавшие купон</h4>
                <div className="clients-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {metrics.clientList.map((client, idx) => (
                    <div key={idx} className="client-card">
                      <div className="client-info">
                        <div className="client-name">{client.name}</div>
                        <div className="client-phone">{client.phone}</div>
                      </div>
                      <div className="client-total">{rub(client.totalRevenue)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Product Analytics */}
          <section className="analytics-section">
            <h3>Аналитика по товарам</h3>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">Товаров куплено с купоном</div>
                <div className="metric-value">{metrics.totalItemsWithCoupon}</div>
              </div>
            </div>

            {topProductsChart.length > 0 && (
              <div className="chart-container">
                <h4>Самые популярные товары с купоном (ТОП-10)</h4>
                <ResponsiveContainer width="100%" height={600}>
                  <BarChart data={topProductsChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={200} />
                    <YAxis />
                    <Tooltip 
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="custom-tooltip" style={{
                              backgroundColor: '#fff',
                              border: '1px solid #ccc',
                              borderRadius: '8px',
                              padding: '16px',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                              minWidth: '300px',
                              maxWidth: '500px'
                            }}>
                              <div style={{ 
                                fontWeight: 600, 
                                marginBottom: '12px',
                                fontSize: '15px',
                                wordBreak: 'break-word'
                              }}>
                                {data.fullName}
                              </div>
                              {payload.map((entry, index) => (
                                <div key={index} style={{ 
                                  marginBottom: '8px',
                                  fontSize: '14px',
                                  color: entry.color 
                                }}>
                                  <span style={{ fontWeight: 600 }}>{entry.name}: </span>
                                  <span>
                                    {entry.dataKey === 'revenue' 
                                      ? rub(entry.value) 
                                      : entry.value}
                                  </span>
                                </div>
                              ))}
                              <div style={{ 
                                marginTop: '12px',
                                paddingTop: '12px',
                                borderTop: '1px solid #eee',
                                fontSize: '14px'
                              }}>
                                <span style={{ fontWeight: 600 }}>Стоимость товара: </span>
                                <span>{rub(data.price)}</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend />
                    <Bar dataKey="quantity" fill="#8b7fb8" name="Количество" />
                    <Bar dataKey="revenue" fill="#a092d1" name="Выручка" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Time-based Analytics */}
          <section className="analytics-section">
            <h3> Временная аналитика</h3>
            {metrics.dailyChartData.length > 0 && (
              <div className="chart-container">
                <h4>Использование купона по дням</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={metrics.dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip 
                      formatter={(value, name, props) => {
                        // Format revenue and discount with rubles, orders as plain number
                        return (props.dataKey === 'revenue' || props.dataKey === 'discount') 
                          ? rub(value) 
                          : value;
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="orders" stroke="#8b7fb8" name="Заказы" />
                    <Line type="monotone" dataKey="revenue" stroke="#a092d1" name="Выручка" />
                    <Line type="monotone" dataKey="discount" stroke="#b5a7ea" name="Скидки" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {metrics.weeklyChartData.length > 0 && (
              <div className="chart-container">
                <h4>Использование купона по дням недели</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={metrics.weeklyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip 
                      formatter={(value, name, props) => {
                        // Format revenue with rubles, orders as plain number
                        return props.dataKey === 'revenue' ? rub(value) : value;
                      }}
                    />
                    <Legend />
                    <Bar dataKey="orders" fill="#8b7fb8" name="Заказы" />
                    <Bar dataKey="revenue" fill="#a092d1" name="Выручка" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {metrics.peakActivity && (
              <div className="metric-card">
                <div className="metric-label">Пик активности</div>
                <div className="metric-value-small">
                  {metrics.peakActivity.day} ({metrics.peakActivity.orders} заказов)
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
