import SettingsPage from "./pages/Settings";
import OtherPages from "./pages/OtherPages";
import Orders from "./pages/Orders";
import { useState } from "react";
import Inventory from "./pages/Inventory";
import Products from "./pages/Products";

import {
  LayoutDashboard,
  Package,
  Boxes,
  Truck,
  Warehouse,
  MapPin,
  Tags,
  Users,
  BarChart3,
  Settings,
  Bell,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Menu,
} from "lucide-react";

import "./App.css";

const menuItems = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Products", icon: Package },
  { name: "Inventory", icon: Boxes },
  { name: "Orders", icon: Truck },
  { name: "Categories", icon: Tags },
  { name: "Suppliers", icon: Users },
  { name: "Warehouses", icon: Warehouse },
  { name: "Locations", icon: MapPin },
  { name: "Reports", icon: BarChart3 },
];

const products = [
  {
    id: "PRD-001",
    name: "Wireless Headphones",
    category: "Electronics",
    stock: 145,
    price: "₹2,499",
    status: "In Stock",
  },
  {
    id: "PRD-002",
    name: "Mechanical Keyboard",
    category: "Accessories",
    stock: 12,
    price: "₹3,999",
    status: "Low Stock",
  },
  {
    id: "PRD-003",
    name: "Smart Watch",
    category: "Electronics",
    stock: 0,
    price: "₹5,499",
    status: "Out of Stock",
  },
  {
    id: "PRD-004",
    name: "USB-C Hub",
    category: "Accessories",
    stock: 86,
    price: "₹1,299",
    status: "In Stock",
  },
  {
    id: "PRD-005",
    name: "Bluetooth Speaker",
    category: "Electronics",
    stock: 8,
    price: "₹2,199",
    status: "Low Stock",
  },
];

