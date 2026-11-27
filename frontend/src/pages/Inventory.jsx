
import { useState, useEffect, useCallback } from "react";

import {
  Search,
  Plus,
  Minus,
  Boxes,
  AlertTriangle,
  Package,
  XCircle,
  X,
} from "lucide-react";

import "./Inventory.css";
import api, { getApiError } from "../api";

function Inventory({ searchTerm = "", permissions = [], warehouseId = "" }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [selectedItem, setSelectedItem] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [deductionKey, setDeductionKey] = useState("");
  const canAdjust = permissions.includes('inventory.adjust');
  const canIssue = permissions.includes('inventory.issue');

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [productsResponse, inventoryResponse] = await Promise.all([api.get("/products"), api.get("/inventory")]);
      const stockBySku = new Map(inventoryResponse.data.data.map((row) => [row._id, {
        available: Number(row.availableQuantity || 0),
        onHand: Number(row.onHandQuantity || 0),
        quarantined: Number(row.quarantinedQuantity || 0),
      }]));
      setItems(productsResponse.data.data.map((product) => ({
        id: product._id,
        name: product.name,
        category: product.department,
        sku: product.skuNumber,
        stock: stockBySku.get(product.skuNumber)?.available || 0,
        onHand: stockBySku.get(product.skuNumber)?.onHand || 0,
        quarantined: stockBySku.get(product.skuNumber)?.quarantined || 0,
        minimum: Number(product.reorderLevel || 0),
      })));
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInventory(); }, [loadInventory]);

  // Receive search text from the top global search
  useEffect(() => {
    setSearch(searchTerm);
  }, [searchTerm]);

  const getStatus = (item) => {
    if (item.stock === 0) return "Out of Stock";
    if (item.stock <= item.minimum) return "Low Stock";
    return "In Stock";
  };

  const totalUnits = items.reduce(
    (sum, item) => sum + item.stock,
    0
  );

  const lowStock = items.filter(
    (item) => item.stock > 0 && item.stock <= item.minimum
  ).length;

  const outOfStock = items.filter(
    (item) => item.stock === 0
  ).length;

  // Search by product name, SKU or category
  const filteredItems = items.filter((item) => {
    const searchText = search.trim().toLowerCase();

    const matchesSearch =
      item.name.toLowerCase().includes(searchText) ||
      item.sku.toLowerCase().includes(searchText) ||
      item.category.toLowerCase().includes(searchText);

    const matchesFilter =
      filter === "All" || getStatus(item) === filter;

    return matchesSearch && matchesFilter;
  });

  // Add or remove stock
  const updateStock = async (type) => {
    const amount = Number(quantity);

    if (!Number.isInteger(amount) || amount <= 0) {
      alert("Please enter a valid positive whole number.");
      return;
    }
    if (!reason.trim()) {
      alert("Enter a reason for this inventory change.");
      return;
    }

    if (type === "remove" && amount > selectedItem.stock) {
      alert("You cannot remove more stock than is available.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (type === "add") {
        const requestKey = deductionKey || (globalThis.crypto?.randomUUID
          ? globalThis.crypto.randomUUID()
          : `stockin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        setDeductionKey(requestKey);
        await api.post("/inventory/stock-in", { skuNumber: selectedItem.sku, quantity: amount, warehouseId, reason: reason.trim() }, {
          headers: { "Idempotency-Key": requestKey },
        });
      } else {
        const { data } = await api.get("/pallets", { params: { skuNumber: selectedItem.sku } });
        let remaining = amount;
        const pallets = data.data.slice().sort((a, b) => Number(b.contAvailable ?? b.cont ?? 0) - Number(a.contAvailable ?? a.cont ?? 0));
        const items = [];
        for (const pallet of pallets) {
          if (remaining <= 0) break;
          const available = Number(pallet.contAvailable ?? pallet.cont ?? 0);
          const toRemove = Math.min(available, remaining);
          if (!toRemove) continue;
          items.push({ palletId: pallet._id, quantity: toRemove });
          remaining -= toRemove;
        }
        if (remaining > 0) throw new Error("Inventory changed while updating. Refresh and try again.");
        if (items.length > 100) throw new Error("This deduction spans more than 100 pallets. Reduce the quantity and retry.");
        const requestKey = deductionKey || (globalThis.crypto?.randomUUID
          ? globalThis.crypto.randomUUID()
          : `stockout-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        setDeductionKey(requestKey);
        await api.post("/inventory/stock-out/batch", {
          skuNumber: selectedItem.sku,
          items,
          reason: reason.trim(),
        }, { headers: { "Idempotency-Key": requestKey } });
      }
      await loadInventory();
      setSelectedItem(null);
      setQuantity("");
      setReason("");
      setDeductionKey("");
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="inventory-page">
      {/* PAGE HEADING */}
      <div className="inventory-heading">
        <div>
          <h1>Inventory Overview</h1>
          <p>
            Monitor and manage your warehouse stock levels.
          </p>
        </div>
      </div>

      {error && <div className="data-error" role="alert">{error}</div>}

      {/* SUMMARY CARDS */}
      <div className="inventory-stats">
        <div className="inventory-stat-card">
          <div className="inventory-stat-icon blue">
            <Boxes size={22} />
          </div>

          <p>Total Stock Units</p>
          <h2>{totalUnits.toLocaleString("en-IN")}</h2>
        </div>

        <div className="inventory-stat-card">
          <div className="inventory-stat-icon orange">
            <AlertTriangle size={22} />
          </div>

          <p>Low Stock Items</p>
          <h2>{lowStock}</h2>
        </div>

        <div className="inventory-stat-card">
          <div className="inventory-stat-icon red">
            <XCircle size={22} />
          </div>

          <p>Out of Stock</p>
          <h2>{outOfStock}</h2>
        </div>

        <div className="inventory-stat-card">
          <div className="inventory-stat-icon green">
            <Package size={22} />
          </div>

          <p>Total Products</p>
          <h2>{items.length}</h2>
        </div>
      </div>

      {/* STOCK MANAGEMENT */}
      <div className="panel inventory-management">
        <div className="inventory-toolbar">
          <div>
            <h3>Stock Management</h3>
            <p>View and update product stock quantities.</p>
          </div>

          {/* INVENTORY PAGE SEARCH */}
          <div className="inventory-search">
            <Search size={17} />

            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, SKU or category..."
            />
          </div>
        </div>

        {/* STOCK FILTERS */}
        <div className="inventory-filters">
          {[
            "All",
            "In Stock",
            "Low Stock",
            "Out of Stock",
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

        {/* INVENTORY TABLE */}
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>PRODUCT</th>
                <th>SKU</th>
                <th>CATEGORY</th>
                <th>AVAILABLE STOCK</th>
                <th>ON-HAND</th>
                <th>QUARANTINED</th>
                <th>MINIMUM STOCK</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>

            <tbody>
              {loading ? <tr><td colSpan="9" className="empty-inventory">Loading inventory…</td></tr> : filteredItems.map((item) => {
                const status = getStatus(item);

                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                    </td>

                    <td>{item.sku}</td>

                    <td>{item.category}</td>

                    <td>
                      <strong>{item.stock}</strong>
                    </td>

                    <td>{item.onHand}</td>

                    <td>{item.quarantined}</td>

                    <td>{item.minimum}</td>

                    <td>
                      <span
                        className={`status ${status
                          .toLowerCase()
                          .replaceAll(" ", "-")}`}
                      >
                        {status}
                      </span>
                    </td>

                    <td>
                      {(canAdjust || canIssue) && <>
                      <button
                        type="button"
                        className="stock-action-btn"
                        onClick={() => {
                          setSelectedItem(item);
                          setQuantity("");
                          setReason("");
                          setDeductionKey("");
                        }}
                      >
                        Update Stock
                      </button>
                      </>}
                    </td>
                  </tr>
                );
              })}

              {!loading && filteredItems.length === 0 && (
                <tr>
                  <td colSpan="9" className="empty-inventory">
                    No inventory items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* UPDATE STOCK MODAL */}
      {selectedItem && (
        <div className="inventory-modal-overlay">
          <div className="inventory-modal">
            <button
              type="button"
              className="inventory-modal-close"
              onClick={() => {
                setSelectedItem(null);
                setQuantity("");
                setReason("");
                setDeductionKey("");
              }}
            >
                <X size={20} />
            </button>

            <h2>Update Stock</h2>
            <p>{selectedItem.name}</p>

            <div className="current-stock">
              Current stock:{" "}
              <strong>{selectedItem.stock} units</strong>
            </div>

            <label htmlFor="stock-quantity">
              Enter Quantity
            </label>

            <input
              id="stock-quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => { setQuantity(event.target.value); setDeductionKey(""); }}
              placeholder="Enter quantity"
            />

            <label htmlFor="stock-reason">Reason for change</label>
            <input
              id="stock-reason"
              type="text"
              maxLength={500}
              value={reason}
              onChange={(event) => { setReason(event.target.value); setDeductionKey(""); }}
              placeholder="For example: cycle count correction"
            />

            <div className="stock-modal-actions">
              {canAdjust && <button disabled={saving || !reason.trim()}
                type="button"
                onClick={() => updateStock("add")}
              >
                <Plus size={17} />
                Add Stock
              </button>}

              {canIssue && <button disabled={saving || !reason.trim()}
                type="button"
                onClick={() => updateStock("remove")}
              >
                <Minus size={17} />
                Remove Stock
              </button>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default Inventory;
