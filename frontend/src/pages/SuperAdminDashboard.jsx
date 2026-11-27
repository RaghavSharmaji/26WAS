import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard, Users, Package, Boxes, ShoppingCart, Warehouse, Truck,
  BarChart3, Activity, Settings, LogOut, Search, ChevronLeft, ChevronRight,
  Eye, Pencil, UserPlus, ShieldCheck, RefreshCw, X, KeyRound, UserCheck, UserX, Trash2, Building2
} from 'lucide-react';
import api, { getApiError } from '../api';
import './SuperAdminDashboard.css';

const navItems = [
  ['overview', 'Overview', LayoutDashboard], ['companies', 'Companies', Building2], ['users', 'All Users', Users],
  ['products', 'Products Monitoring', Package], ['inventory', 'Inventory Monitoring', Boxes],
  ['orders', 'Orders Monitoring', ShoppingCart], ['warehouses', 'Warehouses', Warehouse],
  ['suppliers', 'Suppliers', Truck], ['reports', 'Global Reports', BarChart3],
  ['activity', 'Activity Logs', Activity], ['settings', 'Admin Settings', Settings],
];

const userTabs = ['Overview', 'Products', 'Inventory', 'Orders', 'Categories', 'Suppliers', 'Warehouses', 'Locations', 'Reports', 'Recent Activity'];
const resourceForTab = { Products: 'products', Inventory: 'inventory', Orders: 'orders', Categories: 'categories', Suppliers: 'suppliers', Warehouses: 'warehouses', Locations: 'locations', Reports: 'reports', 'Recent Activity': 'activity' };
const statsLabels = [
  ['totalUsers', 'Registered users', Users], ['activeUsers', 'Active users', UserCheck],
  ['inactiveUsers', 'Inactive users', UserX], ['productCount', 'Products', Package],
  ['inventoryUnits', 'Inventory units', Boxes], ['orderCount', 'Orders', ShoppingCart],
  ['warehouseCount', 'Warehouses', Warehouse], ['supplierCount', 'Suppliers', Truck],
  ['lowStockProducts', 'Low stock products', BarChart3],
];

function dateText(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-IN');
}

function displayValue(value) {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? `${value.length} items` : '—';
  if (typeof value === 'object') return value.name || value.email || value._id || '—';
  return String(value);
}

function TrendChart({ title, values = [], color = '#3478ed' }) {
  const rows = values.filter((item) => Number.isFinite(Number(item.count)));
  const max = Math.max(1, ...rows.map((item) => Number(item.count)));
  const points = rows.map((item, index) => `${rows.length < 2 ? 50 : 24 + (index * 452) / (rows.length - 1)},${136 - (Number(item.count) / max) * 112}`).join(' ');
  return <section className="sa-panel sa-chart-panel">
    <div className="sa-panel-heading"><div><h3>{title}</h3><p>Monthly totals from stored records</p></div></div>
    {rows.length ? <><svg className="sa-line-chart" viewBox="0 0 500 160" role="img" aria-label={title}>
      {[24, 60, 96, 136].map((y) => <line key={y} x1="20" y1={y} x2="480" y2={y} stroke="#e9edf3" strokeWidth="1" />)}
      <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {rows.map((item, index) => <circle key={item._id} cx={rows.length < 2 ? 250 : 24 + (index * 452) / (rows.length - 1)} cy={136 - (Number(item.count) / max) * 112} r="4" fill={color}><title>{`${item._id}: ${item.count}`}</title></circle>)}
    </svg><div className="sa-chart-labels"><span>{rows[0]._id}</span><span>{rows[rows.length - 1]._id}</span></div></> : <div className="sa-empty">No records in this period yet.</div>}
  </section>;
}

