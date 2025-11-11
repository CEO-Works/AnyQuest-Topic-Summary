const express = require('express');
// const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
// const fs = require('fs');
const { WebSocketServer } = require('ws');
const {randomUUID} = require('crypto');

// Initialize the Express app
const app = express();
const port = process.env.PORT || 3000;

// Set up Multer for file uploads
// const upload = multer({ dest: 'uploads/' });

// Predefined REST service endpoint
const REST_SERVICE_URL = process.env.REST_SERVICE_URL || 'https://api.anyquest.ai';
const AQ_AGENT_API_KEY = process.env.AQ_AGENT_API_KEY || "9a7d4376e010912ba613562d166811e9";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://<YOUR SERVER URL>/webhook/";

// Middleware to parse JSON requests
app.use(express.json());

// Serve the static `index.html` file
app.use(express.static(path.join(__dirname)));

// Set up WebSocket server
const wss = new WebSocketServer({ noServer: true });
let connectedClients = [];

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
  console.log('- AQ_AGENT_API_KEY:', AQ_AGENT_API_KEY ? '***set***' : 'NOT SET');
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

// Handle topic submission (text-only, no files)
app.post('/submit-topic', async (req, res) => {
  try {
    // Generate unique ID for webhook tracking
    const uuid = randomUUID();

    console.log('Submitting topic:', req.body.topic);
    console.log('Webhook URL:', WEBHOOK_URL + uuid);
    console.log('API URL:', REST_SERVICE_URL + "/run");

    // Create FormData (AnyQuest API expects multipart/form-data, not JSON)
    const formData = new FormData();
    formData.append('prompt', req.body.topic);
    formData.append('webhook', WEBHOOK_URL + uuid);

    // Send topic prompt to AnyQuest API
    const response = await axios.post(REST_SERVICE_URL + "/run", formData, {
      headers: {
        'x-api-key': AQ_AGENT_API_KEY,
        ...formData.getHeaders(),
      },
    });

    // Send response back to the client
    res.send('Server responded with: ' + response.status + ' ' + response.statusText);
  } catch (error) {
    console.error('Error submitting topic:', error.message);
    console.error('Error status:', error.response?.status);
    console.error('Error response data:', JSON.stringify(error.response?.data));
    console.error('Request data:', { prompt: req.body.topic, webhook: WEBHOOK_URL + uuid });
    res.status(500).send('An error occurred while submitting the topic: ' + (error.response?.status || error.message));
  }
});

// COMMENTED OUT: Original file upload endpoint
// app.post('/upload', upload.array('files'), async (req, res) => {
//   try {
//     // Create a new FormData instance
//     const formData = new FormData();
//
//     // Append the text field
//     formData.append('prompt', req.body.textField);
//     const uuid = randomUUID();
//     formData.append('webhook', WEBHOOK_URL + uuid);
//     // formData.append('workingFolderPath', "/Reports");
//
//     // Append the files
//     req.files.forEach((file) => {
//       formData.append('files', fs.createReadStream(file.path), file.originalname);
//     });
//
//     // Forward the form data to the REST service
//     const response = await axios.post(REST_SERVICE_URL + "/run", formData, {
//       headers: {
//         'x-api-key': AQ_AGENT_API_KEY,
//         ...formData.getHeaders(),
//       },
//     });
//
//     // Clean up uploaded files
//     req.files.forEach((file) => fs.unlinkSync(file.path));
//
//     // Send response back to the client
//     res.send('Server responded with: ' + response.status + ' ' + response.statusText);
//   } catch (error) {
//     console.error('Error forwarding files:', error);
//
//     // Clean up uploaded files
//     req.files.forEach((file) => fs.unlinkSync(file.path));
//
//     res.status(500).send('An error occurred while forwarding the files.');
//   }
// });

// Handle webhook POST requests
app.post('/webhook/:id', express.text({type: '*/*'}), (req, res) => {
  const eventType = req.headers['aq-event-type'];
  console.log('Webhook received - ID:', req.params.id, 'Event Type:', eventType);
  console.log('Connected clients:', connectedClients.length);

  if (eventType === "response") {
    console.log("Completing a request");
    console.log("Response content:", req.body.substring(0, 200)); // Log first 200 chars
    connectedClients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        console.log('Sending response to WebSocket client');
        ws.send(JSON.stringify({
          id: req.params.id,
          content: req.body
        }));
      }
    });
  } else if (eventType === "review") {
    const activityJobId = req.headers['aq-activity-job-id'];
    const referenceId = req.headers['aq-reference-id'] || 'none';
    const instructions = req.headers['aq-instructions'] || 'none';
    console.log("Advancing a request: " + activityJobId);
    console.log("Reference ID: " + referenceId);
    console.log("Instructions: " + instructions);
    const url = REST_SERVICE_URL + "/advance/" + activityJobId;
    setTimeout(() => {
      axios.post(url, {
        content: "### Approved\n\n" + req.body
      }, {
        headers: {
          'x-api-key': AQ_AGENT_API_KEY
        }
      }).catch((error) => {
        console.error('Error advancing activity job:', error);
      });
    }, 2000);
  }
  res.send('Webhook received successfully.');
});
