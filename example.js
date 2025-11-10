/**
 * Example usage of the Munkpin Worker Service
 * 
 * After deploying to Vercel, you can use these examples
 * Replace 'munkpin.com' with your actual domain
 */

const WORKER_URL = 'https://munkpin.com/worker';

// Example 1: Health Check
async function checkHealth() {
  try {
    const response = await fetch(`${WORKER_URL}/health`);
    const data = await response.json();
    console.log('Health Check:', data);
    return data;
  } catch (error) {
    console.error('Health check failed:', error);
  }
}

// Example 2: Process Data Task
async function processDataTask(data) {
  try {
    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        task: 'processData',
        payload: { data }
      })
    });
    const result = await response.json();
    console.log('Task Result:', result);
    return result;
  } catch (error) {
    console.error('Task failed:', error);
  }
}

// Example 3: Send Notification
async function sendNotification(message, recipient) {
  try {
    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        task: 'sendNotification',
        payload: { message, recipient }
      })
    });
    const result = await response.json();
    console.log('Notification Result:', result);
    return result;
  } catch (error) {
    console.error('Notification failed:', error);
  }
}

// Example 4: Process Webhook
async function processWebhook(webhookData) {
  try {
    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        task: 'processWebhook',
        payload: webhookData
      })
    });
    const result = await response.json();
    console.log('Webhook Result:', result);
    return result;
  } catch (error) {
    console.error('Webhook processing failed:', error);
  }
}

// Run examples (uncomment to test)
// checkHealth();
// processDataTask('Sample data to process');
// sendNotification('Hello!', 'user@example.com');
// processWebhook({ id: 'webhook_123', event: 'user.created' });

module.exports = {
  checkHealth,
  processDataTask,
  sendNotification,
  processWebhook
};

