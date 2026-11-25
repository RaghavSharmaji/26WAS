/* eslint-disable prettier/prettier */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-undef */
/* eslint-disable node/no-unsupported-features/es-syntax */
const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();
// const Item = require('../model/Item');

// const Location = require('../model/Location');
const Orders = require('../model/Order');

router.get('/', async (req, res) => {
  try {
    const allOrder = await Orders.find().sort({ date: -1 }).lean();
    res.json({
      success: true,
      message: 'all orders',
      allOrder,
      data: allOrder
    });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
    });
  }
});

router.put('/:id/status', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid order ID' });
  }
  const allowed = ['Pending', 'Processing', 'Shipped', 'Delivered'];
  if (!allowed.includes(req.body && req.body.status)) {
    return res.status(400).json({ success: false, message: 'Invalid order status' });
  }
  try {
    const order = await Orders.findByIdAndUpdate(req.params.id, { status: req.body.status.toLowerCase() }, { new: true, runValidators: true });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    return res.json({ success: true, data: order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Could not update order status' });
  }
});

router.post('/create', async (req, res) => {
  const {
    //   ticketsId, customerId,
    items
  } = req.body;
  const newOrder = new Orders({
    //    ticketsId, customerId,
    items
  });
  newOrder.status = 'create';
  try {
    await newOrder.save();
    res.json({
      success: true,
      message: 'Order create',
      newOrder
    });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
    });
  }
});

router.post('/submit', async (req, res) => {
  const { id } = req.body;
  try {
    const order = await Orders.findOne({ _id: id });
    const ticketItems = [];
    const orderItemsI = [];

    res.json({
      success: true,
      message: 'orders',
      items: order.items,
      ticketItems,
      orderItemsI,
      palletAvilaval
    });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
    });
  }
});

module.exports = router;
