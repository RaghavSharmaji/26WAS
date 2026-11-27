import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, RefreshCw, Send } from 'lucide-react';
import api, { getApiError } from '../api';
import './Receiving.css';

const emptyLine = () => ({ productId: '', orderedQuantity: '', unitCost: '0' });

export default function PurchaseOrders({ permissions = [] }) {
  const canCreate = permissions.includes('purchaseOrders.create');
  const canUpdate = permissions.includes('purchaseOrders.update');
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState(localStorage.getItem('wms.activeWarehouseId') || '');
  const [lines, setLines] = useState([emptyLine()]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [poResponse, referenceResponse, warehouseResponse] = await Promise.all([
        api.get('/purchase-orders'), api.get('/purchase-orders/references'), api.get('/warehouses')
      ]);
      setRows(poResponse.data.data || []);
      setSuppliers(referenceResponse.data.data.suppliers || []);
      setProducts(referenceResponse.data.data.products || []);
      setWarehouses(warehouseResponse.data.data || []);
      setSelectedId((current) => current || poResponse.data.data?.[0]?._id || '');
    } catch (requestError) { setError(getApiError(requestError)); }
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    try { const { data } = await api.get(`/purchase-orders/${id}`); setDetail(data.data); }
    catch (requestError) { setError(getApiError(requestError)); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);

  const create = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const payload = { supplierId, warehouseId, notes, lines: lines.map((line) => ({ productId: line.productId, orderedQuantity: Number(line.orderedQuantity), unitCost: Number(line.unitCost) })) };
      const { data } = await api.post('/purchase-orders', payload);
      setNotice(`Draft ${data.data.reference} created. It has not changed inventory.`);
      setLines([emptyLine()]); setNotes(''); await load(); setSelectedId(data.data._id);
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!detail) return;
    setBusy(true); setError('');
    try { await api.post(`/purchase-orders/${detail._id}/submit`, { expectedRevision: detail.revision }); setNotice('Purchase order submitted for receiving.'); await load(); await loadDetail(detail._id); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  };

  return <section className="receiving-page">
    <div className="receiving-heading"><div><h1>Purchase Orders</h1><p>Create supplier orders and track ordered, received, and remaining quantities. Creating a PO never adds inventory.</p></div><button className="receiving-refresh" type="button" onClick={load}><RefreshCw size={16}/>Refresh</button></div>
    {error && <div className="data-error" role="alert">{error}</div>}{notice && <div className="receiving-success" role="status">{notice}</div>}
    {canCreate && <form className="receiving-card" onSubmit={create}>
      <div className="receiving-card-title"><FilePlus2 size={20}/><div><h2>New purchase order</h2><p>Choose an existing supplier, destination warehouse, and product quantities.</p></div></div>
      <div className="receiving-fields">
        <label>Supplier<select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Select supplier</option>{suppliers.map((row) => <option key={row._id} value={row._id}>{row.name}</option>)}</select></label>
        <label>Destination warehouse<select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Select warehouse</option>{warehouses.map((row) => <option key={row._id} value={row._id}>{row.name} · {row.code}</option>)}</select></label>
        <label className="receiving-reason">Notes<input maxLength="1000" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional purchase notes"/></label>
      </div>
      <div className="receiving-table-wrap"><table><thead><tr><th>Product</th><th>Ordered quantity</th><th>Unit cost</th><th></th></tr></thead><tbody>{lines.map((line, index) => <tr key={index}>
        <td><select required value={line.productId} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, productId: event.target.value } : item))}><option value="">Select product</option>{products.map((product) => <option key={product._id} value={product._id}>{product.name} · {product.skuNumber}</option>)}</select></td>
        <td><input required type="number" min="1" step="1" value={line.orderedQuantity} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, orderedQuantity: event.target.value } : item))}/></td>
        <td><input type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, unitCost: event.target.value } : item))}/></td>
        <td><button type="button" className="receiving-refresh" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Remove</button></td>
      </tr>)}</tbody></table></div>
      <button className="receiving-refresh" type="button" onClick={() => setLines((current) => [...current, emptyLine()])}>Add product line</button>
      <button className="receiving-primary" disabled={busy}><FilePlus2 size={16}/>{busy ? 'Saving…' : 'Save draft'}</button>
    </form>}
    <div className="receiving-card"><div className="receiving-card-title"><div><h2>Purchase order history</h2><p>{rows.length} orders · select an order to inspect line quantities.</p></div></div>
      <div className="receiving-table-wrap"><table><thead><tr><th>Reference</th><th>Supplier</th><th>Status</th><th>Products</th><th>Ordered</th><th>Received</th><th>Remaining</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row._id} onClick={() => setSelectedId(row._id)} className={selectedId === row._id ? 'receiving-selected' : ''}>
        <td><button className="receiving-link" type="button" onClick={() => setSelectedId(row._id)}>{row.reference}</button></td><td>{row.supplier?.name || 'Supplier'}</td><td>{row.status.replaceAll('_', ' ')}</td><td>{row.lines.length}</td><td>{row.lines.reduce((sum, line) => sum + line.orderedQuantity, 0)}</td><td>{row.lines.reduce((sum, line) => sum + line.receivedQuantity, 0)}</td><td>{row.lines.reduce((sum, line) => sum + line.orderedQuantity - line.receivedQuantity, 0)}</td>
      </tr>) : <tr><td colSpan="7" className="receiving-empty">No purchase orders yet.</td></tr>}</tbody></table></div>
    </div>
    {detail && <div className="receiving-card"><div className="receiving-heading"><div><h2>{detail.reference} · {detail.status.replaceAll('_', ' ')}</h2><p>Supplier: {detail.supplier?.name || 'Supplier'} · Revision {detail.revision}</p></div>{canUpdate && detail.status === 'draft' && <button className="receiving-primary" disabled={busy} onClick={submit}><Send size={16}/>Submit order</button>}</div>
      <div className="receiving-table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Ordered</th><th>Received</th><th>Remaining</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line._id}><td>{line.productName}</td><td>{line.skuNumber}</td><td>{line.orderedQuantity}</td><td>{line.receivedQuantity}</td><td>{line.orderedQuantity - line.receivedQuantity}</td></tr>)}</tbody></table></div>
    </div>}
  </section>;
}
