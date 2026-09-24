import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { parseAllowedOrigins } from './config/cors.js';
import compression from 'compression';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { connectDB, getDB } from './config/database.js';
import { enqueueJob, JOBS } from './config/queue.js';

// Import routes
import authRoutes from './routes/auth.js';
import { startTranscodeCacheJanitor } from './services/playback/remuxService.js';
import { detectVideoEncoder } from './services/playback/remuxService.js';
import favoriteRoutes from './routes/favorites.js';
import watchHistoryRoutes from './routes/watchHistory.js';
import commentRoutes from './routes/comments.js';
import premiereRoutes from './routes/premieres.js';
import analyticsRoutes from './routes/analytics.js';
import adminRoutes from './routes/admin.js';
import catalogRoutes from './routes/catalog.js';
import providerRoutes from './routes/providers.js';
import playbackRoutes from './routes/playback.js';
import movieRequestRoutes from './routes/movieRequests.js';
import { catalogRateLimit } from './middleware/rateLimit.js';

dotenv.config();

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
});

const app = express();
const httpServer = createServer(app);
// CORS_ORIGIN / FRONTEND_URL, so a new deployment does not need a code change
// to answer its own domain. Empty in production means "nothing configured",
// which fails loudly rather than quietly serving everyone.
const allowedOrigins = parseAllowedOrigins();
if (allowedOrigins.length === 0) {
  console.warn('[server] CORS_ORIGIN/FRONTEND_URL chưa đặt — trình duyệt sẽ bị từ chối');
}
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

const PORT = process.env.PORT || 5001;

// Middleware
app.use(helmet()); // Security headers
app.use(compression()); // Gzip compression
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging.
//
// Every HLS segment is a request: one viewer generates a line every few
// seconds, and a room full of them buries anything worth reading while filling
// the disk. In production the media assets are dropped and everything else is
// kept; in development the firehose is useful, so nothing changes there.
const LOG_ALL_REQUESTS = process.env.NODE_ENV !== 'production';
app.use((req, res, next) => {
  if (LOG_ALL_REQUESTS || !req.path.startsWith('/api/playback/hls/')) {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'MovieWeb Node.js Backend is running',
    timestamp: new Date().toISOString()
  });
});

import { getReadiness } from './services/health/readiness.js';
import { queueConnection, jobQueue } from './config/queue.js';

app.get('/healthz', async (req, res) => {
  const { ready } = await getReadiness({
    mongoPing: async () => {
      const db = getDB();
      await db.command({ ping: 1 });
    },
    redisPing: async () => {
      await queueConnection.ping();
    }
  });
  if (ready) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({ ready: false });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/watch-history', watchHistoryRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/premieres', premiereRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/catalog', catalogRateLimit, catalogRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/playback', playbackRoutes);
app.use('/api/movie-requests', movieRequestRoutes);

// Socket.IO Logic
const premiereViewers = new Map(); // Track viewers per premiere

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_premiere', async (premiereId) => {
    socket.join(premiereId);

    // Track viewer
    if (!premiereViewers.has(premiereId)) {
      premiereViewers.set(premiereId, new Set());
    }
    premiereViewers.get(premiereId).add(socket.id);

    const viewerCount = premiereViewers.get(premiereId).size;

    console.log(`Socket ${socket.id} joined premiere ${premiereId}. Viewers: ${viewerCount}`);

    // Send chat history
    try {
      const db = getDB();
      const messages = await db.collection('premiere_messages')
        .find({ premiereId })
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray();

      socket.emit('chat_history', messages.reverse());
    } catch (error) {
      console.error('Error loading chat history:', error);
    }

    // Broadcast updated viewer count to all in room
    io.to(premiereId).emit('viewer_count', viewerCount);
  });

  socket.on('leave_premiere', (premiereId) => {
    socket.leave(premiereId);

    // Remove viewer
    if (premiereViewers.has(premiereId)) {
      premiereViewers.get(premiereId).delete(socket.id);
      const viewerCount = premiereViewers.get(premiereId).size;

      // Broadcast updated count
      io.to(premiereId).emit('viewer_count', viewerCount);

      console.log(`Socket ${socket.id} left premiere ${premiereId}. Viewers: ${viewerCount}`);
    }
  });

  socket.on('send_message', async (data) => {
    // data: { premiereId, userId, username, message, timestamp }
    const { premiereId, userId, username, message } = data;

    try {
      const db = getDB();
      const newMessage = {
        premiereId,
        userId,
        username,
        message,
        timestamp: new Date()
      };

      // Save to DB
      await db.collection('premiere_messages').insertOne(newMessage);

      // Broadcast to room
      io.to(premiereId).emit('receive_message', newMessage);
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Remove from all premiere rooms
    premiereViewers.forEach((viewers, premiereId) => {
      if (viewers.has(socket.id)) {
        viewers.delete(socket.id);
        const viewerCount = viewers.size;
        io.to(premiereId).emit('viewer_count', viewerCount);
      }
    });
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production';
  
  if (isProd) {
    // Log full error internally
    console.error('Error [PROD]:', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method
    });

    // Mask sensitive technical details
    const statusCode = err.status || 500;
    let userMessage = 'Internal Server Error';

    if (statusCode === 404) userMessage = 'Nội dung không tồn tại.';
    else if (statusCode === 401 || statusCode === 403) userMessage = 'Bạn không có quyền truy cập.';
    else if (statusCode === 429) userMessage = 'Bạn đang thao tác quá nhanh, vui lòng thử lại sau.';
    else if (statusCode === 422) userMessage = err.message; // Validation errors are usually safe

    return res.status(statusCode).json({
      success: false,
      message: userMessage
    });
  }

  // Development: full detail
  console.error('Error [DEV]:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack: err.stack
  });
});

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    const cacheCleanup = await startTranscodeCacheJanitor();
    console.log(
      `[transcode-cache] scanned=${cacheCleanup.scanned} removed=${cacheCleanup.deletedIds.length} retainedMB=${Math.round(cacheCleanup.retainedBytes / 1024 / 1024)}`,
    );

    // Warm the video-encoder detection so the first playback resolve already
    // knows whether the codec-transcode fallback (HEVC/AV1 -> AVC) is viable.
    // Fire-and-forget: detection degrades to software on failure, never fatal.
    detectVideoEncoder().catch(() => {});


    // Start listening
    httpServer.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
      console.log(`📁 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

import { createShutdown } from './services/health/lifecycle.js';
import dbClient from './config/database.js';
import * as remuxService from './services/playback/remuxService.js';

const shutdown = createShutdown({
  stopAccepting: async () => {
    return new Promise((resolve) => {
      io.close(() => {
        httpServer.close(() => {
          resolve();
        });
      });
    });
  },
  closeJobs: async () => {
    await jobQueue.close();
  },
  closeMedia: async () => {
    if (remuxService.stopAllRemux) {
      await remuxService.stopAllRemux();
    }
  },
  closeStores: async () => {
    await queueConnection.quit();
    await dbClient.close();
  }
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();
