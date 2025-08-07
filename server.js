const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/anonymous_board';
mongoose.connect(MONGODB_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// Message Schema
const messageSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
    maxLength: 1000
  },
  ipAddress: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const Message = mongoose.model('Message', messageSchema);

// Trust proxy to get real IP addresses (must be set before other middleware)
app.set('trust proxy', true);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Helper function to get client IP
const getClientIP = (req) => {
  // Try multiple methods to get the real IP
  let ip = req.headers['x-forwarded-for'] ||
           req.headers['x-real-ip'] ||
           req.headers['x-client-ip'] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           req.ip ||
           '127.0.0.1';
  
  // Handle comma-separated IPs (take the first one)
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  
  // Convert IPv6 loopback to IPv4 for consistency
  if (ip === '::1') {
    ip = '127.0.0.1';
  }
  
  // Remove IPv6 prefix if present
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  
  return ip;
};

// Routes
app.get('/', (req, res) => {
  res.render('index', { success: false });
});

app.post('/send-message', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Message cannot be empty' 
      });
    }

    if (message.length > 1000) {
      return res.status(400).json({ 
        success: false, 
        error: 'Message too long (max 1000 characters)' 
      });
    }

    const clientIP = getClientIP(req);
    
    const newMessage = new Message({
      content: message.trim(),
      ipAddress: clientIP,
      timestamp: new Date()
    });

    await newMessage.save();
    
    console.log(`New message saved: ${message.substring(0, 50)}... from IP: ${clientIP}`);
    
    // Return success response
    res.json({ 
      success: true, 
      message: 'Message sent anonymously!' 
    });

  } catch (error) {
    console.error('Error saving message:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send message. Please try again.' 
    });
  }
});

// Optional: Route to view messages (for testing - remove in production)
app.get('/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: -1 }).limit(50);
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Optional: Route to get message count
app.get('/stats', async (req, res) => {
  try {
    const count = await Message.countDocuments();
    res.json({ totalMessages: count });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Anonymous Message Board running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`MongoDB URI: ${MONGODB_URI.replace(/\/\/.*:.*@/, '//***:***@')}`); // Hide credentials in logs
});