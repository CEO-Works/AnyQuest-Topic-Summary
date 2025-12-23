# AgentRelay Integration Guide

## Overview
This guide provides detailed instructions for integrating with AgentRelay. There are two integration methods:

1. **Direct Webhook Relay** (recommended if you're already calling AnyQuest API)
2. **Full Agent Relay** (use AgentRelay to manage agent calls and API keys)

Choose the method that best fits your application architecture.

---

## Method 1: Direct Webhook Relay (Bring Your Own AnyQuest Call)

### Overview
If your application already calls the AnyQuest API directly, you can use AgentRelay purely as a webhook-to-WebSocket relay service. This is the simplest integration method.

### Architecture & Flow

1. **Generate Request ID**: Your app creates a unique request ID (UUID)
2. **Generate Token**: Create authentication token from requestId + WEBHOOK_SECRET
3. **Call AnyQuest API**: Your app calls AnyQuest with webhook URL containing requestId and token
4. **Connect WebSocket**: Your app connects to AgentRelay's WebSocket with the same requestId
5. **Receive Response**: AgentRelay validates the token and pushes response to your WebSocket
6. **Display Result**: Your app receives the response in real-time

### Quick Start

**Webhook URL Format**: `https://anyquest-webhook-relay-production-863f.up.railway.app/webhook/{requestId}?requestId={requestId}&token={token}`

**WebSocket URL**: `wss://anyquest-webhook-relay-production-863f.up.railway.app/ws?id={requestId}`

**Token Generation**: `Buffer.from(\`${requestId}:${WEBHOOK_SECRET}\`).toString('base64').substring(0, 32)`

**Security**: Tokens are validated using a shared secret (WEBHOOK_SECRET) to ensure only authorized webhooks are processed

### Implementation Example

```javascript
const crypto = require('crypto');
const FormData = require('form-data');
const WebSocket = require('ws');
const axios = require('axios');

// Your webhook secret - should match the WEBHOOK_SECRET in AgentRelay's .env
const WEBHOOK_SECRET = 'your-webhook-secret-here';

// Helper function to generate webhook token
function generateWebhookToken(requestId, secret) {
  return Buffer.from(`${requestId}:${secret}`).toString('base64').substring(0, 32);
}

async function processWithAnyQuest(prompt, apiKey) {
  // Step 1: Generate unique request ID
  const requestId = crypto.randomUUID();

  // Step 2: Generate authentication token
  const token = generateWebhookToken(requestId, WEBHOOK_SECRET);

  // Step 3: Build webhook URL with token
  const webhookUrl = `https://anyquest-webhook-relay-production-863f.up.railway.app/webhook/${requestId}?requestId=${requestId}&token=${token}`;

  console.log('Request ID:', requestId);
  console.log('Webhook URL:', webhookUrl);

  // Step 4: Call AnyQuest API with webhook URL
  const formData = new FormData();
  formData.append('webhook', webhookUrl);
  formData.append('Prompt', prompt);
  // Add any other fields your agent needs

  const response = await axios.post('https://api.anyquest.ai/run', formData, {
    headers: {
      'x-api-key': apiKey,
      ...formData.getHeaders()
    }
  });

  console.log('AnyQuest Job ID:', response.data.jobId);

  // Step 5: Connect to WebSocket to receive response
  const wsUrl = `wss://anyquest-webhook-relay-production-863f.up.railway.app/ws?id=${requestId}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('WebSocket connected, waiting for response...');
    });

    ws.on('message', (data) => {
      const response = JSON.parse(data);
      // response.id === requestId
      // response.content === the result from AnyQuest
      console.log('Received response for request ID:', response.id);
      ws.close();
      resolve(response.content);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });

    // Optional: timeout after 60 seconds
    setTimeout(() => {
      ws.close();
      reject(new Error('Response timeout'));
    }, 60000);
  });
}

// Usage
processWithAnyQuest('Summarize the key benefits of cloud computing', 'your-api-key-here')
  .then(result => console.log('Result:', result))
  .catch(error => console.error('Error:', error));
```

### Browser JavaScript Example

```javascript
// Your webhook secret - should match the WEBHOOK_SECRET in AgentRelay's .env
const WEBHOOK_SECRET = 'your-webhook-secret-here';

// Helper function to generate webhook token
function generateWebhookToken(requestId, secret) {
  return btoa(`${requestId}:${secret}`).substring(0, 32);
}

async function processWithAnyQuest(prompt, apiKey) {
  // Step 1: Generate unique request ID
  const requestId = crypto.randomUUID();

  // Step 2: Generate authentication token
  const token = generateWebhookToken(requestId, WEBHOOK_SECRET);

  // Step 3: Build webhook URL with token
  const webhookUrl = `https://anyquest-webhook-relay-production-863f.up.railway.app/webhook/${requestId}?requestId=${requestId}&token=${token}`;

  console.log('Request ID:', requestId);

  // Step 4: Call AnyQuest API with webhook URL
  const formData = new FormData();
  formData.append('webhook', webhookUrl);
  formData.append('Prompt', prompt);

  const response = await fetch('https://api.anyquest.ai/run', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey
    },
    body: formData
  });

  const result = await response.json();
  console.log('Job submitted:', result.jobId);

  // Step 5: Connect to WebSocket to receive response
  const wsUrl = `wss://anyquest-webhook-relay-production-863f.up.railway.app/ws?id=${requestId}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Waiting for response...');
    };

    ws.onmessage = (event) => {
      const response = JSON.parse(event.data);
      ws.close();
      resolve(response.content);
    };

    ws.onerror = (error) => {
      reject(error);
    };
  });
}

// Usage
document.getElementById('submitBtn').addEventListener('click', async () => {
  const prompt = document.getElementById('promptInput').value;
  const apiKey = document.getElementById('apiKeyInput').value;

  try {
    const result = await processWithAnyQuest(prompt, apiKey);
    document.getElementById('output').textContent = result;
  } catch (error) {
    console.error('Error:', error);
    alert('Failed: ' + error.message);
  }
});
```

