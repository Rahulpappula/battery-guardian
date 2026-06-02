// push_server.js – Simple Node.js push notification server
const express = require('express');
const bodyParser = require('body-parser');
const webPush = require('web-push');
const schedule = require('node-schedule');

const app = express();
app.use(bodyParser.json());

// Load VAPID keys (replace with real keys generated via `npx web-push generate-vapid-keys`)
const vapidKeys = {
  publicKey: 'YOUR_PUBLIC_VAPID_KEY',
  privateKey: 'YOUR_PRIVATE_VAPID_KEY'
};
webPush.setVapidDetails(
  'mailto:example@yourdomain.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// In‑memory store for client subscriptions
const subscriptions = [];

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (sub && sub.endpoint) {
    subscriptions.push(sub);
    console.log('New subscription added. Total:', subscriptions.length);
    res.status(201).json({ status: 'subscribed' });
  } else {
    res.status(400).json({ error: 'Invalid subscription' });
  }
});

// Schedule an alarm – expects {title, body, time (ISO string)}
app.post('/schedule', (req, res) => {
  const { title, body, time } = req.body;
  if (!title || !body || !time) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const date = new Date(time);
  if (isNaN(date)) {
    return res.status(400).json({ error: 'Invalid time format' });
  }
  schedule.scheduleJob(date, () => {
    console.log('Sending alarm push at', new Date());
    const payload = JSON.stringify({ title, body, tone: 'default' });
    subscriptions.forEach(sub => {
      webPush.sendNotification(sub, payload).catch(err => {
        console.error('Push error:', err);
      });
    });
  });
  res.json({ status: 'scheduled' });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Push server listening on http://localhost:${PORT}`);
});
