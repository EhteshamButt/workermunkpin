const fetch = require('node-fetch');
const QRCode = require('qrcode');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');

// Puppeteer is optional (heavy dependency, makes builds slow)
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  console.log('Puppeteer not available - screenshot feature disabled');
  puppeteer = null;
}

/**
 * Unique Multi-Purpose Worker Service for munkpin.com
 * Real functionality: QR codes, image processing, PDFs, webhooks, screenshots, visitor tracking
 */

// Visitor tracking storage (in-memory, resets on server restart)
const visitorTracker = {
  visitors: [],
  stats: {
    totalVisits: 0,
    uniqueVisitors: 0,
    tasksExecuted: 0,
    byTask: {},
    byHour: {},
    startTime: new Date().toISOString()
  }
};

// Allowed domain - only track from munkpin.com
const ALLOWED_DOMAIN = 'munkpin.com';

// Check if request is from allowed domain
function isFromAllowedDomain(req) {
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  const host = req.headers['host'] || '';
  
  // Check if origin, referer, or host contains munkpin.com
  return origin.includes(ALLOWED_DOMAIN) || 
         referer.includes(ALLOWED_DOMAIN) || 
         host.includes(ALLOWED_DOMAIN) ||
         host.includes('localhost'); // Allow localhost for testing
}

// Helper function to get client IP (works on Vercel and localhost)
function getClientIP(req) {
  // Vercel provides IP in these headers (in order of preference)
  const vercelIP = req.headers['x-vercel-forwarded-for'] || 
                   req.headers['x-forwarded-for']?.split(',')[0]?.trim();
  
  // Standard headers
  const realIP = req.headers['x-real-ip'] || 
                 req.headers['cf-connecting-ip'] || // Cloudflare
                 req.headers['x-client-ip'];
  
  // Fallback to connection info (for localhost)
  const connectionIP = req.connection?.remoteAddress || 
                       req.socket?.remoteAddress;
  
  // Return first available IP
  return vercelIP || realIP || connectionIP || '127.0.0.1';
}

// Get location from IP using free API
async function getLocationFromIP(ip) {
  // Clean IP (remove port if present, handle IPv6)
  const cleanIP = ip ? ip.split(':').pop().split(',').shift().trim() : '127.0.0.1';
  
  // Skip localhost/private IPs
  const isPrivateIP = cleanIP === '127.0.0.1' || 
                      cleanIP === '::1' || 
                      cleanIP === 'localhost' || 
                      cleanIP.startsWith('192.168.') || 
                      cleanIP.startsWith('10.') || 
                      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanIP);
  
  if (isPrivateIP) {
    return {
      country: 'Local',
      city: 'Localhost',
      region: 'Development',
      timezone: 'Local Development',
      isp: 'Local Network'
    };
  }

  try {
    // Use ip-api.com free service (no API key needed, 45 requests/minute)
    const response = await fetch(`http://ip-api.com/json/${cleanIP}?fields=status,message,country,countryCode,region,regionName,city,lat,lon,timezone,isp,org,as,query`, {
      timeout: 5000
    });
    const data = await response.json();
    
    if (data.status === 'success') {
      return {
        country: data.country || 'Unknown',
        countryCode: data.countryCode || '',
        city: data.city || 'Unknown',
        region: data.regionName || 'Unknown',
        latitude: data.lat,
        longitude: data.lon,
        timezone: data.timezone || 'Unknown',
        isp: data.isp || 'Unknown',
        org: data.org || 'Unknown'
      };
    } else {
      console.log('IP API returned:', data.message);
    }
  } catch (error) {
    console.error('Error fetching location for IP', cleanIP, ':', error.message);
  }
  
  return {
    country: 'Unknown',
    city: 'Unknown',
    region: 'Unknown',
    timezone: 'Unknown',
    isp: 'Unknown'
  };
}

// Parse user agent to get browser details
function parseUserAgent(userAgent) {
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';
  
  if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari')) browser = 'Safari';
  else if (userAgent.includes('Edge')) browser = 'Edge';
  else if (userAgent.includes('Opera')) browser = 'Opera';
  
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) {
    os = 'Android';
    device = 'Mobile';
  } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    os = 'iOS';
    device = userAgent.includes('iPad') ? 'Tablet' : 'Mobile';
  }
  
  return { browser, os, device };
}