### Python Example

```python
import requests
import json
import websocket
import uuid
import base64

# Your webhook secret - should match the WEBHOOK_SECRET in AgentRelay's .env
WEBHOOK_SECRET = 'your-webhook-secret-here'

def generate_webhook_token(request_id, secret):
    """Generate webhook token from requestId and secret"""
    token_string = f"{request_id}:{secret}"
    token_bytes = token_string.encode('utf-8')
    token_base64 = base64.b64encode(token_bytes).decode('utf-8')
    return token_base64[:32]

def process_with_anyquest(prompt, api_key):
    # Step 1: Generate unique request ID
    request_id = str(uuid.uuid4())

    # Step 2: Generate authentication token
    token = generate_webhook_token(request_id, WEBHOOK_SECRET)

    # Step 3: Build webhook URL with token
    webhook_url = f"https://anyquest-webhook-relay-production-863f.up.railway.app/webhook/{request_id}?requestId={request_id}&token={token}"

    print(f"Request ID: {request_id}")
    print(f"Webhook URL: {webhook_url}")

    # Step 4: Call AnyQuest API with webhook URL
    files = {
        'webhook': (None, webhook_url),
        'Prompt': (None, prompt)
    }

    response = requests.post(
        'https://api.anyquest.ai/run',
        files=files,
        headers={'x-api-key': api_key}
    )

    result = response.json()
    print(f"Job submitted: {result['jobId']}")

    # Step 5: Connect to WebSocket to receive response
    ws_url = f"wss://anyquest-webhook-relay-production-863f.up.railway.app/ws?id={request_id}"
    ws = websocket.create_connection(ws_url)

    print("Waiting for response...")
    message = ws.recv()
    ws.close()

    response_data = json.loads(message)
    return response_data['content']

# Usage
result = process_with_anyquest(
    "Summarize the benefits of cloud computing",
    "your-api-key-here"
)
print("Result:", result)
```

### Key Points

- **You manage**: AnyQuest API calls, API keys, agent configuration
- **AgentRelay provides**: Webhook endpoint, WebSocket relay, and webhook token validation
- **Security**: Token-based authentication using shared WEBHOOK_SECRET
- **No agent configuration needed**: You don't need to configure agents in AgentRelay
- **Works with any AnyQuest agent**: Use any agent/workflow you have access to

### Token Authentication Flow

