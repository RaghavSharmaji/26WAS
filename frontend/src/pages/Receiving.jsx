import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ClipboardPlus, RefreshCw, ShieldAlert, Truck } from 'lucide-react';
import api, { getApiError } from '../api';
import './Receiving.css';

function requestKey() {
  return globalThis.crypto?.randomUUID?.() || `wms-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Receiving({ permissions = [] }) {
  const canReceive = permissions.includes('receiving.execute');
  const canInspect = canReceive;
  const canPutaway = permissions.includes('receiving.putaway');
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedPoId, setSelectedPoId] = useState('');
  const [selectedReceiptId, setSelectedReceiptId] = useState('');
  const [receiptDetail, setReceiptDetail] = useState(null);
  const [receiveQuantities, setReceiveQuantities] = useState({});
  const [inspection, setInspection] = useState({});
  const [putaway, setPutaway] = useState({});
  const [tab, setTab] = useState('receive');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [poResponse, receiptResponse, locationResponse] = await Promise.all([
        api.get('/purchase-orders'), api.get('/grns'), api.get('/locations')
      ]);
      setPurchaseOrders((poResponse.data.data || []).filter((row) => ['submitted', 'partially_received'].includes(row.status)));
      setReceipts(receiptResponse.data.data || []);
      setLocations(locationResponse.data.data || []);
      setSelectedPoId((current) => current || (poResponse.data.data || []).find((row) => ['submitted', 'partially_received'].includes(row.status))?._id || '');
      setSelectedReceiptId((current) => current || receiptResponse.data.data?.[0]?._id || '');
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); }
  }, []);

  const loadReceipt = useCallback(async (id) => {
    if (!id) { setReceiptDetail(null); return; }
    try { const { data } = await api.get(`/grns/${id}`); setReceiptDetail(data.data); }
    catch (requestError) { setError(getApiError(requestError)); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadReceipt(selectedReceiptId); }, [selectedReceiptId, loadReceipt]);

  const selectedPo = useMemo(() => purchaseOrders.find((row) => String(row._id) === String(selectedPoId)), [purchaseOrders, selectedPoId]);
  const receive = async (event) => {
    event.preventDefault();
    if (!selectedPo) return;
    const lines = selectedPo.lines.map((line) => ({ purchaseOrderLineId: line._id, quantity: Number(receiveQuantities[line._id] || 0) })).filter((line) => line.quantity > 0);
    if (!lines.length || lines.some((line) => !Number.isSafeInteger(line.quantity))) return setError('Enter a positive whole received quantity for at least one PO line.');
    setBusy(true); setError(''); setNotice('');
    try {
      const { data } = await api.post('/grns', { purchaseOrderId: selectedPo._id, expectedRevision: selectedPo.revision, lines }, { headers: { 'Idempotency-Key': requestKey() } });
      setNotice(`GRN ${data.data.reference} recorded. Received stock remains unavailable until inspection and putaway.`);
      setReceiveQuantities({}); setTab('history'); setSelectedReceiptId(data.data._id); await load();
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  };

  const inspect = async (line) => {
    const value = inspection[line._id] || {};
    setBusy(true); setError(''); setNotice('');
    try {
      const { data } = await api.patch(`/grns/${receiptDetail._id}/lines/${line._id}/inspection`, {
        expectedRevision: receiptDetail.revision,
        acceptedQuantity: Number(value.acceptedQuantity ?? line.acceptedQuantity),
        rejectedQuantity: Number(value.rejectedQuantity ?? line.rejectedQuantity),
        damagedQuantity: Number(value.damagedQuantity ?? line.damagedQuantity),
        incorrectQuantity: Number(value.incorrectQuantity ?? line.incorrectQuantity),
        reason: value.reason || line.inspectionReason || ''
      });
      setReceiptDetail(data.data); setNotice('Inspection saved. Rejected quantities are quarantined.'); await load();
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  };

  const completePutaway = async (line) => {
    const value = putaway[line._id] || {};
    if (!value.locationName) return setError('Choose a destination location in this GRN’s warehouse.');
    setBusy(true); setError(''); setNotice('');
    try {
      const { data } = await api.post(`/grns/${receiptDetail._id}/lines/${line._id}/putaway`, {
        expectedRevision: receiptDetail.revision, quantity: Number(value.quantity), locationName: value.locationName, reason: value.reason || ''
      }, { headers: { 'Idempotency-Key': requestKey() } });
      setReceiptDetail(data.data.receipt); setNotice(`${data.data.putaway.quantity} units put away to ${data.data.putaway.locationName}.`); await load();
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  };

  const locationsForReceipt = locations.filter((location) => String(location.warehouse) === String(receiptDetail?.warehouseId));
  return <section className="receiving-page">
    <div className="receiving-heading"><div><h1>Goods Receiving</h1><p>Receive against submitted purchase orders, inspect goods, quarantine rejects, and put accepted stock away.</p></div><button type="button" className="receiving-refresh" onClick={load} disabled={loading}><RefreshCw size={16}/>Refresh</button></div>
    {error && <div className="data-error" role="alert">{error}</div>}{notice && <div className="receiving-success" role="status">{notice}</div>}
    <div className="receiving-tabs" role="tablist">{[['receive','Receive goods'],['history','GRN history'],['inspection','Quality inspection'],['putaway','Putaway']].map(([key,label]) => <button key={key} type="button" role="tab" aria-selected={tab===key} className={tab===key?'active':''} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === 'receive' && <div className="receiving-card">
      <div className="receiving-card-title"><Truck size={20}/><div><h2>Receive purchase order</h2><p>Only submitted orders with outstanding quantities can be received. Excess quantities are rejected.</p></div></div>
      {!canReceive ? <div className="receiving-note"><ShieldAlert size={17}/> Your role does not have permission to receive goods.</div> : <form onSubmit={receive}>
        <label className="receiving-select-label">Purchase order<select required value={selectedPoId} onChange={(event) => { setSelectedPoId(event.target.value); setReceiveQuantities({}); }}><option value="">Select submitted purchase order</option>{purchaseOrders.map((po) => <option key={po._id} value={po._id}>{po.reference} · {po.status.replaceAll('_',' ')} · {po.supplier?.name || 'Supplier'}</option>)}</select></label>
        {selectedPo && <div className="receiving-table-wrap"><table><thead><tr><th>Product</th><th>Ordered</th><th>Previously received</th><th>Outstanding</th><th>Received now</th></tr></thead><tbody>{selectedPo.lines.map((line) => <tr key={line._id}><td><strong>{line.productName}</strong><small>{line.skuNumber}</small></td><td>{line.orderedQuantity}</td><td>{line.receivedQuantity}</td><td>{line.orderedQuantity-line.receivedQuantity}</td><td><input type="number" min="0" max={line.orderedQuantity-line.receivedQuantity} step="1" value={receiveQuantities[line._id] || ''} onChange={(event) => setReceiveQuantities((current) => ({ ...current, [line._id]: event.target.value }))}/></td></tr>)}</tbody></table></div>}
        <button className="receiving-primary" disabled={busy || !selectedPo}><ClipboardPlus size={17}/>{busy ? 'Recording…' : 'Record GRN'}</button>
      </form>}
    </div>}

    {tab === 'history' && <div className="receiving-card"><div className="receiving-card-title"><ClipboardPlus size={20}/><div><h2>GRN history</h2><p>Goods Receipt Notes linked to their purchase orders and receiving employees.</p></div></div><div className="receiving-table-wrap"><table><thead><tr><th>GRN reference</th><th>Purchase order</th><th>Status</th><th>Received</th><th>Lines</th><th></th></tr></thead><tbody>{receipts.length ? receipts.map((receipt) => <tr key={receipt._id}><td><strong>{receipt.reference}</strong></td><td>{receipt.purchaseOrder?.reference || 'Purchase order'}</td><td>{receipt.status.replaceAll('_',' ')}</td><td>{new Date(receipt.receivedAt).toLocaleString()}</td><td>{receipt.lines.length}</td><td><button className="receiving-refresh" type="button" onClick={()=>{setSelectedReceiptId(receipt._id);setTab('inspection');}}>Inspect / put away</button></td></tr>) : <tr><td colSpan="6" className="receiving-empty">{loading?'Loading receipts…':'No GRNs recorded yet.'}</td></tr>}</tbody></table></div></div>}

    {(tab === 'inspection' || tab === 'putaway') && <div className="receiving-card"><div className="receiving-card-title"><Check size={20}/><div><h2>{tab === 'inspection' ? 'Quality inspection' : 'Accepted goods putaway'}</h2><p>Choose a GRN to manage its line quantities. Rejected stock remains isolated from available inventory.</p></div></div>
      <label className="receiving-select-label">Goods receipt<select value={selectedReceiptId} onChange={(event)=>setSelectedReceiptId(event.target.value)}><option value="">Select GRN</option>{receipts.map((receipt)=><option key={receipt._id} value={receipt._id}>{receipt.reference} · {receipt.status.replaceAll('_',' ')}</option>)}</select></label>
      {receiptDetail && <div className="receiving-grn-meta"><strong>{receiptDetail.reference}</strong><span>Warehouse: {receiptDetail.warehouseId}</span><span>Revision: {receiptDetail.revision}</span></div>}
      {receiptDetail && <div className="receiving-line-list">{receiptDetail.lines.map((line)=><article className="receiving-line" key={line._id}><div className="receiving-line-heading"><strong>{line.productName}</strong><span>{line.skuNumber} · received {line.receivedQuantity} · accepted {line.acceptedQuantity} · rejected/quarantined {line.rejectedQuantity}</span></div>
        {tab==='inspection' && <div className="receiving-inspection-grid"><label>Accepted<input type="number" min={line.acceptedQuantity} max={line.receivedQuantity} step="1" value={inspection[line._id]?.acceptedQuantity ?? line.acceptedQuantity} onChange={(event)=>setInspection((current)=>({...current,[line._id]:{...current[line._id],acceptedQuantity:event.target.value}}))}/></label><label>Rejected<input type="number" min={line.rejectedQuantity} max={line.receivedQuantity} step="1" value={inspection[line._id]?.rejectedQuantity ?? line.rejectedQuantity} onChange={(event)=>setInspection((current)=>({...current,[line._id]:{...current[line._id],rejectedQuantity:event.target.value}}))}/></label><label>Damaged (rejected)<input type="number" min={line.damagedQuantity} max={inspection[line._id]?.rejectedQuantity ?? line.rejectedQuantity} step="1" value={inspection[line._id]?.damagedQuantity ?? line.damagedQuantity} onChange={(event)=>setInspection((current)=>({...current,[line._id]:{...current[line._id],damagedQuantity:event.target.value}}))}/></label><label>Incorrect (rejected)<input type="number" min={line.incorrectQuantity} max={inspection[line._id]?.rejectedQuantity ?? line.rejectedQuantity} step="1" value={inspection[line._id]?.incorrectQuantity ?? line.incorrectQuantity} onChange={(event)=>setInspection((current)=>({...current,[line._id]:{...current[line._id],incorrectQuantity:event.target.value}}))}/></label><label className="wide">Reason<input maxLength="500" required value={inspection[line._id]?.reason ?? line.inspectionReason} onChange={(event)=>setInspection((current)=>({...current,[line._id]:{...current[line._id],reason:event.target.value}}))} placeholder="Explain the inspection result"/></label><button type="button" className="receiving-primary" disabled={!canInspect||busy} onClick={()=>inspect(line)}>Save inspection</button></div>}
        {tab==='putaway' && <div className="receiving-inspection-grid"><label>Accepted awaiting putaway<input readOnly value={Math.max(0,line.acceptedQuantity-line.putawayQuantity)}/></label><label>Putaway quantity<input type="number" min="1" max={Math.max(0,line.acceptedQuantity-line.putawayQuantity)} step="1" value={putaway[line._id]?.quantity || ''} onChange={(event)=>setPutaway((current)=>({...current,[line._id]:{...current[line._id],quantity:event.target.value}}))}/></label><label>Destination location<select value={putaway[line._id]?.locationName || ''} onChange={(event)=>setPutaway((current)=>({...current,[line._id]:{...current[line._id],locationName:event.target.value}}))}><option value="">Select location</option>{locationsForReceipt.filter((location)=>['empty','occupied'].includes(location.status)&&(!location.skuNumber||location.skuNumber===line.skuNumber)).map((location)=><option key={location._id} value={location.fullName}>{location.fullName} · {location.status}</option>)}</select></label><label>Reason<input maxLength="500" value={putaway[line._id]?.reason || ''} onChange={(event)=>setPutaway((current)=>({...current,[line._id]:{...current[line._id],reason:event.target.value}}))}/></label><button type="button" className="receiving-primary" disabled={!canPutaway||busy||line.putawayQuantity>=line.acceptedQuantity} onClick={()=>completePutaway(line)}>Confirm putaway</button></div>}
      </article>)}</div>}
    </div>}
  </section>;
}
