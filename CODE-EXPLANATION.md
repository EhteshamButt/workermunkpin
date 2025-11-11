# 📚 Code Explanation - Munkpin Worker Service

This document explains what each file does and which parts of the code handle specific functionality.

---

## 📁 File Structure Overview

```
munkpin-worker/
├── api/
│   └── worker.js          # Main serverless function (BACKEND)
├── public/
│   ├── index.html         # Landing page (FRONTEND)
│   └── simple-example.html # Test interface (FRONTEND)
├── utils/
│   └── taskQueue.js      # Task queue utility (not currently used)
├── vercel.json           # Vercel deployment configuration
├── package.json          # Dependencies and scripts
└── server.js             # Local development server
```

---

## 🔧 **api/worker.js** - Main Backend Serverless Function

This is the **core file** that handles all backend logic. It runs as a Vercel serverless function.

### **1. Dependencies & Setup (Lines 1-31)**

```javascript
const fetch = require('node-fetch');      // HTTP requests
const QRCode = require('qrcode');         // QR code generation
const sharp = require('sharp');           // Image processing
const PDFDocument = require('pdfkit');     // PDF generation
```

**What it does:**
- Imports required libraries
- Makes `puppeteer` optional (heavy dependency, slows builds)
- Initializes `visitorTracker` object to store visitor data in memory

**Key Part:**
```javascript
const visitorTracker = {
  visitors: [],           // Array of visitor objects
  stats: {                // Statistics object
    totalVisits: 0,
    uniqueVisitors: 0,
    tasksExecuted: 0,
    byTask: {},          // Count of each task type
    byHour: {},          // Visits per hour
    startTime: new Date().toISOString()
  }
};
```

---

### **2. Domain Filtering (Lines 33-49)**

```javascript
function isFromAllowedDomain(req)
```

**What it does:**
- Checks if request comes from allowed domains (`munkpin.com`, `vercel.app`, `localhost`)
- Prevents tracking from unauthorized domains
- Returns `true` if domain is allowed, `false` otherwise

**Why:** Security - only track visitors from your own domains

---

### **3. IP Address Detection (Lines 51-68)**

```javascript
function getClientIP(req)
```

**What it does:**
- Extracts client IP address from various HTTP headers
- Handles Vercel-specific headers (`x-vercel-forwarded-for`)
- Falls back to connection info for localhost testing
- Returns the IP address as a string

**Why:** Need IP to get location and track unique visitors

---

### **4. Location Lookup (Lines 70-130)**

```javascript
async function getLocationFromIP(ip)
```

**What it does:**
- Takes an IP address
- Skips private/localhost IPs (returns "Local" location)
- Calls `ip-api.com` free API to get:
  - Country, City, Region
  - Latitude/Longitude
  - Timezone, ISP
- Returns location object or "Unknown" if fails

**Why:** Track where visitors are coming from geographically

---

### **5. User Agent Parsing (Lines 132-180)**

```javascript
function parseUserAgent(userAgent)
```

**What it does:**
- Parses browser User-Agent string
- Extracts: Browser name, OS, Device type
- Returns object with `{ browser, os, device }`

**Why:** Know what browsers/devices visitors use

---

### **6. Visitor Tracking (Lines 182-231)**

```javascript
async function trackVisitor(req, taskType = null)
```

**What it does:**
- Main tracking function called on every request
- Checks if request is from allowed domain
- Ignores browser auto-requests (favicon, service workers)
- Gets IP, location, browser info
- Creates visit object and adds to `visitorTracker.visitors`
- Updates statistics (total visits, unique visitors, tasks, hourly)
- Keeps only last 1000 visits (memory management)

**Key Part:**
```javascript
const visit = {
  id: `visit_${Date.now()}_${Math.random()...}`,
  ip: ip,
  userAgent: userAgent,
  timestamp: timestamp,
  task: taskType,              // What task they executed
  path: path,                  // URL path
  location: location,          // Country, city, etc.
  browser: browserInfo.browser,
  os: browserInfo.os,
  device: browserInfo.device
};
```

**Why:** Track all visitor activity for analytics

---

### **7. Task Handlers (Lines 246-693)**

This is where all the **actual features** are implemented:

#### **A. generateQRCode (Lines 248-270)**
- **What:** Creates QR code from text
- **Uses:** `qrcode` library
- **Returns:** Base64 data URI of QR code image

