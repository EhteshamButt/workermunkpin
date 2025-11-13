/**
 * Simple local server to test the worker service
 * Run with: node server.js
 */

const http = require('http');
const url = require('url');

const PORT = 3000;

// Load worker using dynamic import since it's an ES module
async function loadWorker() {
  try {
    const workerModule = await import('./api/worker.js');
    const workerHandler = workerModule.default;
    
    // Wrap the worker handler to adapt Vercel-style request/response
    return async function(vercelReq, vercelRes) {
      try {
        // Construct full URL
        const protocol = vercelReq.headers['x-forwarded-proto'] || 'http';
        const host = vercelReq.headers.host || 'localhost:3000';
        const urlPath = vercelReq.url || '/';
        const fullUrl = urlPath.startsWith('http') ? urlPath : `${protocol}://${host}${urlPath}`;
        
        // Create headers object
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
    };
  } catch (error) {
    console.error('Failed to load worker:', error);
    throw error;
  }
}

// Start server after worker is loaded
(async () => {
  const worker = await loadWorker();

  // Create a simple server that wraps Vercel's request/response format
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // Parse request body for POST requests
    let body = {};
    if (req.method === 'POST') {
      let data = '';
      req.on('data', chunk => {
        data += chunk.toString();
      });
      req.on('end', async () => {
        try {
          body = data ? JSON.parse(data) : {};
        } catch (e) {
          body = {};
        }
        
        // Create Vercel-compatible request/response objects
        const vercelReq = {
          method: req.method,
          url: parsedUrl.pathname,
          body: body,
          headers: req.headers,
          connection: req.connection,
          socket: req.socket
        };
        
        const vercelRes = {
          statusCode: 200,
          headers: {},
          setHeader: function(name, value) {
            this.headers[name] = value;
          },
          status: function(code) {
            this.statusCode = code;
            return this;
          },
          json: function(data) {
            this.headers['Content-Type'] = 'application/json';
            res.writeHead(this.statusCode, this.headers);
            res.end(JSON.stringify(data));
          },
          end: function() {
            res.writeHead(this.statusCode, this.headers);
            res.end();
          }
        };
        
        await worker(vercelReq, vercelRes);
      });
    } else {
      // Handle GET requests
      const vercelReq = {
        method: req.method,
        url: parsedUrl.pathname,
        body: {},
        headers: req.headers,
        connection: req.connection,
        socket: req.socket
      };
      
      const vercelRes = {
        statusCode: 200,
        headers: {},
        setHeader: function(name, value) {
          this.headers[name] = value;
        },
        status: function(code) {
          this.statusCode = code;
          return this;
        },
        json: function(data) {
          this.headers['Content-Type'] = 'application/json';
          res.writeHead(this.statusCode, this.headers);
          res.end(JSON.stringify(data));
        },
        end: function() {
          res.writeHead(this.statusCode, this.headers);
          res.end();
        }
      };
      
      await worker(vercelReq, vercelRes);
    }
  });

  server.listen(PORT, () => {
    console.log('🚀 Munkpin Worker Service is running!');
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`\n📋 Available endpoints:`);
    console.log(`   GET  http://localhost:${PORT}/worker/health`);
    console.log(`   GET  http://localhost:${PORT}/worker`);
    console.log(`   POST http://localhost:${PORT}/worker`);
    console.log(`\n🌐 Open test.html in Chrome to test the service`);
    console.log(`\nPress Ctrl+C to stop the server\n`);
  });
})().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

