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
    const { name, email, amount, phone } = req.body;

    // 1. Server-Side Validation
    if (!name || !email || !amount) {
      return res.status(400).json({
        status: false,
        message: 'Name, email, and amount are required fields.'
      });
    }

    const currency = req.body.currency || 'AUTO';
    const parsedAmount = parseFloat(amount);
    const minAmount = (currency === 'KES') ? 10 : (currency === 'NGN' ? 100 : 10);
    
    if (isNaN(parsedAmount) || parsedAmount < minAmount) {
      return res.status(400).json({
        status: false,
        message: `Amount must be at least ${minAmount} ${currency === 'AUTO' ? '' : currency}.`
      });
    }

    // 2. Convert amount to Paystack subunit (Kobo/Cents/Pesewas: 1 Unit = 100 Subunits)
    const amountInKobo = Math.round(parsedAmount * 100);

    // 3. Prepare payload for Paystack API
    const paystackPayload = {
      email: email,
      amount: amountInKobo,
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

    // Attach phone number to metadata if provided (crucial for pre-filling Mobile Money requests)
    if (phone) {
      paystackPayload.metadata.phone = phone;
      paystackPayload.metadata.custom_fields.push({
        display_name: 'Phone Number',
        variable_name: 'phone_number',
        value: phone
      });
    }

    // Attach currency & filter payment channels to prevent invalid channel requests (e.g. Mobile Money on unsupported currencies)
    if (req.body.currency && req.body.currency !== 'AUTO') {
      paystackPayload.currency = req.body.currency;
      
      if (currency === 'KES' || currency === 'GHS') {
        paystackPayload.channels = ['card', 'mobile_money'];
      } else if (currency === 'NGN') {
        paystackPayload.channels = ['card', 'bank', 'ussd', 'qr', 'bank_transfer'];
      } else if (currency === 'USD' || currency === 'ZAR') {
        paystackPayload.channels = ['card'];
      }
    }

    // 4. Call Paystack Initialize Endpoint using native fetch
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paystackPayload)
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      return res.status(response.status || 400).json({
        status: false,
        message: data.message || 'Failed to initialize Paystack transaction.'
      });
    }

    // 5. Send transaction details and public key back to client
    return res.status(200).json({
      status: true,
      message: 'Transaction initialized successfully.',
      data: {
        authorization_url: data.data.authorization_url,
        access_code: data.data.access_code,
        reference: data.data.reference,
        key: process.env.PAYSTACK_PUBLIC_KEY
      }
    });

  } catch (error) {
    console.error('Error initializing transaction:', error);
    return res.status(500).json({
      status: false,
      message: 'Internal server error while initializing transaction.'
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
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
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