#### **B. processImage (Lines 272-331)**
- **What:** Downloads, resizes, compresses images
- **Uses:** `sharp` library
- **Features:** Resize, convert format (JPEG/PNG/WebP), compress
- **Returns:** Processed image as base64 data URI

#### **C. generatePDF (Lines 333-449)**
- **What:** Creates PDF report with visitor analytics
- **Uses:** `pdfkit` library
- **Content:** Summary stats, task breakdown, recent visitor details
- **Returns:** PDF as base64 data URI

#### **D. retryWebhook (Lines 451-503)**
- **What:** Sends HTTP POST to webhook URL with retry logic
- **Features:** Exponential backoff (1s, 2s, 4s delays)
- **Returns:** Success/failure status with attempt count

#### **E. screenshotURL (Lines 505-549)**
- **What:** Takes screenshot of any website
- **Uses:** `puppeteer` (optional - may not be installed)
- **Returns:** Screenshot as base64 image
- **Note:** Disabled if puppeteer not available (build optimization)

#### **F. transformData (Lines 551-628)**
- **What:** Manipulates JSON data
- **Operations:** Filter, map, sort, aggregate
- **Returns:** Transformed data with operation details

#### **G. getAnalytics (Lines 630-662)**
- **What:** Returns visitor tracking data
- **Returns:** Stats object + recent visits array
- **Safety:** Initializes tracker if undefined

#### **H. resetAnalytics (Lines 664-672)**
- **What:** Clears all visitor tracking data
- **Returns:** Success message

#### **I. healthCheck (Lines 674-692)**
- **What:** Returns service status
- **Returns:** Version, features list, uptime

---

### **8. Task Processor (Lines 695-718)**

```javascript
async function processWorkerTask(taskType, payload)
```

**What it does:**
- Takes task type and payload
- Finds the correct handler from `taskHandlers`
- Executes handler and returns result
- Handles errors gracefully

**Why:** Centralized task execution with error handling

---

### **9. Main HTTP Handler (Lines 720-831)**

```javascript
module.exports = async (req, res)
```

**This is the entry point** - Vercel calls this function for every request.

**Flow:**

1. **CORS Setup (Lines 722-730)**
   - Sets CORS headers to allow cross-origin requests
   - Handles OPTIONS preflight requests

2. **Visitor Tracking (Line 734)**
   - Tracks every request automatically

3. **URL Routing (Lines 737-758)**
   - Parses URL to determine endpoint
   - Checks for `/health`, `/analytics`, `/analytics/reset`
   - Handles Vercel rewrite paths

4. **Health Check Endpoint (Lines 760-766)**
   - Returns service status

5. **Analytics Endpoint (Lines 768-772)**
   - Returns visitor statistics

6. **Reset Analytics Endpoint (Lines 774-778)**
   - Clears tracking data

7. **POST Task Processing (Lines 780-801)**
   - Processes task requests
   - Validates task type
   - Executes task and returns result

8. **Default Response (Lines 803-822)**
   - Returns API documentation if no specific endpoint matched

9. **Error Handling (Lines 824-830)**
   - Catches all errors and returns 500 status

---

## 🎨 **public/simple-example.html** - Test Interface

This is the **frontend test page** where users can test all features.

### **Structure:**

1. **HTML/CSS (Lines 1-180)**
   - Professional styling
   - Input fields for each feature
   - Buttons to trigger actions
   - Result display areas

2. **JavaScript Functions (Lines 182-350)**

   - **`viewAnalytics()`** (Lines 182-236)
     - Fetches analytics from `/worker/analytics`
     - Displays stats in formatted table
     - Shows recent visits with location
     - Error handling with user-friendly messages

   - **`resetAnalytics()`** (Lines 238-252)
     - Sends POST to `/worker/analytics/reset`
     - Confirms before resetting

   - **`testConnection()`** (Lines 254-264)
     - Tests `/worker/health` endpoint

   - **`generateQR()`** (Lines 256-272)
     - Sends POST with `task: 'generateQRCode'`
     - Displays QR code image

   - **`processImage()`** (Lines 274-295)
     - Sends POST with `task: 'processImage'`
     - Displays processed image

   - **`generatePDF()`** (Lines 297-328)
     - Sends POST with `task: 'generatePDF'`
     - Stores PDF data for download
     - Shows download button

   - **`takeScreenshot()`** (Lines 330-350)
     - Sends POST with `task: 'screenshotURL'`
     - Displays screenshot

3. **BASE_URL Detection (Line 160)**
   ```javascript
   const BASE_URL = window.location.origin + '/worker';
   ```
   - Automatically detects current domain
   - Works on localhost and production

