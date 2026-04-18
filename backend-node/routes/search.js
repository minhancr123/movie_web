import express from 'express';
import { searchCatalog } from '../controllers/searchController.js';

const router = express.Router();

router.get('/', searchCatalog);

export default router;
