import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X, Package, TrendingUp, AlertTriangle, Boxes, Warehouse } from 'lucide-react';
import api, { getApiError } from '../api';
import './OtherPages.css';

const pageConfig = {
  Categories: {
    endpoint: '/categories', icon: Package, description: 'Organize and manage your product categories.',
    fields: [{ key: 'name', label: 'Category Name' }, { key: 'description', label: 'Description' }, { key: 'status', label: 'Status', type: 'status' }],
  },
  Suppliers: {
    endpoint: '/suppliers', icon: Package, description: 'Manage your suppliers and their contact information.',
    fields: [{ key: 'name', label: 'Supplier Name' }, { key: 'contactName', label: 'Contact Person' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'status', label: 'Status', type: 'status' }],
  },
  Warehouses: {
    endpoint: '/warehouses', icon: Warehouse, description: 'View and manage your warehouse facilities.',
    fields: [{ key: 'name', label: 'Warehouse Name' }, { key: 'code', label: 'Code' }, { key: 'address', label: 'Address' }, { key: 'status', label: 'Status', type: 'status' }],
  },
  Locations: {
    endpoint: '/locations', icon: Warehouse, description: 'Manage storage zones and locations inside warehouses.',
    fields: [{ key: 'fullName', label: 'Location ID' }, { key: 'warehouse', label: 'Warehouse', type: 'warehouse' }, { key: 'zone', label: 'Zone' }, { key: 'row', label: 'Row', type: 'number' }, { key: 'location', label: 'Position', type: 'number' }, { key: 'level', label: 'Level', type: 'number' }, { key: 'status', label: 'Status', type: 'status' }],
  },
};

function displayRecord(page, item) {
  if (page === 'Categories') return { ...item, status: 'Active' };
  if (page === 'Suppliers' || page === 'Warehouses') return { ...item, status: item.active === false ? 'Inactive' : 'Active' };
  if (page === 'Locations') {
    const statusMap = { empty: 'Available', occupied: 'Occupied', upcoming: 'Upcoming', maintenance: 'Maintenance' };
    return { ...item, status: statusMap[item.status] || 'Available' };
  }
  return item;
}

function apiPayload(page, values) {
  if (page === 'Categories') return { name: values.name, description: values.description || '' };
  if (page === 'Suppliers') return { name: values.name, contactName: values.contactName, email: values.email, phone: values.phone, active: values.status !== 'Inactive' };
  if (page === 'Warehouses') return { name: values.name, code: values.code, address: values.address, active: values.status !== 'Inactive' };
  const statusMap = { Available: 'empty', Occupied: 'occupied', Upcoming: 'upcoming', Maintenance: 'maintenance' };
  return { fullName: values.fullName, warehouse: values.warehouse || undefined, zone: values.zone, row: Number(values.row), location: Number(values.location), level: Number(values.level), status: statusMap[values.status] || 'empty' };
}