1. Your app generates a unique request ID (UUID)
2. Create token: `Buffer.from(\`${requestId}:${WEBHOOK_SECRET}\`).toString('base64').substring(0, 32)`
3. Build webhook URL: `{base_url}/webhook/{requestId}?requestId={requestId}&token={token}`
4. Pass webhook URL to AnyQuest API
5. AnyQuest calls the webhook URL (includes token in query params)
6. AgentRelay validates token by regenerating it and comparing
7. If valid, response is forwarded to WebSocket clients

### Important: WEBHOOK_SECRET Configuration

The `WEBHOOK_SECRET` must be the same in both:
- Your application code (where you generate tokens)
- AgentRelay's `.env` file (where tokens are validated)

Generate a secure random secret:
```bash
# Using OpenSSL
openssl rand -base64 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Method 2: Full Agent Relay (AgentRelay Manages API Calls)

### Overview
This method uses AgentRelay to manage agent configurations, API keys, and make calls to AnyQuest on your behalf. This is useful for applications that need to send data (like app ideas and feedback) to an LLM for summarization or analysis.

### Architecture & Flow

### How It Works
1. **Submit Request**: Your app sends a POST request to AgentRelay with your prompt
2. **Generate Request ID & Token**: AgentRelay generates a unique request ID and authentication token
3. **Relay to AnyQuest**: AgentRelay forwards the request to AnyQuest API using stored API key and webhook URL with token
4. **WebSocket Connection**: Your app connects to the webhook relay WebSocket
5. **Receive Response**: AgentRelay validates the webhook token and pushes the response via WebSocket
6. **Display Result**: Your app receives and displays the LLM-generated summary

### Key Components
- **AgentRelay Server**: Running at `https://anyquest-webhook-relay-production-863f.up.railway.app` (or your deployed URL)
- **Agent ID**: Any agent configured in `agents.json` (e.g., `generic-prompt-agent`)
- **WebSocket Relay**: `wss://anyquest-webhook-relay-production-863f.up.railway.app`
- **Field Names**: Defined per agent in `agents.json` (case-sensitive!)
- **Security**: Webhook tokens are automatically generated and validated using WEBHOOK_SECRET for each request

---

## Method 2 API Reference

### Endpoint: Submit Prompt

**URL**: `POST https://anyquest-webhook-relay-production-863f.up.railway.app/submit`

**Content-Type**: `multipart/form-data`

**Request Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | string | Yes | Must be `"generic-prompt-agent"` |
| `Prompt` | string | Yes | Your prompt text (case-sensitive field name) |

**Response Format**:
```json
{
  "success": true,
  "message": "Server responded with: 200 ",
  "requestId": "4aaf4241-10aa-4409-8061-b16d68f437c0",
  "webhookId": "4aaf4241-10aa-4409-8061-b16d68f437c0",
  "jobId": "6fef5e80-3c66-466d-9604-e5cd2a26cf45",
  "agentId": "generic-prompt-agent"
}
```

**Response Fields**:
- `success`: Boolean indicating if submission was successful
- `message`: Status message from the API
- `requestId`: Unique ID for this request (use this for WebSocket connection)
- `webhookId`: Same as requestId (kept for backwards compatibility)
- `jobId`: AnyQuest job ID for tracking
- `agentId`: Confirmation of which agent processed the request

**Error Response**:
```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

---

## WebSocket Response Mechanism

### Connection
Once you receive the `webhookId` from the submit endpoint, connect to:

**WebSocket URL**: `wss://anyquest-webhook-relay-production-863f.up.railway.app/ws?id={webhookId}`

Replace `{webhookId}` with the actual webhook ID from the submit response.

### Message Format
When the LLM completes processing, you'll receive:

```json
{
  "id": "4aaf4241-10aa-4409-8061-b16d68f437c0",
  "content": "The actual LLM response text will be here..."
}
```

**Message Fields**:
- `id`: The webhook ID (matches your request)
- `content`: The LLM-generated response to your prompt

---

## Implementation Examples

### Example 1: Node.js/Express with Fetch and WebSocket

```javascript
const FormData = require('form-data');
const WebSocket = require('ws');

async function getLLMSummary(appIdeas, feedback) {
  // Step 1: Construct your prompt
  const prompt = `
Summarize the following app ideas and feedback:

