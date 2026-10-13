// Evaluated before Express/routes so Sentry can instrument the HTTP stack.
import dotenv from 'dotenv';
import { initSentry } from './sentry.js';
dotenv.config();
initSentry();
