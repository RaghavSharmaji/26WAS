const express = require('express');

const router = express.Router();
const authRoutes = require('./auth.routes');
const asyncHandler = require('../middleware/asyncHandler');

// @route   POST api/user
// @desc    Register new user
// @access  Public
router.post('/', asyncHandler(authRoutes.register));

module.exports = router;
