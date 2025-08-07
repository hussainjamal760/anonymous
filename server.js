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
  deviceInfo: {
    // Basic device info
    userAgent: String,
    platform: String,
    isMobile: Boolean,
    isTablet: Boolean,
    isDesktop: Boolean,
    
    // Device details
    deviceType: String, // 'mobile', 'tablet', 'desktop'
    deviceBrand: String, // 'Apple', 'Samsung', 'Google', etc.
    deviceModel: String,
    operatingSystem: String, // 'iOS', 'Android', 'Windows', etc.
    osVersion: String,
    browser: String, // 'Chrome', 'Safari', 'Firefox', etc.
    browserVersion: String,
    
    // Screen info
    screenWidth: Number,
    screenHeight: Number,
    colorDepth: Number,
    pixelRatio: Number,
    
    // Network info
    connectionType: String, // '4g', 'wifi', etc.
    isOnline: Boolean,
    
    // Hardware features
    touchSupport: Boolean,
    cookiesEnabled: Boolean,
    javaEnabled: Boolean,
    
    // Battery info (if available)
    batteryLevel: Number,
    batteryCharging: Boolean,
    
    // Sensors (if available)
    hasGyroscope: Boolean,
    hasAccelerometer: Boolean,
    hasCompass: Boolean
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

// Helper function to parse device info from user agent
const parseDeviceInfo = (userAgent, deviceData) => {
  const ua = userAgent.toLowerCase();
  let deviceInfo = {
    userAgent: userAgent,
    platform: deviceData.platform || 'Unknown',
    isMobile: deviceData.isMobile || false,
    isTablet: deviceData.isTablet || false,
    isDesktop: !deviceData.isMobile && !deviceData.isTablet,
    
    // Default values
    deviceType: 'desktop',
    deviceBrand: 'Unknown',
    deviceModel: 'Unknown',
    operatingSystem: 'Unknown',
    osVersion: 'Unknown',
    browser: 'Unknown',
    browserVersion: 'Unknown',
    
    // Screen and hardware info from client
    screenWidth: deviceData.screenWidth || null,
    screenHeight: deviceData.screenHeight || null,
    colorDepth: deviceData.colorDepth || null,
    pixelRatio: deviceData.pixelRatio || null,
    connectionType: deviceData.connectionType || 'Unknown',
    isOnline: deviceData.isOnline !== undefined ? deviceData.isOnline : true,
    touchSupport: deviceData.touchSupport || false,
    cookiesEnabled: deviceData.cookiesEnabled !== undefined ? deviceData.cookiesEnabled : true,
    javaEnabled: deviceData.javaEnabled || false,
    batteryLevel: deviceData.batteryLevel || null,
    batteryCharging: deviceData.batteryCharging || null,
    hasGyroscope: deviceData.hasGyroscope || false,
    hasAccelerometer: deviceData.hasAccelerometer || false,
    hasCompass: deviceData.hasCompass || false
  };

  // Determine device type
  if (deviceData.isMobile) {
    deviceInfo.deviceType = 'mobile';
  } else if (deviceData.isTablet) {
    deviceInfo.deviceType = 'tablet';
  }

  // Parse Operating System
  if (ua.includes('android')) {
    deviceInfo.operatingSystem = 'Android';
    const androidMatch = ua.match(/android ([0-9\.]+)/);
    if (androidMatch) deviceInfo.osVersion = androidMatch[1];
  } else if (ua.includes('iphone') || ua.includes('ipad')) {
    deviceInfo.operatingSystem = ua.includes('ipad') ? 'iPadOS' : 'iOS';
    const iosMatch = ua.match(/os ([0-9_]+)/);
    if (iosMatch) deviceInfo.osVersion = iosMatch[1].replace(/_/g, '.');
  } else if (ua.includes('windows')) {
    deviceInfo.operatingSystem = 'Windows';
    if (ua.includes('windows nt 10.0')) deviceInfo.osVersion = '10/11';
    else if (ua.includes('windows nt 6.3')) deviceInfo.osVersion = '8.1';
    else if (ua.includes('windows nt 6.1')) deviceInfo.osVersion = '7';
  } else if (ua.includes('mac os')) {
    deviceInfo.operatingSystem = 'macOS';
    const macMatch = ua.match(/mac os x ([0-9_]+)/);
    if (macMatch) deviceInfo.osVersion = macMatch[1].replace(/_/g, '.');
  } else if (ua.includes('linux')) {
    deviceInfo.operatingSystem = 'Linux';
  }

  // Parse Browser
  if (ua.includes('chrome') && !ua.includes('edg')) {
    deviceInfo.browser = 'Chrome';
    const chromeMatch = ua.match(/chrome\/([0-9\.]+)/);
    if (chromeMatch) deviceInfo.browserVersion = chromeMatch[1];
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    deviceInfo.browser = 'Safari';
    const safariMatch = ua.match(/version\/([0-9\.]+)/);
    if (safariMatch) deviceInfo.browserVersion = safariMatch[1];
  } else if (ua.includes('firefox')) {
    deviceInfo.browser = 'Firefox';
    const firefoxMatch = ua.match(/firefox\/([0-9\.]+)/);
    if (firefoxMatch) deviceInfo.browserVersion = firefoxMatch[1];
  } else if (ua.includes('edg')) {
    deviceInfo.browser = 'Microsoft Edge';
    const edgeMatch = ua.match(/edg\/([0-9\.]+)/);
    if (edgeMatch) deviceInfo.browserVersion = edgeMatch[1];
  }

  // Parse Device Brand and Model
  if (ua.includes('iphone')) {
    deviceInfo.deviceBrand = 'Apple';
    if (ua.includes('iphone os')) {
      // Determine iPhone model based on user agent patterns
      if (ua.includes('iphone14')) deviceInfo.deviceModel = 'iPhone 14';
      else if (ua.includes('iphone13')) deviceInfo.deviceModel = 'iPhone 13';
      else if (ua.includes('iphone12')) deviceInfo.deviceModel = 'iPhone 12';
      else deviceInfo.deviceModel = 'iPhone';
    }
  } else if (ua.includes('ipad')) {
    deviceInfo.deviceBrand = 'Apple';
    deviceInfo.deviceModel = 'iPad';
  } else if (ua.includes('samsung')) {
    deviceInfo.deviceBrand = 'Samsung';
    if (ua.includes('galaxy')) deviceInfo.deviceModel = 'Galaxy';
  } else if (ua.includes('pixel')) {
    deviceInfo.deviceBrand = 'Google';
    deviceInfo.deviceModel = 'Pixel';
  } else if (ua.includes('oneplus')) {
    deviceInfo.deviceBrand = 'OnePlus';
  } else if (ua.includes('xiaomi')) {
    deviceInfo.deviceBrand = 'Xiaomi';
  } else if (ua.includes('huawei')) {
    deviceInfo.deviceBrand = 'Huawei';
  }

  return deviceInfo;
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
      browser_language,
      // Device info from client
      deviceInfo: clientDeviceInfo
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
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
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
    
    // Parse comprehensive device information
    const deviceInfo = parseDeviceInfo(userAgent, clientDeviceInfo || {});
    
    const newMessage = new Message({
      content: message.trim(),
      ipAddress: clientIP,
      location: locationData,
      deviceInfo: deviceInfo,
      timestamp: new Date()
    });

    await newMessage.save();
    
    console.log(`📱 New message from ${deviceInfo.deviceBrand} ${deviceInfo.deviceModel} (${deviceInfo.operatingSystem}) in ${bestLocation.city}, ${bestLocation.country}`);
    
    // Return success response with location and device info
    res.json({ 
      success: true, 
      message: 'Message sent anonymously!',
      location: {
        city: bestLocation.city,
        country: bestLocation.country,
        source: bestLocation.source
      },
      device: {
        type: deviceInfo.deviceType,
        brand: deviceInfo.deviceBrand,
        model: deviceInfo.deviceModel,
        os: deviceInfo.operatingSystem,
        browser: deviceInfo.browser
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