function ReportsPage() {
  const [summary, setSummary] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api.get('/reports/summary'), api.get('/reports/low-stock')])
      .then(([summaryResponse, lowStockResponse]) => {
        setSummary(summaryResponse.data.data);
        setLowStock(lowStockResponse.data.data);
      })
      .catch((requestError) => setError(getApiError(requestError)))
      .finally(() => setLoading(false));
  }, []);

  const reports = [
    { title: 'Total Products', value: summary?.productCount ?? '—', icon: Package, note: 'Products in database' },
    { title: 'Total Stock Units', value: summary?.totalAvailableQuantity?.toLocaleString('en-IN') ?? '—', icon: Boxes, note: 'Available units' },
    { title: 'Low Stock Items', value: lowStock.length || 0, icon: AlertTriangle, note: 'At or below reorder level' },
    { title: 'Total Warehouses', value: summary?.warehouseCount ?? '—', icon: Warehouse, note: 'Registered facilities' },
  ];

  return <div className="management-page">
    <div className="management-heading"><div><h1>Reports &amp; Analytics</h1><p>Live summary from your warehouse database.</p></div></div>
    {error && <div className="data-error" role="alert">{error}</div>}
    <div className="management-stats">{reports.map((item) => { const Icon = item.icon; return <div className="management-stat" key={item.title}><div className="management-stat-icon"><Icon size={21} /></div><div><p>{item.title}</p><h2>{loading ? '…' : item.value}</h2><span>{item.note}</span></div></div>; })}</div>
    <div className="report-grid">
      <div className="report-panel"><h3>Inventory Movements</h3><p className="report-subtitle">Recorded stock activity</p>
        {['stockIn', 'stockOut', 'adjustments'].map((key) => <div className="report-overview-row" key={key}><span>{key === 'stockIn' ? 'Stock received' : key === 'stockOut' ? 'Stock shipped' : 'Stock adjustments'}</span><strong>{summary?.[key]?.count ?? 0} events · {summary?.[key]?.quantity ?? 0} units</strong></div>)}
      </div>
      <div className="report-panel"><h3>Low Stock Products</h3><p className="report-subtitle">Compared with configured reorder levels</p>
        {lowStock.slice(0, 6).map((row) => <div className="report-overview-row" key={row.item._id}><span>{row.item.name} ({row.item.skuNumber})</span><strong>{row.availableQuantity} / {row.item.reorderLevel}</strong></div>)}
        {!loading && lowStock.length === 0 && <div className="report-overview-row"><span>No products currently need attention.</span><strong>—</strong></div>}
      </div>
    </div>
  </div>;
}