---

## 🏠 **public/index.html** - Landing Page

Professional landing page that shows:
- Service description
- Available endpoints
- Features list
- Quick start guide
- Links to test interface

**Purpose:** Documentation and marketing page

---

## ⚙️ **vercel.json** - Deployment Configuration

```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "public",
  "functions": {
    "api/worker.js": {
      "maxDuration": 60,    // 60 second timeout
      "memory": 1024        // 1GB RAM
    }
  },
  "rewrites": [
    {
      "source": "/worker",
      "destination": "/api/worker"
    },
    {
      "source": "/worker/:path*",
      "destination": "/api/worker"
    }
  ]
}
```

**What it does:**
- Configures serverless function settings
- Maps `/worker/*` URLs to `/api/worker` function
- Sets timeout and memory limits
- Specifies `public` folder for static files

**Why:** Vercel needs this to know how to route requests

---

## 📦 **package.json** - Dependencies

```json
{
  "dependencies": {
    "node-fetch": "^2.7.0",    // HTTP requests
    "qrcode": "^1.5.3",        // QR code generation
    "sharp": "^0.33.0",        // Image processing
    "pdfkit": "^0.14.0"        // PDF generation
  }
}
```

**What it does:**
- Lists all required packages
- Defines scripts (dev, build, start)
- Specifies Node.js version requirement

---

## 🔄 **utils/taskQueue.js** - Task Queue Utility

**Status:** Created but not currently used in main code

**What it does:**
- Manages a queue of tasks
- Can enqueue/dequeue tasks
- Tracks task status

**Purpose:** Could be used for background task processing (future feature)

---

## 🔀 Request Flow Example

**When user clicks "Generate QR Code" button:**

1. **Frontend (`simple-example.html`):**
   ```javascript
   fetch('/worker', {
     method: 'POST',
     body: JSON.stringify({
       task: 'generateQRCode',
       payload: { text: 'https://munkpin.com', size: 200 }
     })
   })
   ```

2. **Vercel Rewrite:**
   - `/worker` → `/api/worker` (via `vercel.json`)

3. **Backend (`api/worker.js`):**
   - `module.exports` function receives request
   - Tracks visitor (line 734)
   - Routes to POST handler (line 781)
   - Extracts `task` and `payload` (line 783)
   - Calls `processWorkerTask('generateQRCode', payload)` (line 795)
   - Executes `taskHandlers.generateQRCode()` (line 249)
   - Returns QR code as base64 image

4. **Frontend:**
   - Receives response
   - Displays QR code image in result div

---

## 🎯 Key Concepts

### **1. Serverless Function**
- Runs on-demand (not always running)
- Each request spawns a new instance
- Stateless (data resets between requests)
- **Exception:** `visitorTracker` is in-memory (resets on cold start)

### **2. CORS (Cross-Origin Resource Sharing)**
- Allows frontend to call API from different domain
- Set in lines 722-725

### **3. Base64 Data URIs**
- Images/PDFs returned as `data:image/png;base64,...`
- Can be used directly in `<img src="...">` tags
- No separate file storage needed

### **4. Visitor Tracking**
- In-memory storage (lost on server restart)
- Filters by domain
- Ignores browser auto-requests
- Tracks: IP, location, browser, OS, device, tasks

---

## 🐛 Common Issues & Solutions

### **Issue: Analytics returns undefined**
- **Cause:** Visitor tracker not initialized
- **Fix:** Added safety checks in `getAnalytics()` (lines 632-645)

### **Issue: 404 on `/worker/analytics`**
- **Cause:** Vercel rewrites change URL path
- **Fix:** Check multiple path sources (lines 742-758)

### **Issue: Location shows "Local"**
- **Cause:** Private IP address (localhost, 192.168.x.x)
- **Fix:** Normal behavior - real IPs show real locations

---

## 📝 Summary

- **`api/worker.js`**: Main backend - handles all API logic, tasks, tracking
- **`public/simple-example.html`**: Frontend test interface
- **`public/index.html`**: Landing/documentation page
- **`vercel.json`**: Deployment configuration
- **`package.json`**: Dependencies

The system works by:
1. Frontend sends requests to `/worker/*`
2. Vercel rewrites to `/api/worker`
3. Backend processes request, tracks visitor, executes task
4. Returns result to frontend
5. Frontend displays result

All visitor activity is automatically tracked and can be viewed via the analytics endpoint!

