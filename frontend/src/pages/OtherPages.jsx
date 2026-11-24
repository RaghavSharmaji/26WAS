
import { useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Building2,
  Users,
  Warehouse,
  MapPin,
  Package,
  TrendingUp,
  AlertTriangle,
  Boxes,
} from "lucide-react";
import "./OtherPages.css";

const pageConfig = {
  Categories: {
    icon: Package,
    description: "Organize and manage your product categories.",
    fields: ["Category Name", "Description", "Products", "Status"],
    initial: [
      { id: 1, "Category Name": "Electronics", Description: "Electronic devices and gadgets", Products: "24", Status: "Active" },
      { id: 2, "Category Name": "Accessories", Description: "Computer and mobile accessories", Products: "18", Status: "Active" },
      { id: 3, "Category Name": "Home & Kitchen", Description: "Home and kitchen products", Products: "12", Status: "Active" },
      { id: 4, "Category Name": "Furniture", Description: "Office and home furniture", Products: "8", Status: "Inactive" },
    ],
  },
  Suppliers: {
    icon: Users,
    description: "Manage your suppliers and their contact information.",
    fields: ["Supplier Name", "Contact Person", "Email", "Phone", "Status"],
    initial: [
      { id: 1, "Supplier Name": "TechWorld Distributors", "Contact Person": "Rahul Sharma", Email: "rahul@techworld.com", Phone: "9876543210", Status: "Active" },
      { id: 2, "Supplier Name": "Global Electronics", "Contact Person": "Priya Verma", Email: "priya@global.com", Phone: "9876543211", Status: "Active" },
      { id: 3, "Supplier Name": "Prime Supplies", "Contact Person": "Aman Gupta", Email: "aman@prime.com", Phone: "9876543212", Status: "Inactive" },
    ],
  },
  Warehouses: {
    icon: Warehouse,
    description: "View and manage your warehouse facilities.",
    fields: ["Warehouse Name", "Location", "Capacity", "Manager", "Status"],
    initial: [
      { id: 1, "Warehouse Name": "North Warehouse", Location: "Ludhiana, Punjab", Capacity: "10,000 units", Manager: "Rahul Sharma", Status: "Active" },
      { id: 2, "Warehouse Name": "Central Warehouse", Location: "Delhi, India", Capacity: "15,000 units", Manager: "Priya Verma", Status: "Active" },
      { id: 3, "Warehouse Name": "South Warehouse", Location: "Bengaluru, Karnataka", Capacity: "8,000 units", Manager: "Aman Gupta", Status: "Inactive" },
    ],
  },
  Locations: {
    icon: MapPin,
    description: "Manage storage zones and locations inside warehouses.",
    fields: ["Location ID", "Warehouse", "Zone", "Shelf", "Status"],
    initial: [
      { id: 1, "Location ID": "LOC-001", Warehouse: "North Warehouse", Zone: "A", Shelf: "A-01", Status: "Occupied" },
      { id: 2, "Location ID": "LOC-002", Warehouse: "North Warehouse", Zone: "A", Shelf: "A-02", Status: "Available" },
      { id: 3, "Location ID": "LOC-003", Warehouse: "Central Warehouse", Zone: "B", Shelf: "B-01", Status: "Occupied" },
      { id: 4, "Location ID": "LOC-004", Warehouse: "South Warehouse", Zone: "C", Shelf: "C-01", Status: "Available" },
    ],
  },
};

