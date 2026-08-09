/**
 * Paystack Payment Gateway Backend - Express Server
 * Handles Payment Initialization, Server-side Verification, and Webhooks.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;

if (!PAYSTACK_SECRET_KEY || !PAYSTACK_PUBLIC_KEY) {
  console.warn('⚠️ Missing Paystack API keys. Create a local .env file and set PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY.');
}

// Middleware
app.use(cors());

// Parse JSON bodies for REST API endpoints
app.use(express.json());

// Serve static frontend files (index.html, style.css, script.js)
app.use(express.static(path.join(__dirname)));

/**
 * -------------------------------------------------------------------
 * ROUTE 1: Initialize Transaction (POST /pay-paystack)
 * -------------------------------------------------------------------
 * Accepts customer details from frontend, validates data, and calls
 * Paystack API to initialize a transaction securely.
 */
app.post('/pay-paystack', async (req, res) => {
  try {
    const { name, email, amount, currency } = req.body;

    if (!name || !email || !amount) {
      return res.status(400).json({
        status: false,
        message: 'Name, email, and amount are required fields.'
      });
    }

    const parsedAmount = parseFloat(amount);
    const minAmount = 10;

    if (isNaN(parsedAmount) || parsedAmount < minAmount) {
      return res.status(400).json({
        status: false,
        message: `Amount must be at least KES ${minAmount} (1000 cents).`
      });
    }

    const amountInCents = Math.round(parsedAmount * 100);
    const reference = `ref_live_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    const paystackPayload = {
      email: email,
      amount: amountInCents,
      currency: 'KES',
      reference: reference,
      metadata: {
        custom_fields: [
          {
            display_name: 'Customer Name',
            variable_name: 'customer_name',
            value: name
          }
        ]
      }
    };

    const secretKey = (PAYSTACK_SECRET_KEY || '').trim();
    const publicKey = (PAYSTACK_PUBLIC_KEY || '').trim();

    if (!secretKey || !publicKey) {
      return res.status(500).json({
        status: false,
        message: 'Server is missing Paystack API keys. Please check your environment variables and set PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY.'
      });
    }

    if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) {
      console.error('Paystack secret key format appears invalid:', secretKey.slice(0, 12) + '...');
      return res.status(500).json({
        status: false,
        message: 'Paystack secret key format looks invalid. Ensure PAYSTACK_SECRET_KEY is the secret key from Paystack and not the public key, and that there are no extra spaces.'
      });
    }

    console.log('📡 Sending Paystack Initialize Request:', JSON.stringify(paystackPayload, null, 2));

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Node.js/Paystack-Integration)'
      },
      body: JSON.stringify(paystackPayload)
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      console.error('❌ Raw Paystack API Error Data:', JSON.stringify(data, null, 2));
      const isInvalidKey = data.message && data.message.toLowerCase().includes('invalid key');
      const errorMessage = isInvalidKey
        ? 'Invalid Paystack Secret Key. Please check your .env file and ensure PAYSTACK_SECRET_KEY is copied correctly from your Paystack Dashboard (sk_live_... or sk_test_...).'
        : (data.message || 'Failed to initialize Paystack transaction.');

      return res.status(response.status || 400).json({
        status: false,
        message: errorMessage,
        error_details: data
      });
    }

    console.log('✅ Paystack Transaction Initialized Successfully! Ref:', reference);
    return res.status(200).json({
      status: true,
      message: 'Transaction initialized successfully.',
      data: {
        authorization_url: data.data.authorization_url,
        access_code: data.data.access_code,
        reference: data.data.reference || reference,
        key: publicKey
      }
    });
  } catch (error) {
    console.error('❌ Exception during Paystack transaction initialization:', error);
    return res.status(500).json({
      status: false,
      message: 'Internal server error while initializing transaction.',
      error: error.message
    });
  }
});

/**
 * -------------------------------------------------------------------
 * ROUTE 2: Verify Payment (GET /verify-payment/:reference)
 * -------------------------------------------------------------------
 * Queries Paystack API directly using Secret Key to verify payment
 * status after user completes inline transaction.
 */
app.get('/verify-payment/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const secretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();

    if (!reference) {
      return res.status(400).json({
        status: false,
        message: 'Transaction reference is required.'
      });
    }

    // Call Paystack Verify Endpoint
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Node.js/Paystack-Integration)'
      }
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      return res.status(response.status || 400).json({
        status: false,
        message: data.message || 'Payment verification failed.'
      });
    }

    // Payment Verification Success
    return res.status(200).json({
      status: true,
      message: 'Payment verification processed.',
      data: data.data
    });

  } catch (error) {
    console.error('Error verifying payment:', error);
    return res.status(500).json({
      status: false,
      message: 'Internal server error while verifying payment.'
    });
  }
});

/**
 * -------------------------------------------------------------------
 * ROUTE 3: Paystack Webhook Handler (POST /paystack-webhook)
 * -------------------------------------------------------------------
 * Asynchronous event notification sent by Paystack.
 * Cryptographically verifies HMAC SHA512 signature before processing.
 */
app.post('/paystack-webhook', (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers['x-paystack-signature'];

    if (!secret || !signature) {
      return res.status(400).send('Webhook secret or signature missing');
    }

    // 1. Verify HMAC SHA512 Signature
    const hash = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== signature) {
      console.warn('⚠️ Webhook signature mismatch! Unauthorized request.');
      return res.status(400).send('Invalid signature');
    }

    // 2. Process Event
    const event = req.body;

    if (event.event === 'charge.success') {
      const paymentData = event.data;
      console.log('✅ Paystack Webhook Event: charge.success');
      console.log(`Reference: ${paymentData.reference}`);
      console.log(`Amount: ${paymentData.amount / 100} ${paymentData.currency}`);
      console.log(`Customer Email: ${paymentData.customer.email}`);

      // TODO: Perform database operations here (e.g. fulfill order, update user subscription)
    }

    // Acknowledge receipt of event to Paystack with 200 OK
    return res.status(200).send('Webhook processed successfully');

  } catch (error) {
    console.error('Error handling webhook:', error);
    return res.status(500).send('Webhook handler error');
  }
});

// Export Express app for Vercel Serverless Functions
module.exports = app;

// Start Express Server locally
if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Paystack Payment Server running on http://localhost:${PORT}`);
  });
}
