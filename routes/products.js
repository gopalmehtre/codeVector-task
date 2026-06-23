const { Router } = require('express');
const { getProducts, getCategories, healthCheck } = require('../controllers/productsController');

const router = Router();

router.get('/products', getProducts);
router.get('/categories', getCategories);
router.get('/health', healthCheck);

module.exports = router;