function ReportsPage() {
  const reports = [
    { title: "Total Products", value: "68", icon: Package, note: "Products in system" },
    { title: "Total Stock Units", value: "1,245", icon: Boxes, note: "Units currently recorded" },
    { title: "Low Stock Items", value: "12", icon: AlertTriangle, note: "Require attention" },
    { title: "Total Warehouses", value: "3", icon: Warehouse, note: "Registered facilities" },
  ];

  const stockData = [
    { name: "Electronics", value: 85 },
    { name: "Accessories", value: 65 },
    { name: "Home & Kitchen", value: 48 },
    { name: "Furniture", value: 32 },
  ];

  return (
    <div className="management-page">
      <div className="management-heading">
        <div>
          <h1>Reports & Analytics</h1>
          <p>Monitor warehouse performance and inventory insights.</p>
        </div>
      </div>

      <div className="management-stats">
        {reports.map((item) => {
          const Icon = item.icon;
          return (
            <div className="management-stat" key={item.title}>
              <div className="management-stat-icon"><Icon size={21} /></div>
              <div>
                <p>{item.title}</p>
                <h2>{item.value}</h2>
                <span>{item.note}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="report-grid">
        <div className="report-panel">
          <h3>Inventory by Category</h3>
          <p className="report-subtitle">Sample stock distribution</p>
          <div className="report-bars">
            {stockData.map((item) => (
              <div className="report-bar-row" key={item.name}>
                <div className="report-bar-label">
                  <span>{item.name}</span>
                  <strong>{item.value}%</strong>
                </div>
                <div className="report-bar-track">
                  <div className="report-bar-fill" style={{ width: `${item.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="report-panel">
          <h3>Warehouse Overview</h3>
          <p className="report-subtitle">Current facility summary</p>
          <div className="report-overview-row">
            <span>Active warehouses</span><strong>2</strong>
          </div>
          <div className="report-overview-row">
            <span>Total registered warehouses</span><strong>3</strong>
          </div>
          <div className="report-overview-row">
            <span>Low stock products</span><strong>12</strong>
          </div>
          <div className="report-overview-row">
            <span>Out of stock products</span><strong>4</strong>
          </div>
          <div className="report-insight">
            <TrendingUp size={19} />
            <span>Review low-stock products regularly to avoid shortages.</span>
          </div>
        </div>
      </div>
      <p className="report-disclaimer">Note: This report currently displays sample frontend data.</p>
    </div>
  );
}

function OtherPages({ activePage }) {
  const config = pageConfig[activePage];

  const [records, setRecords] = useState(() =>
    config ? config.initial.map((item) => ({ ...item })) : []
  );
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({});

  if (activePage === "Reports") return <ReportsPage />;
  if (!config) return null;

  const Icon = config.icon;
  const fields = config.fields;
  const nameField = fields[0];

  const filteredRecords = records.filter((record) =>
    fields.some((field) =>
      String(record[field] ?? "").toLowerCase().includes(search.toLowerCase())
    )
  );

  const openAddModal = () => {
    setEditingId(null);
    setFormData(Object.fromEntries(fields.map((field) => [field, ""])));
    setModalOpen(true);
  };

  const openEditModal = (record) => {
    setEditingId(record.id);
    setFormData(Object.fromEntries(fields.map((field) => [field, record[field] ?? ""])));
    setModalOpen(true);
  };

  const saveRecord = (event) => {
    event.preventDefault();

    if (!formData[nameField]?.trim()) {
      alert(`${nameField} is required.`);
      return;
    }

    if (editingId !== null) {
      setRecords((current) =>
        current.map((record) =>
          record.id === editingId ? { ...record, ...formData } : record
        )
      );
    } else {
      setRecords((current) => [
        ...current,
        { id: Date.now(), ...formData },
      ]);
    }

    setModalOpen(false);
  };

  const deleteRecord = (id) => {
    if (window.confirm("Are you sure you want to delete this record?")) {
      setRecords((current) => current.filter((record) => record.id !== id));
    }
  };

  const activeCount = records.filter((record) =>
    ["Active", "Available", "Occupied"].includes(record.Status)
  ).length;

  return (
    <div className="management-page">
      <div className="management-heading">
        <div>
          <h1>{activePage}</h1>
          <p>{config.description}</p>
        </div>
        <button className="management-primary-btn" onClick={openAddModal}>
          <Plus size={18} /> Add {activePage === "Categories" ? "Category" : activePage === "Suppliers" ? "Supplier" : activePage === "Warehouses" ? "Warehouse" : "Location"}
        </button>
      </div>

      <div className="management-stats">
        <div className="management-stat">
          <div className="management-stat-icon"><Icon size={21} /></div>
          <div><p>Total {activePage}</p><h2>{records.length}</h2><span>All registered records</span></div>
        </div>
        <div className="management-stat">
          <div className="management-stat-icon"><TrendingUp size={21} /></div>
          <div><p>Active / Available</p><h2>{activeCount}</h2><span>Currently active records</span></div>
        </div>
        <div className="management-stat">
          <div className="management-stat-icon"><Package size={21} /></div>
          <div><p>Other Records</p><h2>{records.length - activeCount}</h2><span>Inactive or other status</span></div>
        </div>
      </div>

      <div className="management-table-card">
        <div className="management-table-heading">
          <div>
            <h3>All {activePage}</h3>
            <p>View, search, edit and manage your records.</p>
          </div>
          <div className="management-search">
            <Search size={17} />
            <input
              type="text"
              placeholder={`Search ${activePage.toLowerCase()}...`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="management-table-wrap">
          <table className="management-table">
            <thead>
              <tr>
                {fields.map((field) => <th key={field}>{field}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length > 0 ? filteredRecords.map((record) => (
                <tr key={record.id}>
                  {fields.map((field) => (
                    <td key={field}>
                      {field === "Status" ? (
                        <span className={`management-status ${String(record[field]).toLowerCase().replaceAll(" ", "-")}`}>
                          {record[field]}
                        </span>
                      ) : (
                        record[field] || "—"
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="management-actions">
                      <button title="Edit" onClick={() => openEditModal(record)}><Pencil size={16} /></button>
                      <button title="Delete" onClick={() => deleteRecord(record.id)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={fields.length + 1} className="management-empty">No records found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="management-table-footer">
          Showing {filteredRecords.length} of {records.length} records
        </div>
      </div>

      {modalOpen && (
        <div className="management-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="management-modal" onClick={(event) => event.stopPropagation()}>
            <div className="management-modal-heading">
              <div>
                <h2>{editingId !== null ? "Edit" : "Add"} {activePage.slice(0, -1)}</h2>
                <p>Enter the details below.</p>
              </div>
              <button className="management-close" onClick={() => setModalOpen(false)}><X size={20} /></button>
            </div>

            <form onSubmit={saveRecord}>
              {fields.map((field) => (
                <label className="management-form-field" key={field}>
                  <span>{field}</span>
                  {field === "Status" ? (
                    <select
                      value={formData[field] || ""}
                      onChange={(event) => setFormData({ ...formData, [field]: event.target.value })}
                    >
                      {(activePage === "Locations" ? ["Available", "Occupied"] : ["Active", "Inactive"]).map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={formData[field] || ""}
                      onChange={(event) => setFormData({ ...formData, [field]: event.target.value })}
                      placeholder={`Enter ${field.toLowerCase()}`}
                    />
                  )}
                </label>
              ))}
              <div className="management-modal-actions">
                <button type="button" className="management-cancel-btn" onClick={() => setModalOpen(false)}>Cancel</button>
                <button type="submit" className="management-primary-btn">{editingId !== null ? "Save Changes" : "Add Record"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default OtherPages;