function Overview({ onOpenUsers }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const { data } = await api.get('/admin/overview'); setOverview(data.data); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const stats = overview?.stats || {};
  return <div className="sa-content">
    <div className="sa-heading"><div><p className="sa-eyebrow">SYSTEM CONTROL</p><h1>Super Admin Overview</h1><p>Live totals across WareFlow accounts and warehouse records.</p></div><button className="sa-secondary" onClick={load}><RefreshCw size={16} /> Refresh</button></div>
    {error && <div className="sa-error" role="alert">{error}</div>}
    <div className="sa-stat-grid">{statsLabels.map(([key, label, Icon]) => <button type="button" className="sa-stat-card" key={key} onClick={key === 'totalUsers' ? onOpenUsers : undefined}><span className="sa-stat-icon"><Icon size={20} /></span><span className="sa-stat-label">{label}</span><strong>{loading ? '…' : Number(stats[key] || 0).toLocaleString('en-IN')}</strong></button>)}</div>
    <div className="sa-chart-grid">
      <TrendChart title="User registration trends" values={overview?.trends?.users} />
      <TrendChart title="User activity" values={overview?.trends?.activity} color="#20a66b" />
      <TrendChart title="Products added over time" values={overview?.trends?.products} color="#8b67d9" />
      <TrendChart title="Orders across WareFlow" values={overview?.trends?.orders} color="#df8c28" />
    </div>
    <section className="sa-panel"><div className="sa-panel-heading"><div><h3>Inventory distribution</h3><p>Available units grouped by department</p></div></div>
      {overview?.inventoryDistribution?.length ? <div className="sa-distribution">{overview.inventoryDistribution.slice(0, 10).map((row) => { const total = Math.max(1, ...overview.inventoryDistribution.map((item) => item.units)); return <div className="sa-distribution-row" key={row.department}><div><span>{row.department}</span><strong>{Number(row.units).toLocaleString('en-IN')} units · {row.users} users</strong></div><div className="sa-track"><span style={{ width: `${Math.max(2, (row.units / total) * 100)}%` }} /></div></div>; })}</div> : <div className="sa-empty">No inventory records yet.</div>}
    </section>
  </div>;
}

