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
  location: {
    // IP-based location (less accurate)
    ip_country: String,
    ip_city: String,
    ip_region: String,
    ip_timezone: String,
    
    // GPS-based location (more accurate, if provided)
    gps_latitude: Number,
    gps_longitude: Number,
    gps_accuracy: Number,
    
    // Browser-detected info
    browser_timezone: String,
    browser_language: String,
    
    // Combined best guess
    final_country: String,
    final_city: String,
    location_source: String // 'gps', 'ip', 'browser', 'combined'
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

// Helper function to get IP geolocation
const getIPGeolocation = async (ip) => {
  try {
    // Skip localhost IPs
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return {
        country: 'Local',
        city: 'Localhost',
        region: 'Local',
        timezone: 'Local'
      };
    }

    // Use ipapi.co (free tier: 30,000 requests/month)
    const response = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!response.ok) throw new Error('IP API failed');
    
    const data = await response.json();
    
    return {
      country: data.country_name || 'Unknown',
      city: data.city || 'Unknown',
      region: data.region || 'Unknown',
      timezone: data.timezone || 'Unknown'
    };
  } catch (error) {
    console.error('IP Geolocation error:', error);
    return {
      country: 'Unknown',
      city: 'Unknown',
      region: 'Unknown',
      timezone: 'Unknown'
    };
  }
};

// Helper function to determine best location
const determineBestLocation = (locationData) => {
  const { ip_country, ip_city, gps_latitude, gps_longitude, browser_timezone } = locationData;
  
  // Priority: GPS > Browser hints > IP
  if (gps_latitude && gps_longitude) {
    return {
      source: 'gps',
      country: ip_country, // Still use IP for country as GPS doesn't give country directly
      city: 'GPS Location' // We'd need reverse geocoding for exact city from GPS
    };
  }
  
  if (browser_timezone && browser_timezone !== 'Unknown') {
    return {
      source: 'browser',
      country: ip_country,
      city: ip_city
    };
  }
  
  return {
    source: 'ip',
    country: ip_country,
    city: ip_city
  };
};

// Routes
app.get('/', (req, res) => {
  res.render('index', { success: false });
});

app.post('/send-message', async (req, res) => {
  try {
    const { 
      message, 
      gps_latitude, 
      gps_longitude, 
      gps_accuracy,
      browser_timezone, 
      browser_language 
    } = req.body;
    
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
    
    // Get IP-based geolocation
    const ipLocation = await getIPGeolocation(clientIP);
    
    // Build location data object
    const locationData = {
      // IP-based location
      ip_country: ipLocation.country,
      ip_city: ipLocation.city,
      ip_region: ipLocation.region,
      ip_timezone: ipLocation.timezone,
      
      // GPS-based location (if provided)
      gps_latitude: gps_latitude || null,
      gps_longitude: gps_longitude || null,
      gps_accuracy: gps_accuracy || null,
      
      // Browser-detected info
      browser_timezone: browser_timezone || 'Unknown',
      browser_language: browser_language || 'Unknown'
    };
    
    // Determine the best location estimate
    const bestLocation = determineBestLocation(locationData);
    locationData.final_country = bestLocation.country;
    locationData.final_city = bestLocation.city;
    locationData.location_source = bestLocation.source;
    
    const newMessage = new Message({
      content: message.trim(),
      ipAddress: clientIP,
      location: locationData,
      timestamp: new Date()
    });

    await newMessage.save();
    
    console.log(`New message from ${bestLocation.city}, ${bestLocation.country} (${bestLocation.source}): ${message.substring(0, 50)}...`);
    
    // Return success response with location info
    res.json({ 
      success: true, 
      message: 'Message sent anonymously!',
      location: {
        city: bestLocation.city,
        country: bestLocation.country,
        source: bestLocation.source
      }
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