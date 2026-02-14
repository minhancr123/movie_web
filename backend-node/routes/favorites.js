import express from 'express';
import { addFavorite, removeFavorite, getFavorites, checkFavorite } from '../controllers/favoriteController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// All routes are protected
router.use(authMiddleware);

router.post('/', addFavorite);
router.delete('/:movieSlug', removeFavorite);
router.get('/', getFavorites);
router.get('/check/:movieSlug', checkFavorite);

export default router;
