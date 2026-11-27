import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Truck, PackageCheck, ClipboardList, Users, RefreshCw, Eye } from "lucide-react";
import api, { getApiError } from "../api";
import "./Orders.css";

const newKey = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const statusLabel = (value) => String(value || "draft").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function Orders({ permissions = [] }) {
  const [tab, setTab] = useState("orders");
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [pickers, setPickers] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [customerForm, setCustomerForm] = useState({ name: "", contactPerson: "", phone: "", email: "", address: "" });
  const [orderForm, setOrderForm] = useState({ customerId: "", warehouseId: localStorage.getItem("wms.activeWarehouseId") || "", expectedDeliveryAt: "", notes: "", lines: [{ productId: "", quantity: 1 }] });
  const [pickValues, setPickValues] = useState({});
  const [packageWeight, setPackageWeight] = useState("");
  const [packageNotes, setPackageNotes] = useState("");
  const [pickerId, setPickerId] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [deliveredTo, setDeliveredTo] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const can = (permission) => permissions.includes(permission);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [orderResult, customerResult, productResult, warehouseResult, shipmentResult] = await Promise.all([
        api.get("/order"), api.get("/customers"), api.get("/products"), api.get("/warehouses"), api.get("/shipments").catch(() => ({ data: { data: [] } }))
      ]);
      const orderRows = orderResult.data.data || orderResult.data.allOrder || [];
      setOrders(orderRows);
      setCustomers(customerResult.data.data || []);
      setProducts(productResult.data.data || []);
      setWarehouses(warehouseResult.data.data || []);
      setShipments(shipmentResult.data.data || []);
      setOrderForm((previous) => ({ ...previous,
        customerId: previous.customerId || customerResult.data.data?.[0]?._id || "",
        warehouseId: previous.warehouseId || localStorage.getItem("wms.activeWarehouseId") || warehouseResult.data.data?.[0]?._id || ""
      }));
      setSelected((previous) => {
        if (!previous) return null;
        return orderRows.find((row) => row._id === previous._id) || null;
      });
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected?.warehouseId || !can('picking.assign')) return;
    api.get(`/order/pickers?warehouseId=${selected.warehouseId}`)
      .then(({ data }) => setPickers(data.data || []))
      .catch((requestError) => setError(getApiError(requestError)));
  }, [selected?._id, selected?.warehouseId, permissions]);

  const filteredOrders = useMemo(() => orders.filter((order) => {
    const term = search.trim().toLowerCase();
    const matches = !term || [order.reference, order._id, order.customer?.name, order.status].some((value) => String(value || "").toLowerCase().includes(term));
    return matches && (filter === "all" || order.status === filter);
  }), [orders, search, filter]);

  const run = async (action, successMessage) => {
    setSaving(true); setError(""); setNotice("");
    try { await action(); setNotice(successMessage); await load(); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setSaving(false); }
  };

  const createCustomer = (event) => {
    event.preventDefault();
    return run(async () => { await api.post("/customers", customerForm); setCustomerForm({ name: "", contactPerson: "", phone: "", email: "", address: "" }); }, "Customer created.");
  };

  const createOrder = (event) => {
    event.preventDefault();
    const lines = orderForm.lines.filter((line) => line.productId).map((line) => ({ productId: line.productId, quantity: Number(line.quantity) }));
    return run(async () => {
      const { data } = await api.post("/order", { ...orderForm, lines });
      setSelected(data.data); setTab("orders");
      setOrderForm((previous) => ({ ...previous, notes: "", expectedDeliveryAt: "", lines: [{ productId: "", quantity: 1 }] }));
    }, "Sales order created as a draft.");
  };

  const refreshOrder = async () => {
    if (!selected?._id) return;
    const { data } = await api.get(`/order/${selected._id}`);
    setSelected(data.data);
  };

  const action = (callback, message) => run(async () => { await callback(); await refreshOrder(); }, message);
  const revisionBody = { expectedRevision: Number(selected?.revision || 0) };

  const submit = () => action(() => api.post(`/order/${selected._id}/submit`, revisionBody), "Order submitted.");
  const reserve = () => action(() => api.post(`/order/${selected._id}/reserve`, revisionBody, { headers: { "Idempotency-Key": newKey("reserve") } }), "Inventory reservation recorded.");
  const assign = () => action(() => api.post(`/order/${selected._id}/picking/assign`, { ...revisionBody, userId: pickerId }), "Picker assigned.");
  const confirmPick = () => action(() => api.post(`/order/${selected._id}/picking/confirm`, {
    ...revisionBody, complete: true,
    lines: (selected.lines || []).map((line) => ({ orderLineId: line._id, pickedQuantity: Number(pickValues[line._id] ?? line.pickedQuantity ?? 0) }))
  }), "Picking confirmed. Any short quantity was released back to available stock.");
  const pack = () => action(() => api.post(`/order/${selected._id}/packing`, {
    ...revisionBody,
    packages: [{ weight: packageWeight || null, notes: packageNotes, lines: (selected.lines || []).filter((line) => Number(line.pickedQuantity) > 0).map((line) => ({ orderLineId: line._id, quantity: Number(line.pickedQuantity) })) }]
  }, { headers: { "Idempotency-Key": newKey("pack") } }), "Package recorded.");
  const dispatch = () => {
    if (!window.confirm("Confirm dispatch? This deducts physical inventory once.")) return;
    return action(() => api.post(`/order/${selected._id}/dispatch`, { ...revisionBody, carrier, trackingNumber }, { headers: { "Idempotency-Key": newKey("dispatch") } }), "Shipment dispatched.");
  };
  const deliver = () => action(() => api.post(`/order/${selected._id}/delivery`, { deliveredTo, deliveryNotes }), "Delivery confirmed. Inventory was not deducted again.");
  const cancel = () => {
    if (!window.confirm("Cancel this order and release its reservation/picked stock?")) return;
    return action(() => api.post(`/order/${selected._id}/cancel`, { ...revisionBody, reason: cancelReason }), "Order cancelled and remaining stock released.");
  };

  const addOrderLine = () => setOrderForm((previous) => ({ ...previous, lines: [...previous.lines, { productId: "", quantity: 1 }] }));
  const updateOrderLine = (index, field, value) => setOrderForm((previous) => ({ ...previous, lines: previous.lines.map((line, i) => i === index ? { ...line, [field]: value } : line) }));

  return <section className="orders-page">
    <div className="orders-heading">
      <div><h1>Outbound Orders</h1><p>Manage customer orders from reservation through delivery.</p></div>
      <button type="button" className="view-order-btn" disabled={loading} onClick={load}><RefreshCw size={15} /> Refresh</button>
    </div>
    {error && <div className="data-error" role="alert">{error}</div>}
    {notice && <div className="data-success" role="status">{notice}</div>}

    <div className="orders-filters">
      {[['orders', 'Sales Orders'], ['customers', 'Customers'], ['shipments', 'Shipments']].map(([value, label]) => <button type="button" key={value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{label}</button>)}
    </div>

    {tab === 'orders' && <>
      {can('orders.create') && <form className="panel outbound-form" onSubmit={createOrder}>
        <h3>Create Sales Order</h3>
        <div className="outbound-form-grid">
          <label>Customer<select required value={orderForm.customerId} onChange={(event) => setOrderForm({ ...orderForm, customerId: event.target.value })}><option value="">Select customer</option>{customers.filter((row) => row.active).map((row) => <option key={row._id} value={row._id}>{row.name}</option>)}</select></label>
          <label>Warehouse<select required value={orderForm.warehouseId} onChange={(event) => setOrderForm({ ...orderForm, warehouseId: event.target.value })}><option value="">Select warehouse</option>{warehouses.map((row) => <option key={row._id} value={row._id}>{row.name}</option>)}</select></label>
          <label>Expected delivery<input type="date" value={orderForm.expectedDeliveryAt} onChange={(event) => setOrderForm({ ...orderForm, expectedDeliveryAt: event.target.value })} /></label>
        </div>
        <div className="outbound-lines">
          {orderForm.lines.map((line, index) => <div className="outbound-line" key={index}>
            <select required value={line.productId} onChange={(event) => updateOrderLine(index, 'productId', event.target.value)}><option value="">Select product / SKU</option>{products.map((product) => <option key={product._id} value={product._id}>{product.name} · {product.skuNumber}</option>)}</select>
            <input aria-label="Ordered quantity" type="number" min="1" step="1" required value={line.quantity} onChange={(event) => updateOrderLine(index, 'quantity', event.target.value)} />
            {orderForm.lines.length > 1 && <button type="button" onClick={() => setOrderForm((previous) => ({ ...previous, lines: previous.lines.filter((_, i) => i !== index) }))}>Remove</button>}
          </div>)}
          <button type="button" className="view-order-btn" onClick={addOrderLine}>Add product line</button>
        </div>
        <label className="outbound-notes">Notes<textarea maxLength="1000" value={orderForm.notes} onChange={(event) => setOrderForm({ ...orderForm, notes: event.target.value })} /></label>
        <button className="outbound-primary" disabled={saving || !customers.length || !products.length || !warehouses.length}>Create draft</button>
      </form>}

      <div className="panel orders-management">
        <div className="orders-toolbar"><div><h3>Sales Orders</h3><p>{orders.length} orders in this company context.</p></div><div className="orders-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, reference, customer..." /></div></div>
        <div className="orders-filters"><select aria-label="Filter by order status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option>{['draft','submitted','partially_reserved','reserved','picking','picked','packed','dispatched','delivered','cancelled','create','plash'].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></div>
        <div className="table-wrapper"><table><thead><tr><th>REFERENCE</th><th>CUSTOMER</th><th>WAREHOUSE</th><th>LINES</th><th>STATUS</th><th>DATE</th><th>ACTION</th></tr></thead><tbody>
          {loading ? <tr><td colSpan="7" className="orders-empty">Loading orders…</td></tr> : filteredOrders.map((order) => <tr key={order._id}><td><strong>{order.reference || order._id}</strong></td><td>{order.customer?.name || 'Legacy order'}</td><td>{warehouses.find((row) => String(row._id) === String(order.warehouseId))?.name || '—'}</td><td>{order.lines?.length || order.items?.length || 0}</td><td><span className={`order-status ${String(order.status).toLowerCase()}`}>{statusLabel(order.status)}</span></td><td>{order.date ? new Date(order.date).toLocaleDateString() : '—'}</td><td><button type="button" className="view-order-btn" onClick={() => setSelected(order)}><Eye size={15} /> Workflow</button></td></tr>)}
          {!loading && !filteredOrders.length && <tr><td colSpan="7" className="orders-empty">No orders match these filters.</td></tr>}
        </tbody></table></div>
      </div>
    </>}

    {tab === 'customers' && <div className="outbound-two-column">
      {can('customers.create') && <form className="panel outbound-form" onSubmit={createCustomer}><h3>Add Customer</h3>
        <label>Name<input required minLength="2" maxLength="160" value={customerForm.name} onChange={(event) => setCustomerForm({ ...customerForm, name: event.target.value })} /></label>
        <label>Contact person<input maxLength="160" value={customerForm.contactPerson} onChange={(event) => setCustomerForm({ ...customerForm, contactPerson: event.target.value })} /></label>
        <label>Phone<input maxLength="40" value={customerForm.phone} onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })} /></label>
        <label>Email<input type="email" maxLength="254" value={customerForm.email} onChange={(event) => setCustomerForm({ ...customerForm, email: event.target.value })} /></label>
        <label>Address<textarea maxLength="1000" value={customerForm.address} onChange={(event) => setCustomerForm({ ...customerForm, address: event.target.value })} /></label>
        <button className="outbound-primary" disabled={saving}>Save customer</button>
      </form>}
      <div className="panel orders-management"><h3><Users size={17} /> Customers</h3><div className="table-wrapper"><table><thead><tr><th>NAME</th><th>CONTACT</th><th>PHONE</th><th>EMAIL</th><th>STATUS</th>{can('customers.update') && <th>ACTION</th>}</tr></thead><tbody>{customers.map((customer) => <tr key={customer._id}><td>{customer.name}</td><td>{customer.contactPerson || '—'}</td><td>{customer.phone || '—'}</td><td>{customer.email || '—'}</td><td>{customer.active ? 'Active' : 'Inactive'}</td>{can('customers.update') && <td><button type="button" className="view-order-btn" disabled={saving} onClick={() => run(() => api.put(`/customers/${customer._id}`, { active: !customer.active }), `Customer ${customer.active ? 'deactivated' : 'activated'}.`)}>{customer.active ? 'Deactivate' : 'Activate'}</button></td>}</tr>)}{!customers.length && <tr><td colSpan={can('customers.update') ? '6' : '5'} className="orders-empty">No customers yet.</td></tr>}</tbody></table></div></div>
    </div>}

    {tab === 'shipments' && <div className="panel orders-management"><h3><Truck size={17} /> Shipments</h3><div className="table-wrapper"><table><thead><tr><th>SHIPMENT</th><th>ORDER</th><th>CARRIER</th><th>TRACKING</th><th>DISPATCHED</th><th>STATUS</th></tr></thead><tbody>{shipments.map((shipment) => <tr key={shipment._id}><td>{shipment.reference}</td><td>{orders.find((row) => row._id === shipment.orderId)?.reference || shipment.orderId}</td><td>{shipment.carrier || '—'}</td><td>{shipment.trackingNumber || '—'}</td><td>{shipment.dispatchedAt ? new Date(shipment.dispatchedAt).toLocaleString() : '—'}</td><td>{statusLabel(shipment.status)}</td></tr>)}{!shipments.length && <tr><td colSpan="6" className="orders-empty">No shipments have been dispatched.</td></tr>}</tbody></table></div></div>}

    {selected && <div className="order-modal-overlay" onClick={() => setSelected(null)}><div className="order-modal outbound-detail" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="order-modal-close" onClick={() => setSelected(null)}>×</button>
      <h2>{selected.reference || 'Legacy order'}</h2><p className="order-modal-subtitle">{selected.customer?.name || selected.customerId || 'Customer not linked'} · {warehouses.find((row) => String(row._id) === String(selected.warehouseId))?.name || 'Warehouse not set'}</p>
      <div className="order-detail-row"><span>Status</span><strong>{statusLabel(selected.status)}</strong></div>
      <div className="table-wrapper"><table><thead><tr><th>SKU / PRODUCT</th><th>ORDERED</th><th>RESERVED</th><th>PICKED</th><th>PACKED</th></tr></thead><tbody>{(selected.lines || []).map((line) => <tr key={line._id}><td>{line.productName} · {line.skuNumber}</td><td>{line.orderedQuantity}</td><td>{line.reservedQuantity || 0}</td><td>{line.pickedQuantity || 0}</td><td>{line.packedQuantity || 0}</td></tr>)}</tbody></table></div>
      {selected.status === 'draft' && can('orders.submit') && <button className="outbound-primary" disabled={saving} onClick={submit}>Submit order</button>}
      {['submitted','partially_reserved'].includes(selected.status) && can('inventory.reserve') && <button className="outbound-primary" disabled={saving} onClick={reserve}>Reserve available stock</button>}
      {['reserved','partially_reserved','picking'].includes(selected.status) && can('picking.assign') && <div className="outbound-action"><label>Assign picker<select value={pickerId} onChange={(event) => setPickerId(event.target.value)}><option value="">Choose picker</option>{pickers.map((person) => <option key={person._id} value={person._id}>{person.name} · {person.email}</option>)}</select></label><button type="button" disabled={saving || !pickerId} onClick={assign}>Assign</button></div>}
      {['reserved','partially_reserved','picking'].includes(selected.status) && can('picking.execute') && <div className="outbound-action"><h3><ClipboardList size={17} /> Confirm picked quantities</h3>{(selected.lines || []).map((line) => <label key={line._id}>{line.productName} · {line.skuNumber} (reserved {line.reservedQuantity || 0})<small>{(line.allocations || []).map((allocation) => `${allocation.location || 'Bin'} · ${allocation.reservedQuantity} units`).join(' | ')}</small><input type="number" min={line.pickedQuantity || 0} max={line.reservedQuantity || 0} step="1" value={pickValues[line._id] ?? line.pickedQuantity ?? 0} onChange={(event) => setPickValues({ ...pickValues, [line._id]: event.target.value })} /></label>)}<button type="button" disabled={saving} onClick={confirmPick}>Complete pick</button></div>}
      {selected.status === 'picked' && can('packing.execute') && <div className="outbound-action"><h3><PackageCheck size={17} /> Pack picked goods</h3><label>Package weight (optional)<input type="number" min="0" step="0.01" value={packageWeight} onChange={(event) => setPackageWeight(event.target.value)} /></label><label>Packing notes<textarea value={packageNotes} maxLength="500" onChange={(event) => setPackageNotes(event.target.value)} /></label><button type="button" disabled={saving} onClick={pack}>Create package and mark packed</button></div>}
      {selected.status === 'packed' && can('shipping.execute') && <div className="outbound-action"><h3><Truck size={17} /> Dispatch shipment</h3><label>Carrier<input maxLength="120" value={carrier} onChange={(event) => setCarrier(event.target.value)} /></label><label>Tracking number<input maxLength="160" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} /></label><button type="button" disabled={saving} onClick={dispatch}>Confirm dispatch</button></div>}
      {selected.status === 'dispatched' && can('shipping.execute') && <div className="outbound-action"><h3>Confirm delivery</h3><label>Recipient<input maxLength="160" value={deliveredTo} onChange={(event) => setDeliveredTo(event.target.value)} /></label><label>Delivery notes<textarea maxLength="1000" value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} /></label><button type="button" disabled={saving} onClick={deliver}>Mark delivered</button></div>}
      {!['cancelled','dispatched','delivered'].includes(selected.status) && can('orders.cancel') && <div className="outbound-action"><label>Cancellation reason<input minLength="3" maxLength="500" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label><button type="button" disabled={saving || cancelReason.trim().length < 3} onClick={cancel}>Cancel and release stock</button></div>}
      <button type="button" className="order-done-btn" onClick={() => setSelected(null)}>Close</button>
    </div></div>}
  </section>;
}

export default Orders;
