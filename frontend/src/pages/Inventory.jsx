
import { useState, useEffect } from "react";

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

function Inventory({ searchTerm = "" }) {
  const [items, setItems] = useState([
    {
      id: 1,
      name: "Wireless Headphones",
      category: "Electronics",
      sku: "PRD-001",
      stock: 145,
      minimum: 20,
    },
    {
      id: 2,
      name: "Mechanical Keyboard",
      category: "Accessories",
      sku: "PRD-002",
      stock: 12,
      minimum: 20,
    },
    {
      id: 3,
      name: "Smart Watch",
      category: "Electronics",
      sku: "PRD-003",
      stock: 0,
      minimum: 15,
    },
    {
      id: 4,
      name: "USB-C Hub",
      category: "Accessories",
      sku: "PRD-004",
      stock: 86,
      minimum: 20,
    },
    {
      id: 5,
      name: "Bluetooth Speaker",
      category: "Electronics",
      sku: "PRD-005",
      stock: 8,
      minimum: 20,
    },
  ]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [selectedItem, setSelectedItem] = useState(null);
  const [quantity, setQuantity] = useState("");

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
  const updateStock = (type) => {
    const amount = Number(quantity);

    if (!Number.isInteger(amount) || amount <= 0) {
      alert("Please enter a valid positive whole number.");
      return;
    }

    if (type === "remove" && amount > selectedItem.stock) {
      alert("You cannot remove more stock than is available.");
      return;
    }

    setItems((previousItems) =>
      previousItems.map((item) => {
        if (item.id !== selectedItem.id) return item;

        return {
          ...item,
          stock:
            type === "add"
              ? item.stock + amount
              : item.stock - amount,
        };
      })
    );

    setSelectedItem(null);
    setQuantity("");
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
                <th>MINIMUM STOCK</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>

            <tbody>
              {filteredItems.map((item) => {
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
                      <button
                        type="button"
                        className="stock-action-btn"
                        onClick={() => {
                          setSelectedItem(item);
                          setQuantity("");
                        }}
                      >
                        Update Stock
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan="7" className="empty-inventory">
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
              onChange={(event) =>
                setQuantity(event.target.value)
              }
              placeholder="Enter quantity"
            />

            <div className="stock-modal-actions">
              <button
                type="button"
                onClick={() => updateStock("add")}
              >
                <Plus size={17} />
                Add Stock
              </button>

              <button
                type="button"
                onClick={() => updateStock("remove")}
              >
                <Minus size={17} />
                Remove Stock
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default Inventory;