function CompanyManagement() {
  const [companies, setCompanies] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [reason, setReason] = useState('');
  const [reviewStatus, setReviewStatus] = useState('all');
  const [application, setApplication] = useState(null);
  const [loadingApplication, setLoadingApplication] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/admin/companies', { params: { page, limit: 25, search, status, reviewStatus } });
      setCompanies(data.data || []);
      setPagination(data.pagination || { page, pages: 1, total: 0 });
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, [page, search, status, reviewStatus]);

  useEffect(() => { load(); }, [load]);

  const activate = async (event) => {
    event.preventDefault();
    if (!selectedCompany) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/admin/companies/${selectedCompany.id}/activate`, { reason });
      setNotice(data.message || `${selectedCompany.name} was activated.`);
      setSelectedCompany(null);
      setReason('');
      await load();
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSaving(false);
    }
  };

  const openApplication = async (company) => {
    setError(''); setNotice(''); setReason(''); setApplication(null); setSelectedCompany(company); setLoadingApplication(true);
    try {
      const { data } = await api.get(`/admin/companies/${company.id}/registration`);
      setApplication(data.data);
    } catch (requestError) { setApplication(null); setError(getApiError(requestError)); }
    finally { setLoadingApplication(false); }
  };

  const reviewApplication = async (statusValue) => {
    if (!selectedCompany || !reason.trim()) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const { data } = await api.post(`/admin/companies/${selectedCompany.id}/registration/review`, { status: statusValue, reason });
      setNotice(data.message || `Application marked ${statusValue}.`);
      setSelectedCompany(null); setApplication(null); setReason(''); await load();
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setSaving(false); }
  };

  return <div className="sa-content">
    <div className="sa-heading"><div><p className="sa-eyebrow">TENANT ADMINISTRATION</p><h1>Companies</h1><p>{pagination.total} companies · Activate pending tenants after review.</p></div><button className="sa-secondary" type="button" onClick={load} disabled={loading}><RefreshCw size={16} /> Refresh</button></div>
    {error && <div className="sa-error" role="alert">{error}</div>}
    {notice && <div className="sa-notice" role="status">{notice}</div>}
    <section className="sa-panel">
      <div className="sa-toolbar"><label className="sa-search"><Search size={17} /><input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Search company name, code, or email" /></label>
        <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} aria-label="Filter companies by status"><option value="all">All company statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deactivated">Deactivated</option></select>
        <select value={reviewStatus} onChange={(event) => { setPage(1); setReviewStatus(event.target.value); }} aria-label="Filter application review status"><option value="all">All application statuses</option><option value="pending">Application pending</option><option value="under_review">Under review</option><option value="verified">Verified</option><option value="rejected">Rejected</option></select>
      </div>
      <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Company</th><th>Company code</th><th>Contact</th><th>Status</th><th>Application</th><th>Created</th><th>Actions</th></tr></thead><tbody>
        {companies.map((company) => <tr key={company.id}><td><strong>{company.name}</strong>{company.legalBusinessName && <small className="sa-company-detail">{company.legalBusinessName}</small>}<small className="sa-company-detail">ID: {company.id}</small></td><td>{company.slug}</td><td>{company.email || '—'}{company.phone && <small className="sa-company-detail">{company.phone}</small>}</td><td><span className={`sa-status ${company.status}`}>{company.status}</span></td><td>{company.registration ? <><span className={`sa-status ${company.registration.status}`}>{company.registration.status}</span><small className="sa-company-detail">{company.registration.reference}</small></> : 'Legacy company'}</td><td>{dateText(company.createdAt)}</td><td>{company.registration ? <button type="button" className="sa-primary" onClick={() => openApplication(company)}><UserCheck size={15} /> Review application</button> : company.status === 'pending' ? <button type="button" className="sa-primary" onClick={() => { setSelectedCompany(company); setApplication(null); setReason(''); setError(''); }}><UserCheck size={15} /> Review &amp; activate</button> : <span className="sa-muted">No action</span>}</td></tr>)}
        {!loading && !companies.length && <tr><td colSpan="7" className="sa-empty">No companies match these filters.</td></tr>}
        {loading && <tr><td colSpan="7" className="sa-empty">Loading companies…</td></tr>}
      </tbody></table></div>
      <div className="sa-pagination"><span>Page {pagination.page || page} of {Math.max(1, pagination.pages || 1)}</span><div><button type="button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><button type="button" aria-label="Next page" disabled={page >= (pagination.pages || 1) || loading} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div></div>
    </section>
    {selectedCompany && <div className="sa-overlay" onClick={() => !saving && (setSelectedCompany(null), setApplication(null))}><form className="sa-modal" onClick={(event) => event.stopPropagation()} onSubmit={application ? (event) => { event.preventDefault(); reviewApplication('under_review'); } : selectedCompany.registration ? (event) => event.preventDefault() : activate}>
      <div className="sa-modal-heading"><div><h2>{application ? 'Review company application' : 'Activate company?'}</h2><p>{application ? 'Review the submitted details. Verification and activation are separate audited steps.' : 'Activation lets this company’s existing active Company Admin select its workspace.'}</p></div><button type="button" aria-label="Close" disabled={saving} onClick={() => { setSelectedCompany(null); setApplication(null); }}><X size={19} /></button></div>
      {selectedCompany.registration && !application && <><p>{loadingApplication ? 'Loading application details…' : 'Could not load the private application details.'}</p>{error && <div className="sa-error" role="alert">{error}</div>}<div className="sa-modal-actions"><button type="button" className="sa-secondary" onClick={() => { setSelectedCompany(null); setError(''); }}>Close</button></div></>}
      {application && <>
        <div className="sa-company-review"><strong>Application {application.registration.reference}</strong><span>Review status: <b>{application.registration.status}</b> · Email verification: {application.registration.emailVerificationStatus}</span><span>Administrator: {application.registration.administrator?.name} · {application.registration.administrator?.designation}</span><span>{application.registration.administrator?.email} · {application.registration.administrator?.phone}</span><span>Business: {application.registration.businessType} · {application.registration.company?.industry || selectedCompany.industry}</span><span>Location: {application.registration.city}, {application.registration.state}, {application.registration.country} · {application.registration.postalCode}</span><span>Warehouse estimate: {application.registration.warehouseRequirements?.expectedWarehouses} warehouses, {application.registration.warehouseRequirements?.approximateSkus} SKUs, {application.registration.warehouseRequirements?.monthlyOrders} monthly orders, {application.registration.warehouseRequirements?.employees} employees</span><span>Optional identifiers: GSTIN {application.registration.gstin || '—'} · PAN {application.registration.pan || '—'} · CIN/LLPIN {application.registration.cin || '—'} · Registration no. {application.registration.businessRegistrationNumber || '—'}</span><span>Terms {application.registration.acceptance?.termsVersion} / Privacy {application.registration.acceptance?.privacyVersion} accepted {dateText(application.registration.acceptance?.acceptedAt)}</span></div>
        <label>Review reason<textarea required maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record what was reviewed or what needs follow-up" /></label>
        {error && <div className="sa-error" role="alert">{error}</div>}
        <div className="sa-modal-actions"><button type="button" className="sa-secondary" disabled={saving} onClick={() => { setSelectedCompany(null); setApplication(null); }}>Close</button><button type="button" className="sa-secondary" disabled={saving || !reason.trim() || !['pending', 'under_review'].includes(application.registration.status)} onClick={() => reviewApplication('rejected')}>Reject</button><button type="button" className="sa-secondary" disabled={saving || !reason.trim() || application.registration.status !== 'pending'} onClick={() => reviewApplication('under_review')}>Mark under review</button><button type="button" className="sa-primary" disabled={saving || !reason.trim() || !['pending', 'under_review'].includes(application.registration.status)} onClick={() => reviewApplication('verified')}>Verify information</button><button type="button" className="sa-primary" disabled={saving || !reason.trim() || application.registration.status !== 'verified'} onClick={() => { setSelectedCompany(selectedCompany); setApplication(null); }}>Continue to activation</button></div>
      </>}
      {!application && !selectedCompany.registration && <>
      <div className="sa-company-review"><strong>{selectedCompany.name}</strong><span>{selectedCompany.legalBusinessName || selectedCompany.slug}</span><span>{selectedCompany.email || 'No company email on file'}</span><span>Current status: <b>{selectedCompany.status}</b></span></div>
      <label>Activation reason<textarea required maxLength={500} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record why this company is being activated" /></label>
      {error && <div className="sa-error" role="alert">{error}</div>}
      <div className="sa-modal-actions"><button type="button" className="sa-secondary" disabled={saving} onClick={() => setSelectedCompany(null)}>Cancel</button><button type="submit" className="sa-primary" disabled={saving || !reason.trim()}>{saving ? 'Activating…' : 'Confirm activation'}</button></div>
      </>}
    </form></div>}
  </div>;
}

function UserManagement({ onSelectUser }) {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('date');
  const [direction, setDirection] = useState('desc');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', accountStatus: 'active' });

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get('/admin/users', { params: { page, limit: 20, search, status, sort, direction } });
      setRows(data.data); setPagination(data.pagination);
    } catch (requestError) { setError(getApiError(requestError)); }
  }, [page, search, status, sort, direction]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm({ name: '', email: '', phone: '', password: '', accountStatus: 'active' }); setModal({ type: 'create' }); };
  const openEdit = (user) => { setForm({ name: user.name, email: user.email, phone: user.phone, accountStatus: user.accountStatus === 'deleted' ? undefined : user.accountStatus }); setModal({ type: 'edit', user }); };
  const openReset = (user) => { setForm({ password: '' }); setModal({ type: 'reset', user }); };

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if (modal.type === 'create') await api.post('/admin/users', form);
      if (modal.type === 'edit') await api.patch(`/admin/users/${modal.user.id}`, form);
      if (modal.type === 'reset') await api.post(`/admin/users/${modal.user.id}/reset-password`, { password: form.password });
      setModal(null); await load();
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setSaving(false); }
  };

  const setAccountStatus = async (user) => {
    if (user.accountStatus === 'deleted') return;
    const next = user.accountStatus === 'active' ? 'inactive' : 'active';
    try { await api.patch(`/admin/users/${user.id}`, { accountStatus: next }); await load(); }
    catch (requestError) { setError(getApiError(requestError)); }
  };
  const removeUser = async (user) => {
    if (!window.confirm(`Mark ${user.name}'s account as deleted? Their warehouse records will be preserved for audit and recovery.`)) return;
    try { await api.delete(`/admin/users/${user.id}`); await load(); }
    catch (requestError) { setError(getApiError(requestError)); }
  };

  return <div className="sa-content">
    <div className="sa-heading"><div><p className="sa-eyebrow">ACCOUNT ADMINISTRATION</p><h1>All Users</h1><p>{pagination.total} registered accounts</p></div><button className="sa-primary" onClick={openCreate}><UserPlus size={17} /> Create user</button></div>
    {error && <div className="sa-error" role="alert">{error}</div>}
    <section className="sa-panel">
      <div className="sa-toolbar"><label className="sa-search"><Search size={17} /><input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Search name, email or user ID" /></label>
        <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="all">All account states</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="deleted">Deleted</option></select>
        <select value={`${sort}:${direction}`} onChange={(event) => { const [nextSort, nextDirection] = event.target.value.split(':'); setSort(nextSort); setDirection(nextDirection); }}><option value="date:desc">Newest registrations</option><option value="date:asc">Oldest registrations</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="email:asc">Email A–Z</option><option value="lastLoginAt:desc">Most recently active</option></select>
      </div>
      <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>User ID</th><th>User</th><th>Phone</th><th>Registered</th><th>Status</th><th>Products</th><th>Inventory</th><th>Orders</th><th>Warehouses</th><th>Actions</th></tr></thead><tbody>
        {rows.map((user) => <tr key={user.id}><td className="sa-id">{user.id}</td><td><button className="sa-user-link" onClick={() => onSelectUser(user)}><strong>{user.name}</strong><small>{user.email}</small></button></td><td>{user.phone || '—'}</td><td>{dateText(user.registeredAt)}</td><td><span className={`sa-status ${user.accountStatus}`}>{user.accountStatus}</span></td><td>{user.stats.products}</td><td>{Number(user.stats.inventoryUnits).toLocaleString('en-IN')}</td><td>{user.stats.orders}</td><td>{user.stats.warehouses}</td><td><div className="sa-actions">
          <button title="View account" onClick={() => onSelectUser(user)}><Eye size={15} /></button><button title="Edit account" onClick={() => openEdit(user)}><Pencil size={15} /></button>{user.accountStatus !== 'deleted' && <><button title="Reset password" onClick={() => openReset(user)}><KeyRound size={15} /></button><button title={user.accountStatus === 'active' ? 'Deactivate' : 'Activate'} onClick={() => setAccountStatus(user)}>{user.accountStatus === 'active' ? <UserX size={15} /> : <UserCheck size={15} />}</button><button title="Soft-delete account" onClick={() => removeUser(user)}><Trash2 size={15} /></button></>}
        </div></td></tr>)}
        {!rows.length && <tr><td colSpan="10" className="sa-empty">No users match these filters.</td></tr>}
      </tbody></table></div>
      <div className="sa-pagination"><span>Page {pagination.page || page} of {Math.max(1, pagination.pages || 1)}</span><div><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><button disabled={page >= (pagination.pages || 1)} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div></div>
    </section>
    {modal && <div className="sa-overlay" onClick={() => setModal(null)}><form className="sa-modal" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
      <div className="sa-modal-heading"><div><h2>{modal.type === 'create' ? 'Create user account' : modal.type === 'edit' ? 'Edit user' : 'Reset user password'}</h2><p>{modal.type === 'reset' ? 'The user must change this temporary password after signing in.' : 'New accounts are always created as normal users.'}</p></div><button type="button" onClick={() => setModal(null)}><X size={19} /></button></div>
      {modal.type !== 'reset' ? <><label>Full name<input required minLength="2" maxLength="80" value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Email<input required type="email" value={form.email || ''} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Phone<input maxLength="40" value={form.phone || ''} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>{modal.type === 'edit' && modal.user.accountStatus !== 'deleted' && <label>Account status<select value={form.accountStatus} onChange={(event) => setForm({ ...form, accountStatus: event.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>}{modal.type === 'create' && <label>Temporary password<input required type="password" minLength="12" maxLength="128" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>}</> : <label>Temporary password<input required autoComplete="new-password" type="password" minLength="12" maxLength="128" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>}
      <div className="sa-modal-actions"><button type="button" className="sa-secondary" onClick={() => setModal(null)}>Cancel</button><button className="sa-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
    </form></div>}
  </div>;
}

function UserDetails({ user: initialUser, onBack, onViewDashboard }) {
  const [user, setUser] = useState(initialUser);
  const [tab, setTab] = useState('Overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState('');
  useEffect(() => { api.get(`/admin/users/${user.id}`).then(({ data: result }) => setUser(result.data)).catch((requestError) => setError(getApiError(requestError))); }, [user.id]);
  const loadTab = useCallback(async () => {
    if (tab === 'Overview') { setData(user.stats); return; }
    setLoading(true); setError('');
    try { const { data: result } = await api.get(`/admin/users/${user.id}/data/${resourceForTab[tab]}`); setData(result.data); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); }
  }, [tab, user.id, user.stats]);
  useEffect(() => { loadTab(); }, [loadTab]);
  const resetPassword = async (event) => {
    event.preventDefault();
    try { await api.post(`/admin/users/${user.id}/reset-password`, { password }); setResetOpen(false); setPassword(''); setError('Password reset. User will be required to change it at next sign-in.'); }
    catch (requestError) { setError(getApiError(requestError)); }
  };

  return <div className="sa-content">
    <div className="sa-heading"><div><button className="sa-back-link" onClick={onBack}><ChevronLeft size={17} /> All users</button><p className="sa-eyebrow">USER MANAGEMENT</p><h1>{user.name}</h1><p>{user.email} · <span className={`sa-status ${user.accountStatus}`}>{user.accountStatus}</span></p><p className="sa-muted">Summary covers {user.companies?.length ? `${user.companies.length} active compan${user.companies.length === 1 ? 'y' : 'ies'}: ${user.companies.map(company => company.name).join(', ')}` : 'legacy records owned by this user only'}.</p></div><div className="sa-heading-actions">{user.accountStatus !== 'deleted' && <button className="sa-secondary" onClick={() => setResetOpen(true)}><KeyRound size={16} /> Reset password</button>}<button className="sa-primary" onClick={() => onViewDashboard(user)}><Eye size={16} /> View User Dashboard</button></div></div>
    {error && <div className="sa-error" role="alert">{error}</div>}
    <div className="sa-user-tabs">{userTabs.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === 'Overview' ? <div className="sa-user-overview">
      <section className="sa-panel sa-profile-card"><div className="sa-avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><h2>{user.name}</h2><p>{user.email}</p><p>{user.phone || 'No phone on record'}</p><span className={`sa-status ${user.accountStatus}`}>{user.accountStatus}</span></div></section>
      <div className="sa-stat-grid sa-user-stat-grid">{Object.entries(user.stats || {}).map(([key, value]) => <div className="sa-stat-card" key={key}><span className="sa-stat-label">{key.replaceAll(/([A-Z])/g, ' $1')}</span><strong>{Number(value || 0).toLocaleString('en-IN')}</strong></div>)}</div>
      <section className="sa-panel sa-profile-facts"><div><span>User ID</span><strong>{user.id}</strong></div><div><span>Registered</span><strong>{dateText(user.registeredAt)}</strong></div><div><span>Last sign-in</span><strong>{dateText(user.lastLoginAt)}</strong></div><div><span>Account state</span><strong>{user.accountStatus}</strong></div></section>
    </div> : <DataView tab={tab} data={data} loading={loading} userId={user.id} />}
    {resetOpen && <div className="sa-overlay"><form className="sa-modal" onSubmit={resetPassword}><div className="sa-modal-heading"><div><h2>Reset password</h2><p>Temporary password is hashed and never returned by the API.</p></div><button type="button" onClick={() => setResetOpen(false)}><X size={19} /></button></div><label>Temporary password<input required type="password" minLength="12" maxLength="128" value={password} onChange={(event) => setPassword(event.target.value)} /></label><div className="sa-modal-actions"><button type="button" className="sa-secondary" onClick={() => setResetOpen(false)}>Cancel</button><button className="sa-primary">Reset password</button></div></form></div>}
  </div>;
}

function DataView({ tab, data, loading }) {
  if (loading) return <div className="sa-panel sa-empty">Loading {tab.toLowerCase()}…</div>;
  if (tab === 'Reports') return <div className="sa-stat-grid">{Object.entries(data || {}).map(([key, value]) => <div className="sa-stat-card" key={key}><span className="sa-stat-label">{key.replaceAll(/([A-Z])/g, ' $1')}</span><strong>{Number(value || 0).toLocaleString('en-IN')}</strong></div>)}</div>;
  if (tab === 'Recent Activity') return <ActivityList events={data || []} />;
  const fields = {
    Products: [['name', 'Product'], ['skuNumber', 'SKU'], ['department', 'Department'], ['price', 'Price'], ['reorderLevel', 'Reorder level'], ['date', 'Added']],
    Inventory: [['skuNumber', 'SKU'], ['item', 'Product'], ['availableQuantity', 'Available units'], ['palletCount', 'Pallets']],
    Orders: [['_id', 'Order ID'], ['status', 'Status'], ['items', 'Lines'], ['date', 'Date']],
    Categories: [['name', 'Category'], ['description', 'Description'], ['createdAt', 'Created']],
    Suppliers: [['name', 'Supplier'], ['contactName', 'Contact'], ['email', 'Email'], ['phone', 'Phone'], ['active', 'Active']],
    Warehouses: [['name', 'Warehouse'], ['code', 'Code'], ['address', 'Address'], ['active', 'Active']],
    Locations: [['fullName', 'Location'], ['warehouse', 'Warehouse ID'], ['zone', 'Zone'], ['row', 'Row'], ['location', 'Position'], ['level', 'Level'], ['status', 'Status']],
  }[tab] || [];
  return <section className="sa-panel"><div className="sa-table-wrap"><table className="sa-table"><thead><tr>{fields.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{(data || []).map((record, index) => <tr key={record._id || index}>{fields.map(([key]) => <td key={key}>{key === 'date' || key === 'createdAt' ? dateText(record[key]) : displayValue(record[key])}</td>)}</tr>)}{!data?.length && <tr><td colSpan={fields.length} className="sa-empty">No records for this user.</td></tr>}</tbody></table></div></section>;
}

function ActivityList({ events }) {
  return <section className="sa-panel sa-activity-list">{events.length ? events.map((event, index) => <div className="sa-activity-row" key={`${event.type}-${event.at}-${index}`}><span className="sa-activity-dot" /><div><strong>{event.message}</strong><small>{event.type} · {dateText(event.at)}</small></div></div>) : <div className="sa-empty">No activity records found.</div>}</section>;
}

function UserDashboardPreview({ user, onReturn }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/admin/users/${user.id}/dashboard`).then(({ data }) => setPreview(data.data)).catch((requestError) => setError(getApiError(requestError))); }, [user.id]);
  return <div className="sa-content">
    <div className="sa-readonly-banner"><ShieldCheck size={19} /><div><strong>Read-only Super Admin view</strong><span>You are viewing {user.name}'s warehouse summary across {(preview?.companies || []).map(company => company.name).join(', ') || 'legacy records owned by this user'}. No account switching or data edits are enabled here.</span></div><button onClick={onReturn}>Return to user details</button></div>
    <div className="sa-heading"><div><p className="sa-eyebrow">VIEWING USER ACCOUNT</p><h1>{user.name}'s Dashboard</h1><p>{user.email}</p></div></div>
    {error && <div className="sa-error" role="alert">{error}</div>}
    <div className="sa-stat-grid">{Object.entries(preview?.stats || {}).map(([key, value]) => <div className="sa-stat-card" key={key}><span className="sa-stat-label">{key.replaceAll(/([A-Z])/g, ' $1')}</span><strong>{Number(value || 0).toLocaleString('en-IN')}</strong></div>)}</div>
    <div className="sa-preview-grid"><section className="sa-panel"><h3>Low-stock alerts</h3>{(preview?.lowStock || []).map((row) => <div className="sa-activity-row" key={row.item._id}><div><strong>{row.item.name} · {row.item.skuNumber}</strong><small>{row.availableQuantity} available · reorder at {row.item.reorderLevel}</small></div></div>)}{preview && !preview.lowStock.length && <div className="sa-empty">No low-stock alerts.</div>}</section><section className="sa-panel"><h3>Recent activity</h3><ActivityList events={preview?.recentActivity || []} /></section></div>
    <section className="sa-panel"><h3>Recent products</h3><DataView tab="Products" data={preview?.products || []} /></section>
    <section className="sa-panel"><h3>Inventory overview</h3><DataView tab="Inventory" data={preview?.inventory || []} /></section>
    <section className="sa-panel"><h3>Recent orders</h3><DataView tab="Orders" data={preview?.orders || []} /></section>
  </div>;
}

function MonitorSection({ resource, title }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/admin/monitor/${resource}`).then(({ data }) => setRows(data.data)).catch((requestError) => setError(getApiError(requestError))); }, [resource]);
  const visible = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search.toLowerCase()));
  const keys = resource === 'products' ? ['ownerId', 'name', 'skuNumber', 'department', 'price', 'reorderLevel', 'date']
    : resource === 'inventory' ? ['ownerId', 'item', 'skuNumber', 'availableQuantity', 'palletCount']
      : resource === 'orders' ? ['ownerId', '_id', 'status', 'items', 'date']
        : resource === 'warehouses' ? ['ownerId', 'name', 'code', 'address', 'active']
          : ['ownerId', 'name', 'email', 'contactName', 'phone', 'active'];
  return <div className="sa-content"><div className="sa-heading"><div><p className="sa-eyebrow">GLOBAL MONITORING</p><h1>{title}</h1><p>{rows.length} records across all accounts</p></div><label className="sa-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter visible records" /></label></div>
    {error && <div className="sa-error">{error}</div>}<section className="sa-panel"><div className="sa-table-wrap"><table className="sa-table"><thead><tr>{keys.map((key) => <th key={key}>{key === 'ownerId' ? 'User' : key}</th>)}</tr></thead><tbody>{visible.map((row, index) => <tr key={row._id || index}>{keys.map((key) => <td key={key}>{key === 'date' ? dateText(row[key]) : displayValue(row[key])}</td>)}</tr>)}{!visible.length && <tr><td colSpan={keys.length} className="sa-empty">No records found.</td></tr>}</tbody></table></div></section>
  </div>;
}