App Ideas:
${appIdeas.map((idea, i) => `${i+1}. ${idea}`).join('\n')}

Feedback:
${feedback.map((fb, i) => `- ${fb}`).join('\n')}

Please provide a concise summary of the overall sentiment and key themes.
  `.trim();

  // Step 2: Submit to AgentRelay
  const formData = new FormData();
  formData.append('agentId', 'generic-prompt-agent');
  formData.append('Prompt', prompt);

  const response = await fetch('https://anyquest-webhook-relay-production-863f.up.railway.app/submit', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  // Step 3: Connect to WebSocket for response
  const webhookId = result.webhookId;
  const wsUrl = `wss://anyquest-webhook-relay-production-863f.up.railway.app/ws?id=${webhookId}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('WebSocket connected, waiting for response...');
    });

    ws.on('message', (data) => {
      const response = JSON.parse(data);
      console.log('Received LLM response for ID:', response.id);
      ws.close();
      resolve(response.content);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });

    // Optional: Add timeout
    setTimeout(() => {
      ws.close();
      reject(new Error('Response timeout'));
    }, 60000); // 60 second timeout
  });
}

// Usage
const appIdeas = [
  "AI-powered task manager",
  "Social media analytics dashboard",
  "Collaborative code editor"
];

const feedback = [
  "Love the AI task manager idea!",
  "Analytics dashboard seems useful",
  "Not sure about the code editor market"
];

getLLMSummary(appIdeas, feedback)
  .then(summary => {
    console.log('Summary:', summary);
    // Display in your application
  })
  .catch(error => {
    console.error('Error:', error);
  });