function OtherPages({ activePage, user }) {
  if (activePage === 'Reports') return <ReportsPage />;
  const config = pageConfig[activePage];
  const [records, setRecords] = useState([]);
  const [warehouseOptions, setWarehouseOptions] = useState([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadRecords = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    setError('');
    try {
      if (activePage === 'Locations') {
        const [locationsResponse, warehousesResponse] = await Promise.all([api.get(config.endpoint), api.get('/warehouses')]);
        setWarehouseOptions(warehousesResponse.data.data);
        setRecords(locationsResponse.data.data.map((item) => displayRecord(activePage, { ...item, warehouse: item.warehouse ? String(item.warehouse) : '' })));
      } else {
        const { data } = await api.get(config.endpoint);
        setRecords(data.data.map((item) => displayRecord(activePage, item)));
      }
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); }
  }, [activePage, config]);

  useEffect(() => { loadRecords(); }, [loadRecords]);
  if (!config) return null;

  const Icon = config.icon;
  const fields = config.fields;
  const filteredRecords = records.filter((record) => fields.some((field) => String(record[field.key] ?? '').toLowerCase().includes(search.toLowerCase())));
  const activeCount = records.filter((record) => ['Active', 'Available', 'Occupied'].includes(record.status)).length;
  const openAddModal = () => {
    setEditing(null);
      setFormData(Object.fromEntries(fields.map((field) => [field.key, field.key === 'status' ? (activePage === 'Locations' ? 'Available' : 'Active') : ''])));
    setModalOpen(true);
  };
  const openEditModal = (record) => { setEditing(record); setFormData(Object.fromEntries(fields.map((field) => [field.key, record[field.key] ?? '']))); setModalOpen(true); };

  const saveRecord = async (event) => {
    event.preventDefault();
    const firstField = fields[0];
    if (!String(formData[firstField.key] ?? '').trim()) { setError(`${firstField.label} is required.`); return; }
    setSaving(true);
    setError('');
    try {
      const payload = apiPayload(activePage, formData);
      if (editing) await api.put(`${config.endpoint}/${editing._id}`, payload);
      else await api.post(config.endpoint, payload);
      setModalOpen(false);
      await loadRecords();
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setSaving(false); }
  };

  const deleteRecord = async (id) => {
    if (!window.confirm(`Delete this ${activePage.slice(0, -1).toLowerCase()}?`)) return;
    setError('');
    try { await api.delete(`${config.endpoint}/${id}`); await loadRecords(); }
    catch (requestError) { setError(getApiError(requestError)); }
  };

  return <div className="management-page">
    <div className="management-heading"><div><h1>{activePage}</h1><p>{config.description}</p></div><button className="management-primary-btn" onClick={openAddModal}><Plus size={18} /> Add {activePage.slice(0, -1)}</button></div>
    {error && <div className="data-error" role="alert">{error}</div>}
    <div className="management-stats">
      <div className="management-stat"><div className="management-stat-icon"><Icon size={21} /></div><div><p>Total {activePage}</p><h2>{records.length}</h2><span>From database</span></div></div>
      <div className="management-stat"><div className="management-stat-icon"><TrendingUp size={21} /></div><div><p>Active / Available</p><h2>{activeCount}</h2><span>Currently active</span></div></div>
      <div className="management-stat"><div className="management-stat-icon"><Package size={21} /></div><div><p>Other Records</p><h2>{records.length - activeCount}</h2><span>Inactive or other status</span></div></div>
    </div>
    <div className="management-table-card">
      <div className="management-table-heading"><div><h3>All {activePage}</h3><p>View, search, edit and manage database records.</p></div><div className="management-search"><Search size={17} /><input placeholder={`Search ${activePage.toLowerCase()}...`} value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
      <div className="management-table-wrap"><table className="management-table"><thead><tr>{fields.map((field) => <th key={field.key}>{field.label}</th>)}<th>Actions</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={fields.length + 1} className="management-empty">Loading…</td></tr> : filteredRecords.length ? filteredRecords.map((record) => <tr key={record._id}>{fields.map((field) => <td key={field.key}>{field.type === 'status' ? <span className={`management-status ${String(record[field.key]).toLowerCase().replaceAll(' ', '-')}`}>{record[field.key]}</span> : field.type === 'warehouse' ? warehouseOptions.find((warehouse) => warehouse._id === record.warehouse)?.name || '—' : record[field.key] || '—'}</td>)}<td><div className="management-actions"><button title="Edit" onClick={() => openEditModal(record)}><Pencil size={16} /></button>{user?.role === 'admin' && <button title="Delete" onClick={() => deleteRecord(record._id)}><Trash2 size={16} /></button>}</div></td></tr>) : <tr><td colSpan={fields.length + 1} className="management-empty">No records found.</td></tr>}</tbody>
      </table></div><div className="management-table-footer">Showing {filteredRecords.length} of {records.length} records</div>
    </div>
    {modalOpen && <div className="management-modal-overlay" onClick={() => setModalOpen(false)}><div className="management-modal" onClick={(event) => event.stopPropagation()}>
      <div className="management-modal-heading"><div><h2>{editing ? 'Edit' : 'Add'} {activePage.slice(0, -1)}</h2><p>Enter the details below.</p></div><button className="management-close" onClick={() => setModalOpen(false)}><X size={20} /></button></div>
      <form onSubmit={saveRecord}>{fields.map((field) => <label className="management-form-field" key={field.key}><span>{field.label}</span>{field.type === 'status' ? <select value={formData[field.key] || ''} onChange={(event) => setFormData({ ...formData, [field.key]: event.target.value })}>{(activePage === 'Locations' ? ['Available', 'Occupied', 'Upcoming', 'Maintenance'] : ['Active', 'Inactive']).map((status) => <option key={status}>{status}</option>)}</select> : field.type === 'warehouse' ? <select value={formData[field.key] || ''} onChange={(event) => setFormData({ ...formData, [field.key]: event.target.value })}><option value="">No warehouse assigned</option>{warehouseOptions.map((warehouse) => <option key={warehouse._id} value={warehouse._id}>{warehouse.name}</option>)}</select> : <input type={field.type || 'text'} min={field.type === 'number' ? 0 : undefined} required={field === fields[0] || field.type === 'number'} value={formData[field.key] || ''} onChange={(event) => setFormData({ ...formData, [field.key]: event.target.value })} placeholder={`Enter ${field.label.toLowerCase()}`} />}</label>)}
        <div className="management-modal-actions"><button type="button" className="management-cancel-btn" onClick={() => setModalOpen(false)}>Cancel</button><button type="submit" className="management-primary-btn" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Record'}</button></div>
      </form>
    </div></div>}
  </div>;
}

export default OtherPages;