function GlobalActivity() {
  const [events, setEvents] = useState([]); const [users, setUsers] = useState([]); const [filters, setFilters] = useState({ userId: '', type: '', from: '', to: '' }); const [error, setError] = useState('');
  useEffect(() => { api.get('/admin/users', { params: { limit: 100, status: 'all' } }).then(({ data }) => setUsers(data.data)).catch(() => {}); }, []);
  const load = useCallback(async () => { setError(''); try { const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value)); const { data } = await api.get('/admin/activity', { params }); setEvents(data.data); } catch (requestError) { setError(getApiError(requestError)); } }, [filters]);
  useEffect(() => { load(); }, [load]);
  return <div className="sa-content"><div className="sa-heading"><div><p className="sa-eyebrow">SYSTEM AUDIT</p><h1>Activity Logs</h1><p>Registrations, product additions, orders, inventory changes, sign-ins, and admin actions.</p></div><button className="sa-secondary" onClick={load}><RefreshCw size={16} /> Refresh</button></div>
    <div className="sa-filter-row"><select value={filters.userId} onChange={(event) => setFilters({ ...filters, userId: event.target.value })}><option value="">All users</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select><select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">All activity</option><option value="user.registered">Registrations</option><option value="user.login">Sign-ins</option><option value="product.created">Products</option><option value="order.created">Orders</option><option value="inventory.stock-in">Manual stock-in</option><option value="inventory.receipt">Goods receipts</option><option value="inventory.quarantine">Quarantine</option><option value="inventory.putaway">Putaway</option><option value="inventory.reserve">Reservations</option><option value="inventory.pick">Picking</option><option value="inventory.release">Released stock</option><option value="inventory.dispatch">Dispatches</option><option value="inventory.stock-out">Legacy stock-out</option><option value="inventory.adjustment">Stock adjustments</option><option value="admin.action">Admin actions</option></select><label>From<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label><label>To<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label></div>
    {error && <div className="sa-error">{error}</div>}<ActivityList events={events} />
  </div>;
}

