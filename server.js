/**
 * Simple local server to test the worker service
 * Run with: node server.js
 */

const http = require('http');
const url = require('url');
const worker = require('./api/worker');

const PORT = 3000;

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

