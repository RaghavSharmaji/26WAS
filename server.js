require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

const authRoutes = require('./routes/auth.routes');
const locationRoutes = require('./routes/location.routes');
const itemRoutes = require('./routes/item.routes');
const palletRoutes = require('./routes/pallet.routes');
const receivingRoutes = require('./routes/receiving.routes');
const orderRoutes = require('./routes/order.routes');
const ticketRoutes = require('./routes/ticket.routes');
const pickerRoutes = require('./routes/picker.routes');
const userRoutes = require('./routes/user.routes');
const webScrapingRoutes = require('./routes/webscraping.routes');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    success: connected,
    status: connected ? 'ok' : 'database_unavailable'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/item', itemRoutes);
app.use('/api/pallet', palletRoutes);
app.use('/api/receiving', receivingRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/ticket', ticketRoutes);
app.use('/api/picker', pickerRoutes);
app.use('/api/user', userRoutes);
app.use('/webs/item', webScrapingRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error' });
});

async function start() {
  const port = Number(process.env.PORT || 5000);
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  if (!process.env.SECRET_OR_KEY) throw new Error('SECRET_OR_KEY is required');
  await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('MongoDB connected');
  app.listen(port, () => console.log(`WMS API listening on port ${port}`));
}

if (require.main === module) {
  start().catch(err => {
    console.error(`Startup failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = app;