// List of paths to ignore (browser auto-requests)
const IGNORED_PATHS = [
  '/favicon.ico',
  '/sw.js',
  '/service-worker.js',
  '/manifest.json',
  '/robots.txt',
  '/.well-known'
];

// Check if path should be ignored
function shouldIgnorePath(path) {
  if (!path) return true;
  return IGNORED_PATHS.some(ignored => path.includes(ignored));
}

// Track visitor (only for actual user interactions and from munkpin.com)
async function trackVisitor(req, taskType = null) {
  const path = req.url || '/';
  
  // Only track from munkpin.com domain
  if (!isFromAllowedDomain(req) && !req.headers['host']?.includes('localhost')) {
    return null; // Don't track requests from other domains
  }
  
  // Ignore browser auto-requests (favicon, service workers, etc.)
  if (shouldIgnorePath(path) && !taskType) {
    return null; // Don't track these
  }
  
  const ip = getClientIP(req);
  const userAgent = req.headers['user-agent'] || 'unknown';
  const timestamp = new Date().toISOString();
  
  // Get location and browser details
  const location = await getLocationFromIP(ip);
  const browserInfo = parseUserAgent(userAgent);
  
  const visit = {
    id: `visit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ip: ip,
    userAgent: userAgent,
    timestamp: timestamp,
    task: taskType,
    path: path,
    location: location,
    browser: browserInfo.browser,
    os: browserInfo.os,
    device: browserInfo.device,
    country: location.country,
    city: location.city,
    timezone: location.timezone
  };
  
  visitorTracker.visitors.push(visit);
  visitorTracker.stats.totalVisits++;
  
  // Track unique visitors (simple check by IP)
  const uniqueIPs = new Set(visitorTracker.visitors.map(v => v.ip));
  visitorTracker.stats.uniqueVisitors = uniqueIPs.size;
  
  // Track by task
  if (taskType) {
    visitorTracker.stats.tasksExecuted++;
    visitorTracker.stats.byTask[taskType] = (visitorTracker.stats.byTask[taskType] || 0) + 1;
  }
  
  // Track by hour
  const hour = new Date().getHours();
  visitorTracker.stats.byHour[hour] = (visitorTracker.stats.byHour[hour] || 0) + 1;
  
  // Keep only last 1000 visits to prevent memory issues
  if (visitorTracker.visitors.length > 1000) {
    visitorTracker.visitors = visitorTracker.visitors.slice(-1000);
  }
  
  return visit;
}

// Reset visitor tracker
function resetVisitorTracker() {
  visitorTracker.visitors = [];
  visitorTracker.stats = {
    totalVisits: 0,
    uniqueVisitors: 0,
    tasksExecuted: 0,
    byTask: {},
    byHour: {},
    startTime: new Date().toISOString()
  };
}

// Worker task handlers with REAL functionality
const taskHandlers = {
  // Generate QR Code - Returns data URI
  generateQRCode: async (payload) => {
    const { text, size = 200, errorCorrectionLevel = 'M' } = payload;
    
    if (!text) {
      throw new Error('Text is required for QR code generation');
    }

    const qrDataUri = await QRCode.toDataURL(text, {
      width: size,
      margin: 2,
      errorCorrectionLevel: errorCorrectionLevel
    });

    return {
      status: 'success',
      qrCode: qrDataUri,
      text: text,
      size: size,
      format: 'data:image/png;base64',
      timestamp: new Date().toISOString()
    };
  },

  // Process Image - Resize, compress, convert format
  processImage: async (payload) => {
    const { imageUrl, width, height, quality = 80, format = 'jpeg' } = payload;
    
    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    // Fetch the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const imageBuffer = await response.buffer();
    let processedImage = sharp(imageBuffer);

    // Resize if dimensions provided
    if (width || height) {
      processedImage = processedImage.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // Convert and compress based on format
    let outputBuffer;
    let mimeType;
    
    switch (format.toLowerCase()) {
      case 'png':
        outputBuffer = await processedImage.png({ quality }).toBuffer();
        mimeType = 'image/png';
        break;
      case 'webp':
        outputBuffer = await processedImage.webp({ quality }).toBuffer();
        mimeType = 'image/webp';
        break;
      case 'jpeg':
      case 'jpg':
      default:
        outputBuffer = await processedImage.jpeg({ quality }).toBuffer();
        mimeType = 'image/jpeg';
        break;
    }

    const base64Image = outputBuffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${base64Image}`;

    return {
      status: 'success',
      processed: true,
      format: format,
      originalSize: imageBuffer.length,
      processedSize: outputBuffer.length,
      compressionRatio: ((1 - outputBuffer.length / imageBuffer.length) * 100).toFixed(2) + '%',
      image: dataUri,
      timestamp: new Date().toISOString()
    };
  },

  // Generate PDF with Visitor Analytics Report
  generatePDF: async (payload) => {
    const { title = 'Munkpin.com Visitor Analytics Report' } = payload;
    
    // Get all visitor data
    const recentVisits = visitorTracker.visitors.slice(-100).reverse();
    const stats = visitorTracker.stats;

    return new Promise((resolve, reject) => {
      const chunks = [];
      const doc = new PDFDocument({
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        const base64Pdf = pdfBuffer.toString('base64');
        const dataUri = `data:application/pdf;base64,${base64Pdf}`;

        resolve({
          status: 'success',
          pdf: dataUri,
          size: pdfBuffer.length,
          title: title,
          timestamp: new Date().toISOString()
        });
      });

      doc.on('error', reject);

      // Title
      doc.fontSize(20).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.moveDown(2);

      // Summary Statistics
      doc.fontSize(16).font('Helvetica-Bold').text('Summary Statistics', { underline: true });
      doc.moveDown();
      doc.fontSize(12).font('Helvetica');
      doc.text(`Total Visits: ${stats.totalVisits}`, { indent: 20 });
      doc.text(`Unique Visitors: ${stats.uniqueVisitors}`, { indent: 20 });
      doc.text(`Tasks Executed: ${stats.tasksExecuted}`, { indent: 20 });
      doc.text(`Tracking Started: ${new Date(stats.startTime).toLocaleString()}`, { indent: 20 });
      doc.moveDown(2);

      // Tasks Breakdown
      if (Object.keys(stats.byTask).length > 0) {
        doc.fontSize(16).font('Helvetica-Bold').text('Tasks by Type', { underline: true });
        doc.moveDown();
        doc.fontSize(12).font('Helvetica');
        for (const [task, count] of Object.entries(stats.byTask)) {
          doc.text(`${task}: ${count} times`, { indent: 20 });
        }
        doc.moveDown(2);
      }

      // Visitor Details
      if (recentVisits.length > 0) {
        doc.fontSize(16).font('Helvetica-Bold').text('Recent Visitors (Last 50)', { underline: true });
        doc.moveDown();
        doc.fontSize(10).font('Helvetica');
        
        recentVisits.forEach((visit, index) => {
          if (doc.y > 700) { // New page if needed
            doc.addPage();
          }
          
          doc.font('Helvetica-Bold').text(`Visitor #${index + 1}`, { indent: 10 });
          doc.font('Helvetica');
          doc.text(`Time: ${new Date(visit.timestamp).toLocaleString()}`, { indent: 20 });
          doc.text(`IP Address: ${visit.ip}`, { indent: 20 });
          
          if (visit.location) {
            doc.text(`Location: ${visit.location.city || 'N/A'}, ${visit.location.country || 'N/A'}`, { indent: 20 });
            if (visit.location.region) {
              doc.text(`Region: ${visit.location.region}`, { indent: 20 });
            }
            if (visit.location.timezone) {
              doc.text(`Timezone: ${visit.location.timezone}`, { indent: 20 });
            }
            if (visit.location.isp) {
              doc.text(`ISP: ${visit.location.isp}`, { indent: 20 });
            }
          }
          
          if (visit.browser) {
            doc.text(`Browser: ${visit.browser}`, { indent: 20 });
          }
          if (visit.os) {
            doc.text(`OS: ${visit.os}`, { indent: 20 });
          }
          if (visit.device) {
            doc.text(`Device: ${visit.device}`, { indent: 20 });
          }
          if (visit.task) {
            doc.text(`Task Executed: ${visit.task}`, { indent: 20 });
          }
          if (visit.path) {
            doc.text(`Path: ${visit.path}`, { indent: 20 });
          }
          
          doc.moveDown();
        });
      } else {
        doc.fontSize(12).text('No visitors tracked yet.', { indent: 20 });
      }

      // Footer
      doc.moveDown(2);
      doc.fontSize(10).font('Helvetica-Oblique').text(
        `Generated on ${new Date().toLocaleString()} | munkpin.com`,
        { align: 'center' }
      );

      doc.end();
    });
  },

  // Webhook retry with exponential backoff
  retryWebhook: async (payload) => {
    const { url, data, maxRetries = 3, initialDelay = 1000 } = payload;
    
    if (!url) {
      throw new Error('Webhook URL is required');
    }

    let lastError;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Munkpin-Worker/1.0'
          },
          body: JSON.stringify(data || {}),
          timeout: 10000
        });

        if (response.ok) {
          const responseData = await response.json().catch(() => ({}));
          return {
            status: 'success',
            attempt: attempt + 1,
            httpStatus: response.status,
            response: responseData,
            timestamp: new Date().toISOString()
          };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        lastError = error;
        attempt++;
        
        if (attempt < maxRetries) {
          const delay = initialDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    return {
      status: 'failed',
      attempts: attempt,
      error: lastError.message,
      timestamp: new Date().toISOString()
    };
  },

  // Take screenshot of URL (requires puppeteer - optional feature)
  screenshotURL: async (payload) => {
    const { url, width = 1920, height = 1080, fullPage = false } = payload;
    
    if (!url) {
      throw new Error('URL is required for screenshot');
    }

    if (!puppeteer) {
      throw new Error('Screenshot feature is not available. Puppeteer is not installed (it makes builds slow).');
    }

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      const screenshot = await page.screenshot({
        fullPage: fullPage,
        type: 'png'
      });

      const base64Screenshot = screenshot.toString('base64');
      const dataUri = `data:image/png;base64,${base64Screenshot}`;

      return {
        status: 'success',
        screenshot: dataUri,
        url: url,
        dimensions: { width, height },
        fullPage: fullPage,
        timestamp: new Date().toISOString()
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },

  // Transform data - JSON manipulation
  transformData: async (payload) => {
    const { data, operations = [] } = payload;
    
    if (!data) {
      throw new Error('Data is required for transformation');
    }

    let result = JSON.parse(JSON.stringify(data));

    for (const op of operations) {
      switch (op.type) {
        case 'filter':
          if (Array.isArray(result)) {
            result = result.filter(item => {
              return Object.keys(op.criteria || {}).every(key => 
                item[key] === op.criteria[key]
              );
            });
          }
          break;
        
        case 'map':
          if (Array.isArray(result)) {
            result = result.map(item => {
              const mapped = {};
              Object.keys(op.mapping || {}).forEach(key => {
                mapped[op.mapping[key]] = item[key];
              });
              return mapped;
            });
          }
          break;
        
        case 'sort':
          if (Array.isArray(result)) {
            result.sort((a, b) => {
              const aVal = a[op.field];
              const bVal = b[op.field];
              return op.order === 'desc' ? bVal - aVal : aVal - bVal;
            });
          }
          break;
        
        case 'aggregate':
          if (Array.isArray(result)) {
            const agg = {
              count: result.length,
              sum: 0,
              avg: 0,
              min: Infinity,
              max: -Infinity
            };
            
            if (op.field) {
              const values = result.map(item => Number(item[op.field])).filter(v => !isNaN(v));
              agg.sum = values.reduce((a, b) => a + b, 0);
              agg.avg = values.length > 0 ? agg.sum / values.length : 0;
              agg.min = Math.min(...values);
              agg.max = Math.max(...values);
            }
            
            result = agg;
          }
          break;
      }
    }

    return {
      status: 'success',
      transformed: true,
      originalSize: JSON.stringify(data).length,
      resultSize: JSON.stringify(result).length,
      operations: operations.length,
      result: result,
      timestamp: new Date().toISOString()
    };
  },

  // Get visitor analytics
  getAnalytics: async () => {
    const recentVisits = visitorTracker.visitors.slice(-50).reverse();
    return {
      status: 'success',
      stats: visitorTracker.stats,
      recentVisits: recentVisits,
      totalVisits: visitorTracker.visitors.length,
      timestamp: new Date().toISOString()
    };
  },

  // Reset visitor tracker
  resetAnalytics: async () => {
    resetVisitorTracker();
    return {
      status: 'success',
      message: 'Visitor tracker reset successfully',
      timestamp: new Date().toISOString()
    };
  },

  // Health check
  healthCheck: async () => {
    return {
      status: 'healthy',
      service: 'munkpin-worker',
      version: '2.0.0',
      features: [
        'QR Code Generation',
        'Image Processing',
        'PDF Generation',
        'Webhook Retry',
        'URL Screenshots (optional)',
        'Data Transformation',
        'Visitor Tracking'
      ],
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
  }
};

// Main worker handler
async function processWorkerTask(taskType, payload) {
  const handler = taskHandlers[taskType];
  
  if (!handler) {
    throw new Error(`Unknown task type: ${taskType}`);
  }

  try {
    const result = await handler(payload);
    return {
      success: true,
      taskType,
      result
    };
  } catch (error) {
    console.error(`Error processing task ${taskType}:`, error);
    return {
      success: false,
      taskType,
      error: error.message
    };
  }
}

// Vercel serverless function handler
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Track all requests (ignores browser auto-requests)
    const tracked = await trackVisitor(req);
    // If tracking returned null, it was an ignored path or wrong domain - that's fine

    // Health check endpoint
    const url = req.url || '';
    if (req.method === 'GET' && (url === '/worker' || url === '/worker/health' || url === '/api/worker' || url === '/api/worker/health')) {
      const health = await taskHandlers.healthCheck();
      return res.status(200).json({
        message: 'Worker service is running',
        ...health
      });
    }

    // Analytics endpoint
    if (req.method === 'GET' && (url === '/worker/analytics' || url === '/api/worker/analytics')) {
      const analytics = await taskHandlers.getAnalytics();
      return res.status(200).json(analytics);
    }

    // Reset analytics endpoint
    if (req.method === 'POST' && (url === '/worker/analytics/reset' || url === '/api/worker/analytics/reset')) {
      const result = await taskHandlers.resetAnalytics();
      return res.status(200).json(result);
    }

    // Process POST requests
    if (req.method === 'POST') {
      const body = req.body || {};
      const { task, payload } = body;

      if (!task) {
        return res.status(400).json({
          error: 'Task type is required',
          availableTasks: Object.keys(taskHandlers).filter(t => t !== 'healthCheck' && t !== 'getAnalytics' && t !== 'resetAnalytics')
        });
      }

      // Track task execution
      await trackVisitor(req, task);

      const result = await processWorkerTask(task, payload || {});
      
      return res.status(200).json({
        message: 'Task processed',
        ...result
      });
    }

    // Default response
    return res.status(200).json({
      message: 'Munkpin Worker Service - Unique Multi-Purpose Worker',
      version: '2.0.0',
      endpoints: {
        'GET /worker/health': 'Health check',
        'GET /worker/analytics': 'View visitor analytics',
        'POST /worker/analytics/reset': 'Reset visitor analytics',
        'POST /worker': 'Process a task',
      },
      availableTasks: Object.keys(taskHandlers).filter(t => t !== 'healthCheck'),
      features: [
        'Generate QR codes from text',
        'Process images (resize, compress, convert)',
        'Generate PDFs from text',
        'Retry webhooks with exponential backoff',
        'Take screenshots of URLs (optional - requires puppeteer)',
        'Transform JSON data'
      ]
    });

  } catch (error) {
    console.error('Worker error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
