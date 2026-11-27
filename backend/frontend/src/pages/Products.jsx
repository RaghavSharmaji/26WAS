import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X, Package } from 'lucide-react';
import api, { getApiError } from '../api';

function mapProduct(item, stock = 0) {
  return {
    id: item._id,
    skuNumber: item.skuNumber,
    name: item.name,
    category: item.department,
    price: Number(item.price || 0),
    reorderLevel: Number(item.reorderLevel || 0),
    stock,
  };
}

async function changeSkuStock(skuNumber, current, desired) {
  const delta = desired - current;
  if (!delta) return;
  if (delta > 0) {
    await api.post('/inventory/stock-in', { skuNumber, quantity: delta, reason: 'Product screen stock update' });
    return;
  }
  const { data } = await api.get('/pallets', { params: { skuNumber } });
  let remaining = -delta;
  const pallets = data.data.slice().sort((a, b) => Number(b.contAvailable ?? b.cont ?? 0) - Number(a.contAvailable ?? a.cont ?? 0));
  for (const pallet of pallets) {
    if (remaining <= 0) break;
    const available = Number(pallet.contAvailable ?? pallet.cont ?? 0);
    const quantity = Math.min(available, remaining);
    if (!quantity) continue;
    await api.post('/inventory/stock-out', { palletId: pallet._id, quantity, reason: 'Product screen stock update' });
    remaining -= quantity;
  }
  if (remaining > 0) throw new Error('Stock changed while saving. Refresh the product and try again.');
}

function Products({ user }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', category: 'Electronics', price: '', stock: '', reorderLevel: '0' });

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [productResponse, inventoryResponse] = await Promise.all([api.get('/products'), api.get('/inventory')]);
      const inventoryBySku = new Map(inventoryResponse.data.data.map((row) => [row._id, Number(row.availableQuantity || 0)]));
      setProducts(productResponse.data.data.map((item) => mapProduct(item, inventoryBySku.get(item.skuNumber) || 0)));
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const filteredProducts = products.filter((product) =>
    `${product.name} ${product.skuNumber} ${product.category}`.toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => {
    setShowForm(false);
    setEditProduct(null);
    setForm({ name: '', category: 'Electronics', price: '', stock: '', reorderLevel: '0' });
  };

  const openEdit = (product) => {
    setEditProduct(product);
    setForm({ name: product.name, category: product.category, price: String(product.price), stock: String(product.stock), reorderLevel: String(product.reorderLevel) });
    setShowForm(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const desiredStock = Number(form.stock);
    const price = Number(form.price);
    const reorderLevel = Number(form.reorderLevel);
    if (!form.name.trim() || !Number.isFinite(price) || price < 0 || !Number.isInteger(desiredStock) || desiredStock < 0 || !Number.isInteger(reorderLevel) || reorderLevel < 0) {
      setError('Enter a product name, valid price, and whole-number stock and reorder quantities of zero or more.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (editProduct) {
        await api.put(`/products/${editProduct.id}`, { name: form.name.trim(), department: form.category, price, reorderLevel });
        await changeSkuStock(editProduct.skuNumber, editProduct.stock, desiredStock);
      } else {
        const skuNumber = `WMS-${Date.now().toString(36).toUpperCase()}`;
        await api.post('/products', { name: form.name.trim(), skuNumber, department: form.category, size: 0, price, reorderLevel });
        if (desiredStock > 0) await api.post('/inventory/stock-in', { skuNumber, quantity: desiredStock, reason: 'Initial stock' });
      }
      resetForm();
      await loadProducts();
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (id) => {
    if (!window.confirm('Are you sure you want to delete this product?')) return;
    setError('');
    try {
      await api.delete(`/products/${id}`);
      await loadProducts();
    } catch (requestError) {
      setError(getApiError(requestError));
    }
  };

  const getStatus = (product) => product.stock === 0 ? 'Out of Stock' : product.reorderLevel > 0 && product.stock <= product.reorderLevel ? 'Low Stock' : 'In Stock';

  return (
    <div className="products-page">
      <div className="page-heading">
        <div><h1>Products</h1><p>Manage and monitor all your warehouse products.</p></div>
        <button className="primary-btn" onClick={() => { setError(''); setShowForm(true); }}><Plus size={18} /> Add Product</button>
      </div>

      {error && <div className="data-error" role="alert">{error}</div>}

      <div className="product-summary">
        <div className="panel"><Package size={23} color="#3478ed" /><p>Total Products</p><h2>{products.length}</h2></div>
        <div className="panel"><Package size={23} color="#20a66b" /><p>In Stock</p><h2>{products.filter((p) => p.stock > 15).length}</h2></div>
        <div className="panel"><Package size={23} color="#e69a36" /><p>Low Stock</p><h2>{products.filter((p) => p.stock > 0 && p.reorderLevel > 0 && p.stock <= p.reorderLevel).length}</h2></div>
        <div className="panel"><Package size={23} color="#df625b" /><p>Out of Stock</p><h2>{products.filter((p) => p.stock === 0).length}</h2></div>
      </div>

      <div className="panel products-table-panel">
        <div className="products-toolbar">
          <div><h3>All Products</h3><p>View and manage your product inventory</p></div>
          <div className="search-box"><Search size={17} /><input placeholder="Search products..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan="6" className="data-empty">Loading products…</td></tr> : filteredProducts.map((product) => {
                const status = getStatus(product);
                return <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>{product.skuNumber}</small></td>
                  <td>{product.category}</td>
                  <td>₹{product.price.toLocaleString('en-IN')}</td>
                  <td>{product.stock}</td>
                  <td><span className={`status ${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span></td>
                  <td><div className="action-buttons">
                    <button className="edit-btn" onClick={() => openEdit(product)} title="Edit product"><Pencil size={16} /></button>
                    {user?.role === 'admin' && <button className="delete-btn" onClick={() => deleteProduct(product.id)} title="Delete product"><Trash2 size={16} /></button>}
                  </div></td>
                </tr>;
              })}
              {!loading && filteredProducts.length === 0 && <tr><td colSpan="6" className="data-empty">No products found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && <div className="modal-overlay"><div className="product-modal">
        <div className="modal-header"><div><h2>{editProduct ? 'Edit Product' : 'Add New Product'}</h2><p>Enter the product details below.</p></div><button className="close-btn" onClick={resetForm}><X size={21} /></button></div>
        <form onSubmit={handleSubmit}>
          <label>Product Name</label><input required maxLength={120} placeholder="Enter product name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <label>Category / Department</label><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Electronics</option><option>Accessories</option><option>Furniture</option><option>Clothing</option><option>Other</option></select>
          <label>Price (₹)</label><input required type="number" min="0" step="0.01" placeholder="Enter price" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
          <label>Minimum Stock / Reorder Level</label><input required type="number" min="0" step="1" value={form.reorderLevel} onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })} />
          <label>{editProduct ? 'Available Stock' : 'Initial Stock Quantity'}</label><input required type="number" min="0" step="1" placeholder="Enter stock quantity" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} />
          <div className="modal-actions"><button type="button" className="cancel-btn" onClick={resetForm}>Cancel</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editProduct ? 'Update Product' : 'Save Product'}</button></div>
        </form>
      </div></div>}
    </div>
  );
}

export default Products;
