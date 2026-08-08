/**
 * Paystack Payment Gateway Integration - Client Side Script
 * Uses Vanilla JS to manage form submission, API calls, and Paystack Inline Popups.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const paymentForm = document.getElementById('payment-form');
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const amountInput = document.getElementById('amount');
  const submitBtn = document.getElementById('submit-btn');
  const btnSpinner = document.getElementById('btn-spinner');
  const btnText = document.getElementById('btn-text');
  
  // Alert Banner Elements
  const alertBanner = document.getElementById('alert-banner');
  const alertTitle = document.getElementById('alert-title');
  const alertMessage = document.getElementById('alert-message');
  const alertClose = document.getElementById('alert-close');

  // Dismiss alert on click
  alertClose.addEventListener('click', hideAlert);

  // Form Submit Event Handler
  paymentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideAlert();

    // 1. Client-Side Input Validation
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const amount = parseFloat(amountInput.value.trim());

    const currencySelect = document.getElementById('currency');
    const currency = currencySelect ? currencySelect.value : 'AUTO';

    if (!validateInputs(name, email, amount)) {
      return;
    }

    // 2. Set UI to Loading State
    setLoadingState(true, 'Initializing...');

    // Dynamic API Base URL detection (supports both port 3000 and VS Code Live Server port 5500)
    const API_BASE_URL = (window.location.port === '3000') ? '' : 'http://localhost:3000';

    try {
      // 3. Request Payment Initialization from Express Backend Server
      const response = await fetch(`${API_BASE_URL}/pay-paystack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, email, amount, currency })
      });

      const result = await response.json();

      if (!response.ok || !result.status) {
        throw new Error(result.message || 'Failed to initialize payment transaction.');
      }

      const { reference, key, access_code, authorization_url } = result.data;

      // 4. Trigger Paystack Inline SDK Modal with complete parameters & authorization_url fallback
      openPaystackModal({
        key: key,
        email: email,
        amount: Math.round(amount * 100),
        ref: reference,
        access_code: access_code,
        authorization_url: authorization_url
      });

    } catch (error) {
      console.error('Initialization Error:', error);
      showAlert('error', 'Initialization Failed', error.message || 'Server error occurred. Please try again.');
      setLoadingState(false);
    }
  });

  /**
   * Initializes and opens Paystack Checkout (Uses SDK v2 resumeTransaction with fallback to authorization_url)
   */
  function openPaystackModal({ key, access_code, authorization_url, ref }) {
    if (typeof PaystackPop !== 'undefined') {
      try {
        const popup = new PaystackPop();
        
        // 1. Paystack SDK v2 resumeTransaction using server-generated access_code
        if (typeof popup.resumeTransaction === 'function') {
          popup.resumeTransaction(access_code);
          setLoadingState(false);
          return;
        }

        // 2. Paystack SDK v2 newTransaction
        if (typeof popup.newTransaction === 'function') {
          popup.newTransaction({
            key: key,
            access_code: access_code,
            onSuccess: (transaction) => {
              setLoadingState(true, 'Verifying Payment...');
              verifyTransactionOnServer(transaction.reference || ref);
            },
            onCancel: () => {
              showAlert('info', 'Payment Cancelled', 'You closed the payment window before completion.');
              setLoadingState(false);
            }
          });
          return;
        }
      } catch (err) {
        console.warn('Paystack Pop SDK error, redirecting to Paystack Checkout URL:', err);
      }
    }

    // 3. Fail-safe Checkout Fallback: Redirect directly to Paystack official hosted checkout URL
    if (authorization_url) {
      window.location.href = authorization_url;
    } else {
      showAlert('error', 'Payment Error', 'Unable to launch Paystack checkout. Please try again.');
      setLoadingState(false);
    }
  }

  /**
   * Calls the backend to double-check and verify payment status directly with Paystack API
   */
  async function verifyTransactionOnServer(reference) {
    const API_BASE_URL = (window.location.port === '3000') ? '' : 'http://localhost:3000';
    try {
      const response = await fetch(`${API_BASE_URL}/verify-payment/${reference}`);
      const result = await response.json();

      if (response.ok && result.status && result.data.status === 'success') {
        const paidAmount = (result.data.amount / 100).toLocaleString('en-KE', {
          style: 'currency',
          currency: result.data.currency || 'KES'
        });

        showAlert(
          'success', 
          'Payment Successful! 🎉', 
          `Your payment of ${paidAmount} was successfully verified. Transaction Ref: ${reference}`
        );

        paymentForm.reset();
      } else {
        const errorMsg = result.data?.gateway_response || result.message || 'Payment verification failed.';
        showAlert('error', 'Payment Unverified ❌', errorMsg);
      }
    } catch (error) {
      console.error('Verification Error:', error);
      showAlert('error', 'Verification Error', 'Unable to verify transaction. Please contact support with Ref: ' + reference);
    } finally {
      setLoadingState(false);
    }
  }

  /**
   * Input Validation Helper
   */
  function validateInputs(name, email, amount) {
    let isValid = true;
    clearFieldErrors();

    if (!name) {
      showFieldError('name', 'Please enter your full name.');
      isValid = false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      showFieldError('email', 'Please enter a valid email address.');
      isValid = false;
    }

    if (isNaN(amount) || amount <= 0) {
      showFieldError('amount', 'Please enter a valid amount greater than 0.');
      isValid = false;
    }

    return isValid;
  }

  /**
   * Toggle Button Loading State
   */
  function setLoadingState(isLoading, text = 'Pay Now') {
    submitBtn.disabled = isLoading;
    if (isLoading) {
      btnSpinner.classList.remove('hidden');
      btnText.textContent = text;
    } else {
      btnSpinner.classList.add('hidden');
      btnText.textContent = 'Pay Now';
    }
  }

  /**
   * Dynamic Alert Banner Display
   */
  function showAlert(type, title, message) {
    alertBanner.className = `alert alert-${type}`;
    alertTitle.textContent = title;
    alertMessage.textContent = message;
  }

  function hideAlert() {
    alertBanner.className = 'alert alert-hidden';
  }

  function showFieldError(fieldId, message) {
    const errorSpan = document.getElementById(`${fieldId}-error`);
    const groupDiv = errorSpan.closest('.form-group');
    if (errorSpan) errorSpan.textContent = message;
    if (groupDiv) groupDiv.classList.add('has-error');
  }

  function clearFieldErrors() {
    ['name', 'email', 'amount'].forEach(fieldId => {
      const errorSpan = document.getElementById(`${fieldId}-error`);
      const groupDiv = errorSpan.closest('.form-group');
      if (errorSpan) errorSpan.textContent = '';
      if (groupDiv) groupDiv.classList.remove('has-error');
    });
  }
});
