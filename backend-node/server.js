import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { connectDB, getDB } from './config/database.js';

// Import routes
import authRoutes from './routes/auth.js';
import { createDefaultAdmin } from './controllers/authController.js';
import favoriteRoutes from './routes/favorites.js';
import watchHistoryRoutes from './routes/watchHistory.js';
import commentRoutes from './routes/comments.js';
import premiereRoutes from './routes/premieres.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true
  }
});

const PORT = process.env.PORT || 5001;

// Middleware
app.use(helmet()); // Security headers
app.use(compression()); // Gzip compression
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
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

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/watch-history', watchHistoryRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/premieres', premiereRoutes);
app.use('/api/premieres', premiereRoutes);

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
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    await createDefaultAdmin();

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

startServer();
