/* eslint-disable consistent-return */
/* eslint-disable prettier/prettier */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-undef */
/* eslint-disable node/no-unsupported-features/es-syntax */
const express = require('express');

const router = express.Router();
const Item = require('../model/Item');
const Pallet = require('../model/Pallets');
const Location = require('../model/Location');
const validators = require('../validators/records');
const inventoryService = require('../services/inventoryService');
const { resolveWarehouse, resolveLocation, movePallet } = require('../services/tenantService');

function helperNotGoodSize(location, pallet, maxLocation) {
  let result = false;
  const endSize = location + pallet;
  if (endSize > maxLocation) {
    result = true;
  }
  return result;
}

// get pallet query status
router.post('/status', async (req, res) => {
  const { status } = req.body;

  const pallets = await Pallet.find({
    status
  });
  if (!pallets) {
    res.json({
      success: false,
      message: `pallets not fond on status (${status})`
    });
  } else {
    res.json({
      success: true,
      message: `pallets  fond on status (${status})`,
      pallets: pallets
    });
  }
});

router.post('/create', async (req, res) => {
  try {
    const body = validators.inventory({ ...(req.body || {}), quantity: req.body?.quantity ?? req.body?.cont }, 'stock-in');
    if (req.tenant?.companyId) {
      const warehouse = await resolveWarehouse(req, body.warehouseId || req.tenant.activeWarehouseId);
      body.warehouseId = String(warehouse._id);
      await resolveLocation(req, body.location, body.warehouseId);
    }
    if (!body.skuNumber) return res.status(400).json({ success: false, message: 'skuNumber is required to create a pallet' });
    const result = await inventoryService.receiveNewPallet({ ...body, requestKey: req.get('Idempotency-Key'), userId: req.auth.id });
    const locations = await Location.find({ skuNumber: body.skuNumber });
    return res.status(result.idempotentReplay ? 200 : 201).json({ success: true, message: 'pallet create', newPallet: result.pallet, locations, idempotentReplay: result.idempotentReplay });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Could not create pallet' });
  }
});

router.post('/send', async (req, res) => {
  const { id, location } = req.body;
  if (!location) return res.json({ success: false, message: 'need location ' });
  try {
    const result = await movePallet(req, id, location, { requireReceived: true });
    return res.json({ success: true, message: 'pallet stored', pallet: result.pallet, locationFond: result.location });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not store pallet' });
  }
});

router.post('/dynamicsend', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, message: 'need id ' });
  try {
    const result = await movePallet(req, id, null, { requireReceived: true, findAvailable: true });
    return res.json({ success: true, message: 'pallet stored', pallet: result.pallet, locationFond: result.location });
  } catch (error) {
    console.log('error', error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not find a putaway location' });
  }
});

router.post('/pike-pallet', async (req, res) => {
  const { id } = req.body;

  const pallet = await Pallet.findOne({
    _id: id
  });
  if (!pallet) return res.json({ success: false, message: 'rouge ID' });
  if (pallet.status === 'r/p') {
    res.json({
      success: true,
      message: `pallet is  take to (${pallet.location})`,
      location: pallet.location,
      pallet
    });
  } else {
    res.json({
      success: false,
      message: `pallet is  not r/p   (${pallet.status})`
    });
  }
});

router.post('/valedation', async (req, res) => {
  const { id, location } = req.body;
  const pallet = await Pallet.findOne({
    _id: id
  });
  if (pallet.status !== 'r/p') {
    return res.json({
      success: false,
      message: `pallet is not r/p status is:(${pallet.status} status)`
    });
  }
  if (!pallet) {
    res.json({
      success: false,
      message: `pallet not found (${id})`
    });
  } else if (pallet.location === location) {
    pallet.status = 'store';
    pallet.save();
    res.json({
      success: true,
      message: `pallet is  store in (${pallet.location})`,
      location: pallet.location,
      pallet
    });
  } else {
    res.json({
      success: false,
      message: `location is  not valet   (${location})`
    });
  }
});

router.post('/get-chart-data', async (req, res) => {
  locationTotal = [];
  palletTotal = [];
  try {
    const locationOccupied = await Location.countDocuments({
      status: 'occupied'
    });
    const locationEmpty = await Location.countDocuments({
      status: 'empty'
    });
    const locationUpcoming = await Location.countDocuments({
      status: 'upcoming'
    });
    const locationMaintenance = await Location.countDocuments({
      status: 'maintenance'
    });
    locationTotal[0] = locationOccupied;
    locationTotal[1] = locationEmpty;
    locationTotal[2] = locationUpcoming;
    locationTotal[3] = locationMaintenance;
    const palletStore = await Pallet.countDocuments({
      status: 'store'
    });
    const palletPutAway = await Pallet.countDocuments({
      status: 'r/p'
    });
    const palletReceived = await Pallet.countDocuments({
      status: 'received'
    });
    palletTotal[0] = palletStore;
    palletTotal[1] = palletPutAway;
    palletTotal[2] = palletReceived;

    res.json({
      success: true,
      message: `locationTotal is  store in (locationTotal)`,
      locationTotal,
      palletTotal
    });
  } catch (error) {
    res.json({
      success: false,
      message: error
    });
  }
});

module.exports = router;
