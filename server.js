require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const {randomUUID} = require('crypto');

// Initialize the Express app
const app = express();
const port = process.env.PORT || 3000;

// Set up Multer for file uploads (temp storage)
const upload = multer({ dest: 'uploads/' });

// Path to agents configuration file
const AGENTS_CONFIG_FILE = path.join(__dirname, 'agents.json');

// Predefined REST service endpoint
const REST_SERVICE_URL = process.env.REST_SERVICE_URL || 'https://api.anyquest.ai';
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://anyquest-webhook-relay-production-863f.up.railway.app/webhook/";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Validate WEBHOOK_SECRET is configured
if (!WEBHOOK_SECRET) {
  console.error('WARNING: WEBHOOK_SECRET is not configured in environment variables!');
  console.error('Webhook authentication will not work. Please set WEBHOOK_SECRET in your .env file.');
}

// Helper function to generate webhook token from requestId
function generateWebhookToken(requestId, secret) {
  if (!secret) {
    throw new Error('WEBHOOK_SECRET is not configured');
  }
  return Buffer.from(`${requestId}:${secret}`).toString('base64').substring(0, 32);
}

// Load agents configuration from JSON file
function loadAgentsConfig() {
  try {
    if (fs.existsSync(AGENTS_CONFIG_FILE)) {
      const data = fs.readFileSync(AGENTS_CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    } else {
      console.warn('agents.json not found, creating default...');
      const defaultConfig = { agents: {} };
      fs.writeFileSync(AGENTS_CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
  } catch (error) {
    console.error('Error loading agents config:', error.message);
    return { agents: {} };
  }
}

// Save agents configuration to JSON file
function saveAgentsConfig(config) {
  try {
    fs.writeFileSync(AGENTS_CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('Agents configuration saved');
    return true;
  } catch (error) {
    console.error('Error saving agents config:', error.message);
    return false;
  }
}

let agentsConfig = loadAgentsConfig();
console.log('Loaded agents:', Object.keys(agentsConfig.agents).join(', ') || 'none');

// Middleware to parse JSON requests
app.use(express.json());

// Serve the static `index.html` file
app.use(express.static(path.join(__dirname)));

// Set up WebSocket server
const wss = new WebSocketServer({ noServer: true });
let connectedClients = [];

// Map webhook request IDs to agent IDs for handling callbacks
const webhookToAgent = new Map();

// Handle WebSocket connections
wss.on('connection', (ws) => {
  connectedClients.push(ws);
  ws.on('close', () => {
    connectedClients = connectedClients.filter((client) => client !== ws);
  });
});

// Upgrade HTTP server to WebSocket server
app.server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log('Configuration:');
  console.log('- REST_SERVICE_URL:', REST_SERVICE_URL);
  console.log('- WEBHOOK_URL:', WEBHOOK_URL);
  console.log('- Configured Agents:', Object.keys(agentsConfig.agents).length > 0 ? Object.keys(agentsConfig.agents).join(', ') : 'NONE');
});
app.server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Serve the `index.html` file at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve the admin interface
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Return list of available agents with their field configurations (no API keys)
app.get('/agents', (req, res) => {
  const agentsList = {};
  Object.entries(agentsConfig.agents).forEach(([id, agent]) => {
    agentsList[id] = {
      name: agent.name,
      description: agent.description,
      fields: agent.fields
    };
  });
  res.json({ agents: agentsList });
});

// Get a specific agent (including API key for admin)
app.get('/agents/:id', (req, res) => {
  const agentId = req.params.id;
  const agent = agentsConfig.agents[agentId];

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  res.json({ agentId, ...agent });
});

// Create or update an agent
app.post('/agents/:id', (req, res) => {
  const agentId = req.params.id;
  const { name, apiKey, description, fields } = req.body;

  // Validate required fields
  if (!name || !apiKey || !fields || !Array.isArray(fields)) {
    return res.status(400).json({ error: 'Missing required fields: name, apiKey, fields' });
  }

  // Update or create agent
  agentsConfig.agents[agentId] = {
    name,
    apiKey,
    description: description || '',
    fields
  };

  // Save to file
  if (saveAgentsConfig(agentsConfig)) {
    res.json({ success: true, message: 'Agent saved', agentId });
  } else {
    res.status(500).json({ error: 'Failed to save agent configuration' });
  }
});

// Delete an agent
app.delete('/agents/:id', (req, res) => {
  const agentId = req.params.id;

  if (!agentsConfig.agents[agentId]) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  delete agentsConfig.agents[agentId];

  if (saveAgentsConfig(agentsConfig)) {
    res.json({ success: true, message: 'Agent deleted' });
  } else {
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

// Register webhook (for Method 1: Direct webhook relay)
// Returns the webhook URL with token for authentication
app.post('/webhook/register', (req, res) => {
  const { requestId } = req.body;

  if (!requestId) {
    return res.status(400).json({
      error: 'Missing required field: requestId'
    });
  }

  try {
    // Generate token for this request
    const token = generateWebhookToken(requestId, WEBHOOK_SECRET);

    console.log('Registered webhook:', requestId);

    // Return the webhook URL with token
    const webhookUrl = `${WEBHOOK_URL}${requestId}?requestId=${requestId}&token=${token}`;

    res.json({
      success: true,
      message: 'Webhook registered successfully',
      requestId,
      webhookUrl,
      token
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Handle dynamic form submissions with file uploads
app.post('/submit', upload.array('files'), async (req, res) => {
  const requestId = randomUUID();

  try {
    // Get agent ID from request
    const agentId = req.body.agentId;

    // Validate agent exists
    if (!agentId || !agentsConfig.agents[agentId]) {
      return res.status(400).json({
        success: false,
        error: `Invalid agent: ${agentId}. Available agents: ${Object.keys(agentsConfig.agents).join(', ')}`
      });
    }

    const agent = agentsConfig.agents[agentId];
    const apiKey = agent.apiKey;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: `Agent ${agentId} has no API key configured`
      });
    }

    // Store webhook-to-agent mapping for callback handling
    webhookToAgent.set(requestId, agentId);

    // Generate token for webhook authentication
    const token = generateWebhookToken(requestId, WEBHOOK_SECRET);
    const webhookUrlWithToken = `${WEBHOOK_URL}${requestId}?requestId=${requestId}&token=${token}`;

    console.log('Submitting to agent:', agent.name);
    console.log('Webhook URL:', webhookUrlWithToken);
    console.log('API URL:', REST_SERVICE_URL + "/run");

    // Create FormData (AnyQuest API expects multipart/form-data, not JSON)
    const formData = new FormData();
    formData.append('webhook', webhookUrlWithToken);

    // Add all form fields dynamically
    agent.fields.forEach(field => {
      if (field.type === 'file') {
        // Handle file uploads
        if (req.files && req.files.length > 0) {
          req.files.forEach((file) => {
            formData.append('files', fs.createReadStream(file.path), file.originalname);
          });
        }
      } else {
        // Handle text fields
        const value = req.body[field.name];
        if (value) {
          formData.append(field.name, value);
        }
      }
    });

    // Send to AnyQuest API
    const response = await axios.post(REST_SERVICE_URL + "/run", formData, {
      headers: {
        'x-api-key': apiKey,
        ...formData.getHeaders(),
      },
    });

    // Clean up uploaded files
    if (req.files) {
      req.files.forEach((file) => fs.unlinkSync(file.path));
    }

    // Send response back to the client with request ID
    res.json({
      success: true,
      message: 'Server responded with: ' + response.status + ' ' + response.statusText,
      requestId: requestId,
      webhookId: requestId, // Keep for backwards compatibility
      jobId: response.data.jobId,
      agentId: agentId
    });
  } catch (error) {
    console.error('Error submitting:', error.message);
    console.error('Error status:', error.response?.status);
    console.error('Error response data:', JSON.stringify(error.response?.data));

    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach((file) => fs.unlinkSync(file.path));
    }

    res.status(500).json({
      success: false,
      error: 'An error occurred while submitting: ' + (error.response?.data?.message || error.message)
    });
  }
});

// Handle webhook POST requests
app.post('/webhook/:id', express.text({type: '*/*'}), (req, res) => {
  const eventType = req.headers['aq-event-type'];
  const requestId = req.params.id;
  const receivedToken = req.query.token;
  const queryRequestId = req.query.requestId;

  console.log('Webhook received - Request ID:', requestId, 'Event Type:', eventType);
  console.log('Connected clients:', connectedClients.length);

  // Validate webhook token
  if (WEBHOOK_SECRET) {
    // Verify requestId matches in both path and query
    if (requestId !== queryRequestId) {
      console.error('Request ID mismatch - Path:', requestId, 'Query:', queryRequestId);
      return res.status(401).json({
        error: 'Unauthorized: Request ID mismatch'
      });
    }

    // Generate expected token and validate
    try {
      const expectedToken = generateWebhookToken(requestId, WEBHOOK_SECRET);

      if (!receivedToken || receivedToken !== expectedToken) {
        console.error('Webhook token validation failed for ID:', requestId);
        console.error('Expected:', expectedToken, 'Received:', receivedToken);
        return res.status(401).json({
          error: 'Unauthorized: Invalid or missing webhook token'
        });
      }
      console.log('Webhook token validated successfully');
    } catch (error) {
      console.error('Error validating webhook token:', error.message);
      return res.status(500).json({
        error: 'Error validating webhook token'
      });
    }
  } else {
    console.warn('WEBHOOK_SECRET not configured - skipping token validation');
  }

  // Look up the agent ID for this webhook
  const agentId = webhookToAgent.get(requestId);
  const agent = agentId ? agentsConfig.agents[agentId] : null;
  const apiKey = agent ? agent.apiKey : Object.values(agentsConfig.agents)[0]?.apiKey; // Fallback to first agent if not found

  if (eventType === "response") {
    console.log("Completing a request");
    console.log("Response content:", req.body.substring(0, 200)); // Log first 200 chars
    connectedClients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        console.log('Sending response to WebSocket client');
        ws.send(JSON.stringify({
          id: requestId,
          content: req.body
        }));
      }
    });

    // Clean up webhook mapping after response is complete
    webhookToAgent.delete(requestId);
  } else if (eventType === "review") {
    const activityJobId = req.headers['aq-activity-job-id'];
    const referenceId = req.headers['aq-reference-id'] || 'none';
    const instructions = req.headers['aq-instructions'] || 'none';
    console.log("Advancing a request: " + activityJobId);
    console.log("Agent ID:", agentId || 'unknown');
    console.log("Reference ID: " + referenceId);
    console.log("Instructions: " + instructions);
    const url = REST_SERVICE_URL + "/advance/" + activityJobId;
    setTimeout(() => {
      axios.post(url, {
        content: "### Approved\n\n" + req.body
      }, {
        headers: {
          'x-api-key': apiKey
        }
      }).catch((error) => {
        console.error('Error advancing activity job:', error);
      });
    }, 2000);
  }
  res.send('Webhook received successfully.');
});
