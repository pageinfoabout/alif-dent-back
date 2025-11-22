// src/components/DetailedRevenueAnalytics.jsx
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

export default function DetailedRevenueAnalytics({ period, selectedMonth, selectedYear, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    fetchDetailedAnalytics();
  }, [period, selectedMonth, selectedYear]);

  async function fetchDetailedAnalytics() {
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
      
      // Previous period for comparison
      const prevStartDate = period === 'month'
        ? new Date(currentYear, currentMonth - 1, 1)
        : new Date(currentYear - 1, 0, 1);
      const prevEndDate = period === 'month'
        ? new Date(currentYear, currentMonth, 0)
        : new Date(currentYear - 1, 11, 31);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      const prevStartStr = prevStartDate.toISOString().split('T')[0];
      const prevEndStr = prevEndDate.toISOString().split('T')[0];

      // Fetch bookings for current period
      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .gte('date', startStr)
        .lte('date', endStr)
        .neq('status', 'canceled')
        .order('date', { ascending: true });
      if (bookingsError) throw bookingsError;

      // Fetch bookings for previous period
      const { data: prevBookings, error: prevBookingsError } = await supabase
        .from('bookings')
        .select('total')
        .gte('date', prevStartStr)
        .lte('date', prevEndStr)
        .neq('status', 'canceled');
      if (prevBookingsError) throw prevBookingsError;

      // Fetch users
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id,created_at');
      if (usersError) throw usersError;

      // Fetch all previous bookings to identify new customers
      const { data: allPrevBookings, error: allPrevBookingsError } = await supabase
        .from('bookings')
        .select('name,phone')
        .lt('date', startStr)
        .neq('status', 'canceled');
      if (allPrevBookingsError) throw allPrevBookingsError;
      
      // Create set of existing clients before period
      const existingClients = new Set();
      for (const booking of allPrevBookings || []) {
        const clientKey = `${booking.name}|${booking.phone}`;
        existingClients.add(clientKey);
      }

      // Calculate metrics
      let totalRevenue = 0;
      let totalUnitsSold = 0;
      let totalOrders = 0;
      let revenueWithCoupon = 0;
      let revenueWithoutCoupon = 0;
      let ordersWithCoupon = 0;
      let ordersWithoutCoupon = 0;
      let totalDiscountAmount = 0;

      const productStats = {};
      const clientStats = {};
      const dailyRevenue = {};
      const weeklyRevenue = {};
      const uniqueClients = new Set();
      const newClients = new Set();
      const repeatClients = new Set();
      const clientOrderCounts = {};

      for (const booking of bookings || []) {
        const orderId = booking.id;
        const clientKey = `${booking.name}|${booking.phone}`;
        uniqueClients.add(clientKey);
        
        // Check if new customer (not in previous period)
        if (!existingClients.has(clientKey)) {
          newClients.add(clientKey);
        }

        // Track repeat customers
        if (!clientOrderCounts[clientKey]) {
          clientOrderCounts[clientKey] = 0;
        }
        clientOrderCounts[clientKey]++;
        if (clientOrderCounts[clientKey] > 1) {
          repeatClients.add(clientKey);
        }

        totalOrders++;
        const bookingTotal = booking.total || 0;
        totalRevenue += bookingTotal;

        // Parse services
        let services = booking.services;
        if (!Array.isArray(services)) {
          try { services = services ? JSON.parse(services) : []; } catch { services = []; }
        }
        
        const normalizedServices = (services || []).map(resolveServiceDisplay);
        const originalTotal = normalizedServices.reduce((s, it) => s + (it.price || 0), 0);
        totalUnitsSold += normalizedServices.length;

        // Coupon analysis
        const discount = originalTotal > 0 ? originalTotal - bookingTotal : 0;
        if (discount > 0) {
          ordersWithCoupon++;
          revenueWithCoupon += bookingTotal;
          totalDiscountAmount += discount;
        } else {
          ordersWithoutCoupon++;
          revenueWithoutCoupon += bookingTotal;
        }

        // Product statistics
        for (const service of normalizedServices) {
          const productName = service.name;
          if (!productStats[productName]) {
            productStats[productName] = {
              name: productName,
              quantity: 0,
              revenue: 0,
              orders: new Set()
            };
          }
          productStats[productName].quantity += 1;
          productStats[productName].revenue += service.price;
          productStats[productName].orders.add(orderId);
        }

        // Client statistics
        if (!clientStats[clientKey]) {
          clientStats[clientKey] = {
            name: booking.name,
            phone: booking.phone,
            totalRevenue: 0,
            orderCount: 0,
            unitsPurchased: 0,
            isRegistered: !!booking.cabinet_id
          };
        }
        clientStats[clientKey].totalRevenue += bookingTotal;
        clientStats[clientKey].orderCount++;
        clientStats[clientKey].unitsPurchased += normalizedServices.length;

        // Daily revenue
        const date = booking.date;
        if (!dailyRevenue[date]) {
          dailyRevenue[date] = { date, revenue: 0, orders: 0 };
        }
        dailyRevenue[date].revenue += bookingTotal;
        dailyRevenue[date].orders++;

        // Weekly revenue
        const dateObj = new Date(date);
        const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
        const weekday = dayNames[dayOfWeek];
        if (!weeklyRevenue[weekday]) {
          weeklyRevenue[weekday] = { day: weekday, revenue: 0, orders: 0 };
        }
        weeklyRevenue[weekday].revenue += bookingTotal;
        weeklyRevenue[weekday].orders++;
      }

      // Previous period revenue
      const prevRevenue = (prevBookings || []).reduce((sum, b) => sum + (b.total || 0), 0);
      let revenueGrowthRate = 0;
      if (prevRevenue > 0) {
        revenueGrowthRate = ((totalRevenue - prevRevenue) / prevRevenue) * 100;
      } else if (totalRevenue > 0) {
        // If previous period had no revenue but current has revenue, show as new growth
        revenueGrowthRate = 100; // 100% growth (from 0 to current)
      }
      // If both are 0, growthRate stays 0

      // Process product statistics
      const productList = Object.values(productStats).map(p => ({
        ...p,
        orders: p.orders.size
      })).sort((a, b) => b.quantity - a.quantity);

      const topProduct = productList[0] || null;
      const leastProduct = productList[productList.length - 1] || null;

      // Product revenue share
      const productsWithShare = productList.map(p => ({
        ...p,
        revenueShare: totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0
      }));

      // Process daily revenue
      const dailyChartData = Object.keys(dailyRevenue)
        .sort()
        .map(date => dailyRevenue[date]);

      // Process weekly revenue
      const weekOrder = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
      const weeklyChartData = weekOrder
        .filter(day => weeklyRevenue[day])
        .map(day => weeklyRevenue[day] || { day, revenue: 0, orders: 0 });

      // Client metrics
      const registeredClients = Object.values(clientStats).filter(c => c.isRegistered).length;
      const guestClients = Object.values(clientStats).filter(c => !c.isRegistered).length;
      const avgRevenuePerCustomer = uniqueClients.size > 0 ? totalRevenue / uniqueClients.size : 0;
      const avgUnitsPerCustomer = uniqueClients.size > 0 ? totalUnitsSold / uniqueClients.size : 0;

      // Calculate average items per order
      const avgItemsPerOrder = totalOrders > 0 ? totalUnitsSold / totalOrders : 0;
      const avgDiscountAmount = ordersWithCoupon > 0 ? totalDiscountAmount / ordersWithCoupon : 0;

      setMetrics({
        // Main sales metrics
        totalRevenue,
        totalUnitsSold,
        totalOrders,
        averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
        averageSellingPrice: totalUnitsSold > 0 ? totalRevenue / totalUnitsSold : 0,
        
        // Product metrics
        productList: productsWithShare,
        topProduct,
        leastProduct,
        avgUnitsPerCustomer,
        
        // Coupon metrics
        ordersWithCoupon,
        ordersWithoutCoupon,
        revenueWithCoupon,
        revenueWithoutCoupon,
        avgDiscountAmount,
        
        // Client metrics
        uniqueCustomers: uniqueClients.size,
        newCustomers: newClients.size,
        repeatCustomers: repeatClients.size,
        revenuePerCustomer: avgRevenuePerCustomer,
        registeredClients,
        guestClients,
        registeredPercentage: uniqueClients.size > 0 ? (registeredClients / uniqueClients.size) * 100 : 0,
        
        // Time-based metrics
        dailyChartData,
        weeklyChartData,
        revenueGrowthRate,
        
        // Additional metrics
        avgItemsPerOrder
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
          <div className="loader">Загрузка аналитики...</div>
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
  const topProductsChart = metrics.productList.slice(0, 10).map(p => ({
    name: p.name.length > 20 ? p.name.substring(0, 20) + '...' : p.name,
    fullName: p.name, // Keep full name for tooltip
    revenue: p.revenue,
    quantity: p.quantity,
    price: p.quantity > 0 ? p.revenue / p.quantity : 0 // Average price per unit
  }));

  const couponRevenueData = [
    { name: 'С купоном', value: metrics.revenueWithCoupon },
    { name: 'Без купона', value: metrics.revenueWithoutCoupon }
  ];

  const registeredVsGuestData = [
    { name: 'Зарегистрированные', value: metrics.registeredClients },
    { name: 'Гости', value: metrics.guestClients }
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal revenue-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        
        <div className="revenue-analytics-header">
          <h2>Детальная аналитика выручки</h2>
          <div className="period-badge">{periodLabel}</div>
        </div>

        <div className="revenue-analytics-content">
          {/* Main Sales Metrics */}
          <section className="analytics-section">
            <h3>Основные метрики продаж</h3>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">Общая выручка</div>
                <div className="metric-value">{rub(metrics.totalRevenue)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Количество проданных товаров</div>
                <div className="metric-value">{metrics.totalUnitsSold}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Количество заказов</div>
                <div className="metric-value">{metrics.totalOrders}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Средний чек</div>
                <div className="metric-value">{rub(metrics.averageOrderValue)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Средняя цена товара</div>
                <div className="metric-value">{rub(metrics.averageSellingPrice)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Рост выручки</div>
                <div className={`metric-value ${metrics.revenueGrowthRate >= 0 ? 'positive' : 'negative'}`}>
                  {metrics.revenueGrowthRate >= 0 ? '+' : ''}{metrics.revenueGrowthRate.toFixed(1)}%
                </div>
              </div>
            </div>
          </section>

          {/* Product Metrics */}
          <section className="analytics-section">
            <h3>Метрики по товарам</h3>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">Самый популярный товар</div>
                <div className="metric-value-small">
                  {metrics.topProduct ? metrics.topProduct.name : 'Нет данных'}
                </div>
                {metrics.topProduct && (
                  <div className="metric-details">
                    Продано: {metrics.topProduct.quantity} | Выручка: {rub(metrics.topProduct.revenue)}
                  </div>
                )}
              </div>
              <div className="metric-card">
                <div className="metric-label">Наименее популярный товар</div>
                <div className="metric-value-small">
                  {metrics.leastProduct ? metrics.leastProduct.name : 'Нет данных'}
                </div>
                {metrics.leastProduct && (
                  <div className="metric-details">
                    Продано: {metrics.leastProduct.quantity} | Выручка: {rub(metrics.leastProduct.revenue)}
                  </div>
                )}
              </div>
              <div className="metric-card">
                <div className="metric-label">Среднее количество на клиента</div>
                <div className="metric-value">{metrics.avgUnitsPerCustomer.toFixed(1)}</div>
              </div>
            </div>

            {topProductsChart.length > 0 && (
              <div className="chart-container">
                <h4>Продажи по товарам (ТОП-10)</h4>
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
                    <Bar dataKey="revenue" fill="#8b7fb8" name="Выручка" />
                    <Bar dataKey="quantity" fill="#a092d1" name="Количество" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Coupon Metrics */}
          <section className="analytics-section">
            <h3> Метрики по купонам и скидкам</h3>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">Покупок с купоном</div>
                <div className="metric-value">{metrics.ordersWithCoupon}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Покупок без купона</div>
                <div className="metric-value">{metrics.ordersWithoutCoupon}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Выручка с купоном</div>
                <div className="metric-value">{rub(metrics.revenueWithCoupon)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Выручка без купона</div>
                <div className="metric-value">{rub(metrics.revenueWithoutCoupon)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Средний размер скидки</div>
                <div className="metric-value">{rub(metrics.avgDiscountAmount)}</div>
              </div>
            </div>

            <div className="chart-container">
              <h4>Выручка: с купоном vs без купона</h4>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={couponRevenueData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {couponRevenueData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => rub(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Client Metrics */}
          <section className="analytics-section">
            <h3> Метрики по клиентам</h3>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">Уникальных клиентов</div>
                <div className="metric-value">{metrics.uniqueCustomers}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Новых клиентов</div>
                <div className="metric-value">{metrics.newCustomers}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Повторных покупок</div>
                <div className="metric-value">{metrics.repeatCustomers}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Средняя выручка на клиента</div>
                <div className="metric-value">{rub(metrics.revenuePerCustomer)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">% Зарегистрированных</div>
                <div className="metric-value">{metrics.registeredPercentage.toFixed(1)}%</div>
              </div>
            </div>

            <div className="chart-container">
              <h4>Зарегистрированные vs Гости</h4>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={registeredVsGuestData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {registeredVsGuestData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Time-based Metrics */}
          <section className="analytics-section">
            <h3> Временные метрики</h3>
            {metrics.dailyChartData.length > 0 && (
              <div className="chart-container">
                <h4>Выручка по дням</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={metrics.dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip 
                      formatter={(value, name, props) => {
                        // Format revenue with rubles, orders as plain number
                        return props.dataKey === 'revenue' ? rub(value) : value;
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" stroke="#8b7fb8" name="Выручка" />
                    <Line type="monotone" dataKey="orders" stroke="#a092d1" name="Заказы" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {metrics.weeklyChartData.length > 0 && (
              <div className="chart-container">
                <h4>Выручка по дням недели</h4>
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
                    <Bar dataKey="revenue" fill="#8b7fb8" name="Выручка" />
                    <Bar dataKey="orders" fill="#a092d1" name="Заказы" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Additional Metrics */}
          <section className="analytics-section">
            <h3> Дополнительные метрики</h3>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">Среднее количество товаров в заказе</div>
                <div className="metric-value">{metrics.avgItemsPerOrder.toFixed(1)}</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
