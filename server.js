const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

// Initialize the Express app
const app = express();
const port = 3000;

// Set up Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Predefined REST service endpoint
const REST_SERVICE_URL = 'http://localhost:8080/run';
const AQ_AGENT_API_KEY="3c2c67ec1446fdebd471cbd8a5fb61ce";

// Middleware to parse JSON requests
app.use(express.json());

// Serve the HTML form
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>File Upload</title>
    </head>
    <body>
      <h1>Upload Files</h1>
      <form action="/upload" method="post" enctype="multipart/form-data">
        <label for="textField">Text Field:</label>
        <input type="text" id="textField" name="textField" required><br><br>
        <label for="fileInput">Select Files:</label>
        <input type="file" id="fileInput" name="files" multiple><br><br>
        <button type="submit">Submit</button>
      </form>
    </body>
    </html>
  `);
});

// Handle form submission
app.post('/upload', upload.array('files'), async (req, res) => {
  try {
    // Create a new FormData instance
    const formData = new FormData();

    // Append the text field
    formData.append('prompt', req.body.textField);
    formData.append('webhook', "http://localhost:3000/webhook");

    // Append the files
    req.files.forEach((file) => {
      formData.append('files', fs.createReadStream(file.path), file.originalname);
    });

    // Forward the form data to the REST service
    const response = await axios.post(REST_SERVICE_URL, formData, {
      headers: {
        'x-api-key': AQ_AGENT_API_KEY,
        ...formData.getHeaders(),
      },
    });

    // Clean up uploaded files
    req.files.forEach((file) => fs.unlinkSync(file.path));

    // Send response back to the client
    res.send(`Files successfully forwarded! Server responded with: ${response.status} ${response.statusText}`);
  } catch (error) {
    console.error('Error forwarding files:', error);

    // Clean up uploaded files
    req.files.forEach((file) => fs.unlinkSync(file.path));

    res.status(500).send('An error occurred while forwarding the files.');
  }
});

// Handle webhook POST requests
app.post('/webhook', express.text({ type: '*/*' }), (req, res) => {
    console.log('Webhook received:', req.body);
    res.send('Webhook received successfully.');
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
