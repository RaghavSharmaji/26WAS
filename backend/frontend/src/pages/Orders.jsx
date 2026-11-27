
import { useState, useEffect, useCallback } from "react";
import {
  Search,
  ShoppingCart,
  Clock,
  PackageCheck,
  Truck,
  X,
  Eye,
} from "lucide-react";

import "./Orders.css";
import api, { getApiError } from "../api";

function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [selectedOrder, setSelectedOrder] = useState(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/order");
      const rows = data.data || data.allOrder || [];
      setOrders(rows.map((order) => ({
        id: order._id,
        customer: order.customerId?.name || "—",
        date: new Date(order.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
        items: Array.isArray(order.items) ? order.items.length : 0,
        amount: order.amount == null ? null : Number(order.amount),
        status: ({ create: "Pending", pending: "Pending", processing: "Processing", shipped: "Shipped", delivered: "Delivered" })[String(order.status || "pending").toLowerCase()] || "Pending",
      })));
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const totalOrders = orders.length;
  const pendingOrders = orders.filter(
    (order) => order.status === "Pending"
  ).length;
  const processingOrders = orders.filter(
    (order) => order.status === "Processing"
  ).length;
  const deliveredOrders = orders.filter(
    (order) => order.status === "Delivered"
  ).length;

  const filteredOrders = orders.filter((order) => {
    const query = search.trim().toLowerCase();

    const matchesSearch =
      order.id.toLowerCase().includes(query) ||
      order.customer.toLowerCase().includes(query);

    const matchesFilter =
      filter === "All" || order.status === filter;

    return matchesSearch && matchesFilter;
  });

  const formatAmount = (amount) => amount == null ? "—" :
    amount.toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    });

  const updateStatus = async (orderId, newStatus) => {
    setError("");
    try {
      await api.put(`/order/${orderId}/status`, { status: newStatus });
      setSelectedOrder((previousOrder) => previousOrder ? { ...previousOrder, status: newStatus } : null);
      await loadOrders();
    } catch (requestError) { setError(getApiError(requestError)); }
  };

  return (
    <section className="orders-page">
      <div className="orders-heading">
        <div>
          <h1>Order Management</h1>
          <p>Track and manage your warehouse orders.</p>
        </div>
      </div>

      {error && <div className="data-error" role="alert">{error}</div>}

      {/* ORDER SUMMARY */}
      <div className="orders-stats">
        <div className="order-stat-card">
          <div className="order-stat-icon blue">
            <ShoppingCart size={22} />
          </div>
          <p>Total Orders</p>
          <h2>{totalOrders}</h2>
        </div>

        <div className="order-stat-card">
          <div className="order-stat-icon orange">
            <Clock size={22} />
          </div>
          <p>Pending</p>
          <h2>{pendingOrders}</h2>
        </div>

        <div className="order-stat-card">
          <div className="order-stat-icon purple">
            <PackageCheck size={22} />
          </div>
          <p>Processing</p>
          <h2>{processingOrders}</h2>
        </div>

        <div className="order-stat-card">
          <div className="order-stat-icon green">
            <Truck size={22} />
          </div>
          <p>Delivered</p>
          <h2>{deliveredOrders}</h2>
        </div>
      </div>

      {/* ORDERS TABLE */}
      <div className="panel orders-management">
        <div className="orders-toolbar">
          <div>
            <h3>All Orders</h3>
            <p>View and manage customer orders.</p>
          </div>

          <div className="orders-search">
            <Search size={17} />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order or customer..."
            />
          </div>
        </div>

        {/* FILTERS */}
        <div className="orders-filters">
          {[
            "All",
            "Pending",
            "Processing",
            "Shipped",
            "Delivered",
          ].map((status) => (
            <button
              type="button"
              key={status}
              className={filter === status ? "selected" : ""}
              onClick={() => setFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>

        {/* TABLE */}
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ORDER ID</th>
                <th>CUSTOMER</th>
                <th>DATE</th>
                <th>ITEMS</th>
                <th>AMOUNT</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>

            <tbody>
              {loading ? <tr><td colSpan="7" className="orders-empty">Loading orders…</td></tr> : filteredOrders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.id}</strong>
                  </td>

                  <td>{order.customer}</td>
                  <td>{order.date}</td>
                  <td>{order.items}</td>
                  <td>
                    <strong>{formatAmount(order.amount)}</strong>
                  </td>

                  <td>
                    <span
                      className={`order-status ${order.status
                        .toLowerCase()
                        .replaceAll(" ", "-")}`}
                    >
                      {order.status}
                    </span>
                  </td>

                  <td>
                    <button
                      type="button"
                      className="view-order-btn"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <Eye size={15} />
                      View
                    </button>
                  </td>
                </tr>
              ))}

              {!loading && filteredOrders.length === 0 && (
                <tr>
                  <td colSpan="7" className="orders-empty">
                    No orders found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ORDER DETAILS MODAL */}
      {selectedOrder && (
        <div
          className="order-modal-overlay"
          onClick={() => setSelectedOrder(null)}
        >
          <div
            className="order-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="order-modal-close"
              onClick={() => setSelectedOrder(null)}
            >
              <X size={20} />
            </button>

            <h2>Order Details</h2>
            <p className="order-modal-subtitle">
              Information about {selectedOrder.id}
            </p>

            <div className="order-detail-row">
              <span>Order ID</span>
              <strong>{selectedOrder.id}</strong>
            </div>

            <div className="order-detail-row">
              <span>Customer</span>
              <strong>{selectedOrder.customer}</strong>
            </div>

            <div className="order-detail-row">
              <span>Order Date</span>
              <strong>{selectedOrder.date}</strong>
            </div>

            <div className="order-detail-row">
              <span>Items</span>
              <strong>{selectedOrder.items}</strong>
            </div>

            <div className="order-detail-row">
              <span>Total Amount</span>
              <strong>{formatAmount(selectedOrder.amount)}</strong>
            </div>

            <div className="order-detail-row">
              <span>Current Status</span>
              <strong>{selectedOrder.status}</strong>
            </div>

            <label htmlFor="order-status-select">
              Update Order Status
            </label>

            <select
              id="order-status-select"
              value={selectedOrder.status}
              onChange={(event) =>
                updateStatus(selectedOrder.id, event.target.value)
              }
            >
              <option value="Pending">Pending</option>
              <option value="Processing">Processing</option>
              <option value="Shipped">Shipped</option>
              <option value="Delivered">Delivered</option>
            </select>

            <button
              type="button"
              className="order-done-btn"
              onClick={() => setSelectedOrder(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default Orders;
