/* eslint-disable radix */
/* eslint-disable prettier/prettier */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-undef */
/* eslint-disable node/no-unsupported-features/es-syntax */
const express = require('express');

const router = express.Router();
const Item = require('../model/Item');
const Pallet = require('../model/Pallets');
const validators = require('../validators/records');
const inventoryService = require('../services/inventoryService');
const { requireCompanyRole } = require('../middleware/companyAuthorization');
const { requireCompanyPermission } = require('../middleware/permissions');
const { resolveWarehouse, resolveLocation, movePallet } = require('../services/tenantService');
const Location = require('../model/Location');

// function helperUniqItem(arr, idParam) {
//   let result = true;
//   arr.forEach(function(item) {
//     if (item === idParam) {
//       result = false;
//       console.log('good');
//     }
//   });
//   console.log('arr', arr[0]);
//   console.log('id', idParam);
//   console.log('result', result);
//   return result;
// }

function helperNotGoodSize(location, pallet, maxLocation) {
  let result = false;
  const endSize = location + pallet;
  if (endSize > maxLocation) {
    result = true;
  }
  return result;
}

router.get('/', async (req, res) => {
  try {
    const pagination = req.query.pagination
      ? parseInt(req.query.pagination)
      : 50;
    const page = req.query.page ? parseInt(req.query.page) : 1;
    delete req.query.pagination;
    delete req.query.page;

    const queryPallet = await Pallet.find(req.query)
      .skip(pagination * page - pagination)
      .limit(pagination);
    const count = await Pallet.countDocuments(req.query);
    res.json({
      success: true,
      pallets: queryPallet,
      query: req.query,
      total: count,
      pages: Math.ceil(count / pagination)
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Could not update pallet'
    });
  }
});

router.get('/skuNumber/:skuNumber', async (req, res) => {
  const { skuNumber } = req.params;
  try {
    const palletsFond = await Pallet.find({
      skuNumber: skuNumber
    });

    if (palletsFond <= 0) {
      res.json({
        success: false,
        message: `items not fond (${skuNumber})`
      });
    } else {
      res.json({
        success: true,
        message: `items fond `,
        pallets: palletsFond
      });
    }
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
    });
  }
});

router.get('/id/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const palletFond = await Pallet.findOne({
      _id: id
    }).populate({ path: 'item', select: 'name' });

    if (!palletFond) {
      res.json({
        success: false,
        message: `id not fond (${id})`
      });
    } else {
      res.json({
        success: true,
        message: `id found `,
        pallet: palletFond
      });
    }
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
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
    return res.status(result.idempotentReplay ? 200 : 201).json({ success: true, message: 'pallet create', item: result.pallet, locations, idempotentReplay: result.idempotentReplay });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Could not create pallet' });
  }
});

// eslint-disable-next-line consistent-return
router.post('/update', async (req, res) => {
  const { id, status, location } = req.body;
  try {
    if (status !== undefined) {
      let permitted = false;
      requireCompanyPermission('inventory.update')(req, res, () => { permitted = true; });
      if (!permitted) return;
      if (!Pallet.STATUS_VALUES.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid pallet status' });
      }
    }
    if (location !== undefined) {
      if (typeof location !== 'string' || !location.trim()) return res.status(400).json({ success: false, message: 'A valid destination location is required' });
      const moved = await movePallet(req, id, location.trim(), { status });
      return res.json({ success: true, message: 'pallet Updated', pallet: moved.pallet, locationFond: moved.location });
    }
    const pallet = await Pallet.findOne({
      _id: id
    });

    if (!pallet) {
      res.json({
        success: false,
        message: `pallet not fond (${id})`
      });
    } else {
      if (status !== undefined) pallet.status = status;
      await pallet.save();
      res.json({ success: true, message: 'pallet Updated', pallet });
    }
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
    });
  }
});

router.delete('/delete', requireCompanyRole('company_admin'), async (req, res) => {
  const { id } = req.body;
  try {
    const pallet = await Pallet.findOne({ _id: id });
    if (pallet) {
      if ((pallet.contAvailable || 0) > 0 || pallet.movementLog.length > 0) {
        return res.status(409).json({ success: false, message: 'Pallet has stock or movement history and cannot be deleted' });
      }
      const locationFond = await Location.findOne({
        palletId: id
      });
      if (locationFond) {
        const result = locationFond.palletId.filter(
          item => item === pallet._id
        );
        locationFond.palletId = result;
        locationFond.size -= pallet.size;
        if (result <= 0) {
          locationFond.skuNumber = null;
        }
        await locationFond.save();
      }
      await pallet.delete();
      res.json({
        success: true,
        message: 'done',
        data: pallet,
        locationFond
      });
    } else {
      res.json({
        success: false,
        message: 'not fond',
        data: pallet,
        locationFond
      });
    }
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
    });
  }
});

module.exports = router;