function SuperAdminDashboard({ user, onLogout }) {
  const [section, setSection] = useState('overview');
  const [selectedUser, setSelectedUser] = useState(null);
  const [viewingUser, setViewingUser] = useState(null);
  const [userDetailsKey, setUserDetailsKey] = useState(0);
  const sectionTitle = navItems.find(([key]) => key === section)?.[1] || 'Overview';
  return <div className="sa-layout">
    <aside className="sa-sidebar"><div className="sa-brand"><span><Warehouse size={22} /></span><div><strong>WareFlow</strong><small>SUPER ADMIN</small></div></div><p className="sa-nav-label">ADMIN CONSOLE</p><nav>{navItems.map(([key, label, Icon]) => <button key={key} className={!selectedUser && !viewingUser && section === key ? 'active' : ''} onClick={() => { setSelectedUser(null); setViewingUser(null); setSection(key); }}><Icon size={18} /><span>{label}</span></button>)}</nav><div className="sa-sidebar-bottom"><div className="sa-admin-profile"><span className="sa-avatar-small">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>Super Admin</small></div></div><button className="sa-logout" onClick={onLogout}><LogOut size={17} /> Logout</button></div></aside>
    <main className="sa-main"><header className="sa-topbar"><div><span>WareFlow</span><ChevronRight size={15} /><strong>{viewingUser ? 'Read-only user view' : selectedUser ? selectedUser.name : sectionTitle}</strong></div><span className="sa-secure-badge"><ShieldCheck size={15} /> Protected admin session</span></header>
      {viewingUser ? <UserDashboardPreview user={viewingUser} onReturn={() => setViewingUser(null)} />
        : selectedUser ? <UserDetails key={`${selectedUser.id}-${userDetailsKey}`} user={selectedUser} onBack={() => { setSelectedUser(null); setSection('users'); }} onViewDashboard={setViewingUser} />
          : section === 'overview' ? <Overview onOpenUsers={() => setSection('users')} />
            : section === 'companies' ? <CompanyManagement />
            : section === 'users' ? <UserManagement onSelectUser={(item) => { setSelectedUser(item); setUserDetailsKey((value) => value + 1); }} />
              : ['products', 'inventory', 'orders', 'warehouses', 'suppliers'].includes(section) ? <MonitorSection resource={section} title={sectionTitle} />
                : section === 'reports' ? <div className="sa-content"><div className="sa-heading"><div><p className="sa-eyebrow">GLOBAL REPORTING</p><h1>Global Reports</h1><p>Detailed platform-wide report exports are not available yet.</p></div></div><section className="sa-panel"><div className="sa-empty">System-wide live statistics are available on Overview. Company operational reports are available in the company Reports page to users with the required permission.</div></section></div>
                  : section === 'activity' ? <GlobalActivity />
                    : <AdminSettings user={user} />}
    </main>
  </div>;
}

function AdminSettings({ user }) {
  return <div className="sa-content"><div className="sa-heading"><div><p className="sa-eyebrow">SUPER ADMIN ACCOUNT</p><h1>Admin Settings</h1><p>Credential values stay on the backend and are not returned to this page.</p></div></div><section className="sa-panel sa-settings-card"><ShieldCheck size={24} /><div><h2>{user.name}</h2><p>{user.email}</p><span className="sa-status active">Super Admin account active</span><div className="sa-settings-note"><strong>Credential update procedure</strong><ol><li>Change <code>SUPER_ADMIN_PASSWORD</code> in <code>backend/.env</code>.</li><li>From the backend folder, run <code>npm run superadmin:reset-password</code>.</li><li>Sign in again with the new password.</li></ol></div></div></section></div>;
}

export default SuperAdminDashboard;
