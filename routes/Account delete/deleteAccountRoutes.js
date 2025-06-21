const express = require('express');
const router = express.Router();
const { deleteAccount } = require('../../controller/Delete Account Setting/deleteAccountController');
const {authMiddleware} = require('../../middlewares/authMiddlewares'); // JWT middleware

router.post('/delete-account', authMiddleware, deleteAccount);

module.exports = router;
