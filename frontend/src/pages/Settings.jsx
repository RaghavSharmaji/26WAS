
import { useState } from "react";
import {
  User,
  Warehouse,
  Bell,
  Save,
  RotateCcw,
} from "lucide-react";

import "./Settings.css";

function Settings() {
  const [profile, setProfile] = useState({
    name: "Warehouse Admin",
    email: "admin@wareflow.com",
    role: "Administrator",
  });

  const [warehouse, setWarehouse] = useState({
    name: "WareFlow Main Warehouse",
    currency: "INR (₹)",
    timezone: "Asia/Kolkata",
  });

  const [notifications, setNotifications] = useState({
    lowStock: true,
    orderUpdates: true,
    emailNotifications: false,
  });

  const [saved, setSaved] = useState(false);

  const handleProfileChange = (e) => {
    setProfile({ ...profile, [e.target.name]: e.target.value });
    setSaved(false);
  };

  const handleWarehouseChange = (e) => {
    setWarehouse({ ...warehouse, [e.target.name]: e.target.value });
    setSaved(false);
  };

  const handleNotificationChange = (name) => {
    setNotifications({
      ...notifications,
      [name]: !notifications[name],
    });
    setSaved(false);
  };

  const handleSave = () => {
    setSaved(true);
  };

  const handleReset = () => {
    setProfile({
      name: "Warehouse Admin",
      email: "admin@wareflow.com",
      role: "Administrator",
    });

    setWarehouse({
      name: "WareFlow Main Warehouse",
      currency: "INR (₹)",
      timezone: "Asia/Kolkata",
    });

    setNotifications({
      lowStock: true,
      orderUpdates: true,
      emailNotifications: false,
    });

    setSaved(false);
  };

  return (
    <section className="settings-page">
      <div className="page-heading settings-heading">
        <div>
          <h1>Settings</h1>
          <p>Manage your account, warehouse preferences and notifications.</p>
        </div>
      </div>

      {saved && (
        <div className="settings-success">
          Settings saved successfully!
        </div>
      )}

      <div className="settings-card">
        <div className="settings-card-heading">
          <div className="settings-icon">
            <User size={20} />
          </div>
          <div>
            <h3>Profile Settings</h3>
            <p>Manage your administrator account details.</p>
          </div>
        </div>

        <div className="settings-form-grid">
          <div className="settings-field">
            <label>Full Name</label>
            <input
              type="text"
              name="name"
              value={profile.name}
              onChange={handleProfileChange}
              placeholder="Enter your name"
            />
          </div>

          <div className="settings-field">
            <label>Email Address</label>
            <input
              type="email"
              name="email"
              value={profile.email}
              onChange={handleProfileChange}
              placeholder="Enter your email"
            />
          </div>

          <div className="settings-field">
            <label>Role</label>
            <input
              type="text"
              name="role"
              value={profile.role}
              readOnly
            />
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-heading">
          <div className="settings-icon">
            <Warehouse size={20} />
          </div>
          <div>
            <h3>Warehouse Preferences</h3>
            <p>Configure your warehouse information and preferences.</p>
          </div>
        </div>

        <div className="settings-form-grid">
          <div className="settings-field">
            <label>Warehouse Name</label>
            <input
              type="text"
              name="name"
              value={warehouse.name}
              onChange={handleWarehouseChange}
              placeholder="Enter warehouse name"
            />
          </div>

          <div className="settings-field">
            <label>Currency</label>
            <select
              name="currency"
              value={warehouse.currency}
              onChange={handleWarehouseChange}
            >
              <option value="INR (₹)">INR (₹) - Indian Rupee</option>
              <option value="USD ($)">USD ($) - US Dollar</option>
              <option value="EUR (€)">EUR (€) - Euro</option>
            </select>
          </div>

          <div className="settings-field">
            <label>Timezone</label>
            <select
              name="timezone"
              value={warehouse.timezone}
              onChange={handleWarehouseChange}
            >
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New York</option>
              <option value="Europe/London">Europe/London</option>
            </select>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-heading">
          <div className="settings-icon">
            <Bell size={20} />
          </div>
          <div>
            <h3>Notification Preferences</h3>
            <p>Choose which updates you want to receive.</p>
          </div>
        </div>

        <div className="notification-list">
          <div className="notification-row">
            <div>
              <h4>Low Stock Alerts</h4>
              <p>Get notified when product stock is running low.</p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={notifications.lowStock}
                onChange={() => handleNotificationChange("lowStock")}
              />
              <span className="settings-slider"></span>
            </label>
          </div>

          <div className="notification-row">
            <div>
              <h4>Order Updates</h4>
              <p>Receive notifications about order status changes.</p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={notifications.orderUpdates}
                onChange={() => handleNotificationChange("orderUpdates")}
              />
              <span className="settings-slider"></span>
            </label>
          </div>

          <div className="notification-row">
            <div>
              <h4>Email Notifications</h4>
              <p>Receive warehouse updates through email.</p>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={notifications.emailNotifications}
                onChange={() =>
                  handleNotificationChange("emailNotifications")
                }
              />
              <span className="settings-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div className="settings-actions">
        <button className="settings-reset-btn" onClick={handleReset}>
          <RotateCcw size={16} />
          Reset
        </button>

        <button className="settings-save-btn" onClick={handleSave}>
          <Save size={16} />
          Save Changes
        </button>
      </div>
    </section>
  );
}

export default Settings;