function App() {
  const [activePage, setActivePage] = useState("Dashboard");

  const [globalSearch, setGlobalSearch] = useState("");
  const [inventorySearchTerm, setInventorySearchTerm] = useState("");

  const globalResults = products.filter((product) => {
    const query = globalSearch.trim().toLowerCase();

    if (!query) return false;

    return (
      product.name.toLowerCase().includes(query) ||
      product.id.toLowerCase().includes(query) ||
      product.category.toLowerCase().includes(query)
    );
  });

  const stats = [
    {
      title: "Total Products",
      value: "1,248",
      change: "+12.5%",
      up: true,
      icon: Package,
      color: "blue",
    },
    {
      title: "Total Stock Units",
      value: "8,540",
      change: "+8.2%",
      up: true,
      icon: Boxes,
      color: "green",
    },
    {
      title: "Active Orders",
      value: "186",
      change: "+5.4%",
      up: true,
      icon: Truck,
      color: "purple",
    },
    {
      title: "Low Stock Items",
      value: "24",
      change: "-3.1%",
      up: false,
      icon: Bell,
      color: "orange",
    },
  ];

  const openInventoryProduct = (product) => {
    setInventorySearchTerm(product.name);
    setGlobalSearch("");
    setActivePage("Inventory");
  };

  return (
    <div className="app-layout">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Warehouse size={25} />
          </div>

          <div>
            <h2>WareFlow</h2>
            <span>WAREHOUSE SYSTEM</span>
          </div>
        </div>

        <div className="menu-label">MAIN MENU</div>

        <nav className="navigation">
          {menuItems.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.name}
                className={`nav-item ${activePage === item.name ? "active" : ""
                  }`}
                onClick={() => setActivePage(item.name)}
              >
                <Icon size={19} />
                <span>{item.name}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <button
            className={`nav-item ${activePage === "Settings" ? "active" : ""
              }`}
            onClick={() => setActivePage("Settings")}
          >
            <Settings size={19} />
            <span>Settings</span>
          </button>

          <div className="profile">
            <div className="avatar">SA</div>

            <div>
              <strong>Warehouse Admin</strong>
              <span>Administrator</span>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        {/* TOP HEADER */}
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu">
              <Menu />
            </button>

            <div>
              <h3>{activePage}</h3>
              <p>Welcome back! Here's what's happening today.</p>
            </div>
          </div>

          <div className="topbar-right">
            {/* GLOBAL SEARCH */}
            <div className="search-box global-search">
              <Search size={17} />

              <input
                type="text"
                placeholder="Search products, SKU, category..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />

              {globalSearch.trim() && (
                <div className="global-search-results">
                  {globalResults.length > 0 ? (
                    globalResults.map((product) => (
                      <button
                        type="button"
                        key={product.id}
                        onClick={() => openInventoryProduct(product)}
                      >
                        <div>
                          <strong>{product.name}</strong>
                          <span>
                            {product.id} · {product.category}
                          </span>
                        </div>

                        <Search size={15} />
                      </button>
                    ))
                  ) : (
                    <p>No matching products found.</p>
                  )}
                </div>
              )}
            </div>

            <button className="notification">
              <Bell size={20} />
              <span></span>
            </button>

            <div className="top-avatar">SA</div>
          </div>
        </header>

        {/* PAGE CONTENT */}
        {activePage === "Dashboard" ? (
          <section className="dashboard-body">
            <div className="page-heading">
              <div>
                <h1>Overview</h1>
                <p>
                  Monitor your warehouse operations at a glance.
                </p>
              </div>

              <button
                className="primary-btn"
                onClick={() => setActivePage("Products")}
              >
                <Plus size={18} />
                Add Product
              </button>
            </div>

            {/* STATISTICS */}
            <div className="stats-grid">
              {stats.map((stat) => {
                const Icon = stat.icon;

                return (
                  <div className="stat-card" key={stat.title}>
                    <div className="stat-top">
                      <span>{stat.title}</span>

                      <div className={`stat-icon ${stat.color}`}>
                        <Icon size={21} />
                      </div>
                    </div>

                    <h2>{stat.value}</h2>

                    <div
                      className={`stat-change ${stat.up ? "positive" : "negative"
                        }`}
                    >
                      {stat.up ? (
                        <ArrowUpRight size={16} />
                      ) : (
                        <ArrowDownRight size={16} />
                      )}

                      {stat.change}
                      <span> vs last month</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* INVENTORY AND ALERTS */}
            <div className="content-grid">
              <section className="panel inventory-panel">
                <div className="panel-header">
                  <div>
                    <h3>Recent Inventory</h3>
                    <p>Overview of your latest products</p>
                  </div>

                  <button
                    className="text-btn"
                    onClick={() => setActivePage("Products")}
                  >
                    View all
                  </button>
                </div>

                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>PRODUCT</th>
                        <th>CATEGORY</th>
                        <th>STOCK</th>
                        <th>PRICE</th>
                        <th>STATUS</th>
                      </tr>
                    </thead>

                    <tbody>
                      {products.map((product) => (
                        <tr key={product.id}>
                          <td>
                            <strong>{product.name}</strong>
                            <small>{product.id}</small>
                          </td>

                          <td>{product.category}</td>
                          <td>{product.stock}</td>
                          <td>{product.price}</td>

                          <td>
                            <span
                              className={`status ${product.status
                                .toLowerCase()
                                .replaceAll(" ", "-")}`}
                            >
                              {product.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* STOCK ALERTS */}
              <section className="panel alerts-panel">
                <div className="panel-header">
                  <div>
                    <h3>Stock Alerts</h3>
                    <p>Items requiring attention</p>
                  </div>

                  <Bell size={19} color="#e69a36" />
                </div>

                <div className="alert-item">
                  <div className="alert-dot orange-dot"></div>

                  <div>
                    <strong>Mechanical Keyboard</strong>
                    <p>Only 12 units remaining</p>
                  </div>

                  <span>12</span>
                </div>

                <div className="alert-item">
                  <div className="alert-dot red-dot"></div>

                  <div>
                    <strong>Smart Watch</strong>
                    <p>Currently out of stock</p>
                  </div>

                  <span>0</span>
                </div>

                <div className="alert-item">
                  <div className="alert-dot orange-dot"></div>

                  <div>
                    <strong>Bluetooth Speaker</strong>
                    <p>Only 8 units remaining</p>
                  </div>

                  <span>8</span>
                </div>

                <button className="alert-button">
                  View all alerts
                </button>
              </section>
            </div>

            {/* RECENT ACTIVITY */}
            <section className="panel activity-panel">
              <div className="panel-header">
                <div>
                  <h3>Recent Activity</h3>
                  <p>Latest warehouse operations</p>
                </div>
              </div>

              <div className="activity-row">
                <div className="activity-icon green">
                  <ArrowDownRight size={19} />
                </div>

                <div>
                  <strong>Stock received</strong>
                  <p>Wireless Headphones · 50 units added</p>
                </div>

                <time>10 min ago</time>
              </div>

              <div className="activity-row">
                <div className="activity-icon blue">
                  <Truck size={19} />
                </div>

                <div>
                  <strong>Order dispatched</strong>
                  <p>Order #ORD-1024 · Shipment processed</p>
                </div>

                <time>35 min ago</time>
              </div>

              <div className="activity-row">
                <div className="activity-icon purple">
                  <Package size={19} />
                </div>

                <div>
                  <strong>New product added</strong>
                  <p>Bluetooth Speaker · Electronics</p>
                </div>

                <time>1 hour ago</time>
              </div>
            </section>

            <footer>
              © 2026 WareFlow. Warehouse Management System.
            </footer>
          </section>
        ) : activePage === "Products" ? (
          <Products />
        ) : activePage === "Inventory" ? (
          <Inventory searchTerm={inventorySearchTerm} />
        ) : activePage === "Orders" ? (
          <Orders />
        ) : activePage === "Settings" ? (
          <SettingsPage />
        ) : (
          <OtherPages key={activePage} activePage={activePage} />
        )}
      </main>
    </div>
  );
}

export default App;
