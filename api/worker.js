// Cloudflare Workers compatible imports
// Note: sharp, pdfkit, and puppeteer don't work in Cloudflare Workers
// Using dynamic imports for compatibility
let QRCode;
try {
  QRCode = require('qrcode');
} catch (e) {
  console.log('QRCode not available');
  QRCode = null;
}

// Cloudflare Workers environment detection
const IS_CLOUDFLARE = typeof caches !== 'undefined';

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
function isFromAllowedDomain(request) {
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';
  const host = request.headers.get('host') || '';
  
  // Check if origin, referer, or host contains munkpin.com or Cloudflare Workers domain
  return origin.includes(ALLOWED_DOMAIN) || 
         referer.includes(ALLOWED_DOMAIN) || 
         host.includes(ALLOWED_DOMAIN) ||
         host.includes('localhost') || // Allow localhost for testing
         host.includes('workers.dev') || // Allow Cloudflare Workers deployments
         host.includes('workerlocationpcikerweb'); // Allow this specific deployment
}

// Helper function to get client IP (works on Cloudflare Workers and localhost)
function getClientIP(request) {
  // Cloudflare Workers provides IP in cf-connecting-ip header
  const cfIP = request.headers.get('cf-connecting-ip');
  
  // Standard headers
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIP = request.headers.get('x-real-ip');
  
  // Return first available IP (Cloudflare header takes priority)
  return cfIP || forwardedFor || realIP || '127.0.0.1';
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
async function trackVisitor(request, taskType = null) {
  const url = new URL(request.url);
  const path = url.pathname || '/';
  
  // Only track from munkpin.com domain
  if (!isFromAllowedDomain(request) && !request.headers.get('host')?.includes('localhost')) {
    return null; // Don't track requests from other domains
  }
  
  // Ignore browser auto-requests (favicon, service workers, etc.)
  if (shouldIgnorePath(path) && !taskType) {
    return null; // Don't track these
  }
  
  const ip = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || 'unknown';
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

    if (!QRCode) {
      throw new Error('QR Code generation is not available in Cloudflare Workers environment');
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
  // NOTE: Image processing (sharp) is not available in Cloudflare Workers
  processImage: async (payload) => {
    const { imageUrl } = payload;
    
    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    // In Cloudflare Workers, we can only fetch and return the image
    // Full processing requires sharp which doesn't work in Workers
    if (IS_CLOUDFLARE) {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      
      const imageArrayBuffer = await response.arrayBuffer();
      const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageArrayBuffer)));
      const mimeType = response.headers.get('content-type') || 'image/jpeg';
      const dataUri = `data:${mimeType};base64,${base64Image}`;

      return {
        status: 'success',
        processed: false,
        note: 'Image processing (resize/compress) is not available in Cloudflare Workers. Image fetched and returned as-is.',
        format: mimeType,
        originalSize: imageArrayBuffer.byteLength,
        image: dataUri,
        timestamp: new Date().toISOString()
      };
    }

    throw new Error('Image processing requires sharp library which is not available in Cloudflare Workers');
  },

  // Generate PDF with Visitor Analytics Report
  // NOTE: PDF generation (pdfkit) is not available in Cloudflare Workers
  generatePDF: async (payload) => {
    const { title = 'Munkpin.com Visitor Analytics Report' } = payload;
    
    if (IS_CLOUDFLARE) {
      // Return analytics data as JSON instead of PDF
      const recentVisits = visitorTracker.visitors.slice(-100).reverse();
      const stats = visitorTracker.stats;
      
      return {
        status: 'success',
        note: 'PDF generation is not available in Cloudflare Workers. Returning analytics data as JSON instead.',
        format: 'json',
        title: title,
        data: {
          stats: stats,
          recentVisits: recentVisits,
          generatedAt: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };
    }

    throw new Error('PDF generation requires pdfkit library which is not available in Cloudflare Workers');
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

  // Take screenshot of URL (requires puppeteer - not available in Cloudflare Workers)
  screenshotURL: async (payload) => {
    const { url } = payload;
    
    if (!url) {
      throw new Error('URL is required for screenshot');
    }

    throw new Error('Screenshot feature is not available in Cloudflare Workers. Puppeteer requires Node.js runtime which is not supported.');
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
    // Ensure visitorTracker is initialized
    if (!visitorTracker.stats) {
      visitorTracker.stats = {
        totalVisits: 0,
        uniqueVisitors: 0,
        tasksExecuted: 0,
        byTask: {},
        byHour: {},
        startTime: new Date().toISOString()
      };
    }
    if (!visitorTracker.visitors) {
      visitorTracker.visitors = [];
    }
    
    const recentVisits = visitorTracker.visitors.slice(-50).reverse();
    return {
      status: 'success',
      stats: visitorTracker.stats || {
        totalVisits: 0,
        uniqueVisitors: 0,
        tasksExecuted: 0,
        byTask: {},
        byHour: {},
        startTime: new Date().toISOString()
      },
      recentVisits: recentVisits || [],
      totalVisits: visitorTracker.visitors.length || 0,
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
      uptime: IS_CLOUDFLARE ? 'N/A (Cloudflare Workers)' : process.uptime()
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

// Cloudflare Workers handler (Fetch API)
const workerHandler = {
  async fetch(request, env, ctx) {
    // Set CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    // Handle OPTIONS request
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    try {
      // Track all requests (ignores browser auto-requests)
      await trackVisitor(request);

      const url = new URL(request.url);
      const urlPath = url.pathname;
      const query = url.searchParams;
      
      // Check for analytics in query or path
      const isAnalyticsRequest = urlPath.includes('/analytics') || 
                                 query.get('analytics') === 'true' ||
                                 query.get('endpoint') === 'analytics';
      const isResetRequest = urlPath.includes('/analytics/reset') || 
                            query.get('reset') === 'true';
      const isHealthRequest = urlPath.includes('/health') || 
                             urlPath === '/worker' || 
                             urlPath === '/' ||
                             query.get('health') === 'true';
      
      if (request.method === 'GET' && isHealthRequest) {
        const health = await taskHandlers.healthCheck();
        return new Response(JSON.stringify({
          message: 'Worker service is running',
          ...health
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Analytics endpoint
      if (request.method === 'GET' && isAnalyticsRequest && !isResetRequest) {
        const analytics = await taskHandlers.getAnalytics();
        return new Response(JSON.stringify(analytics), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Reset analytics endpoint
      if (request.method === 'POST' && isResetRequest) {
        const result = await taskHandlers.resetAnalytics();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Process POST requests
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { task, payload } = body;

        if (!task) {
          return new Response(JSON.stringify({
            error: 'Task type is required',
            availableTasks: Object.keys(taskHandlers).filter(t => t !== 'healthCheck' && t !== 'getAnalytics' && t !== 'resetAnalytics')
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Track task execution
        await trackVisitor(request, task);

        const result = await processWorkerTask(task, payload || {});
        
        return new Response(JSON.stringify({
          message: 'Task processed',
          ...result
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Default response
      return new Response(JSON.stringify({
        message: 'Munkpin Worker Service - Unique Multi-Purpose Worker',
        version: '2.0.0',
        platform: 'Cloudflare Workers',
        endpoints: {
          'GET /worker/health': 'Health check',
          'GET /worker/analytics': 'View visitor analytics',
          'POST /worker/analytics/reset': 'Reset visitor analytics',
          'POST /worker': 'Process a task',
        },
        availableTasks: Object.keys(taskHandlers).filter(t => t !== 'healthCheck'),
        features: [
          'Generate QR codes from text',
          'Fetch images (full processing not available in Workers)',
          'Get analytics as JSON (PDF generation not available in Workers)',
          'Retry webhooks with exponential backoff',
          'Transform JSON data',
          'Visitor Tracking'
        ],
        limitations: [
          'Image processing (resize/compress) requires sharp library (not available in Workers)',
          'PDF generation requires pdfkit library (not available in Workers)',
          'Screenshots require puppeteer (not available in Workers)'
        ]
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// Adapter function to convert Vercel-style request/response to Fetch API
async function adapterFunction(vercelReq, vercelRes) {
  try {
    // Construct full URL - vercelReq.url might be just pathname, so we need to construct full URL
    const protocol = vercelReq.headers['x-forwarded-proto'] || 'http';
    const host = vercelReq.headers.host || 'localhost:3000';
    // If url doesn't start with /, it might already be a full URL
    const urlPath = vercelReq.url || '/';
    const fullUrl = urlPath.startsWith('http') ? urlPath : `${protocol}://${host}${urlPath}`;
    
    // Create headers object - Node.js http headers are lowercase keys
    const headersObj = {};
    for (const [key, value] of Object.entries(vercelReq.headers || {})) {
      headersObj[key] = value;
    }
    
    // Create Fetch API Request object
    const requestInit = {
      method: vercelReq.method || 'GET',
      headers: headersObj
    };
    
    // Add body for POST requests
    if ((vercelReq.method === 'POST' || vercelReq.method === 'PUT' || vercelReq.method === 'PATCH') && vercelReq.body) {
      requestInit.body = typeof vercelReq.body === 'string' ? vercelReq.body : JSON.stringify(vercelReq.body);
      if (!headersObj['content-type'] && !headersObj['Content-Type']) {
        headersObj['Content-Type'] = 'application/json';
      }
    }
    
    const request = new Request(fullUrl, requestInit);
    
    // Call the worker handler
    const response = await workerHandler.fetch(request);
    
    // Convert Fetch API Response to Vercel-style response
    const statusCode = response.status;
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    vercelRes.statusCode = statusCode;
    Object.keys(headers).forEach(key => {
      vercelRes.setHeader(key, headers[key]);
    });
    
    const responseBody = await response.text();
    
    try {
      const jsonData = JSON.parse(responseBody);
      vercelRes.json(jsonData);
    } catch (e) {
      vercelRes.setHeader('Content-Type', 'text/plain');
      vercelRes.status(statusCode);
      vercelRes.end(responseBody);
    }
  } catch (error) {
    console.error('Adapter error:', error);
    vercelRes.statusCode = 500;
    vercelRes.setHeader('Content-Type', 'application/json');
    vercelRes.json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

// CommonJS export for Node.js local server
// This allows server.js to use: const worker = require('./api/worker');
if (typeof module !== 'undefined' && module.exports) {
  module.exports = adapterFunction;
}

// ES6 export for Cloudflare Workers
// NOTE: Uncomment the line below when deploying to Cloudflare Workers
// For local testing, keep it commented so require() works
// export default workerHandler;
