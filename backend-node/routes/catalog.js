import express from 'express';
import {
  getHome,
  searchCatalog,
  discoverCatalog,
  getGenres,
  getDetail,
  getSeason,
} from '../controllers/catalogController.js';

const router = express.Router();

// Specific paths must precede /:type/:tmdbId so they are not swallowed by it.
router.get('/home', getHome);
router.get('/search', searchCatalog);
router.get('/discover', discoverCatalog);
router.get('/genres/:type', getGenres);
router.get('/tv/:tmdbId/season/:season', getSeason);
router.get('/:type/:tmdbId', getDetail);

export default router;