```

### Example 2: Browser JavaScript (Frontend)

```javascript
async function getLLMSummary(appIdeas, feedback) {
  // Construct prompt
  const prompt = `
Summarize the following app ideas and feedback:

App Ideas:
${appIdeas.map((idea, i) => `${i+1}. ${idea}`).join('\n')}

Feedback:
${feedback.map((fb, i) => `- ${fb}`).join('\n')}

Please provide a concise summary.
  `.trim();

  // Submit to AgentRelay
  const formData = new FormData();
  formData.append('agentId', 'generic-prompt-agent');
  formData.append('Prompt', prompt);

  const response = await fetch('https://anyquest-webhook-relay-production-863f.up.railway.app/submit', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  // Connect to WebSocket
  const webhookId = result.webhookId;
  const wsUrl = `wss://anyquest-webhook-relay-production-863f.up.railway.app/ws?id=${webhookId}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Connected, waiting for response...');
      // Update UI: show loading state
    };

    ws.onmessage = (event) => {
      const response = JSON.parse(event.data);
      ws.close();
      resolve(response.content);
    };

    ws.onerror = (error) => {
      reject(error);
    };
  });
}

// Usage in your app
document.getElementById('generateSummary').addEventListener('click', async () => {
  const appIdeas = getAppIdeasFromUI(); // Your function
  const feedback = getFeedbackFromUI(); // Your function

  try {
    const summary = await getLLMSummary(appIdeas, feedback);
    document.getElementById('summaryOutput').textContent = summary;
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to generate summary: ' + error.message);
  }
});
```

### Example 3: Python with requests and websocket-client

```python
import requests
import json
import websocket

def get_llm_summary(app_ideas, feedback):
    # Construct prompt
    ideas_text = '\n'.join([f"{i+1}. {idea}" for i, idea in enumerate(app_ideas)])
    feedback_text = '\n'.join([f"- {fb}" for fb in feedback])

    prompt = f"""
Summarize the following app ideas and feedback:

App Ideas:
{ideas_text}

Feedback:
{feedback_text}

Please provide a concise summary.
    """.strip()

    # Submit to AgentRelay
    files = {
        'agentId': (None, 'generic-prompt-agent'),
        'Prompt': (None, prompt)
    }

    response = requests.post('https://anyquest-webhook-relay-production-863f.up.railway.app/submit', files=files)
    result = response.json()

    if not result['success']:
        raise Exception(result.get('error', 'Submission failed'))

    # Connect to WebSocket
    webhook_id = result['webhookId']
    ws_url = f"wss://anyquest-webhook-relay-production-863f.up.railway.app/ws?id={webhook_id}"

    # Receive response
    ws = websocket.create_connection(ws_url)
    message = ws.recv()
    ws.close()

    response_data = json.loads(message)
    return response_data['content']

# Usage
app_ideas = [
    "AI-powered task manager",
    "Social media analytics dashboard"
]

feedback = [
    "Love the task manager!",
    "Analytics looks useful"
]

summary = get_llm_summary(app_ideas, feedback)
print("Summary:", summary)
```

---

## Important Notes

### Field Name Case Sensitivity
The field name is **`Prompt`** with a capital P. This must match exactly as configured in `agents.json`.

### WebSocket Connection Timing
- Connect to the WebSocket **immediately after** receiving the `webhookId`
- The response can arrive at any time (typically 5-30 seconds)
- Implement a timeout (recommend 60-120 seconds)

### Error Handling
Handle these common error scenarios:
1. **AgentRelay server not running**: Check connection to `https://anyquest-webhook-relay-production-863f.up.railway.app`
2. **Invalid agent ID**: Ensure `agentId` is exactly `"generic-prompt-agent"`
3. **WebSocket connection failure**: Check network and firewall settings
4. **Timeout**: LLM processing can take time; implement retry logic if needed
5. **Invalid API key**: The agent's API key must be valid in `agents.json`

### Rate Limiting
- Be mindful of AnyQuest API rate limits
- Consider implementing queue management for multiple requests
- Add delays between bulk submissions if needed

---

## Testing Your Integration

### Quick Test with curl

```bash
# Test submission
curl -X POST https://anyquest-webhook-relay-production-863f.up.railway.app/submit \
  -F "agentId=generic-prompt-agent" \
  -F "Prompt=Summarize: This is a test prompt"

# Response will include webhookId - use it to connect WebSocket
```

### Test Checklist
- [ ] AgentRelay server is running (`node server.js`)
- [ ] Can successfully POST to `/submit` endpoint
- [ ] Receive valid `webhookId` in response
- [ ] Can establish WebSocket connection with webhook ID
- [ ] Receive response message within expected timeframe
- [ ] Can parse and display the content

---

## Deployment Considerations

### If Deploying AgentRelay
When deploying to production, update these URLs in your application:

- **AgentRelay URL**: Change from `https://anyquest-webhook-relay-production-863f.up.railway.app` to your deployed URL
- **WebSocket URL**: Remains `wss://anyquest-webhook-relay-production-863f.up.railway.app` (external service)

### Environment Variables
AgentRelay uses:
- `REST_SERVICE_URL`: AnyQuest API endpoint (default: `https://api.anyquest.ai`)
- `WEBHOOK_URL`: Webhook relay service (default: configured relay)
- `PORT`: Server port (default: 3000)

### CORS Configuration
If your application runs on a different domain, ensure AgentRelay has CORS enabled for your origin.

---

## Troubleshooting

### Problem: "Invalid agent" error
**Solution**: Verify `agentId` is exactly `"generic-prompt-agent"` (check spelling and case)

### Problem: "Agent has no API key configured"
**Solution**: Check `agents.json` and ensure the API key is set for generic-prompt-agent

### Problem: WebSocket connection fails
**Solution**:
- Verify webhook ID is correct
- Check network allows WSS connections
- Ensure webhook relay service is accessible

### Problem: No response received
**Solution**:
- Check AnyQuest API status
- Verify API key is valid
- Look at AgentRelay server logs for errors
- Increase timeout duration

### Problem: Field name not recognized
**Solution**: The field must be `Prompt` (capital P), not `prompt`

---

## Support & Additional Resources

- **AgentRelay Repository**: Review `server.js` for implementation details
- **Agents Configuration**: Check `agents.json` for current agent setup
- **Server Logs**: Monitor console output for debugging information
- **AnyQuest API**: Refer to AnyQuest documentation for API details

---

## Summary

To integrate the generic prompt agent:

1. **Submit your prompt** via POST to `/submit` with `agentId` and `Prompt` fields
2. **Extract webhookId** from the response
3. **Connect WebSocket** to the relay service with the webhook ID
4. **Listen for message** containing the LLM response
5. **Display the content** in your application

This architecture provides real-time LLM responses without polling, using webhook-to-WebSocket relay for efficient delivery.
